/**
 * Miku Quizer - Floating UI Panel (Shadow DOM)
 * Encapsulated draggable, minimizable cyber-Miku HUD.
 */

class FloatingPanel {
  constructor(options = {}) {
    this.onRefresh = options.onRefresh || (() => {});
    this.onClose = options.onClose || (() => {});
    this.onSelectAndNext = options.onSelectAndNext || (() => {});
    this.onCancelAdvance = options.onCancelAdvance || (() => {});
    this.defaultPosition = options.position || 'top-right';
    this.showConfidence = options.showConfidence !== false;
    this.showExplanation = options.showExplanation !== false;
    this.countdownInterval = null;

    this.rootContainer = null;
    this.shadowRoot = null;
    this.panelElement = null;
    this.isMinimized = false;
    this.isDragging = false;
    this.dragOffset = { x: 0, y: 0 };
    this.state = {
      status: 'idle', // 'idle', 'detected', 'thinking', 'ready', 'error'
      questionMeta: null,
      result: null,
      errorMsg: null,
      showReasoning: false
    };

    this.init();
  }

  /**
   * Initialize and attach Shadow DOM container to document body.
   */
  init() {
    if (document.getElementById('miku-quizer-root')) {
      document.getElementById('miku-quizer-root').remove();
    }

    this.rootContainer = document.createElement('div');
    this.rootContainer.id = 'miku-quizer-root';
    this.rootContainer.style.all = 'initial';
    this.rootContainer.style.position = 'fixed';
    this.rootContainer.style.zIndex = '2147483647';
    this.rootContainer.style.top = '0';
    this.rootContainer.style.left = '0';
    this.rootContainer.style.display = 'block';
    this.rootContainer.style.pointerEvents = 'none';

    this.shadowRoot = this.rootContainer.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = this.getTemplate();

    document.body.appendChild(this.rootContainer);

    this.panelElement = this.shadowRoot.getElementById('miku-panel');
    this.minimizedPill = this.shadowRoot.getElementById('miku-mini-pill');

    this.applyInitialPosition();
    this.renderBody();
    this.attachEventListeners();
  }

  /**
   * Position panel according to settings.
   */
  applyInitialPosition() {
    if (!this.panelElement) return;

    this.panelElement.style.removeProperty('top');
    this.panelElement.style.removeProperty('bottom');
    this.panelElement.style.removeProperty('left');
    this.panelElement.style.removeProperty('right');

    const margin = '20px';
    switch (this.defaultPosition) {
      case 'top-left':
        this.panelElement.style.top = margin;
        this.panelElement.style.left = margin;
        break;
      case 'bottom-left':
        this.panelElement.style.bottom = margin;
        this.panelElement.style.left = margin;
        break;
      case 'bottom-right':
        this.panelElement.style.bottom = margin;
        this.panelElement.style.right = margin;
        break;
      case 'top-right':
      default:
        this.panelElement.style.top = margin;
        this.panelElement.style.right = margin;
        break;
    }
  }

  /**
   * Attach drag & drop, minimize, close and refresh interactions.
   */
  attachEventListeners() {
    const header = this.shadowRoot.getElementById('miku-drag-handle');
    const minBtn = this.shadowRoot.getElementById('btn-minimize');
    const closeBtn = this.shadowRoot.getElementById('btn-close');
    const miniPill = this.shadowRoot.getElementById('miku-mini-pill');

    // Dragging logic
    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('.miku-ctrl-btn')) return;
      this.isDragging = true;
      const rect = this.panelElement.getBoundingClientRect();
      this.dragOffset.x = e.clientX - rect.left;
      this.dragOffset.y = e.clientY - rect.top;
      this.panelElement.classList.add('is-dragging');
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      let left = e.clientX - this.dragOffset.x;
      let top = e.clientY - this.dragOffset.y;

      // Keep within screen bounds
      const pWidth = this.panelElement.offsetWidth;
      const pHeight = this.panelElement.offsetHeight;
      const maxX = window.innerWidth - pWidth - 10;
      const maxY = window.innerHeight - pHeight - 10;

      left = Math.max(10, Math.min(left, maxX));
      top = Math.max(10, Math.min(top, maxY));

      this.panelElement.style.left = `${left}px`;
      this.panelElement.style.top = `${top}px`;
      this.panelElement.style.right = 'auto';
      this.panelElement.style.bottom = 'auto';
    });

    window.addEventListener('mouseup', () => {
      if (this.isDragging) {
        this.isDragging = false;
        this.panelElement.classList.remove('is-dragging');
      }
    });

    // Minimize toggle
    minBtn.addEventListener('click', () => {
      this.setMinimized(true);
    });

    miniPill.addEventListener('click', () => {
      this.setMinimized(false);
    });

    // Close button
    closeBtn.addEventListener('click', () => {
      this.hide();
      this.onClose();
    });

    // Delegated actions for dynamically rendered buttons (Refresh, Reasoning toggle, Retry, Select & Next)
    this.shadowRoot.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;

      const action = btn.dataset.action;
      if (action === 'select-and-next') {
        this.cancelAdvanceCountdown();
        this.onSelectAndNext();
      } else if (action === 'cancel-advance') {
        this.cancelAdvanceCountdown();
        this.onCancelAdvance();
      } else if (action === 'refresh' || action === 'retry') {
        this.cancelAdvanceCountdown();
        this.onRefresh();
      } else if (action === 'toggle-reasoning') {
        this.state.showReasoning = !this.state.showReasoning;
        this.renderBody();
      }
    });
  }

  showAdvanceCountdown(seconds) {
    const boxEl = this.shadowRoot.getElementById('miku-countdown-box');
    const barEl = this.shadowRoot.getElementById('miku-countdown-bar');
    const secEl = this.shadowRoot.getElementById('miku-countdown-sec');
    if (!boxEl) return;

    boxEl.style.display = 'flex';
    let remaining = seconds;
    if (secEl) secEl.textContent = `${remaining}s`;

    if (this.countdownInterval) clearInterval(this.countdownInterval);

    if (barEl) {
      barEl.style.transition = 'none';
      barEl.style.width = '100%';
      setTimeout(() => {
        barEl.style.transition = `width ${seconds}s linear`;
        barEl.style.width = '0%';
      }, 50);
    }

    this.countdownInterval = setInterval(() => {
      remaining = Math.max(0, (remaining - 0.5));
      if (secEl) secEl.textContent = `${remaining.toFixed(1)}s`;
      if (remaining <= 0) {
        clearInterval(this.countdownInterval);
      }
    }, 500);
  }

  cancelAdvanceCountdown() {
    if (this.countdownInterval) clearInterval(this.countdownInterval);
    const boxEl = this.shadowRoot.getElementById('miku-countdown-box');
    if (boxEl) boxEl.style.display = 'none';
  }

  setMinimized(minimized) {
    this.isMinimized = minimized;
    if (minimized) {
      this.panelElement.style.display = 'none';
      this.minimizedPill.style.display = 'flex';
    } else {
      this.panelElement.style.display = 'flex';
      this.minimizedPill.style.display = 'none';
    }
  }

  show() {
    if (this.rootContainer) {
      this.rootContainer.style.display = 'block';
    }
  }

  hide() {
    if (this.rootContainer) {
      this.rootContainer.style.display = 'none';
    }
  }

  updateConfig(config = {}) {
    if (config.panelPosition && config.panelPosition !== this.defaultPosition) {
      this.defaultPosition = config.panelPosition;
      this.applyInitialPosition();
    }
    this.showConfidence = config.showConfidence !== false;
    this.showExplanation = config.showExplanation !== false;
    this.renderBody();
  }

  // --- State setters ---

  setIdle() {
    this.state.status = 'idle';
    this.state.questionMeta = null;
    this.state.result = null;
    this.state.errorMsg = null;
    this.renderBody();
  }

  setDetected(meta) {
    this.state.status = 'detected';
    this.state.questionMeta = meta;
    this.state.result = null;
    this.state.errorMsg = null;
    this.renderBody();
  }

  setThinking(meta) {
    this.state.status = 'thinking';
    this.state.questionMeta = meta;
    this.state.result = null;
    this.state.errorMsg = null;
    this.renderBody();
  }

  setReady(result, meta) {
    this.state.status = 'ready';
    this.state.result = result;
    this.state.questionMeta = meta;
    this.state.errorMsg = null;
    this.renderBody();
  }

  setError(errorMsg, meta) {
    this.state.status = 'error';
    this.state.errorMsg = errorMsg;
    this.state.questionMeta = meta;
    this.renderBody();
  }

  /**
   * Re-renders the dynamic body content based on state.
   */
  renderBody() {
    const bodyEl = this.shadowRoot.getElementById('miku-panel-body');
    const miniText = this.shadowRoot.getElementById('mini-pill-text');
    if (!bodyEl) return;

    const { status, questionMeta, result, errorMsg, showReasoning } = this.state;

    let contentHtml = '';

    // Update mini pill text
    if (status === 'ready' && result) {
      miniText.textContent = `Suggested: ${result.answer}`;
    } else if (status === 'thinking') {
      miniText.textContent = 'Thinking...';
    } else if (status === 'detected') {
      miniText.textContent = 'Question Detected';
    } else {
      miniText.textContent = 'Miku Quizer';
    }

    switch (status) {
      case 'idle':
        contentHtml = `
          <div class="miku-status-box idle">
            <div class="miku-radar-ring"></div>
            <div class="miku-status-title">Listening for Quiz</div>
            <div class="miku-status-desc">Navigate to a quiz page or click Next. Miku will detect the question automatically.</div>
          </div>
        `;
        break;

      case 'detected':
        contentHtml = `
          <div class="miku-status-box detected">
            <div class="miku-badge-pill cyan">
              ${questionMeta?.questionNumber ? `Q ${questionMeta.questionNumber}${questionMeta.totalQuestions ? `/${questionMeta.totalQuestions}` : ''}` : 'Question Detected'}
            </div>
            <div class="miku-status-desc q-preview">${this.escapeHTML(questionMeta?.question || '')}</div>
            <div class="miku-pulse-line"></div>
          </div>
        `;
        break;

      case 'thinking':
        contentHtml = `
          <div class="miku-status-box thinking">
            <div class="miku-equalizer">
              <span class="bar bar1"></span>
              <span class="bar bar2"></span>
              <span class="bar bar3"></span>
              <span class="bar bar4"></span>
              <span class="bar bar5"></span>
            </div>
            <div class="miku-status-title neon">Miku is Analyzing...</div>
            <div class="miku-status-desc">Querying Groq AI for optimal answer & explanation</div>
          </div>
        `;
        break;

      case 'ready':
        if (!result) return;
        const confidencePct = Math.round((result.confidence || 0.9) * 100);
        const fromCacheTag = result.fromCache ? '<span class="miku-tag-cached">⚡ Cached</span>' : '';
        const isFinalQuestion = questionMeta?.totalQuestions && questionMeta?.questionNumber && (questionMeta.questionNumber >= questionMeta.totalQuestions);

        if (isFinalQuestion) {
          miniText.textContent = '🏁 End of Quiz';
        }

        contentHtml = `
          <div class="miku-ready-container">
            <div class="miku-answer-hero">
              <div class="miku-suggested-badge">
                <span class="label-prefix">Suggested</span>
                <span class="label-answer">${this.escapeHTML(result.answer)}</span>
              </div>
              
              ${this.showConfidence ? `
                <div class="miku-confidence-wrapper">
                  <div class="confidence-header">
                    <span class="conf-title">Confidence</span>
                    <span class="conf-val">${confidencePct}% ${fromCacheTag}</span>
                  </div>
                  <div class="conf-track">
                    <div class="conf-bar" style="width: ${confidencePct}%"></div>
                  </div>
                </div>
              ` : ''}
            </div>

            ${this.showExplanation && result.explanation ? `
              <div class="miku-explanation-card">
                <div class="miku-expl-title">
                  <span>💡 Why this answer?</span>
                </div>
                <div class="miku-expl-text">${this.escapeHTML(result.explanation)}</div>
              </div>
            ` : ''}

            ${result.sources && result.sources.length > 0 ? `
              <div class="miku-sources-box">
                <span class="sources-label">Sources:</span> ${this.escapeHTML(result.sources.join(', '))}
              </div>
            ` : ''}

            ${!isFinalQuestion ? `
              <div class="miku-countdown-box" id="miku-countdown-box" style="display: none;">
                <div class="countdown-info">
                  <span class="countdown-label">⏩ Next Question in:</span>
                  <span class="countdown-sec" id="miku-countdown-sec">3.5s</span>
                </div>
                <div class="countdown-track">
                  <div class="countdown-fill" id="miku-countdown-bar"></div>
                </div>
                <button class="btn-cancel-advance" data-action="cancel-advance" title="Pause and stay on this question">Pause</button>
              </div>
            ` : ''}

            ${isFinalQuestion ? `
              <div class="miku-final-box">
                <div class="miku-final-header">
                  <span class="miku-final-icon">🏁</span>
                  <span class="miku-final-title">End of Quiz</span>
                </div>
                <div class="miku-final-desc">All ${questionMeta.totalQuestions} questions completed! Review your choices and click <b>Submit Quiz</b> when ready.</div>
              </div>
              <div class="miku-actions-bar" style="justify-content: flex-end;">
                <button class="miku-btn miku-btn-secondary" data-action="refresh" title="Re-evaluate with Groq AI">
                  <span class="btn-icon">🔄</span> Re-check
                </button>
              </div>
            ` : `
              <div class="miku-actions-bar">
                <button class="miku-btn miku-btn-primary" data-action="select-and-next" title="Select Option ${this.escapeHTML(result.answer)} and go to Next Question">
                  <span>⚡ Select & Next →</span>
                </button>
                <button class="miku-btn miku-btn-secondary" data-action="refresh" title="Re-evaluate with Groq AI">
                  <span class="btn-icon">🔄</span> Re-check
                </button>
              </div>
            `}
          </div>
        `;
        break;

      case 'error':
        contentHtml = `
          <div class="miku-status-box error">
            <div class="miku-error-icon">⚠️</div>
            <div class="miku-status-title error-txt">Detection Notice</div>
            <div class="miku-status-desc">${this.escapeHTML(errorMsg || 'Could not analyze question choices.')}</div>
            <button class="miku-btn miku-btn-retry" data-action="retry">
              <span>🔄 Retry</span>
            </button>
          </div>
        `;
        break;
    }

    bodyEl.innerHTML = contentHtml;
  }

  escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  getTemplate() {
    return `
      <style>
        :host {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
          font-size: 13px;
          line-height: 1.4;
          color: #e2f1f8;
          box-sizing: border-box;
          user-select: none;
        }

        *, *::before, *::after {
          box-sizing: border-box;
        }

        /* Floating Window */
        .miku-panel {
          position: fixed;
          width: 320px;
          max-width: calc(100vw - 30px);
          background: linear-gradient(135deg, rgba(13, 23, 33, 0.95), rgba(18, 30, 42, 0.92));
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          border: 1px solid rgba(57, 197, 187, 0.35);
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6), 0 0 20px rgba(57, 197, 187, 0.2);
          border-radius: 14px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          pointer-events: auto;
          transition: border-color 0.2s, box-shadow 0.2s, transform 0.1s;
          z-index: 2147483647;
        }

        .miku-panel.is-dragging {
          opacity: 0.9;
          transform: scale(1.02);
          border-color: #00f5ff;
          box-shadow: 0 14px 40px rgba(0, 245, 255, 0.35);
        }

        /* Header */
        .miku-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 14px;
          background: rgba(20, 36, 50, 0.8);
          border-bottom: 1px solid rgba(57, 197, 187, 0.25);
          cursor: grab;
        }

        .miku-header:active {
          cursor: grabbing;
        }

        .miku-brand {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .miku-avatar {
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: linear-gradient(135deg, #39C5BB, #00F5FF);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          color: #0e1721;
          font-weight: 900;
          box-shadow: 0 0 8px rgba(57, 197, 187, 0.6);
        }

        .miku-title {
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.5px;
          background: linear-gradient(90deg, #39C5BB, #00F5FF);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .miku-controls {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .miku-ctrl-btn {
          width: 22px;
          height: 22px;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.05);
          color: #a0c4d8;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          font-size: 12px;
          transition: all 0.15s ease;
        }

        .miku-ctrl-btn:hover {
          background: rgba(57, 197, 187, 0.25);
          color: #ffffff;
          border-color: #39C5BB;
        }

        .miku-ctrl-btn.close:hover {
          background: rgba(255, 60, 90, 0.3);
          border-color: #ff3c5a;
          color: #ffb4c0;
        }

        /* Body */
        .miku-body {
          padding: 14px;
          max-height: 420px;
          overflow-y: auto;
        }

        .miku-body::-webkit-scrollbar {
          width: 4px;
        }
        .miku-body::-webkit-scrollbar-thumb {
          background: rgba(57, 197, 187, 0.3);
          border-radius: 4px;
        }

        /* States */
        .miku-status-box {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          padding: 12px 6px;
        }

        .miku-status-title {
          font-weight: 700;
          font-size: 14px;
          margin-bottom: 6px;
          color: #e2f1f8;
        }

        .miku-status-title.neon {
          color: #00F5FF;
          text-shadow: 0 0 10px rgba(0, 245, 255, 0.5);
        }

        .miku-status-title.error-txt {
          color: #ff7288;
        }

        .miku-status-desc {
          font-size: 12px;
          color: #92b1c6;
          line-height: 1.4;
        }

        .miku-status-desc.q-preview {
          background: rgba(0, 0, 0, 0.25);
          padding: 8px 10px;
          border-radius: 8px;
          border: 1px dashed rgba(57, 197, 187, 0.3);
          margin-top: 8px;
          font-style: italic;
          max-height: 60px;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        /* Equalizer Animation for Thinking */
        .miku-equalizer {
          display: flex;
          align-items: flex-end;
          gap: 4px;
          height: 32px;
          margin-bottom: 12px;
        }

        .miku-equalizer .bar {
          width: 5px;
          border-radius: 3px;
          background: linear-gradient(to top, #39C5BB, #00F5FF);
          animation: mikuBounce 0.8s ease-in-out infinite alternate;
        }

        .bar1 { height: 12px; animation-delay: 0.1s; }
        .bar2 { height: 26px; animation-delay: 0.3s; }
        .bar3 { height: 18px; animation-delay: 0.15s; }
        .bar4 { height: 30px; animation-delay: 0.4s; }
        .bar5 { height: 14px; animation-delay: 0.25s; }

        @keyframes mikuBounce {
          0% { transform: scaleY(0.3); }
          100% { transform: scaleY(1.1); }
        }

        /* Radar Ring for Idle */
        .miku-radar-ring {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 2px solid #39C5BB;
          position: relative;
          margin-bottom: 10px;
          animation: radarPulse 1.8s ease-out infinite;
        }

        @keyframes radarPulse {
          0% { transform: scale(0.6); opacity: 1; box-shadow: 0 0 0 0 rgba(57, 197, 187, 0.8); }
          70% { transform: scale(1.1); opacity: 0.4; box-shadow: 0 0 0 10px rgba(57, 197, 187, 0); }
          100% { transform: scale(1.2); opacity: 0; }
        }

        /* Ready Answer Hero */
        .miku-answer-hero {
          background: rgba(57, 197, 187, 0.08);
          border: 1px solid rgba(57, 197, 187, 0.35);
          border-radius: 10px;
          padding: 12px;
          margin-bottom: 10px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .miku-suggested-badge {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
        }

        .label-prefix {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 1px;
          color: #39C5BB;
          font-weight: 700;
        }

        .label-answer {
          font-size: 26px;
          font-weight: 900;
          color: #ffffff;
          line-height: 1.1;
          text-shadow: 0 0 12px rgba(57, 197, 187, 0.6);
        }

        .miku-confidence-wrapper {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .confidence-header {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
        }

        .conf-title {
          color: #92b1c6;
        }

        .conf-val {
          font-weight: 700;
          color: #00F5FF;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .conf-track {
          width: 100%;
          height: 6px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 3px;
          overflow: hidden;
        }

        .conf-bar {
          height: 100%;
          background: linear-gradient(90deg, #39C5BB, #00F5FF);
          border-radius: 3px;
          transition: width 0.4s ease;
          box-shadow: 0 0 6px rgba(0, 245, 255, 0.8);
        }

        /* Explanation Box */
        .miku-explanation-card {
          background: rgba(14, 25, 36, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 8px;
          padding: 10px;
          margin-bottom: 10px;
        }

        .miku-expl-title {
          font-size: 11px;
          font-weight: 700;
          color: #ffd166;
          margin-bottom: 4px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .miku-expl-text {
          font-size: 12px;
          color: #cce4f2;
          line-height: 1.45;
        }

        /* Sources */
        .miku-sources-box {
          font-size: 10px;
          color: #7b9ab0;
          margin-bottom: 8px;
        }

        .sources-label {
          font-weight: 700;
          color: #39C5BB;
        }

        /* Buttons & Actions */
        .miku-actions-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-top: 4px;
        }

        .miku-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          border: none;
          transition: all 0.15s ease;
        }

        .miku-btn-secondary {
          background: rgba(57, 197, 187, 0.15);
          color: #39C5BB;
          border: 1px solid rgba(57, 197, 187, 0.4);
        }

        .miku-btn-secondary:hover {
          background: rgba(57, 197, 187, 0.3);
          color: #ffffff;
        }

        .miku-btn-retry {
          background: linear-gradient(135deg, #39C5BB, #00F5FF);
          color: #0e1621;
          font-weight: 700;
          margin-top: 10px;
        }

        /* Countdown Box for Auto-Advance */
        .miku-countdown-box {
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(0, 0, 0, 0.35);
          border: 1px solid rgba(57, 197, 187, 0.25);
          border-radius: 8px;
          padding: 6px 10px;
          margin-bottom: 8px;
        }

        .countdown-info {
          display: flex;
          align-items: center;
          gap: 4px;
          white-space: nowrap;
        }

        .countdown-label {
          font-size: 10.5px;
          color: #92b1c6;
          font-weight: 600;
        }

        .countdown-sec {
          font-size: 11px;
          font-weight: 800;
          color: #00F5FF;
          min-width: 24px;
        }

        .countdown-track {
          flex: 1;
          height: 4px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 2px;
          overflow: hidden;
        }

        .countdown-fill {
          height: 100%;
          width: 100%;
          background: linear-gradient(90deg, #39C5BB, #00F5FF);
          border-radius: 2px;
        }

        .btn-cancel-advance {
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.15);
          color: #d1e8f5;
          font-size: 10px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .btn-cancel-advance:hover {
          background: rgba(255, 71, 87, 0.25);
          border-color: #ff4757;
          color: #ffffff;
        }

        .miku-final-box {
          background: linear-gradient(135deg, rgba(255, 209, 102, 0.12), rgba(57, 197, 187, 0.1));
          border: 1px solid rgba(255, 209, 102, 0.45);
          box-shadow: 0 4px 14px rgba(255, 209, 102, 0.15);
          border-radius: 8px;
          padding: 10px 12px;
          margin-bottom: 10px;
          text-align: center;
        }

        .miku-final-header {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          margin-bottom: 4px;
        }

        .miku-final-icon {
          font-size: 16px;
        }

        .miku-final-title {
          font-size: 12px;
          font-weight: 800;
          color: #ffd166;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .miku-final-desc {
          font-size: 11.5px;
          color: #d1e8f5;
          line-height: 1.4;
        }

        .miku-final-desc b {
          color: #00F5FF;
        }

        .miku-manual-hint {
          font-size: 10px;
          color: #ff98a8;
          font-weight: 500;
        }

        .miku-tag-cached {
          font-size: 9px;
          padding: 1px 4px;
          border-radius: 4px;
          background: rgba(255, 209, 102, 0.2);
          color: #ffd166;
          border: 1px solid rgba(255, 209, 102, 0.4);
        }

        .miku-badge-pill {
          display: inline-block;
          padding: 3px 8px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 700;
        }

        .miku-badge-pill.cyan {
          background: rgba(0, 245, 255, 0.15);
          color: #00F5FF;
          border: 1px solid rgba(0, 245, 255, 0.4);
        }

        /* Minimized Floating Pill */
        .miku-mini-pill {
          position: fixed;
          bottom: 20px;
          right: 20px;
          background: linear-gradient(135deg, #0e1b26, #162939);
          border: 1px solid #39C5BB;
          box-shadow: 0 4px 18px rgba(0, 0, 0, 0.5), 0 0 12px rgba(57, 197, 187, 0.4);
          border-radius: 30px;
          padding: 8px 14px;
          display: none;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          pointer-events: auto;
          z-index: 2147483647;
          transition: transform 0.2s, box-shadow 0.2s;
        }

        .miku-mini-pill:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 22px rgba(0, 245, 255, 0.6);
        }

        .mini-avatar {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: #39C5BB;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          color: #0e1721;
          font-weight: bold;
        }

        .mini-text {
          font-size: 12px;
          font-weight: 700;
          color: #39C5BB;
        }
      </style>

      <div class="miku-panel" id="miku-panel">
        <div class="miku-header" id="miku-drag-handle">
          <div class="miku-brand">
            <div class="miku-avatar">39</div>
            <span class="miku-title">Miku Quizer</span>
          </div>
          <div class="miku-controls">
            <button class="miku-ctrl-btn" id="btn-minimize" title="Minimize">─</button>
            <button class="miku-ctrl-btn close" id="btn-close" title="Close Panel">✕</button>
          </div>
        </div>

        <div class="miku-body" id="miku-panel-body">
          <!-- Rendered dynamically -->
        </div>
      </div>

      <div class="miku-mini-pill" id="miku-mini-pill" title="Click to expand Miku Quizer">
        <div class="mini-avatar">🎵</div>
        <span class="mini-text" id="mini-pill-text">Miku Quizer</span>
      </div>
    `;
  }
}

// Attach to window
if (typeof window !== 'undefined') {
  window.MikuFloatingPanel = FloatingPanel;
}
