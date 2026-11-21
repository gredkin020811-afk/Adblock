(function () {
  'use strict';

  // Tab navigation
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  for (const btn of tabBtns) {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.tab;
      for (const b of tabBtns) b.classList.toggle('active', b === btn);
      for (const p of tabPanels) p.classList.toggle('active', p.id === targetId);
    });
  }

  const i18n = window.UltiI18n || {
    init: async () => {},
    setLanguage: async () => {},
    getLanguage: () => 'auto',
    getResolvedLocale: () => 'en',
    t: (k) => k
  };
  const t = (key, vars) => i18n.t(key, vars);

  // Adblock & General Elements
  const langSelect = document.getElementById('langSelect');
  const globalToggle = document.getElementById('globalToggle');
  const siteToggle = document.getElementById('siteToggle');
  const shieldIcon = document.getElementById('shieldIcon');
  const statusText = document.getElementById('statusText');
  const currentDomainEl = document.getElementById('currentDomain');
  const tabBlockedCountEl = document.getElementById('tabBlockedCount');

  const statNetworkEl = document.getElementById('statNetwork');
  const statYoutubeEl = document.getElementById('statYoutube');
  const statDomEl = document.getElementById('statDom');
  const statPopupEl = document.getElementById('statPopup');

  const chkHoverDownloader = document.getElementById('chkHoverDownloader');
  const chkSiteHoverDownloader = document.getElementById('chkSiteHoverDownloader');
  const disabledSitesSection = document.getElementById('disabledSitesSection');
  const disabledDomainsList = document.getElementById('disabledDomainsList');
  const downloadsListContainer = document.getElementById('downloadsListContainer');
  const clearDownloadsBtn = document.getElementById('clearDownloadsBtn');
  const dlSpeedBtns = document.querySelectorAll('#dlSpeedLimitGroup .seg-btn');
  const ytOptionCheckboxes = document.querySelectorAll('input[data-yt-key]');
  const ytGridBtns = document.querySelectorAll('#ytGridColumnsGroup .seg-btn');

  const pickerBtn = document.getElementById('pickerBtn');
  const customSelectorsBar = document.getElementById('customSelectorsBar');
  const customSelectorsCount = document.getElementById('customSelectorsCount');
  const resetSiteSelectorsBtn = document.getElementById('resetSiteSelectorsBtn');

  const customDomainInput = document.getElementById('customDomainInput');
  const addDomainBtn = document.getElementById('addDomainBtn');
  const customDomainsList = document.getElementById('customDomainsList');

  const cloudSyncBtn = document.getElementById('cloudSyncBtn');
  const cloudMeta = document.getElementById('cloudMeta');

  // Dark Reader Elements
  const darkGlobalToggle = document.getElementById('darkGlobalToggle');
  const darkSiteStatusText = document.getElementById('darkSiteStatusText');
  const segBtns = document.querySelectorAll('#darkSiteModeGroup .seg-btn');
  const engineBtns = document.querySelectorAll('.engine-btn');
  const paletteBtns = document.querySelectorAll('.palette-btn');
  const rngBrightness = document.getElementById('rngBrightness');
  const rngContrast = document.getElementById('rngContrast');
  const rngWarmth = document.getElementById('rngWarmth');
  const valBrightness = document.getElementById('valBrightness');
  const valContrast = document.getElementById('valContrast');
  const valWarmth = document.getElementById('valWarmth');
  const chkAutoSkipNativeDark = document.getElementById('chkAutoSkipNativeDark');

  let activeTabId = null;
  let activeHostname = '';
  let tabNativeDarkDetected = false;

  const DEFAULT_YT_PREMIUM = {
    nonStopBackground: true,
    sponsorBlock: true,
    autoMaxQuality: true,
    returnDislikes: true,
    playerEnhancements: true,
    ytMusicPremium: true,
    showDownloadButtons: true,
    premiumLogo: true,
    miniPlayerOnScroll: true,
    wheelVolumeControl: true,
    hideShorts: false,
    hideEndscreens: true,
    squareCorners: false,
    hideSidebar: false,
    hideComments: false,
    gridColumns: 0
  };

  const DEFAULT_DARK_READER = {
    enabled: true,
    engine: 'smart',
    theme: 'midnight',
    brightness: 100,
    contrast: 100,
    warmth: 0,
    autoSkipNativeDark: true,
    disabledDomains: [],
    forcedDomains: []
  };

  function formatNum(n) {
    const loc = (i18n.getResolvedLocale() || 'en').replace('_', '-');
    return Number(n || 0).toLocaleString(loc);
  }

  function updateSpeedButtonLabels() {
    const unit = t('dlSpeedUnit');
    for (const b of dlSpeedBtns) {
      if (b.dataset.speed === '0') {
        b.textContent = t('dlSpeedMax');
      } else {
        b.textContent = `${b.dataset.speed} ${unit}`;
      }
    }
  }

  function extractHostname(url) {
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        return u.hostname.toLowerCase().replace(/^www\./, '');
      }
    } catch (_) {}
    return '';
  }

  async function init() {
    await i18n.init();
    if (langSelect) {
      langSelect.value = i18n.getLanguage();
      langSelect.addEventListener('change', async () => {
        await i18n.setLanguage(langSelect.value, true);
        updateSpeedButtonLabels();
        currentDomainEl.textContent = activeHostname || t('systemTab');
        await renderFromStorage();
      });
    }
    updateSpeedButtonLabels();

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs && tabs[0]) {
      activeTabId = tabs[0].id;
      activeHostname = extractHostname(tabs[0].url || '');
    }

    currentDomainEl.textContent = activeHostname || t('systemTab');
    if (!activeHostname) {
      siteToggle.disabled = true;
      pickerBtn.disabled = true;
      if (chkSiteHoverDownloader) chkSiteHoverDownloader.disabled = true;
    }

    if (activeTabId !== null) {
      chrome.runtime.sendMessage(
        { type: 'ULTIBLOCK_GET_TAB_COUNT', tabId: activeTabId },
        (res) => {
          if (res && typeof res.count === 'number') {
            tabBlockedCountEl.textContent = formatNum(res.count);
          }
        }
      );

      chrome.tabs.sendMessage(
        activeTabId,
        { type: 'ULTIBLOCK_GET_DARK_STATUS' },
        (res) => {
          if (chrome.runtime.lastError) return;
          if (res) {
            tabNativeDarkDetected = Boolean(res.detectedNativeDark);
            renderFromStorage();
          }
        }
      );
    }

    await renderFromStorage();
  }

  async function updateDarkSettings(patchFn) {
    const data = await chrome.storage.local.get(['darkReaderSettings']);
    const current = {
      ...DEFAULT_DARK_READER,
      ...(data.darkReaderSettings || {})
    };
    patchFn(current);
    await chrome.storage.local.set({ darkReaderSettings: current });
    await renderFromStorage();
  }

  function fmtBytes(bytes) {
    const b = Number(bytes || 0);
    const unit = t('dlSizeUnit');
    if (!b || b <= 0) return `0 ${unit}`;
    return `${(b / (1024 * 1024)).toFixed(1)} ${unit}`;
  }

  function renderDownloadsList(downloads) {
    if (!downloadsListContainer) return;
    const list = Array.isArray(downloads) ? downloads.slice().reverse() : [];
    downloadsListContainer.textContent = '';

    const hasFinished = list.some(
      (j) =>
        j.status === 'completed' ||
        j.status === 'cancelled' ||
        j.status === 'error'
    );
    if (clearDownloadsBtn) {
      clearDownloadsBtn.style.display = hasFinished ? 'inline-block' : 'none';
    }

    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = t('dlEmpty');
      Object.assign(empty.style, {
        fontSize: '11px',
        color: '#64748b',
        textAlign: 'center',
        padding: '4px 0'
      });
      downloadsListContainer.appendChild(empty);
      return;
    }

    for (const job of list.slice(0, 5)) {
      const row = document.createElement('div');
      Object.assign(row.style, {
        background: '#0f172a',
        border: '1px solid #1e293b',
        borderRadius: '7px',
        padding: '7px 9px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px'
      });

      const topRow = document.createElement('div');
      Object.assign(topRow.style, {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '6px'
      });

      const titleEl = document.createElement('span');
      const icon = job.kind === 'mp3' ? '🎵' : '🎬';
      titleEl.textContent = `${icon} ${job.title || job.filename}`;
      Object.assign(titleEl.style, {
        fontSize: '11.5px',
        fontWeight: '600',
        color: '#f1f5f9',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        flex: '1'
      });
      topRow.appendChild(titleEl);

      const isRunning =
        job.status === 'downloading' ||
        job.status === 'converting' ||
        job.status === 'muxing';

      if (isRunning) {
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.textContent = '✕';
        cancelBtn.title = t('dlCancelTitle');
        Object.assign(cancelBtn.style, {
          background: 'transparent',
          border: 'none',
          color: '#ef4444',
          cursor: 'pointer',
          fontSize: '12px',
          fontWeight: '700',
          padding: '0 3px'
        });
        cancelBtn.addEventListener('click', () => {
          chrome.runtime.sendMessage({
            type: 'ULTIBLOCK_CANCEL_BG_DOWNLOAD',
            jobId: job.id
          });
        });
        topRow.appendChild(cancelBtn);
      }
      row.appendChild(topRow);

      // Progress Bar
      const barBg = document.createElement('div');
      Object.assign(barBg.style, {
        width: '100%',
        height: '5px',
        background: '#1e293b',
        borderRadius: '3px',
        overflow: 'hidden'
      });
      const barFill = document.createElement('div');
      const pct = Math.max(0, Math.min(100, Math.round(job.progress || 0)));
      const barColor =
        job.status === 'completed'
          ? '#22c55e'
          : job.status === 'error' || job.status === 'cancelled'
            ? '#ef4444'
            : job.kind === 'mp3'
              ? '#8b5cf6'
              : '#0ea5e9';
      Object.assign(barFill.style, {
        width: `${pct}%`,
        height: '100%',
        background: barColor,
        transition: 'width 0.2s ease'
      });
      barBg.appendChild(barFill);
      row.appendChild(barBg);

      // Meta status line
      const metaRow = document.createElement('div');
      Object.assign(metaRow.style, {
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '10.5px',
        color: '#94a3b8'
      });

      const leftStatus = document.createElement('span');
      leftStatus.textContent = job.stageText || `${pct}%`;

      const rightStatus = document.createElement('span');
      if (isRunning && job.totalBytes > 0) {
        const speedStr =
          job.speedBps > 0
            ? ` • ${(job.speedBps / (1024 * 1024)).toFixed(1)} ${t('dlSpeedUnit')}`
            : '';
        rightStatus.textContent = `${fmtBytes(job.downloadedBytes)} / ${fmtBytes(job.totalBytes)}${speedStr}`;
      } else {
        rightStatus.textContent = `${pct}%`;
      }

      metaRow.appendChild(leftStatus);
      metaRow.appendChild(rightStatus);
      row.appendChild(metaRow);

      downloadsListContainer.appendChild(row);
    }
  }

  async function renderFromStorage() {
    const data = await chrome.storage.local.get([
      'enabled',
      'hoverDownloader',
      'downloadSpeedLimitMBps',
      'activeDownloads',
      'disabledDomains',
      'disabledDownloaderDomains',
      'customBlockedDomains',
      'customSelectors',
      'cloudRulesCount',
      'lastCloudUpdate',
      'ytPremiumSettings',
      'darkReaderSettings',
      'totalStats'
    ]);

    const enabled = data.enabled !== undefined ? data.enabled : true;
    const hoverDownloader =
      data.hoverDownloader !== undefined ? data.hoverDownloader : true;
    const speedLimit =
      data.downloadSpeedLimitMBps !== undefined
        ? String(data.downloadSpeedLimitMBps)
        : '2.5';
    for (const b of dlSpeedBtns) {
      b.classList.toggle('active', b.dataset.speed === speedLimit);
    }
    renderDownloadsList(data.activeDownloads || []);
    const disabledDomains = Array.isArray(data.disabledDomains)
      ? data.disabledDomains
      : [];
    const disabledDownloaderDomains = Array.isArray(data.disabledDownloaderDomains)
      ? data.disabledDownloaderDomains
      : [];
    const customBlockedDomains = Array.isArray(data.customBlockedDomains)
      ? data.customBlockedDomains
      : [];
    const customSelectors = data.customSelectors || {};
    const ytPremium = {
      ...DEFAULT_YT_PREMIUM,
      ...(data.ytPremiumSettings || {})
    };
    const dark = {
      ...DEFAULT_DARK_READER,
      ...(data.darkReaderSettings || {})
    };
    const stats = data.totalStats || {
      network: 0,
      dom: 0,
      youtube: 0,
      popup: 0
    };

    globalToggle.checked = enabled;
    chkHoverDownloader.checked = Boolean(hoverDownloader);

    const siteEnabled =
      enabled && (!activeHostname || !disabledDomains.includes(activeHostname));
    siteToggle.checked = siteEnabled;

    if (chkSiteHoverDownloader) {
      chkSiteHoverDownloader.checked =
        Boolean(hoverDownloader) &&
        siteEnabled &&
        (!activeHostname || !disabledDownloaderDomains.includes(activeHostname));
    }

    if (enabled && siteEnabled) {
      shieldIcon.classList.remove('disabled');
      statusText.textContent = t('statusActive');
      statusText.classList.remove('off');
    } else if (!enabled) {
      shieldIcon.classList.add('disabled');
      statusText.textContent = t('statusGlobalOff');
      statusText.classList.add('off');
    } else {
      shieldIcon.classList.add('disabled');
      statusText.textContent = t('statusSitePaused', { domain: activeHostname });
      statusText.classList.add('off');
    }

    statNetworkEl.textContent = formatNum(stats.network);
    statYoutubeEl.textContent = formatNum(stats.youtube);
    statDomEl.textContent = formatNum(stats.dom);
    statPopupEl.textContent = formatNum(stats.popup);

    // Sync YouTube Premium + Tweaks checkboxes & grid buttons
    for (const cb of ytOptionCheckboxes) {
      const key = cb.dataset.ytKey;
      if (key in ytPremium) {
        cb.checked = Boolean(ytPremium[key]);
      }
    }

    const activeCols = String(ytPremium.gridColumns || 0);
    for (const b of ytGridBtns) {
      b.classList.toggle('active', b.dataset.cols === activeCols);
    }

    // Sync Dark Reader UI
    darkGlobalToggle.checked = Boolean(dark.enabled);
    chkAutoSkipNativeDark.checked = Boolean(dark.autoSkipNativeDark);

    rngBrightness.value = dark.brightness;
    rngContrast.value = dark.contrast;
    rngWarmth.value = dark.warmth;
    valBrightness.textContent = `${dark.brightness}%`;
    valContrast.textContent = `${dark.contrast}%`;
    valWarmth.textContent = `${dark.warmth}%`;

    for (const b of engineBtns) {
      b.classList.toggle('active', b.dataset.engine === dark.engine);
    }
    for (const b of paletteBtns) {
      b.classList.toggle('active', b.dataset.theme === dark.theme);
    }

    const darkDisabledSet = new Set(dark.disabledDomains || []);
    const darkForcedSet = new Set(dark.forcedDomains || []);
    let siteMode = 'auto';
    if (activeHostname) {
      if (darkForcedSet.has(activeHostname)) siteMode = 'force';
      else if (darkDisabledSet.has(activeHostname)) siteMode = 'off';
    }

    for (const b of segBtns) {
      b.classList.toggle('active', b.dataset.siteMode === siteMode);
    }

    if (!dark.enabled) {
      darkSiteStatusText.textContent = t('darkStatusGlobalOff');
    } else if (siteMode === 'off') {
      darkSiteStatusText.textContent = t('darkStatusSiteOff', { domain: activeHostname });
    } else if (siteMode === 'force') {
      darkSiteStatusText.textContent = t('darkStatusSiteForce', { domain: activeHostname });
    } else if (dark.autoSkipNativeDark && tabNativeDarkDetected) {
      darkSiteStatusText.textContent = t('darkStatusNativeSkip');
    } else {
      darkSiteStatusText.textContent = t('darkStatusActive');
    }

    // Custom selectors for active site
    const siteSelectors =
      activeHostname && Array.isArray(customSelectors[activeHostname])
        ? customSelectors[activeHostname]
        : [];

    if (siteSelectors.length > 0) {
      customSelectorsBar.style.display = 'flex';
      customSelectorsCount.textContent = t('customHiddenCount', { count: siteSelectors.length });
    } else {
      customSelectorsBar.style.display = 'none';
    }

    // Disabled / Whitelisted domains tags
    if (disabledSitesSection && disabledDomainsList) {
      disabledDomainsList.innerHTML = '';
      if (disabledDomains.length > 0) {
        disabledSitesSection.style.display = 'block';
        for (const dom of disabledDomains) {
          const tag = document.createElement('div');
          tag.className = 'domain-tag';
          const span = document.createElement('span');
          span.textContent = dom;
          const btn = document.createElement('button');
          btn.textContent = '×';
          btn.title = t('whitelistRestoreTitle');
          btn.addEventListener('click', () => removeDisabledDomain(dom));
          tag.appendChild(span);
          tag.appendChild(btn);
          disabledDomainsList.appendChild(tag);
        }
      } else {
        disabledSitesSection.style.display = 'none';
      }
    }

    // Custom blocked domains tags
    customDomainsList.innerHTML = '';
    for (const dom of customBlockedDomains) {
      const tag = document.createElement('div');
      tag.className = 'domain-tag';
      const span = document.createElement('span');
      span.textContent = dom;
      const btn = document.createElement('button');
      btn.textContent = '×';
      btn.title = t('blacklistRemoveTitle');
      btn.addEventListener('click', () => removeCustomDomain(dom));
      tag.appendChild(span);
      tag.appendChild(btn);
      customDomainsList.appendChild(tag);
    }

    if (data.cloudRulesCount && data.lastCloudUpdate) {
      cloudMeta.textContent = t('cloudMetaUpdated', {
        count: formatNum(data.cloudRulesCount),
        date: data.lastCloudUpdate
      });
    } else {
      cloudMeta.textContent = t('madeBy');
    }
  }

  // Master Downloader Toggle (controls Photos/Websites + YouTube + YouTube Music)
  chkHoverDownloader.addEventListener('change', async () => {
    const val = chkHoverDownloader.checked;
    const data = await chrome.storage.local.get(['ytPremiumSettings']);
    const currentYt = {
      ...DEFAULT_YT_PREMIUM,
      ...(data.ytPremiumSettings || {}),
      showDownloadButtons: val
    };
    await chrome.storage.local.set({
      hoverDownloader: val,
      ytPremiumSettings: currentYt
    });
    await renderFromStorage();
  });

  if (chkSiteHoverDownloader) {
    chkSiteHoverDownloader.addEventListener('change', async () => {
      if (!activeHostname) return;
      const data = await chrome.storage.local.get(['disabledDownloaderDomains']);
      let list = Array.isArray(data.disabledDownloaderDomains)
        ? data.disabledDownloaderDomains
        : [];
      if (chkSiteHoverDownloader.checked) {
        list = list.filter((d) => d !== activeHostname);
      } else if (!list.includes(activeHostname)) {
        list.push(activeHostname);
      }
      await chrome.storage.local.set({ disabledDownloaderDomains: list });
      await renderFromStorage();
    });
  }

  if (clearDownloadsBtn) {
    clearDownloadsBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'ULTIBLOCK_CLEAR_FINISHED_DOWNLOADS' });
    });
  }

  for (const btn of dlSpeedBtns) {
    btn.addEventListener('click', () => {
      const speedVal = Number(btn.dataset.speed) || 0;
      chrome.runtime.sendMessage({
        type: 'ULTIBLOCK_SET_SPEED_LIMIT',
        speedLimitMBps: speedVal
      });
    });
  }

  // Dark Reader Event Listeners
  darkGlobalToggle.addEventListener('change', () => {
    updateDarkSettings((s) => {
      s.enabled = darkGlobalToggle.checked;
    });
  });

  chkAutoSkipNativeDark.addEventListener('change', () => {
    updateDarkSettings((s) => {
      s.autoSkipNativeDark = chkAutoSkipNativeDark.checked;
    });
  });

  for (const btn of segBtns) {
    btn.addEventListener('click', () => {
      if (!activeHostname) return;
      const mode = btn.dataset.siteMode;
      updateDarkSettings((s) => {
        const disabled = new Set(s.disabledDomains || []);
        const forced = new Set(s.forcedDomains || []);
        disabled.delete(activeHostname);
        forced.delete(activeHostname);
        if (mode === 'force') forced.add(activeHostname);
        if (mode === 'off') disabled.add(activeHostname);
        s.disabledDomains = Array.from(disabled);
        s.forcedDomains = Array.from(forced);
      });
    });
  }

  for (const btn of engineBtns) {
    btn.addEventListener('click', () => {
      updateDarkSettings((s) => {
        s.engine = btn.dataset.engine;
      });
    });
  }

  for (const btn of paletteBtns) {
    btn.addEventListener('click', () => {
      updateDarkSettings((s) => {
        s.theme = btn.dataset.theme;
      });
    });
  }

  rngBrightness.addEventListener('input', () => {
    valBrightness.textContent = `${rngBrightness.value}%`;
    updateDarkSettings((s) => {
      s.brightness = Number(rngBrightness.value);
    });
  });

  rngContrast.addEventListener('input', () => {
    valContrast.textContent = `${rngContrast.value}%`;
    updateDarkSettings((s) => {
      s.contrast = Number(rngContrast.value);
    });
  });

  rngWarmth.addEventListener('input', () => {
    valWarmth.textContent = `${rngWarmth.value}%`;
    updateDarkSettings((s) => {
      s.warmth = Number(rngWarmth.value);
    });
  });

  // YouTube Premium & Tweaks option toggles
  for (const cb of ytOptionCheckboxes) {
    cb.addEventListener('change', async () => {
      const data = await chrome.storage.local.get(['ytPremiumSettings']);
      const current = {
        ...DEFAULT_YT_PREMIUM,
        ...(data.ytPremiumSettings || {})
      };
      const key = cb.dataset.ytKey;
      current[key] = cb.checked;
      const patch = { ytPremiumSettings: current };
      if (key === 'showDownloadButtons') {
        patch.hoverDownloader = cb.checked;
      }
      await chrome.storage.local.set(patch);
      await renderFromStorage();
    });
  }

  for (const btn of ytGridBtns) {
    btn.addEventListener('click', async () => {
      const data = await chrome.storage.local.get(['ytPremiumSettings']);
      const current = {
        ...DEFAULT_YT_PREMIUM,
        ...(data.ytPremiumSettings || {})
      };
      current.gridColumns = Number(btn.dataset.cols || 0);
      await chrome.storage.local.set({ ytPremiumSettings: current });
      await renderFromStorage();
    });
  }

  // Global Toggle
  globalToggle.addEventListener('change', async () => {
    await chrome.storage.local.set({ enabled: globalToggle.checked });
    chrome.runtime.sendMessage({ type: 'ULTIBLOCK_SYNC_RULES' });
    await renderFromStorage();
  });

  // Site Toggle
  siteToggle.addEventListener('change', async () => {
    if (!activeHostname) return;
    const data = await chrome.storage.local.get(['disabledDomains']);
    let list = Array.isArray(data.disabledDomains) ? data.disabledDomains : [];
    if (siteToggle.checked) {
      list = list.filter((d) => d !== activeHostname);
    } else if (!list.includes(activeHostname)) {
      list.push(activeHostname);
    }
    await chrome.storage.local.set({ disabledDomains: list });
    chrome.runtime.sendMessage({ type: 'ULTIBLOCK_SYNC_RULES' });
    await renderFromStorage();
    if (activeTabId !== null) {
      try {
        chrome.tabs.reload(activeTabId);
      } catch (_) {}
    }
  });

  async function removeDisabledDomain(domain) {
    const data = await chrome.storage.local.get(['disabledDomains']);
    const list = (data.disabledDomains || []).filter((d) => d !== domain);
    await chrome.storage.local.set({ disabledDomains: list });
    chrome.runtime.sendMessage({ type: 'ULTIBLOCK_SYNC_RULES' });
    await renderFromStorage();
    if (activeTabId !== null && domain === activeHostname) {
      try {
        chrome.tabs.reload(activeTabId);
      } catch (_) {}
    }
  }

  // Interactive Element Picker
  pickerBtn.addEventListener('click', () => {
    if (!activeTabId) return;
    chrome.tabs.sendMessage(
      activeTabId,
      { type: 'ULTIBLOCK_START_PICKER' },
      () => {
        window.close();
      }
    );
  });

  // Reset custom hidden selectors for current site
  resetSiteSelectorsBtn.addEventListener('click', async () => {
    if (!activeHostname) return;
    const data = await chrome.storage.local.get(['customSelectors']);
    const map = data.customSelectors || {};
    delete map[activeHostname];
    await chrome.storage.local.set({ customSelectors: map });
    await renderFromStorage();
  });

  // Add custom blocked domain
  async function addCustomDomain() {
    const raw = (customDomainInput.value || '').trim().toLowerCase();
    const cleaned = raw
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0];

    if (!cleaned || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(cleaned)) {
      return;
    }

    const data = await chrome.storage.local.get(['customBlockedDomains']);
    const list = Array.isArray(data.customBlockedDomains)
      ? data.customBlockedDomains
      : [];
    if (!list.includes(cleaned)) {
      list.push(cleaned);
      await chrome.storage.local.set({ customBlockedDomains: list });
      chrome.runtime.sendMessage({ type: 'ULTIBLOCK_SYNC_RULES' });
    }
    customDomainInput.value = '';
    await renderFromStorage();
  }

  async function removeCustomDomain(domain) {
    const data = await chrome.storage.local.get(['customBlockedDomains']);
    const list = (data.customBlockedDomains || []).filter((d) => d !== domain);
    await chrome.storage.local.set({ customBlockedDomains: list });
    chrome.runtime.sendMessage({ type: 'ULTIBLOCK_SYNC_RULES' });
    await renderFromStorage();
  }

  addDomainBtn.addEventListener('click', addCustomDomain);
  customDomainInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addCustomDomain();
  });

  // Cloud Filter Sync
  cloudSyncBtn.addEventListener('click', () => {
    cloudSyncBtn.disabled = true;
    cloudSyncBtn.textContent = t('cloudSyncLoading');
    chrome.runtime.sendMessage(
      { type: 'ULTIBLOCK_UPDATE_CLOUD_FILTERS' },
      async (res) => {
        cloudSyncBtn.disabled = false;
        if (res && res.ok) {
          cloudSyncBtn.textContent = t('cloudSyncDone', { count: formatNum(res.count) });
        } else {
          cloudSyncBtn.textContent = t('cloudSyncError');
        }
        await renderFromStorage();
      }
    );
  });

  chrome.storage.onChanged.addListener(() => {
    renderFromStorage();
  });

  init();
})();
