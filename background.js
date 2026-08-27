/**
 * Miku Quizer - Background Service Worker (Manifest V3)
 * Manages API communication, question caching, stats tracking, settings, and automatic script injection.
 */

const DEFAULT_CONFIG = {
  backendUrl: 'http://localhost:3001',
  model: 'gpt-5.4',
  showConfidence: true,
  showExplanation: true,
  highlightOption: false,
  autoSelect: true,
  autoAdvance: true,
  advanceDelaySeconds: 3.5,
  assistantActive: true,
  panelPosition: 'top-right',
  cacheEnabled: true,
  disabledSites: []
};

const DEFAULT_STATS = {
  questionsDetected: 0,
  aiRequests: 0,
  cachedAnswers: 0,
  lastQuestion: null
};

// Initialize configuration, stats, and inject into existing tabs on install/update
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get(['config', 'stats', 'quizCache']);
  if (!data.config) {
    await chrome.storage.local.set({ config: DEFAULT_CONFIG });
  } else {
    const updated = {
      ...DEFAULT_CONFIG,
      ...data.config,
      advanceDelaySeconds: 3.5,
      model: 'gpt-5.4'
    };
    await chrome.storage.local.set({ config: updated });
  }
  if (!data.stats) {
    await chrome.storage.local.set({ stats: DEFAULT_STATS });
  }
  if (!data.quizCache) {
    await chrome.storage.local.set({ quizCache: {} });
  }

  // Inject content scripts into already-open tabs
  try {
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    for (const tab of tabs) {
      if (tab.id && !tab.url.startsWith('chrome://') && !tab.url.startsWith('chrome-extension://')) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: [
              'modules/dom-extractor.js',
              'modules/highlighter.js',
              'modules/floating-panel.js',
              'content.js'
            ]
          });
          await chrome.scripting.insertCSS({
            target: { tabId: tab.id },
            files: ['styles.css']
          });
        } catch (e) {
          // Tab might be restricted or unloaded
        }
      }
    }
  } catch (err) {
    console.warn('[Miku Quizer Background] Auto-injection notice:', err);
  }

  console.log('[Miku Quizer Background] Initialized and injected into existing tabs.');
});

/**
 * Generate a deterministic hash for a question and its options.
 */
function createQuestionHash(question, options) {
  const normalizedQ = (question || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const normalizedOpts = (options || [])
    .map(opt => {
      const text = typeof opt === 'object' ? (opt.text || '') : String(opt);
      return text.trim().toLowerCase().replace(/\s+/g, ' ');
    })
    .sort()
    .join('|');
  
  const raw = `${normalizedQ}:::${normalizedOpts}`;
  
  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return 'mq_' + (hash >>> 0).toString(16);
}

async function getConfig() {
  const data = await chrome.storage.local.get('config');
  return { ...DEFAULT_CONFIG, ...(data.config || {}) };
}

async function getStats() {
  const data = await chrome.storage.local.get('stats');
  return { ...DEFAULT_STATS, ...(data.stats || {}) };
}

async function updateStats(mutator) {
  const stats = await getStats();
  const updated = mutator(stats) || stats;
  await chrome.storage.local.set({ stats: updated });
  return updated;
}

async function checkBackendHealth(backendUrl) {
  try {
    const url = (backendUrl || 'http://localhost:3001').replace(/\/+$/, '') + '/api/health';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      return { connected: true, data };
    }
    return { connected: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { connected: false, error: err.name === 'AbortError' ? 'Connection timed out' : err.message };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handleAsync = async () => {
    switch (message.type) {
      case 'PING_BACKEND': {
        const config = await getConfig();
        const health = await checkBackendHealth(config.backendUrl);
        return { success: true, ...health };
      }

      case 'GET_CONFIG': {
        const config = await getConfig();
        return { success: true, config };
      }

      case 'SET_CONFIG': {
        const current = await getConfig();
        const updated = { ...current, ...message.config };
        await chrome.storage.local.set({ config: updated });
        return { success: true, config: updated };
      }

      case 'GET_STATS': {
        const stats = await getStats();
        const config = await getConfig();
        const health = await checkBackendHealth(config.backendUrl);
        return { success: true, stats, config, connected: health.connected };
      }

      case 'CLEAR_CACHE': {
        await chrome.storage.local.set({ quizCache: {} });
        await updateStats(s => ({ ...s, cachedAnswers: 0 }));
        return { success: true, message: 'Cache cleared successfully.' };
      }

      case 'TOGGLE_SITE_DISABLE': {
        const config = await getConfig();
        const host = message.host;
        if (!host) return { success: false, error: 'No host provided' };

        const disabledSites = new Set(config.disabledSites || []);
        let disabled = false;
        if (disabledSites.has(host)) {
          disabledSites.delete(host);
          disabled = false;
        } else {
          disabledSites.add(host);
          disabled = true;
        }

        const updatedConfig = { ...config, disabledSites: Array.from(disabledSites) };
        await chrome.storage.local.set({ config: updatedConfig });
        return { success: true, disabled, disabledSites: updatedConfig.disabledSites };
      }

      case 'SOLVE_QUESTION': {
        const { question, options, questionNumber, totalQuestions, forceRefresh } = message.payload;
        const config = await getConfig();
        const qHash = createQuestionHash(question, options);

        await updateStats(s => ({
          ...s,
          questionsDetected: (s.questionsDetected || 0) + 1,
          lastQuestion: {
            text: question.substring(0, 100) + (question.length > 100 ? '...' : ''),
            number: questionNumber,
            total: totalQuestions,
            time: Date.now()
          }
        }));

        // Check local cache if enabled and not force-refreshing
        if (config.cacheEnabled && !forceRefresh) {
          const { quizCache = {} } = await chrome.storage.local.get('quizCache');
          if (quizCache[qHash]) {
            console.log('[Miku Quizer Background] Cache hit for question:', qHash);
            await updateStats(s => ({ ...s, cachedAnswers: (s.cachedAnswers || 0) + 1 }));
            return {
              success: true,
              fromCache: true,
              data: quizCache[qHash]
            };
          }
        }

        const endpoint = (config.backendUrl || 'http://localhost:3001').replace(/\/+$/, '') + '/api/solve';
        console.log('[Miku Quizer Background] Sending question to AI proxy:', endpoint);

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 18000);

          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              question,
              options,
              questionNumber,
              totalQuestions,
              model: config.model
            }),
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            let errorMsg = `Server returned HTTP ${response.status}`;
            try {
              const errBody = await response.json();
              errorMsg = errBody.error || errBody.message || errorMsg;
            } catch {
              // ignore
            }
            return {
              success: false,
              error: `AI proxy error: ${errorMsg}`
            };
          }

          const result = await response.json();

          if (!result.success) {
            return {
              success: false,
              error: result.error || 'AI returned an unhandled error response.'
            };
          }

          await updateStats(s => ({ ...s, aiRequests: (s.aiRequests || 0) + 1 }));

          if (config.cacheEnabled) {
            const { quizCache = {} } = await chrome.storage.local.get('quizCache');
            quizCache[qHash] = result;
            await chrome.storage.local.set({ quizCache });
          }

          return {
            success: true,
            fromCache: false,
            data: result
          };
        } catch (fetchErr) {
          console.error('[Miku Quizer Background] Fetch error:', fetchErr);
          const isTimeout = fetchErr.name === 'AbortError';
          return {
            success: false,
            error: isTimeout
              ? 'Request to Miku backend timed out. Try refreshing the question.'
              : 'Cannot connect to Miku backend proxy at ' + config.backendUrl + '. Make sure backend server is running.'
          };
        }
      }

      default:
        return { success: false, error: 'Unknown message type: ' + message.type };
    }
  };

  handleAsync()
    .then(sendResponse)
    .catch(err => {
      console.error('[Miku Quizer Background] Handler error:', err);
      sendResponse({ success: false, error: err.message });
    });

  return true;
});
