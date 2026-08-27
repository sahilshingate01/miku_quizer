/**
 * Miku Quizer - Universal DOM Question & Options Extractor Engine
 * Uses reverse-proximity option clustering and multi-strategy heuristics to detect
 * quiz questions on any platform (Newton School, HackerEarth, Mettl, Canvas, Google Forms, etc.)
 */

class QuizExtractor {
  constructor() {
    this.excludedPhrases = [
      'next', 'previous', 'back', 'submit', 'submit quiz', 'finish',
      'clear selection', 'clear answer', 'mark for review', 'flag', 'flag question',
      'bookmark', 'hint', 'skip', 'save & next', 'save and continue', 'review question',
      'reset', 'report', 'explain answer', 'show explanation', 'previous question',
      'next question', 'review later', 'run code', 'compile & run', 'view solution'
    ];

    this.questionHeaderRegex = /(?:question|q\.?|problem|item)\s*#?\s*(\d+)(?:\s*(?:\/|of)\s*(\d+))?/i;
  }

  /**
   * Check if a DOM element is visible on screen.
   */
  isVisible(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    if (element.closest('#miku-quizer-root') || element.id === 'miku-quizer-root') return false;

    const style = window.getComputedStyle(element);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0' ||
      element.hidden ||
      element.getAttribute('aria-hidden') === 'true'
    ) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return (rect.width > 0 || element.children.length > 0) && (rect.height > 0 || element.children.length > 0);
  }

  /**
   * Clean and normalize raw text.
   */
  cleanText(text) {
    if (!text) return '';
    return text
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /**
   * Check if text is a common quiz control rather than an answer option.
   */
  isIgnoredText(text) {
    if (!text || text.length < 1) return true;
    const clean = text.toLowerCase().trim();
    if (clean.length > 100) return false;
    return this.excludedPhrases.some(
      phrase => clean === phrase || clean.startsWith(phrase + ' ') || clean.endsWith(' ' + phrase)
    );
  }

  /**
   * Extract question metadata (e.g. QUESTION 1/5).
   */
  extractQuestionMeta(text) {
    if (!text) return { questionNumber: null, totalQuestions: null };
    const match = text.match(this.questionHeaderRegex);
    if (match) {
      const qNum = parseInt(match[1], 10);
      const total = match[2] ? parseInt(match[2], 10) : null;
      return {
        questionNumber: !isNaN(qNum) ? qNum : null,
        totalQuestions: total && !isNaN(total) ? total : null
      };
    }
    return { questionNumber: null, totalQuestions: null };
  }

  /**
   * Safe label splitter that does NOT eat command-line dashes (e.g., "--exit-on-finish").
   */
  splitOptionLabel(rawText, fallbackIndex) {
    const fallbackLabel = String.fromCharCode(65 + fallbackIndex);
    if (!rawText) return { label: fallbackLabel, text: '' };

    const trimmed = this.cleanText(rawText);

    // Multi-line: first line is "A", remaining is option text
    const lines = rawText.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
    if (lines.length >= 2 && /^[A-H1-9]$/i.test(lines[0])) {
      return {
        label: lines[0].toUpperCase(),
        text: lines.slice(1).join(' ').trim()
      };
    }

    // Single-line prefix: "A. text", "A) text", "A text", "(A) text"
    // Using \s+ prevents consuming leading "--" flags!
    const prefixMatch = trimmed.match(/^[\(\[]?([A-Za-z0-9])[\.\)\:\-\]]?\s+(.+)$/);
    if (prefixMatch) {
      const label = prefixMatch[1].toUpperCase();
      const text = prefixMatch[2].trim();
      if (/^[A-H1-9]$/.test(label)) {
        return { label, text: text || trimmed };
      }
    }

    return { label: fallbackLabel, text: trimmed };
  }

  /**
   * Extract option text and element from a card container or option item.
   */
  extractOptionData(optCard, index) {
    const fallbackLabel = String.fromCharCode(65 + index);
    if (!optCard) return null;

    // Check for child badge with option letter (e.g. Newton School [A] box)
    const childNodes = Array.from(optCard.querySelectorAll('div, span, b, strong, p, button'));
    let badgeEl = null;
    let badgeLabel = '';

    for (const child of childNodes) {
      const text = this.cleanText(child.innerText || child.textContent);
      if (/^[A-H1-9]$/i.test(text)) {
        badgeEl = child;
        badgeLabel = text.toUpperCase();
        break;
      }
    }

    if (badgeEl && badgeLabel) {
      // Find the main text child/node
      let text = '';
      for (const child of childNodes) {
        if (child === badgeEl || badgeEl.contains(child) || child.contains(badgeEl)) continue;
        const cText = this.cleanText(child.innerText || child.textContent);
        if (cText && cText.length > text.length && !this.isIgnoredText(cText)) {
          text = cText;
        }
      }

      if (!text) {
        const full = this.cleanText(optCard.innerText || optCard.textContent);
        const parsed = this.splitOptionLabel(full, index);
        text = parsed.text;
      }

      if (text && !this.isIgnoredText(text)) {
        return {
          label: badgeLabel,
          text,
          element: optCard
        };
      }
    }

    // Direct card text
    const fullText = this.cleanText(optCard.innerText || optCard.textContent);
    if (!fullText || this.isIgnoredText(fullText)) return null;

    const { label, text } = this.splitOptionLabel(fullText, index);
    return {
      label,
      text,
      element: optCard
    };
  }

  /**
   * Strategy 1: Universal Option-Cluster Reverse Detection
   * Finds sets of sequential choice badges (A, B, C, D) and traces their parent question.
   */
  detectByOptionClusters() {
    // Find all elements containing just "A" or starting with "A"
    const allElements = Array.from(document.querySelectorAll('div, span, button, label, li, p, b, strong'));
    const candidateABadges = [];

    for (const el of allElements) {
      if (!this.isVisible(el)) continue;
      if (el.children.length > 2) continue;
      const text = this.cleanText(el.innerText || el.textContent);
      if (text === 'A' || text === 'A.' || text === 'A)' || text === '(A)' || text === '1' || text === '1.') {
        candidateABadges.push(el);
      }
    }

    for (const aBadge of candidateABadges) {
      // Find the card wrapping option A
      let aCard = aBadge;
      while (aCard && aCard.parentElement && aCard.parentElement !== document.body && aCard.offsetHeight < 120) {
        if (aCard.parentElement.children.length >= 2 && aCard.parentElement.children.length <= 10) {
          break;
        }
        aCard = aCard.parentElement;
      }

      const optionsParent = aCard?.parentElement;
      if (!optionsParent) continue;

      // Look for sibling option cards B, C, D in the same parent
      const cards = Array.from(optionsParent.children).filter(c => this.isVisible(c) && !this.isIgnoredText(c.innerText));
      if (cards.length < 2 || cards.length > 10) continue;

      const extractedOptions = [];
      const seenLabels = new Set();
      const seenTexts = new Set();

      cards.forEach((card, idx) => {
        const opt = this.extractOptionData(card, idx);
        if (opt && opt.text && !this.isIgnoredText(opt.text) && !seenTexts.has(opt.text.toLowerCase())) {
          seenLabels.add(opt.label);
          seenTexts.add(opt.text.toLowerCase());
          extractedOptions.push(opt);
        }
      });

      // Valid option group must contain at least A and B
      if (extractedOptions.length >= 2) {
        // Find question text: walk backwards from optionsParent
        let questionText = '';
        let questionMeta = { questionNumber: null, totalQuestions: null };

        // Check preceding siblings of optionsParent
        let prev = optionsParent.previousElementSibling;
        while (prev && !questionText) {
          if (this.isVisible(prev)) {
            const t = this.cleanText(prev.innerText || prev.textContent);
            if (t.length > 10 && !this.isIgnoredText(t)) {
              questionText = t;
              break;
            }
          }
          prev = prev.previousElementSibling;
        }

        // If not found in sibling, check parent container headings
        if (!questionText && optionsParent.parentElement) {
          const headings = optionsParent.parentElement.querySelectorAll('h1, h2, h3, h4, h5, p, [class*="question"], [class*="title"], div');
          for (const h of headings) {
            if (!this.isVisible(h) || optionsParent.contains(h)) continue;
            if (h.children.length > 3) continue;
            const t = this.cleanText(h.innerText || h.textContent);
            if (t.length > 10 && !this.isIgnoredText(t) && !this.questionHeaderRegex.test(t)) {
              questionText = t;
              break;
            }
          }
        }

        // Find question header meta (e.g. QUESTION 1/5) in parent or ancestors
        let ancestor = optionsParent.parentElement;
        let depth = 0;
        while (ancestor && ancestor !== document.body && depth < 4) {
          const metaMatch = this.extractQuestionMeta(ancestor.innerText || ancestor.textContent);
          if (metaMatch.questionNumber) {
            questionMeta = metaMatch;
            break;
          }
          ancestor = ancestor.parentElement;
          depth++;
        }

        if (questionText && extractedOptions.length >= 2) {
          // Clean header lines from question text if included
          const cleanQ = questionText
            .replace(/QUESTION\s*\d+(?:\s*(?:\/|of)\s*\d+)?/gi, '')
            .replace(/Mark for review/gi, '')
            .replace(/Clear Selection/gi, '')
            .trim();

          return {
            strategy: 'option-cluster-reverse',
            questionNumber: questionMeta.questionNumber,
            totalQuestions: questionMeta.totalQuestions,
            question: cleanQ || questionText,
            options: extractedOptions
          };
        }
      }
    }

    return null;
  }

  /**
   * Strategy 2: Question Header & Proximity Scanner (Newton School, Exam Portals)
   */
  detectByQuestionHeader() {
    const allHeaders = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, div, span, p, b, strong'));
    let headerEl = null;
    let meta = { questionNumber: null, totalQuestions: null };

    for (const el of allHeaders) {
      if (!this.isVisible(el)) continue;
      if (el.children.length > 3) continue;
      const text = this.cleanText(el.innerText || el.textContent);
      if (this.questionHeaderRegex.test(text) && text.length < 35) {
        meta = this.extractQuestionMeta(text);
        headerEl = el;
        break;
      }
    }

    if (!headerEl) return null;

    // Walk up to question block container
    let container = headerEl.parentElement;
    let depth = 0;
    while (container && container !== document.body && depth < 6) {
      const cards = container.querySelectorAll('[class*="option"], [class*="choice"], [class*="answer"], [role="radio"], label, div[tabindex]');
      if (cards.length >= 2 && cards.length <= 10) break;
      container = container.parentElement;
      depth++;
    }

    if (!container) container = document.body;

    // Find question text
    let questionText = '';
    const textNodes = container.querySelectorAll('h1, h2, h3, h4, h5, p, [class*="question"], [class*="title"], [class*="prompt"], div');
    for (const tn of textNodes) {
      if (!this.isVisible(tn) || tn.contains(headerEl) || headerEl.contains(tn)) continue;
      if (tn.children.length > 4) continue;
      const t = this.cleanText(tn.innerText || tn.textContent);
      if (
        t.length > 8 &&
        !this.isIgnoredText(t) &&
        !this.questionHeaderRegex.test(t) &&
        !t.includes('Mark for review') &&
        !t.includes('Clear Selection')
      ) {
        questionText = t;
        break;
      }
    }

    // Find option elements
    const optionCards = container.querySelectorAll(
      '[class*="option"], [class*="choice"], [class*="answer"], [class*="radio"], [role="radio"], label, div[tabindex]'
    );

    const validOptions = [];
    const seenTexts = new Set();

    for (const card of optionCards) {
      if (!this.isVisible(card)) continue;
      if (card.contains(headerEl)) continue;
      if (questionText && card.textContent.includes(questionText) && card.textContent.length < questionText.length + 10) continue;
      if (validOptions.some(vo => vo.element.contains(card))) continue;

      const opt = this.extractOptionData(card, validOptions.length);
      if (opt && opt.text && !this.isIgnoredText(opt.text) && !seenTexts.has(opt.text.toLowerCase())) {
        seenTexts.add(opt.text.toLowerCase());
        validOptions.push(opt);
      }
    }

    if (validOptions.length >= 2 && questionText.length > 5) {
      return {
        strategy: 'question-header-proximity',
        questionNumber: meta.questionNumber,
        totalQuestions: meta.totalQuestions,
        question: questionText,
        options: validOptions
      };
    }

    return null;
  }

  /**
   * Strategy 3: Standard Form & Radio Input Groups
   */
  detectByRadioInputs() {
    const radioInputs = Array.from(document.querySelectorAll('input[type="radio"]')).filter(r => this.isVisible(r));
    if (radioInputs.length < 2) return null;

    const groups = new Map();
    for (const radio of radioInputs) {
      const name = radio.name || 'unnamed-group';
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(radio);
    }

    for (const [name, radios] of groups.entries()) {
      if (radios.length < 2) continue;

      let ancestor = radios[0].parentElement;
      while (ancestor && ancestor !== document.body && !radios.every(r => ancestor.contains(r))) {
        ancestor = ancestor.parentElement;
      }

      if (!ancestor) continue;

      const headings = ancestor.querySelectorAll('h1, h2, h3, h4, h5, legend, p, [class*="question"], [class*="title"]');
      let questionText = '';
      for (const h of headings) {
        if (this.isVisible(h)) {
          const t = this.cleanText(h.innerText || h.textContent);
          if (t.length > 8 && !this.isIgnoredText(t)) {
            questionText = t;
            break;
          }
        }
      }

      const validOptions = [];
      const seenTexts = new Set();

      radios.forEach((radio, idx) => {
        let labelEl = radio.closest('label');
        if (!labelEl && radio.id) {
          labelEl = document.querySelector(`label[for="${CSS.escape(radio.id)}"]`);
        }
        const targetEl = labelEl || radio.parentElement;
        if (!targetEl || !this.isVisible(targetEl)) return;

        const opt = this.extractOptionData(targetEl, validOptions.length);
        if (opt && opt.text && !this.isIgnoredText(opt.text) && !seenTexts.has(opt.text.toLowerCase())) {
          seenTexts.add(opt.text.toLowerCase());
          validOptions.push(opt);
        }
      });

      if (validOptions.length >= 2) {
        const meta = this.extractQuestionMeta(ancestor.innerText || questionText);
        return {
          strategy: 'radio-groups',
          questionNumber: meta.questionNumber,
          totalQuestions: meta.totalQuestions,
          question: questionText || 'Question detected from form choices:',
          options: validOptions
        };
      }
    }

    return null;
  }

  /**
   * Main entry point to extract the current visible quiz question.
   */
  extractQuizQuestion() {
    const result =
      this.detectByOptionClusters() ||
      this.detectByQuestionHeader() ||
      this.detectByRadioInputs();

    if (!result) return null;

    let cleanQ = this.cleanText(result.question);
    result.options.forEach(opt => {
      if (opt.text && cleanQ.endsWith(opt.text)) {
        cleanQ = cleanQ.replace(opt.text, '').trim();
      }
    });

    return {
      questionNumber: result.questionNumber,
      totalQuestions: result.totalQuestions,
      question: cleanQ,
      options: result.options.map(opt => ({
        label: opt.label,
        text: opt.text,
        element: opt.element
      })),
      strategy: result.strategy
    };
  }
}

if (typeof window !== 'undefined') {
  window.MikuQuizExtractor = QuizExtractor;
}
