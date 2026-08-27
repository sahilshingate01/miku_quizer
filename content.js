/**
 * Miku Quizer - Content Script Orchestrator
 * Detects questions, coordinates with the background AI service, displays the floating HUD,
 * highlights answers, auto-selects options safely, and auto-advances to the next question.
 */

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__MIKU_QUIZER_INITIALIZED__) {
    console.log('🎵 [Miku Quizer] Content script already active on this tab.');
    return;
  }
  window.__MIKU_QUIZER_INITIALIZED__ = true;

  console.log('🎵 [Miku Quizer] Content script loaded on:', window.location.hostname);

  let extractor = null;
  let highlighter = null;
  let floatingPanel = null;
  let mutationObserver = null;
  let debounceTimeout = null;

  let lastQuestionHash = null;
  let lastSelectedQuestionHash = null;
  let currentConfig = null;
  let currentDetectedQuestion = null;
  let lastSolvedResult = null;
  let advanceTimeout = null;
  let selectTimeout = null;
  let isAssistantRunning = false;

  /**
   * Fast hashing for questions to prevent duplicate processing on DOM mutations.
   */
  function hashQuestion(question, options) {
    const raw = (question || '') + ':::' + (options || []).map(o => o.text).sort().join('|');
    let hash = 0x811c9dc5;
    for (let i = 0; i < raw.length; i++) {
      hash ^= raw.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(16);
  }

  /**
   * Load configuration from background worker.
   */
  async function loadConfig() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (response) => {
        if (response && response.success) {
          currentConfig = response.config;
          resolve(currentConfig);
        } else {
          resolve({});
        }
      });
    });
  }

  /**
   * Safely dispatch full mouse and pointer events so React/Next.js registers the click.
   */
  function safelyClickElement(el) {
    if (!el) return false;
    try {
      const mouseEvents = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
      mouseEvents.forEach(evtName => {
        const evt = new MouseEvent(evtName, {
          bubbles: true,
          cancelable: true,
          view: window
        });
        el.dispatchEvent(evt);
      });

      // Also trigger on child elements
      const child = el.querySelector('input, label, button, span, div');
      if (child && child !== el) {
        mouseEvents.forEach(evtName => {
          const evt = new MouseEvent(evtName, {
            bubbles: true,
            cancelable: true,
            view: window
          });
          child.dispatchEvent(evt);
        });
      }

      if (typeof el.click === 'function') {
        el.click();
      }
      return true;
    } catch (e) {
      console.warn('[Miku Quizer] Click error:', e);
      return false;
    }
  }

  /**
   * Checks if an option element is already in a selected/checked state.
   */
  function isElementAlreadySelected(el) {
    if (!el) return false;
    try {
      const radio = el.querySelector('input[type="radio"], input[type="checkbox"]');
      if (radio && radio.checked) return true;

      if (el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true') return true;
      if (el.querySelector('[aria-checked="true"], [aria-selected="true"]')) return true;

      const className = String(el.className || '').toLowerCase();
      if (className.includes('selected') || className.includes('checked') || className.includes('active')) {
        return true;
      }
    } catch (e) {}
    return false;
  }

  /**
   * Selects the suggested option on the webpage without duplicate clicks.
   */
  function selectSuggestedOption(answerLabel) {
    if (!currentDetectedQuestion || !currentDetectedQuestion.options) return false;
    const qHash = hashQuestion(currentDetectedQuestion.question, currentDetectedQuestion.options);

    // Guard: Prevent double-clicking / toggle de-selecting the same question
    if (lastSelectedQuestionHash === qHash) {
      console.log('[Miku Quizer] Option already selected for this question, skipping repeat click.');
      return true;
    }

    const label = String(answerLabel || lastSolvedResult?.answer || '').trim().toUpperCase();
    if (!label) return false;

    // 1. Try matching label (e.g. "C")
    let matchedOpt = currentDetectedQuestion.options.find(
      o => String(o.label).trim().toUpperCase() === label
    );

    // 2. Fallback: match by letter index (A=0, B=1, C=2, D=3...)
    if (!matchedOpt && label.length === 1 && label >= 'A' && label <= 'Z') {
      const idx = label.charCodeAt(0) - 65;
      if (idx >= 0 && idx < currentDetectedQuestion.options.length) {
        matchedOpt = currentDetectedQuestion.options[idx];
      }
    }

    if (matchedOpt && matchedOpt.element) {
      if (isElementAlreadySelected(matchedOpt.element)) {
        console.log('[Miku Quizer] Option DOM is already in selected state.');
        lastSelectedQuestionHash = qHash;
        return true;
      }

      safelyClickElement(matchedOpt.element);
      lastSelectedQuestionHash = qHash;
      console.log('[Miku Quizer] Selected option:', label, matchedOpt.text);
      return true;
    }

    console.warn('[Miku Quizer] Could not find option element for label:', label);
    return false;
  }

  /**
   * Finds and clicks the Next button on the quiz page.
   */
  function clickNextQuizButton() {
    const allCandidates = Array.from(
      document.querySelectorAll(
        'button, [role="button"], a, div[tabindex], div[class*="next"], button[class*="next"]'
      )
    );

    let nextBtn = null;

    for (const btn of allCandidates) {
      if (btn.closest('#miku-quizer-root')) continue;
      const text = (btn.innerText || btn.textContent || '').toLowerCase().trim();
      const clean = text.replace(/[^a-z]/g, ' ').trim();
      
      // Match "next", "next >", "next question", "save & next"
      if (
        (clean === 'next' || clean.startsWith('next') || clean.endsWith('next') || clean === 'save next') &&
        !text.includes('submit') &&
        !text.includes('previous') &&
        !text.includes('prev') &&
        !text.includes('review') &&
        !text.includes('clear')
      ) {
        nextBtn = btn;
        break;
      }
    }

    if (!nextBtn) {
      for (const btn of allCandidates) {
        if (btn.closest('#miku-quizer-root')) continue;
        const text = (btn.innerText || btn.textContent || '').toLowerCase();
        if (text.includes('next') && !text.includes('submit') && !text.includes('prev')) {
          nextBtn = btn;
          break;
        }
      }
    }

    if (nextBtn) {
      console.log('[Miku Quizer] Clicking Next button automatically:', nextBtn);
      safelyClickElement(nextBtn);
      // Non-forcing scans so it only triggers when the question hash actually changes on the DOM
      setTimeout(() => { if (isAssistantRunning) scanPage(false); }, 400);
      setTimeout(() => { if (isAssistantRunning) scanPage(false); }, 900);
      setTimeout(() => { if (isAssistantRunning) scanPage(false); }, 1500);
      return true;
    } else {
      console.warn('[Miku Quizer] Could not locate Next button on page.');
      return false;
    }
  }

  /**
   * Process and solve the detected question.
   */
  async function handleQuestionDetected(detected, forceRefresh = false) {
    if (!detected || !detected.question || !detected.options || detected.options.length < 2) {
      return;
    }

    const qHash = hashQuestion(detected.question, detected.options);

    // Skip if question hasn't changed unless user explicitly clicked refresh
    if (!forceRefresh && qHash === lastQuestionHash) {
      return;
    }

    lastQuestionHash = qHash;
    currentDetectedQuestion = detected;

    // Reset previous highlights
    if (highlighter) highlighter.clear();

    // Update floating HUD to thinking state
    if (floatingPanel) {
      floatingPanel.show();
      floatingPanel.setThinking({
        question: detected.question,
        questionNumber: detected.questionNumber,
        totalQuestions: detected.totalQuestions
      });
    }

    console.log('[Miku Quizer] Querying AI for question:', {
      question: detected.question,
      optionsCount: detected.options.length,
      strategy: detected.strategy
    });

    // Send question to background service worker
    chrome.runtime.sendMessage(
      {
        type: 'SOLVE_QUESTION',
        payload: {
          question: detected.question,
          options: detected.options.map(o => ({ label: o.label, text: o.text })),
          questionNumber: detected.questionNumber,
          totalQuestions: detected.totalQuestions,
          forceRefresh: Boolean(forceRefresh)
        }
      },
      (response) => {
        if (!isAssistantRunning) return;

        if (!response) {
          if (floatingPanel) floatingPanel.setError('Could not connect to Miku background service. Try refreshing the page.');
          return;
        }

        if (!response.success) {
          if (floatingPanel) {
            floatingPanel.setError(
              response.error || "Miku couldn't get an answer. Please check if the backend proxy is running."
            );
          }
          return;
        }

        const data = response.data;
        lastSolvedResult = data;
        console.log('[Miku Quizer] Received AI answer:', data);

        // Update floating HUD
        if (floatingPanel) {
          floatingPanel.setReady(
            {
              answer: data.answer,
              confidence: data.confidence,
              explanation: data.explanation,
              sources: data.sources,
              fromCache: response.fromCache
            },
            {
              question: detected.question,
              questionNumber: detected.questionNumber,
              totalQuestions: detected.totalQuestions
            }
          );
        }

        // Highlight suggested option visually only if explicitly enabled
        if (currentConfig?.highlightOption && highlighter) {
          const matchedOpt = detected.options.find(
            o => String(o.label).trim().toUpperCase() === String(data.answer).trim().toUpperCase()
          );

          if (matchedOpt) {
            highlighter.highlight(matchedOpt, data.confidence);
          }
        }

        // 1. Natural Pacing: Delay selecting option by ~500ms
        if (selectTimeout) clearTimeout(selectTimeout);
        selectTimeout = setTimeout(() => {
          if (!isAssistantRunning) return;
          if (currentConfig?.autoSelect !== false) {
            selectSuggestedOption(data.answer);
          }
        }, 500);

        // 2. Auto-advance to next question (3.5s) if enabled and not final question
        const isLastQuestion = detected.totalQuestions && detected.questionNumber && (detected.questionNumber >= detected.totalQuestions);
        if (advanceTimeout) clearTimeout(advanceTimeout);

        if (currentConfig?.autoAdvance !== false && !isLastQuestion) {
          const delaySec = Math.max(0.5, parseFloat(currentConfig?.advanceDelaySeconds) || 3.5);
          console.log(`[Miku Quizer] Auto-advancing in ${delaySec}s...`);

          if (floatingPanel) {
            floatingPanel.showAdvanceCountdown(delaySec);
          }

          advanceTimeout = setTimeout(() => {
            if (!isAssistantRunning) return;
            clickNextQuizButton();
          }, 500 + (delaySec * 1000));
        }
      }
    );
  }

  /**
   * Scan page DOM for questions.
   */
  function scanPage(force = false) {
    try {
      if (!isAssistantRunning) return null;
      if (!extractor) return null;
      const detected = extractor.extractQuizQuestion();

      if (detected && detected.options && detected.options.length >= 2) {
        handleQuestionDetected(detected, force);
        return detected;
      } else {
        if (lastQuestionHash !== null) {
          if (highlighter) highlighter.clear();
          lastQuestionHash = null;
          if (floatingPanel) floatingPanel.setIdle();
        }
        return null;
      }
    } catch (err) {
      console.warn('[Miku Quizer] Error while scanning page:', err);
      return null;
    }
  }

  /**
   * Debounced DOM scanner.
   */
  function triggerDebouncedScan() {
    if (!isAssistantRunning) return;
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      if (isAssistantRunning) scanPage();
    }, 350);
  }

  /**
   * Setup MutationObserver to watch for quiz dynamic changes.
   */
  function setupMutationObserver() {
    if (mutationObserver) {
      mutationObserver.disconnect();
    }

    mutationObserver = new MutationObserver((mutations) => {
      if (!isAssistantRunning) return;
      const relevant = mutations.some(m => {
        if (m.target && m.target.closest) {
          if (m.target.closest('#miku-quizer-root') || m.target.classList?.contains('miku-suggest-badge')) {
            return false;
          }
        }
        return true;
      });

      if (relevant) {
        triggerDebouncedScan();
      }
    });

    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function activateAssistant() {
    isAssistantRunning = true;
    if (floatingPanel) floatingPanel.show();
    setupMutationObserver();
    scanPage(true);
    console.log('[Miku Quizer] Assistant activated on tab.');
  }

  function deactivateAssistant() {
    isAssistantRunning = false;
    if (selectTimeout) { clearTimeout(selectTimeout); selectTimeout = null; }
    if (advanceTimeout) { clearTimeout(advanceTimeout); advanceTimeout = null; }
    if (debounceTimeout) { clearTimeout(debounceTimeout); debounceTimeout = null; }
    if (floatingPanel) {
      floatingPanel.cancelAdvanceCountdown();
      floatingPanel.hide();
    }
    if (highlighter) highlighter.clear();
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }
    lastSelectedQuestionHash = null;
    console.log('[Miku Quizer] Assistant stopped completely.');
  }

  /**
   * Listen for messages from Popup or Background.
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'START_ASSISTANT' || message.type === 'ACTIVATE_ASSISTANT') {
      activateAssistant();
      const detected = scanPage(true);
      sendResponse({
        success: true,
        active: true,
        detected: detected ? {
          question: detected.question,
          questionNumber: detected.questionNumber,
          totalQuestions: detected.totalQuestions,
          optionsCount: detected.options.length
        } : null,
        lastResult: lastSolvedResult
      });
      return true;
    } else if (message.type === 'STOP_ASSISTANT' || message.type === 'DEACTIVATE_ASSISTANT') {
      deactivateAssistant();
      sendResponse({ success: true, active: false });
      return true;
    } else if (message.type === 'GET_TAB_STATUS') {
      sendResponse({
        success: true,
        active: isAssistantRunning,
        detected: currentDetectedQuestion ? {
          question: currentDetectedQuestion.question,
          questionNumber: currentDetectedQuestion.questionNumber,
          totalQuestions: currentDetectedQuestion.totalQuestions
        } : null,
        lastResult: lastSolvedResult
      });
      return true;
    } else if (message.type === 'SCAN_PAGE') {
      if (!isAssistantRunning) {
        activateAssistant();
      }
      const detected = scanPage(message.force || false);
      sendResponse({
        success: true,
        active: isAssistantRunning,
        detected: detected ? {
          question: detected.question,
          questionNumber: detected.questionNumber,
          totalQuestions: detected.totalQuestions,
          optionsCount: detected.options.length
        } : null,
        lastResult: lastSolvedResult
      });
      return true;
    } else if (message.type === 'SELECT_AND_NEXT') {
      if (selectTimeout) clearTimeout(selectTimeout);
      if (advanceTimeout) clearTimeout(advanceTimeout);
      selectSuggestedOption(lastSolvedResult?.answer);
      setTimeout(() => {
        clickNextQuizButton();
      }, 350);
      sendResponse({ success: true });
      return true;
    }
  });

  /**
   * Main Initialization.
   */
  async function init() {
    const config = await loadConfig();

    const currentHost = window.location.hostname;
    if (config.disabledSites && config.disabledSites.includes(currentHost)) {
      console.log(`[Miku Quizer] Extension is disabled on ${currentHost}`);
      return;
    }

    extractor = new (window.MikuQuizExtractor || QuizExtractor)();
    highlighter = new (window.MikuOptionHighlighter || OptionHighlighter)();
    floatingPanel = new (window.MikuFloatingPanel || FloatingPanel)({
      position: config.panelPosition || 'top-right',
      showConfidence: config.showConfidence,
      showExplanation: config.showExplanation,
      onRefresh: () => {
        if (!isAssistantRunning) return;
        if (currentDetectedQuestion) {
          handleQuestionDetected(currentDetectedQuestion, true);
        } else {
          scanPage(true);
        }
      },
      onSelectAndNext: () => {
        if (selectTimeout) clearTimeout(selectTimeout);
        if (advanceTimeout) clearTimeout(advanceTimeout);
        selectSuggestedOption(lastSolvedResult?.answer);
        setTimeout(() => {
          clickNextQuizButton();
        }, 350);
      },
      onCancelAdvance: () => {
        if (advanceTimeout) {
          clearTimeout(advanceTimeout);
          advanceTimeout = null;
          console.log('[Miku Quizer] Auto-advance paused by user.');
        }
      },
      onClose: () => {
        deactivateAssistant();
      }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.config) {
        currentConfig = { ...currentConfig, ...changes.config.newValue };
        if (floatingPanel) floatingPanel.updateConfig(currentConfig);

        if (currentConfig.disabledSites && currentConfig.disabledSites.includes(currentHost)) {
          deactivateAssistant();
        } else if (currentConfig.assistantActive === false && isAssistantRunning) {
          deactivateAssistant();
        } else if (currentConfig.assistantActive === true && !isAssistantRunning) {
          activateAssistant();
        }
      }
    });

    // Proactively listen for Next/Previous button clicks only if active
    document.addEventListener('click', (e) => {
      if (!isAssistantRunning) return;
      const btn = e.target.closest('button, a, [role="button"], div[tabindex]');
      if (btn) {
        const text = (btn.innerText || btn.textContent || '').toLowerCase().trim();
        if (
          text.includes('next') ||
          text.includes('prev') ||
          text.includes('save') ||
          text.includes('continue') ||
          text.includes('question')
        ) {
          setTimeout(() => { if (isAssistantRunning) scanPage(); }, 250);
          setTimeout(() => { if (isAssistantRunning) scanPage(); }, 750);
        }
      }
    }, true);

    // Start assistant if active in config
    if (config.assistantActive !== false) {
      activateAssistant();
    } else {
      floatingPanel.hide();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
