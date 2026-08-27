/**
 * Miku Quizer - Option Highlighter Module (Zero DOM Injection)
 * Applies pure non-intrusive CSS classes and pseudo-elements.
 * STRICT SAFETY RULE: Never injects child DOM nodes (prevents React/SPA reconciliation crashes).
 * STRICT SAFETY RULE: Never calls .click() or programmatically checks inputs.
 */

class OptionHighlighter {
  constructor() {
    this.currentHighlightedElements = [];
  }

  /**
   * Clear all active visual highlights from the DOM.
   */
  clear() {
    this.currentHighlightedElements.forEach(el => {
      try {
        if (el && el.classList) {
          el.classList.remove('miku-suggested');
        }
      } catch (e) {
        // Ignore detached elements
      }
    });
    this.currentHighlightedElements = [];

    // Global cleanup query
    document.querySelectorAll('.miku-suggested').forEach(el => {
      el.classList.remove('miku-suggested');
    });

    // Remove any legacy injected badge elements if present
    document.querySelectorAll('.miku-suggest-badge').forEach(el => {
      el.remove();
    });
  }

  /**
   * Highlight the suggested option safely via CSS class without adding DOM nodes.
   * @param {Object} suggestedOption - { label, text, element }
   * @param {number} confidence - Confidence score (0 to 1)
   */
  highlight(suggestedOption, confidence = 0.95) {
    this.clear();

    if (!suggestedOption || !suggestedOption.element) return;

    const el = suggestedOption.element;

    try {
      el.classList.add('miku-suggested');
      this.currentHighlightedElements.push(el);

      console.log(`[Miku Quizer Highlighter] Highlighted option "${suggestedOption.label}" cleanly via CSS.`);
    } catch (err) {
      console.warn('[Miku Quizer Highlighter] Failed to apply highlight class:', err);
    }
  }
}

if (typeof window !== 'undefined') {
  window.MikuOptionHighlighter = OptionHighlighter;
}
