/**
 * Miku Quizer - Options Controller
 */

const DEFAULT_CONFIG = {
  backendUrl: 'http://localhost:3001',
  model: 'openai/gpt-oss-120b',
  showConfidence: true,
  showExplanation: true,
  highlightOption: true,
  panelPosition: 'top-right',
  cacheEnabled: true,
  disabledSites: []
};

document.addEventListener('DOMContentLoaded', async () => {
  const backendUrlInput = document.getElementById('backendUrl');
  const modelSelect = document.getElementById('modelSelect');
  const highlightOptionInput = document.getElementById('highlightOption');
  const showConfidenceInput = document.getElementById('showConfidence');
  const showExplanationInput = document.getElementById('showExplanation');
  const autoSelectInput = document.getElementById('autoSelect');
  const autoAdvanceInput = document.getElementById('autoAdvance');
  const advanceDelaySecondsInput = document.getElementById('advanceDelaySeconds');
  const panelPositionSelect = document.getElementById('panelPosition');
  const cacheEnabledInput = document.getElementById('cacheEnabled');
  const newSiteInput = document.getElementById('newSiteInput');
  const btnAddSite = document.getElementById('btn-add-site');
  const sitesListEl = document.getElementById('sites-list');
  const btnTestConn = document.getElementById('btn-test-conn');
  const btnFetchModels = document.getElementById('btn-fetch-models');
  const connStatusMsg = document.getElementById('conn-status-msg');
  const btnSave = document.getElementById('btn-save');
  const btnReset = document.getElementById('btn-reset');
  const saveStatus = document.getElementById('save-status');

  let currentDisabledSites = [];

  // Render disabled sites chips
  function renderSitesList() {
    sitesListEl.innerHTML = '';
    if (currentDisabledSites.length === 0) {
      sitesListEl.innerHTML = '<span class="no-sites-text">No excluded websites. Miku Quizer is active everywhere.</span>';
      return;
    }

    currentDisabledSites.forEach((site, index) => {
      const chip = document.createElement('div');
      chip.className = 'site-chip';
      chip.innerHTML = `
        <span>${escapeHTML(site)}</span>
        <button type="button" data-index="${index}" title="Remove">✕</button>
      `;
      sitesListEl.appendChild(chip);
    });
  }

  function escapeHTML(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Load config
  chrome.runtime.sendMessage({ type: 'GET_CONFIG' }, (response) => {
    const config = (response && response.config) || DEFAULT_CONFIG;
    backendUrlInput.value = config.backendUrl || 'http://localhost:3001';
    
    // Check if model exists in options, otherwise add it
    ensureModelOption(config.model || 'gpt-5.4');
    modelSelect.value = config.model || 'gpt-5.4';

    highlightOptionInput.checked = Boolean(config.highlightOption);
    showConfidenceInput.checked = config.showConfidence !== false;
    showExplanationInput.checked = config.showExplanation !== false;
    autoSelectInput.checked = config.autoSelect !== false;
    autoAdvanceInput.checked = Boolean(config.autoAdvance);
    if (advanceDelaySecondsInput) advanceDelaySecondsInput.value = String(config.advanceDelaySeconds || '2.5');
    panelPositionSelect.value = config.panelPosition || 'top-right';
    cacheEnabledInput.checked = config.cacheEnabled !== false;

    currentDisabledSites = Array.isArray(config.disabledSites) ? [...config.disabledSites] : [];
    renderSitesList();
  });

  function ensureModelOption(modelId) {
    let exists = false;
    for (let i = 0; i < modelSelect.options.length; i++) {
      if (modelSelect.options[i].value === modelId) {
        exists = true;
        break;
      }
    }
    if (!exists) {
      const opt = document.createElement('option');
      opt.value = modelId;
      opt.textContent = `${modelId} (Custom)`;
      modelSelect.appendChild(opt);
    }
  }

  // Site deletion delegation
  sitesListEl.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON') {
      const index = parseInt(e.target.dataset.index, 10);
      if (!isNaN(index)) {
        currentDisabledSites.splice(index, 1);
        renderSitesList();
      }
    }
  });

  // Add site button
  btnAddSite.addEventListener('click', () => {
    let site = newSiteInput.value.trim().toLowerCase();
    // Clean URLs
    site = site.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (site && !currentDisabledSites.includes(site)) {
      currentDisabledSites.push(site);
      renderSitesList();
      newSiteInput.value = '';
    }
  });

  newSiteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      btnAddSite.click();
    }
  });

  // Test Connection
  btnTestConn.addEventListener('click', async () => {
    const url = backendUrlInput.value.trim().replace(/\/+$/, '') + '/api/health';
    connStatusMsg.textContent = 'Testing connection...';
    connStatusMsg.className = 'field-hint';

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data = await res.json();
        connStatusMsg.textContent = `✓ Connected! Model default: ${data.model || 'Unknown'}, Groq API: ${data.hasApiKey ? 'Active' : 'Missing Key'}`;
        connStatusMsg.className = 'field-hint success';
      } else {
        connStatusMsg.textContent = `✗ Server responded with status ${res.status}`;
        connStatusMsg.className = 'field-hint error';
      }
    } catch (err) {
      connStatusMsg.textContent = `✗ Connection failed: ${err.message}. Make sure backend server is running.`;
      connStatusMsg.className = 'field-hint error';
    }
  });

  // Fetch models from backend
  btnFetchModels.addEventListener('click', async () => {
    const url = backendUrlInput.value.trim().replace(/\/+$/, '') + '/api/models';
    btnFetchModels.textContent = 'Fetching...';
    btnFetchModels.disabled = true;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.models) && data.models.length > 0) {
          const currentVal = modelSelect.value;
          modelSelect.innerHTML = '';
          data.models.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            modelSelect.appendChild(opt);
          });
          ensureModelOption(currentVal);
          modelSelect.value = currentVal;
          connStatusMsg.textContent = `✓ Successfully refreshed ${data.models.length} AI models.`;
          connStatusMsg.className = 'field-hint success';
        }
      }
    } catch (err) {
      connStatusMsg.textContent = `Could not fetch models: ${err.message}`;
      connStatusMsg.className = 'field-hint error';
    } finally {
      btnFetchModels.textContent = 'Refresh List';
      btnFetchModels.disabled = false;
    }
  });

  // Reset Defaults
  btnReset.addEventListener('click', () => {
    if (confirm('Reset all settings to default values?')) {
      backendUrlInput.value = DEFAULT_CONFIG.backendUrl;
      modelSelect.value = DEFAULT_CONFIG.model;
      highlightOptionInput.checked = DEFAULT_CONFIG.highlightOption;
      showConfidenceInput.checked = DEFAULT_CONFIG.showConfidence;
      showExplanationInput.checked = DEFAULT_CONFIG.showExplanation;
      panelPositionSelect.value = DEFAULT_CONFIG.panelPosition;
      cacheEnabledInput.checked = DEFAULT_CONFIG.cacheEnabled;
      currentDisabledSites = [];
      renderSitesList();
      connStatusMsg.textContent = 'Settings reset to defaults. Click "Save Settings" to apply.';
      connStatusMsg.className = 'field-hint';
    }
  });

  // Save Settings
  btnSave.addEventListener('click', () => {
    const updated = {
      backendUrl: backendUrlInput.value.trim() || 'http://localhost:3001',
      model: modelSelect.value || 'openai/gpt-oss-120b',
      highlightOption: highlightOptionInput.checked,
      showConfidence: showConfidenceInput.checked,
      showExplanation: showExplanationInput.checked,
      autoSelect: autoSelectInput.checked,
      autoAdvance: autoAdvanceInput.checked,
      advanceDelaySeconds: parseFloat(advanceDelaySecondsInput ? advanceDelaySecondsInput.value : '3.5') || 3.5,
      panelPosition: panelPositionSelect.value,
      cacheEnabled: cacheEnabledInput.checked,
      disabledSites: currentDisabledSites
    };

    chrome.runtime.sendMessage({ type: 'SET_CONFIG', config: updated }, (res) => {
      if (res && res.success) {
        saveStatus.textContent = '✓ Settings Saved!';
        saveStatus.style.opacity = '1';
        setTimeout(() => {
          saveStatus.style.opacity = '0';
        }, 2500);
      } else {
        alert('Failed to save settings: ' + (res?.error || 'Unknown error'));
      }
    });
  });
});
