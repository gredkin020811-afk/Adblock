/**
 * UltiBlock Pro — ISOLATED World Content Script
 * Handles:
 * 1. YouTube real-time video ad fast-forwarding, skipping & anti-adblock dialog dismissal
 * 2. Universal HTML5 video pre-roll skipper for online cinemas (PlayerJS, Kodik, Rutube, VK, etc.)
 * 3. Heuristic DOM MutationObserver for random sites (casino banners, sticky overlays, ad iframes)
 * 4. Interactive Element Picker ("Заблокировать элемент на странице")
 * 5. Per-site custom CSS rules and stats synchronization with background Service Worker
 */
(function () {
  'use strict';

  if (window.__ultiblockIsolatedInjected) return;
  window.__ultiblockIsolatedInjected = true;

  const hostname = (location.hostname || '').toLowerCase().replace(/^www\./, '');
  const isYouTube =
    hostname === 'youtube.com' ||
    hostname === 'm.youtube.com' ||
    hostname === 'music.youtube.com' ||
    hostname === 'youtu.be';

  let isExtensionActive = true;
  let customStyleEl = null;

  // Synchronous check from localStorage before async chrome.storage.local finishes
  try {
    if (localStorage.getItem('__ub_site_disabled') === '1') {
      isExtensionActive = false;
      if (document.documentElement) {
        document.documentElement.dataset.ultiblockDisabled = 'true';
      }
    }
  } catch (_) {}

  // Stat batching to avoid excessive sendMessage calls
  const pendingStats = {
    network: 0,
    dom: 0,
    youtube: 0,
    popup: 0,
    sponsor: 0
  };
  let statFlushTimer = null;

  function recordStat(kind, count = 1) {
    if (!isExtensionActive) return;
    if (kind in pendingStats) {
      pendingStats[kind] += count;
    }
    if (!statFlushTimer) {
      statFlushTimer = setTimeout(() => {
        statFlushTimer = null;
        const payload = { ...pendingStats };
        pendingStats.network = 0;
        pendingStats.dom = 0;
        pendingStats.youtube = 0;
        pendingStats.popup = 0;
        pendingStats.sponsor = 0;
        try {
          chrome.runtime.sendMessage({
            type: 'ULTIBLOCK_RECORD_STATS',
            hostname,
            stats: payload
          });
        } catch (_) {}
      }, 600);
    }
  }

  // Listen for stats and YouTube Premium API requests from MAIN world scripts
  window.addEventListener('message', (event) => {
    if (
      event.source !== window ||
      !event.data ||
      event.data.__ultiblock !== true
    ) {
      return;
    }

    if (event.data.type === 'ULTIBLOCK_STAT') {
      recordStat(event.data.kind || 'network', event.data.count || 1);
    } else if (event.data.type === 'ULTIBLOCK_YT_VIDEO_CHANGE') {
      const { videoId, needSponsor, needDislikes } = event.data;
      if (!videoId) return;
      try {
        chrome.runtime.sendMessage(
          {
            type: 'ULTIBLOCK_FETCH_YT_EXTRAS',
            videoId,
            needSponsor: Boolean(needSponsor),
            needDislikes: Boolean(needDislikes)
          },
          (res) => {
            if (res && res.ok) {
              window.postMessage(
                {
                  __ultiblock: true,
                  type: 'ULTIBLOCK_YT_VIDEO_DATA',
                  videoId: res.videoId,
                  segments: res.segments || [],
                  dislikes: res.dislikes || null
                },
                '*'
              );
            }
          }
        );
      } catch (_) {}
    }
  });

  // =========================================================================
  // 1. INITIALIZE SETTINGS & CUSTOM USER SELECTORS
  // =========================================================================
  function applyState(
    enabled,
    disabledDomains,
    customSelectorsMap,
    ytPremiumSettings,
    hoverDownloader
  ) {
    const domainDisabled =
      Array.isArray(disabledDomains) && disabledDomains.includes(hostname);
    isExtensionActive = Boolean(enabled) && !domainDisabled;

    try {
      if (!isExtensionActive) {
        localStorage.setItem('__ub_site_disabled', '1');
      } else {
        localStorage.removeItem('__ub_site_disabled');
      }
    } catch (_) {}

    if (document.documentElement) {
      if (!isExtensionActive) {
        document.documentElement.dataset.ultiblockDisabled = 'true';
      } else {
        delete document.documentElement.dataset.ultiblockDisabled;
      }
      const mergedYt = {
        ...(ytPremiumSettings || {}),
        showDownloadButtons:
          hoverDownloader !== false &&
          (!ytPremiumSettings || ytPremiumSettings.showDownloadButtons !== false)
      };
      const mergedYtStr = JSON.stringify(mergedYt);
      document.documentElement.dataset.ultiblockYtConfig = mergedYtStr;
      try {
        localStorage.setItem('__ub_yt_config', mergedYtStr);
      } catch (_) {}
    }

    const selectors =
      customSelectorsMap && Array.isArray(customSelectorsMap[hostname])
        ? customSelectorsMap[hostname]
        : [];

    if (isExtensionActive && selectors.length > 0) {
      const cssText = `${selectors.join(',\n')} {\n  display: none !important;\n  visibility: hidden !important;\n  pointer-events: none !important;\n}`;
      if (!customStyleEl) {
        customStyleEl = document.createElement('style');
        customStyleEl.id = 'ultiblock-custom-selectors';
        (document.head || document.documentElement).appendChild(customStyleEl);
      }
      customStyleEl.textContent = cssText;
    } else if (customStyleEl) {
      customStyleEl.textContent = '';
    }
  }

  try {
    chrome.storage.local.get(
      [
        'enabled',
        'disabledDomains',
        'customSelectors',
        'ytPremiumSettings',
        'hoverDownloader'
      ],
      (res) => {
        const enabled = res.enabled !== undefined ? res.enabled : true;
        const disabledDomains = res.disabledDomains || [];
        const customSelectors = res.customSelectors || {};
        const hoverDownloader =
          res.hoverDownloader !== undefined ? res.hoverDownloader : true;
        applyState(
          enabled,
          disabledDomains,
          customSelectors,
          res.ytPremiumSettings || null,
          hoverDownloader
        );
      }
    );

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        chrome.storage.local.get(
          [
            'enabled',
            'disabledDomains',
            'customSelectors',
            'ytPremiumSettings',
            'hoverDownloader'
          ],
          (res) => {
            applyState(
              res.enabled !== undefined ? res.enabled : true,
              res.disabledDomains || [],
              res.customSelectors || {},
              res.ytPremiumSettings || null,
              res.hoverDownloader !== undefined ? res.hoverDownloader : true
            );
          }
        );
      }
    });
  } catch (_) {}

  // =========================================================================
  // 2. YOUTUBE REAL-TIME AD SKIPPER & ENFORCEMENT KILLER
  // =========================================================================
  const YT_SKIP_SELECTORS = [
    '.ytp-ad-skip-button',
    '.ytp-ad-skip-button-modern',
    '.ytp-skip-ad-button',
    '.ytp-ad-skip-button-slot button',
    '.ytp-ad-skip-button-container button',
    '.ytp-ad-overlay-close-button',
    'button.ytp-ad-skip-button-modern'
  ];

  let userPlaybackRate = 1;
  let userWasMuted = false;
  let wasInAdState = false;

  function handleYouTubeAds() {
    if (!isExtensionActive || !isYouTube) return;

    const player = document.querySelector('#movie_player, .html5-video-player');
    const video = document.querySelector('video.html5-main-video, #movie_player video');

    // 1. Click any visible skip or overlay close buttons immediately
    for (const sel of YT_SKIP_SELECTORS) {
      const buttons = document.querySelectorAll(sel);
      for (const btn of buttons) {
        if (btn && typeof btn.click === 'function') {
          try {
            btn.click();
          } catch (_) {}
        }
      }
    }

    // 2. Check if player is currently showing a video ad
    const isAdShowing =
      player &&
      (player.classList.contains('ad-showing') ||
        player.classList.contains('ad-interrupting'));

    if (isAdShowing && video) {
      if (!wasInAdState) {
        wasInAdState = true;
        userPlaybackRate =
          video.playbackRate && video.playbackRate <= 4 ? video.playbackRate : 1;
        userWasMuted = video.muted;
        recordStat('youtube', 1);
      }

      // Mute ad audio immediately
      video.muted = true;

      // Server-side stitched (SSAP) ads live inside the main video stream:
      // seeking the <video> element or changing its rate breaks playback.
      // Those are skipped from the MAIN world via the player API instead.
      const isSsapAd =
        document.documentElement &&
        document.documentElement.dataset.ultiblockSsapAd === 'true';

      // Fast-forward to the end of the ad video stream (only once metadata is loaded)
      if (!isSsapAd && video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 0.5) {
        video.currentTime = Math.max(0, video.duration - 0.05);
      }
      if (!isSsapAd && video.readyState >= 1) {
        try {
          video.playbackRate = 16;
        } catch (_) {}
      }

      // Also ask #movie_player API to skip/cancel ad if accessible
      for (const sel of YT_SKIP_SELECTORS) {
        const btn = document.querySelector(sel);
        if (btn) {
          try {
            btn.click();
          } catch (_) {}
        }
      }
    } else if (wasInAdState && video) {
      // Ad finished — restore user's original playback speed and mute state
      wasInAdState = false;
      try {
        video.playbackRate = userPlaybackRate || 1;
        video.muted = userWasMuted;
      } catch (_) {}
    }

    // 3. Dismiss YouTube anti-adblock enforcement popup if it ever appears
    const enforcementModal = document.querySelector(
      'tp-yt-paper-dialog:has(ytd-enforcement-message-view-model), ytd-enforcement-message-view-model'
    );
    if (enforcementModal) {
      const dialog = enforcementModal.closest('tp-yt-paper-dialog') || enforcementModal;
      dialog.remove();
      const backdrop = document.querySelector('tp-yt-iron-overlay-backdrop');
      if (backdrop) backdrop.remove();
      if (video && video.paused) {
        try {
          video.play();
        } catch (_) {}
      }
      recordStat('youtube', 1);
    }

    // 4. Hide error overlay if visible without detaching Polymer-managed nodes
    const flexy = document.querySelector('ytd-watch-flexy[player-unavailable]');
    if (flexy) {
      flexy.removeAttribute('player-unavailable');
    }
    const errScreen = document.querySelector(
      '#error-screen, yt-playability-error-supported-renderers, #player-error-message-container'
    );
    if (errScreen && errScreen.style.display !== 'none') {
      errScreen.style.setProperty('display', 'none', 'important');
    }
    const ytpError = document.querySelector('.ytp-error');
    if (ytpError && ytpError.style.display !== 'none') {
      ytpError.style.setProperty('display', 'none', 'important');
    }
  }

  if (isYouTube) {
    // High-frequency check for zero-frame ad skipping on YouTube
    setInterval(handleYouTubeAds, 150);
  }

  // =========================================================================
  // 3. UNIVERSAL VIDEO PRE-ROLL SKIPPER (Online Cinemas, Rutube, VK, etc.)
  // =========================================================================
  const GENERIC_SKIP_SELECTORS = [
    '.vast-skip-button',
    '.jw-skip',
    '.vjs-skip-button',
    '.ima-skip-button',
    '[class*="skip-ad"]',
    '[class*="ad-skip"]',
    '[id*="skip-ad"]',
    '.preroll-skip',
    '.skip_button'
  ];

  const AD_VIDEO_SRC_REGEX =
    /googlesyndication|doubleclick|2mdn\.net|an\.yandex\.ru|strm-rad|adfox|beseed|nativeroll|viboom|videoroll|pladform|buzzoola|moevideo|franecki|traforet|octoclick|preroll/i;

  function handleGenericVideoAds() {
    if (!isExtensionActive || isYouTube) return;

    // 1. Click generic skip buttons
    for (const sel of GENERIC_SKIP_SELECTORS) {
      const btns = document.querySelectorAll(sel);
      for (const btn of btns) {
        if (btn && btn.offsetParent !== null) {
          try {
            btn.click();
            recordStat('dom', 1);
          } catch (_) {}
        }
      }
    }

    // 2. Search buttons/divs containing exact Russian/English skip text inside player wrappers
    const candidates = document.querySelectorAll(
      'button, [role="button"], .pjsdiv, div[style*="cursor: pointer"]'
    );
    for (const el of candidates) {
      const txt = (el.textContent || '').trim();
      if (
        txt.length > 0 &&
        txt.length < 32 &&
        /^(пропустить(\s+рекламу)?|skip(\s+ad|\s+video)?|закрыть\s+рекламу)$/i.test(txt)
      ) {
        try {
          el.click();
          recordStat('dom', 1);
        } catch (_) {}
      }
    }

    // 3. Fast-forward <video> elements whose source URL is an ad server
    const videos = document.querySelectorAll('video');
    for (const v of videos) {
      const src = v.currentSrc || v.src || '';
      if (src && AD_VIDEO_SRC_REGEX.test(src)) {
        v.muted = true;
        if (Number.isFinite(v.duration) && v.duration > 0) {
          v.currentTime = v.duration;
          recordStat('network', 1);
        } else {
          try {
            v.playbackRate = 16;
          } catch (_) {}
        }
      }
    }
  }

  if (!isYouTube) {
    setInterval(handleGenericVideoAds, 600);
  }

  // =========================================================================
  // 4. HEURISTIC DOM CLEANER FOR RANDOM SITES
  // =========================================================================
  const BAD_IFRAME_OR_HREF_REGEX =
    /doubleclick\.net|googlesyndication\.com|adnxs\.com|yandex\.ru\/ads|adfox\.ru|mgid\.com|marketgid\.com|smi2\.net|24smi\.|teasernet\.com|directadvert\.ru|kadam\.net|bodyclick\.net|luckyads|adsterra|exoclick|trafficstars|juicyads|propellerads|popads|clickadu|hilltopads|evadav|1xbet|1xstavka|melbet|mostbet|vavada|joycasino|casino-x|azino777|1win|pin-up|dragonmoney|catcasino|kentcasino|pokerdom|traforet|franecki|octoclick|twinrds|tsyndicate|realsrv|oclasrv/i;

  function cleanNode(root) {
    if (!isExtensionActive || !root || !root.querySelectorAll) return;

    let hiddenCount = 0;

    // 1. Check iframes with ad/casino/teaser sources
    const iframes = root.querySelectorAll('iframe');
    for (const iframe of iframes) {
      if (iframe.dataset.ultiblockChecked) continue;
      iframe.dataset.ultiblockChecked = '1';
      const src = iframe.src || iframe.getAttribute('data-src') || '';
      const idCls = `${iframe.id || ''} ${iframe.className || ''}`;
      if (
        (src && BAD_IFRAME_OR_HREF_REGEX.test(src)) ||
        /\b(google_ads_iframe|yandex_rtb|adfox|mgid|ad-frame)\b/i.test(idCls)
      ) {
        iframe.style.setProperty('display', 'none', 'important');
        iframe.src = 'about:blank';
        hiddenCount++;
      }
    }

    // 2. Check links/banners pointing to casinos/betting/teaser networks
    const links = root.querySelectorAll('a[href]');
    for (const a of links) {
      if (a.dataset.ultiblockChecked) continue;
      a.dataset.ultiblockChecked = '1';
      const href = a.getAttribute('href') || '';
      if (BAD_IFRAME_OR_HREF_REGEX.test(href)) {
        // Hide the link and, if it wraps an image/video banner, its immediate ad wrapper
        a.style.setProperty('display', 'none', 'important');
        const parent = a.parentElement;
        if (
          parent &&
          parent.tagName !== 'BODY' &&
          parent.tagName !== 'MAIN' &&
          parent.tagName !== 'ARTICLE' &&
          parent.children.length === 1
        ) {
          parent.style.setProperty('display', 'none', 'important');
        }
        hiddenCount++;
      }
    }

    if (hiddenCount > 0) {
      recordStat('dom', hiddenCount);
    }
  }

  // Observe DOM mutations
  const observer = new MutationObserver((mutations) => {
    if (!isExtensionActive) return;
    if (isYouTube) {
      handleYouTubeAds();
      return;
    }
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          cleanNode(node);
        }
      }
    }
  });

  function startObserver() {
    if (document.documentElement) {
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
      cleanNode(document.documentElement);
    } else {
      window.addEventListener('DOMContentLoaded', () => {
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true
        });
        cleanNode(document.documentElement);
      });
    }
  }

  startObserver();

  // =========================================================================
  // 5. INTERACTIVE ELEMENT PICKER ("ЗАБЛОКИРОВАТЬ ЭЛЕМЕНТ НА СТРАНИЦЕ")
  // =========================================================================
  let pickerActive = false;
  let pickerOverlay = null;
  let pickerTooltip = null;
  let hoveredElement = null;

  function buildUniqueSelector(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';
    if (el.id && !/^\d/.test(el.id) && !el.id.includes(':')) {
      return `#${CSS.escape(el.id)}`;
    }

    const parts = [];
    let cur = el;
    let depth = 0;

    while (
      cur &&
      cur.nodeType === Node.ELEMENT_NODE &&
      cur.tagName !== 'HTML' &&
      cur.tagName !== 'BODY' &&
      depth < 4
    ) {
      let selector = cur.tagName.toLowerCase();
      if (cur.id && !/^\d/.test(cur.id)) {
        selector = `#${CSS.escape(cur.id)}`;
        parts.unshift(selector);
        break;
      }

      const validClasses = Array.from(cur.classList || []).filter(
        (c) => c.length > 1 && c.length < 40 && !/^(hover|active|focus|open|show)$/i.test(c)
      );

      if (validClasses.length > 0) {
        selector +=
          '.' +
          validClasses
            .slice(0, 2)
            .map((c) => CSS.escape(c))
            .join('.');
      } else if (cur.parentElement) {
        const siblings = Array.from(cur.parentElement.children).filter(
          (s) => s.tagName === cur.tagName
        );
        if (siblings.length > 1) {
          const idx = Array.from(cur.parentElement.children).indexOf(cur) + 1;
          selector += `:nth-child(${idx})`;
        }
      }

      parts.unshift(selector);
      cur = cur.parentElement;
      depth++;
    }

    return parts.join(' > ');
  }

  function stopElementPicker() {
    if (!pickerActive) return;
    pickerActive = false;
    window.removeEventListener('mousemove', onPickerMouseMove, true);
    window.removeEventListener('click', onPickerClick, true);
    window.removeEventListener('keydown', onPickerKeyDown, true);
    if (pickerOverlay) {
      pickerOverlay.remove();
      pickerOverlay = null;
    }
    if (pickerTooltip) {
      pickerTooltip.remove();
      pickerTooltip = null;
    }
    hoveredElement = null;
  }

  function onPickerMouseMove(e) {
    if (!pickerActive) return;
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (
      !target ||
      target === pickerOverlay ||
      target === pickerTooltip ||
      target.tagName === 'HTML' ||
      target.tagName === 'BODY'
    ) {
      return;
    }
    hoveredElement = target;
    const rect = target.getBoundingClientRect();

    Object.assign(pickerOverlay.style, {
      display: 'block',
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`
    });

    const sel = buildUniqueSelector(target);
    pickerTooltip.textContent = `Клик — заблокировать: ${sel} (Esc — отмена)`;
    Object.assign(pickerTooltip.style, {
      display: 'block',
      top: `${Math.max(8, rect.top - 34)}px`,
      left: `${Math.min(window.innerWidth - 320, Math.max(8, rect.left))}px`
    });
  }

  function onPickerClick(e) {
    if (!pickerActive) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (hoveredElement) {
      const selector = buildUniqueSelector(hoveredElement);
      if (selector) {
        hoveredElement.style.setProperty('display', 'none', 'important');
        recordStat('dom', 1);

        chrome.storage.local.get(['customSelectors'], (res) => {
          const map = res.customSelectors || {};
          const list = Array.isArray(map[hostname]) ? map[hostname] : [];
          if (!list.includes(selector)) {
            list.push(selector);
            map[hostname] = list;
            chrome.storage.local.set({ customSelectors: map });
          }
        });
      }
    }

    stopElementPicker();
  }

  function onPickerKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      stopElementPicker();
    }
  }

  function startElementPicker() {
    if (pickerActive) return;
    pickerActive = true;

    pickerOverlay = document.createElement('div');
    Object.assign(pickerOverlay.style, {
      position: 'fixed',
      zIndex: '2147483646',
      pointerEvents: 'none',
      background: 'rgba(239, 68, 68, 0.22)',
      border: '2px solid #ef4444',
      borderRadius: '4px',
      boxShadow: '0 0 12px rgba(239, 68, 68, 0.45)',
      transition: 'all 0.05s ease',
      display: 'none'
    });

    pickerTooltip = document.createElement('div');
    Object.assign(pickerTooltip.style, {
      position: 'fixed',
      zIndex: '2147483647',
      pointerEvents: 'none',
      background: '#0f172a',
      color: '#f8fafc',
      padding: '6px 10px',
      borderRadius: '6px',
      fontSize: '12px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      border: '1px solid #ef4444',
      boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
      whiteSpace: 'nowrap',
      maxWidth: '420px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      display: 'none'
    });

    document.documentElement.appendChild(pickerOverlay);
    document.documentElement.appendChild(pickerTooltip);

    window.addEventListener('mousemove', onPickerMouseMove, true);
    window.addEventListener('click', onPickerClick, true);
    window.addEventListener('keydown', onPickerKeyDown, true);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'ULTIBLOCK_START_PICKER') {
      startElementPicker();
      sendResponse({ ok: true });
    }
    return false;
  });
})();
