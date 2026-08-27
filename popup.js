/**
 * Miku Quizer - Popup Controller
 */

document.addEventListener('DOMContentLoaded', async () => {
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const statDetected = document.getElementById('stat-detected');
  const statRequests = document.getElementById('stat-requests');
  const statCache = document.getElementById('stat-cache');
  const liveQBadge = document.getElementById('live-q-badge');
  const liveQText = document.getElementById('live-q-text');
  const currentSiteName = document.getElementById('current-site-name');
  const btnScanNow = document.getElementById('btn-scan-now');
  const btnClearCache = document.getElementById('btn-clear-cache');
  const btnToggleSite = document.getElementById('btn-toggle-site');
  const btnOptions = document.getElementById('btn-options');
  const toast = document.getElementById('toast');

  let currentHost = '';
  let activeTabId = null;

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2200);
  }

  // Ensure content script is injected and scan the page
  async function triggerActiveTabScan(force = false) {
    if (!activeTabId) return;

    try {
      // First try sending message
      chrome.tabs.sendMessage(activeTabId, { type: 'SCAN_PAGE', force }, async (res) => {
        if (chrome.runtime.lastError || !res) {
          // Script was not injected yet on this tab, inject now!
          try {
            await chrome.scripting.executeScript({
              target: { tabId: activeTabId },
              files: [
                'modules/dom-extractor.js',
                'modules/highlighter.js',
                'modules/floating-panel.js',
                'content.js'
              ]
            });
            await chrome.scripting.insertCSS({
              target: { tabId: activeTabId },
              files: ['styles.css']
            });

            // Re-send scan message after a brief tick
            setTimeout(() => {
              chrome.tabs.sendMessage(activeTabId, { type: 'SCAN_PAGE', force: true }, (res2) => {
                if (res2 && res2.detected) {
                  updateQuestionDisplay(res2.detected);
                  refreshStats();
                  showToast('✨ Quiz question detected!');
                }
              });
            }, 300);
          } catch (injectErr) {
            console.warn('[Miku Quizer Popup] Injection error:', injectErr);
          }
        } else if (res && res.detected) {
          updateQuestionDisplay(res.detected);
          refreshStats();
          if (force) showToast('✨ Re-scanned and detected question!');
        } else if (force) {
          showToast('⚠️ No quiz question detected on this page.');
        }
      });
    } catch (e) {
      console.warn('[Miku Quizer Popup] Scan error:', e);
    }
  }

  function updateQuestionDisplay(q) {
    if (q && q.question) {
      liveQBadge.textContent = q.questionNumber ? `Q ${q.questionNumber}${q.totalQuestions ? `/${q.totalQuestions}` : ''}` : 'Active';
      liveQText.textContent = q.question;
    }
  }

  function refreshStats() {
    chrome.runtime.sendMessage({ type: 'GET_STATS' }, (response) => {
      if (!response || !response.success) {
        statusDot.className = 'status-dot disconnected';
        statusText.textContent = 'Service Error';
        return;
      }

      const { stats, config, connected } = response;

      if (connected) {
        statusDot.className = 'status-dot connected';
        statusText.textContent = 'Connected (Proxy)';
      } else {
        statusDot.className = 'status-dot disconnected';
        statusText.textContent = 'Offline (Start Server)';
      }

      statDetected.textContent = stats.questionsDetected || 0;
      statRequests.textContent = stats.aiRequests || 0;
      statCache.textContent = stats.cachedAnswers || 0;

      if (stats.lastQuestion && stats.lastQuestion.text && liveQBadge.textContent === 'None') {
        const q = stats.lastQuestion;
        liveQBadge.textContent = q.number ? `Q ${q.number}${q.total ? `/${q.total}` : ''}` : 'Active';
        liveQText.textContent = q.text;
      }

      updateSiteToggleButton(config.disabledSites || []);
    });
  }

  // Get active tab info
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs[0]) {
      activeTabId = tabs[0].id;
      if (tabs[0].url) {
        try {
          const url = new URL(tabs[0].url);
          currentHost = url.hostname;
          currentSiteName.textContent = currentHost || 'Active Page';
        } catch {
          currentSiteName.textContent = 'Active Page';
        }
      }
    }
  } catch (e) {
    currentSiteName.textContent = 'Active Tab';
  }

  // Load stats
  refreshStats();

  function updateSiteToggleButton(disabledSites) {
    const isSiteDisabled = currentHost && disabledSites.includes(currentHost);
    const toggleIcon = document.getElementById('site-toggle-icon');
    const toggleText = document.getElementById('site-toggle-text');

    if (isSiteDisabled) {
      btnToggleSite.classList.add('site-disabled');
      toggleIcon.textContent = '🟢';
      toggleText.textContent = 'Enable on Site';
    } else {
      btnToggleSite.classList.remove('site-disabled');
      toggleIcon.textContent = '🛡️';
      toggleText.textContent = 'Disable on Site';
    }
  }

  const btnToggleAssistant = document.getElementById('btn-toggle-assistant');
  const activateIcon = document.getElementById('activate-icon');
  const activateText = document.getElementById('activate-text');
  const btnPopupSelectNext = document.getElementById('btn-popup-select-next');

  let isAssistantActive = false;

  function updateAssistantButtonUI(active) {
    isAssistantActive = Boolean(active);
    if (isAssistantActive) {
      btnToggleAssistant.classList.add('is-active');
      activateIcon.textContent = '⏸️';
      activateText.textContent = 'Pause / Hide Assistant';
    } else {
      btnToggleAssistant.classList.remove('is-active');
      activateIcon.textContent = '⚡';
      activateText.textContent = 'Start Assistant on Tab';
    }
  }

  // Check tab status on load
  if (activeTabId) {
    chrome.tabs.sendMessage(activeTabId, { type: 'GET_TAB_STATUS' }, (res) => {
      if (res && res.success) {
        updateAssistantButtonUI(res.active);
        if (res.detected) updateQuestionDisplay(res.detected);
      }
    });
  }

  // Toggle Assistant Button
  if (btnToggleAssistant) {
    btnToggleAssistant.addEventListener('click', async () => {
      if (!activeTabId) return;

      const nextActive = !isAssistantActive;
      updateAssistantButtonUI(nextActive);

      // Save state to storage
      chrome.storage.local.get(['config'], (data) => {
        const cfg = data.config || {};
        cfg.assistantActive = nextActive;
        chrome.storage.local.set({ config: cfg });
      });

      const actionType = nextActive ? 'START_ASSISTANT' : 'STOP_ASSISTANT';

      // Send message to active tab
      chrome.tabs.sendMessage(activeTabId, { type: actionType }, async (res) => {
        if (chrome.runtime.lastError || !res) {
          // If script not loaded yet and activating, inject it
          if (nextActive) {
            try {
              await chrome.scripting.executeScript({
                target: { tabId: activeTabId },
                files: ['modules/dom-extractor.js', 'modules/highlighter.js', 'modules/floating-panel.js', 'content.js']
              });
              await chrome.scripting.insertCSS({
                target: { tabId: activeTabId },
                files: ['styles.css']
              });
              setTimeout(() => {
                chrome.tabs.sendMessage(activeTabId, { type: 'START_ASSISTANT' }, (res2) => {
                  if (res2 && res2.detected) updateQuestionDisplay(res2.detected);
                });
              }, 200);
            } catch (e) {}
          }
        } else {
          if (res.active && res.detected) {
            updateQuestionDisplay(res.detected);
          }
        }

        if (nextActive) {
          showToast('⚡ Miku Assistant Activated!');
        } else {
          showToast('⏸️ Miku Assistant Paused.');
        }
        refreshStats();
      });
    });
  }

  // Scan Now button
  btnScanNow.addEventListener('click', () => {
    btnScanNow.style.transform = 'scale(0.97)';
    setTimeout(() => { btnScanNow.style.transform = 'none'; }, 150);
    triggerActiveTabScan(true);
  });

  // Select & Next button
  if (btnPopupSelectNext) {
    btnPopupSelectNext.addEventListener('click', () => {
      if (!activeTabId) return;
      chrome.tabs.sendMessage(activeTabId, { type: 'SELECT_AND_NEXT' }, (res) => {
        showToast('⚡ Selected & Moving to Next Question!');
        setTimeout(() => refreshStats(), 1000);
      });
    });
  }

  // Clear cache button
  btnClearCache.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' }, (res) => {
      if (res && res.success) {
        statCache.textContent = '0';
        showToast('⚡ Question cache cleared!');
      }
    });
  });

  // Toggle site enable/disable button
  btnToggleSite.addEventListener('click', () => {
    if (!currentHost) return;
    chrome.runtime.sendMessage({ type: 'TOGGLE_SITE_DISABLE', host: currentHost }, (res) => {
      if (res && res.success) {
        updateSiteToggleButton(res.disabledSites || []);
        showToast(res.disabled ? `🚫 Disabled on ${currentHost}` : `✨ Enabled on ${currentHost}`);
      }
    });
  });

  // Auth & Profile Elements
  const authLoginCard = document.getElementById('auth-login-card');
  const userProfileBar = document.getElementById('user-profile-bar');
  const userProfileEmail = document.getElementById('user-profile-email');
  const btnGoogleLogin = document.getElementById('btn-google-login');
  const btnReAuth = document.getElementById('btn-re-auth');

  let currentBackendUrl = 'http://localhost:3001';

  async function getBackendUrl() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['config'], (data) => {
        if (data && data.config && data.config.backendUrl) {
          currentBackendUrl = data.config.backendUrl.replace(/\/+$/, '');
        }
        resolve(currentBackendUrl);
      });
    });
  }

  async function checkAuthStatus() {
    try {
      const baseUrl = await getBackendUrl();
      const resp = await fetch(`${baseUrl}/api/auth/status`, { signal: AbortSignal.timeout(3500) });
      if (resp.ok) {
        const data = await resp.json();
        if (data.authenticated && data.user) {
          if (authLoginCard) authLoginCard.style.display = 'none';
          if (userProfileBar) userProfileBar.style.display = 'flex';
          if (userProfileEmail) userProfileEmail.textContent = data.user.email || 'ChatGPT Account';
          return true;
        }
      }
    } catch (e) {}

    if (authLoginCard) authLoginCard.style.display = 'flex';
    if (userProfileBar) userProfileBar.style.display = 'none';
    return false;
  }

  // Handle Google / ChatGPT OAuth Login
  if (btnGoogleLogin) {
    btnGoogleLogin.addEventListener('click', async () => {
      showToast('🌐 Opening Google / ChatGPT Login...');
      try {
        const baseUrl = await getBackendUrl();
        const resp = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(8000)
        });
        if (resp.ok) {
          const resData = await resp.json();
          if (resData.authUrl) {
            chrome.tabs.create({ url: resData.authUrl });
          }
        } else {
          showToast('⚠️ Backend server returned error. Check terminal.');
        }
        let attempts = 0;
        const pollTimer = setInterval(async () => {
          attempts++;
          const authed = await checkAuthStatus();
          if (authed) {
            clearInterval(pollTimer);
            showToast('✨ Logged in with ChatGPT!');
            refreshStats();
          } else if (attempts > 60) {
            clearInterval(pollTimer);
          }
        }, 1500);
      } catch (err) {
        showToast('⚠️ Backend offline. Please start "node server.js" first!');
      }
    });
  }

  if (btnReAuth) {
    btnReAuth.addEventListener('click', async () => {
      showToast('🌐 Switching / Refreshing ChatGPT account...');
      try {
        const baseUrl = await getBackendUrl();
        const resp = await fetch(`${baseUrl}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(8000)
        });
        if (resp.ok) {
          const resData = await resp.json();
          if (resData.authUrl) {
            chrome.tabs.create({ url: resData.authUrl });
          }
        }
        let attempts = 0;
        const pollTimer = setInterval(async () => {
          attempts++;
          const authed = await checkAuthStatus();
          if (authed) {
            clearInterval(pollTimer);
            showToast('✨ Account updated!');
            refreshStats();
          } else if (attempts > 60) {
            clearInterval(pollTimer);
          }
        }, 1500);
      } catch (err) {
        showToast('⚠️ Backend offline. Please start "node server.js" first!');
      }
    });
  }

  checkAuthStatus();

  // Settings options button
  btnOptions.addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options.html'));
    }
  });
});
