/**
 * UltiBlock Pro — Smart Dark Reader Engine (ISOLATED World, document_start)
 * Designed to beat standard Dark Reader:
 * - Zero White Flash (runs at document_start before first paint)
 * - Auto-detects sites that ALREADY have a native dark theme (by luminance, meta color-scheme, attributes)
 * - Two engines:
 *   1. "smart" (Smart Surface & CSS Engine — recolors backgrounds/text/borders without inverting media or colors)
 *   2. "gpu"   (Ultra-fast GPU Matrix Filter — 120 FPS invert+hue-rotate with automatic media & bg-image protection)
 * - 4 Curated Palettes: Midnight Slate, Carbon Soft, True OLED, Warm Paper
 * - Real-time Sliders: Brightness, Contrast, Warmth (Eye Care Sepia)
 * - Hotkey Alt+D to toggle dark mode on the current site at any time
 */
(function () {
  'use strict';

  if (window.__ultiblockDarkEngineInjected) return;
  window.__ultiblockDarkEngineInjected = true;

  const hostname = (location.hostname || '').toLowerCase().replace(/^www\./, '');
  if (!hostname) return;

  // Domains that are already dark by default (skip in 'auto' site mode unless user forces dark mode on them)
  const KNOWN_NATIVE_DARK_DOMAINS = new Set([
    'youtube.com',
    'music.youtube.com',
    'm.youtube.com',
    'twitch.tv',
    'discord.com',
    'open.spotify.com',
    'netflix.com',
    'store.steampowered.com',
    'steamcommunity.com',
    'kinopoisk.ru',
    'hd.kinopoisk.ru'
  ]);

  const PALETTES = {
    midnight: {
      name: 'Midnight Slate',
      bgPrimary: '#0d1117',
      bgSecondary: '#161b22',
      bgElevated: '#1f2631',
      bgInput: '#090d13',
      textPrimary: '#e6edf3',
      textSecondary: '#9198a1',
      borderColor: '#30363d',
      linkColor: '#58a6ff',
      scrollbarThumb: '#30363d'
    },
    carbon: {
      name: 'Carbon Soft',
      bgPrimary: '#141417',
      bgSecondary: '#1c1c21',
      bgElevated: '#26262d',
      bgInput: '#101013',
      textPrimary: '#ececf1',
      textSecondary: '#a1a1aa',
      borderColor: '#2e2e36',
      linkColor: '#60a5fa',
      scrollbarThumb: '#3f3f46'
    },
    oled: {
      name: 'True OLED',
      bgPrimary: '#000000',
      bgSecondary: '#0a0a0c',
      bgElevated: '#141418',
      bgInput: '#050507',
      textPrimary: '#f4f4f6',
      textSecondary: '#8e8e93',
      borderColor: '#222228',
      linkColor: '#38bdf8',
      scrollbarThumb: '#27272a'
    },
    warm: {
      name: 'Warm Paper',
      bgPrimary: '#191614',
      bgSecondary: '#231f1c',
      bgElevated: '#2d2824',
      bgInput: '#14110f',
      textPrimary: '#ebe3db',
      textSecondary: '#a89f96',
      borderColor: '#38322d',
      linkColor: '#f59e0b',
      scrollbarThumb: '#443c35'
    }
  };

  const DEFAULT_DARK_SETTINGS = {
    enabled: true,
    engine: 'smart', // 'smart' | 'gpu'
    theme: 'midnight', // 'midnight' | 'carbon' | 'oled' | 'warm'
    brightness: 100, // 70..130
    contrast: 100, // 70..130
    warmth: 0, // 0..60 (sepia)
    autoSkipNativeDark: true,
    disabledDomains: [],
    forcedDomains: []
  };

  let currentSettings = { ...DEFAULT_DARK_SETTINGS };
  let styleEl = null;
  let isCurrentlyApplied = false;
  let detectedNativeDark = false;
  let domObserver = null;
  let processedNodes = new WeakSet();

  // =========================================================================
  // 1. NATIVE DARK THEME DETECTOR
  // =========================================================================
  function parseRgb(colorStr) {
    if (!colorStr) return null;
    const m = colorStr.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i);
    if (!m) return null;
    const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
    if (a < 0.15) return null; // transparent
    return {
      r: parseInt(m[1], 10),
      g: parseInt(m[2], 10),
      b: parseInt(m[3], 10),
      a
    };
  }

  function getLuminance({ r, g, b }) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function checkIfSiteIsAlreadyDark() {
    if (KNOWN_NATIVE_DARK_DOMAINS.has(hostname)) return true;

    const docEl = document.documentElement;
    if (!docEl) return false;

    // Check common dark theme attributes/classes on <html> or <body>
    const htmlAttrs = [
      docEl.getAttribute('data-theme'),
      docEl.getAttribute('data-color-mode'),
      docEl.getAttribute('data-bs-theme'),
      docEl.getAttribute('theme'),
      docEl.getAttribute('color-scheme'),
      docEl.className
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (
      docEl.hasAttribute('dark') ||
      /\b(dark|theme-dark|dark-mode|night|night-mode)\b/.test(htmlAttrs)
    ) {
      return true;
    }

    if (document.body) {
      const bodyAttrs = [
        document.body.getAttribute('data-theme'),
        document.body.getAttribute('data-bs-theme'),
        document.body.className
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (/\b(dark|theme-dark|dark-mode|night)\b/.test(bodyAttrs)) {
        return true;
      }
    }

    // Check computed background luminance of html and body (temporarily disabling our own style if needed)
    if (document.body && !isCurrentlyApplied) {
      try {
        const bodyBg = parseRgb(getComputedStyle(document.body).backgroundColor);
        if (bodyBg && getLuminance(bodyBg) < 85) {
          return true;
        }
        const htmlBg = parseRgb(getComputedStyle(docEl).backgroundColor);
        if (htmlBg && getLuminance(htmlBg) < 85) {
          return true;
        }
      } catch (_) {}
    }

    return false;
  }

  // =========================================================================
  // 2. CSS GENERATION FOR "SMART" AND "GPU" ENGINES
  // =========================================================================
  function buildFilterChain(extraFilter = '') {
    const parts = [];
    if (extraFilter) parts.push(extraFilter);
    if (currentSettings.brightness !== 100) {
      parts.push(`brightness(${currentSettings.brightness}%)`);
    }
    if (currentSettings.contrast !== 100) {
      parts.push(`contrast(${currentSettings.contrast}%)`);
    }
    if (currentSettings.warmth > 0) {
      parts.push(`sepia(${currentSettings.warmth}%)`);
    }
    return parts.length > 0 ? `filter: ${parts.join(' ')} !important;` : '';
  }

  function generateSmartCss(p) {
    const rootFilter = buildFilterChain();
    return `
      :root {
        color-scheme: dark !important;
        --ultiblock-bg-primary: ${p.bgPrimary};
        --ultiblock-bg-secondary: ${p.bgSecondary};
        --ultiblock-bg-elevated: ${p.bgElevated};
        --ultiblock-bg-input: ${p.bgInput};
        --ultiblock-text-primary: ${p.textPrimary};
        --ultiblock-text-secondary: ${p.textSecondary};
        --ultiblock-border: ${p.borderColor};
        --ultiblock-link: ${p.linkColor};
      }

      html {
        background-color: ${p.bgPrimary} !important;
        color: ${p.textPrimary} !important;
        ${rootFilter}
      }

      body {
        background-color: ${p.bgPrimary} !important;
        color: ${p.textPrimary} !important;
      }

      /* Structural containers */
      main, article, section,
      [class*="wrapper"], [class*="container"], [class*="content"], [class*="page"], [class*="layout"] {
        background-color: transparent;
        color: ${p.textPrimary};
      }

      /* Cards, headers, navbars, sidebars, modals, tables, dropdowns */
      header, footer, nav, aside, dialog,
      table, thead, tbody, tr, td, th,
      fieldset, details, summary,
      [class*="card"], [class*="panel"], [class*="modal"], [class*="popup"],
      [class*="dropdown"], [class*="menu"], [class*="sidebar"], [class*="navbar"],
      [class*="header"], [class*="footer"], [class*="box"], [class*="widget"],
      [class*="item"], [class*="block"], [class*="post"], [class*="comment"] {
        border-color: ${p.borderColor} !important;
      }

      table, th, td {
        background-color: ${p.bgSecondary} !important;
        color: ${p.textPrimary} !important;
      }

      th, thead {
        background-color: ${p.bgElevated} !important;
      }

      /* Typography */
      h1, h2, h3, h4, h5, h6,
      p, span, li, dt, dd, label, strong, b, em, i, small, blockquote, cite {
        color: inherit;
      }

      h1, h2, h3, h4, h5, h6, strong, b {
        color: ${p.textPrimary};
      }

      blockquote, pre, code, kbd, samp {
        background-color: ${p.bgSecondary} !important;
        color: ${p.textPrimary} !important;
        border-color: ${p.borderColor} !important;
      }

      a {
        color: ${p.linkColor};
      }

      hr {
        border-color: ${p.borderColor} !important;
        background-color: ${p.borderColor} !important;
      }

      /* Form Inputs & Buttons */
      input, textarea, select {
        background-color: ${p.bgInput} !important;
        color: ${p.textPrimary} !important;
        border-color: ${p.borderColor} !important;
      }

      input::placeholder, textarea::placeholder {
        color: ${p.textSecondary} !important;
      }

      button, [role="button"], input[type="button"], input[type="submit"] {
        border-color: ${p.borderColor};
      }

      /* Dynamic surface attribute markers set by Smart DOM Scanner */
      [data-ub-dark-bg="primary"] {
        background-color: ${p.bgPrimary} !important;
        background-image: none !important;
      }
      [data-ub-dark-bg="secondary"] {
        background-color: ${p.bgSecondary} !important;
      }
      [data-ub-dark-bg="elevated"] {
        background-color: ${p.bgElevated} !important;
      }
      [data-ub-dark-text="light"] {
        color: ${p.textPrimary} !important;
      }
      [data-ub-dark-text="muted"] {
        color: ${p.textSecondary} !important;
      }
      [data-ub-dark-border="1"] {
        border-color: ${p.borderColor} !important;
      }

      /* Scrollbars */
      ::-webkit-scrollbar {
        width: 10px;
        height: 10px;
        background-color: ${p.bgPrimary};
      }
      ::-webkit-scrollbar-thumb {
        background-color: ${p.scrollbarThumb};
        border-radius: 5px;
      }
    `;
  }

  function generateGpuCss(p) {
    const filterRule = buildFilterChain('invert(0.92) hue-rotate(180deg)');
    return `
      html {
        background-color: #ffffff !important;
        ${filterRule}
      }

      /* Counter-invert all media, images, videos, canvases, iframes, and background-image elements */
      img, video, picture, canvas, iframe, embed, object,
      svg image, [style*="background-image"], [data-ub-has-bg-img="1"],
      .emoji, [class*="avatar"], [class*="logo"] {
        filter: invert(1) hue-rotate(180deg) !important;
      }
    `;
  }

  // =========================================================================
  // 3. SMART DOM SURFACE CLASSIFIER (NON-DESTRUCTIVE, FAST WEAKSET PASS)
  // =========================================================================
  const SKIP_TAGS = new Set([
    'SCRIPT',
    'STYLE',
    'LINK',
    'META',
    'HEAD',
    'TITLE',
    'NOSCRIPT',
    'IMG',
    'VIDEO',
    'PICTURE',
    'CANVAS',
    'SVG',
    'PATH',
    'IFRAME'
  ]);

  function adaptElementSurface(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE || SKIP_TAGS.has(el.tagName)) {
      return;
    }
    if (processedNodes.has(el)) return;
    processedNodes.add(el);

    try {
      const cs = getComputedStyle(el);

      if (currentSettings.engine === 'gpu') {
        // In GPU mode, only mark elements with CSS background-image URLs so they aren't inverted
        if (
          cs.backgroundImage &&
          cs.backgroundImage.includes('url(') &&
          el.tagName !== 'BODY' &&
          el.tagName !== 'HTML'
        ) {
          el.dataset.ubHasBgImg = '1';
        }
        return;
      }

      // Smart Surface Mode:
      // 1. Check background color luminance
      const bg = parseRgb(cs.backgroundColor);
      if (bg) {
        const lum = getLuminance(bg);
        const saturation = Math.max(bg.r, bg.g, bg.b) - Math.min(bg.r, bg.g, bg.b);

        // Only darken low-saturation light/white surfaces (preserves colorful buttons/badges!)
        if (lum > 175 && saturation < 55) {
          const hasBgUrl = cs.backgroundImage && cs.backgroundImage.includes('url(');
          if (!hasBgUrl) {
            if (lum > 242) {
              el.dataset.ubDarkBg =
                el.tagName === 'BODY' || el.tagName === 'MAIN'
                  ? 'primary'
                  : 'secondary';
            } else {
              el.dataset.ubDarkBg = 'elevated';
            }
          }
        }
      }

      // 2. Check text color luminance (if text is very dark, brighten it)
      const fg = parseRgb(cs.color);
      if (fg) {
        const fgLum = getLuminance(fg);
        const fgSat = Math.max(fg.r, fg.g, fg.b) - Math.min(fg.r, fg.g, fg.b);
        if (fgLum < 95 && fgSat < 65) {
          el.dataset.ubDarkText = fgLum < 55 ? 'light' : 'muted';
        }
      }

      // 3. Check bright borders
      const borderCol = parseRgb(cs.borderTopColor);
      if (borderCol && getLuminance(borderCol) > 180) {
        el.dataset.ubDarkBorder = '1';
      }
    } catch (_) {}
  }

  function scanSubtree(root) {
    if (!isCurrentlyApplied || !root || root.nodeType !== Node.ELEMENT_NODE) return;
    adaptElementSurface(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let count = 0;
    let node = walker.nextNode();
    while (node && count < 450) {
      adaptElementSurface(node);
      node = walker.nextNode();
      count++;
    }
  }

  let pendingScanNodes = new Set();
  let scanRafId = null;

  function schedulePendingScans() {
    if (scanRafId) return;
    scanRafId = requestAnimationFrame(() => {
      scanRafId = null;
      if (!isCurrentlyApplied) {
        pendingScanNodes.clear();
        return;
      }
      let budget = 250;
      for (const n of pendingScanNodes) {
        pendingScanNodes.delete(n);
        if (n.isConnected) {
          adaptElementSurface(n);
          const walker = document.createTreeWalker(n, NodeFilter.SHOW_ELEMENT);
          let cur = walker.nextNode();
          while (cur && budget > 0) {
            adaptElementSurface(cur);
            cur = walker.nextNode();
            budget--;
          }
        }
        if (budget <= 0) break;
      }
      if (pendingScanNodes.size > 0) {
        schedulePendingScans();
      }
    });
  }

  function clearSmartAttributes() {
    processedNodes = new WeakSet();
    const attrs = [
      'data-ub-dark-bg',
      'data-ub-dark-text',
      'data-ub-dark-border',
      'data-ub-has-bg-img'
    ];
    for (const attr of attrs) {
      const els = document.querySelectorAll(`[${attr}]`);
      for (const el of els) {
        el.removeAttribute(attr);
      }
    }
  }

  // =========================================================================
  // 4. APPLY / REMOVE DARK ENGINE
  // =========================================================================
  function shouldActivateOnCurrentDomain() {
    if (!currentSettings.enabled) return false;

    const disabledList = Array.isArray(currentSettings.disabledDomains)
      ? currentSettings.disabledDomains
      : [];
    const forcedList = Array.isArray(currentSettings.forcedDomains)
      ? currentSettings.forcedDomains
      : [];

    if (disabledList.includes(hostname)) {
      try { localStorage.setItem('__ub_dark_mode', 'off'); } catch (_) {}
      return false;
    }
    if (forcedList.includes(hostname)) {
      try { localStorage.setItem('__ub_dark_mode', 'force'); } catch (_) {}
      return true;
    }
    try { localStorage.removeItem('__ub_dark_mode'); } catch (_) {}

    if (currentSettings.autoSkipNativeDark && detectedNativeDark) {
      return false;
    }

    return true;
  }

  function updateDarkEngine() {
    if (!detectedNativeDark && !isCurrentlyApplied) {
      detectedNativeDark = checkIfSiteIsAlreadyDark();
    }

    const active = shouldActivateOnCurrentDomain();

    if (!active) {
      if (styleEl) {
        styleEl.remove();
        styleEl = null;
      }
      if (domObserver) {
        domObserver.disconnect();
        domObserver = null;
      }
      if (isCurrentlyApplied) {
        isCurrentlyApplied = false;
        clearSmartAttributes();
      }
      return;
    }

    const palette = PALETTES[currentSettings.theme] || PALETTES.midnight;
    const cssText =
      currentSettings.engine === 'gpu'
        ? generateGpuCss(palette)
        : generateSmartCss(palette);

    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'ultiblock-dark-reader-style';
      (document.head || document.documentElement).appendChild(styleEl);
    } else if (!document.contains(styleEl)) {
      (document.head || document.documentElement).appendChild(styleEl);
    }

    styleEl.textContent = cssText;
    isCurrentlyApplied = true;

    if (document.body) {
      processedNodes = new WeakSet();
      scanSubtree(document.body);
    }

    if (!domObserver && document.documentElement) {
      domObserver = new MutationObserver((mutations) => {
        if (!isCurrentlyApplied) return;
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              pendingScanNodes.add(node);
            }
          }
        }
        if (pendingScanNodes.size > 0) {
          schedulePendingScans();
        }
      });
      domObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    }
  }

  // Re-verify native dark status when DOM is ready (in case body classes load at DOMContentLoaded)
  window.addEventListener('DOMContentLoaded', () => {
    if (!isCurrentlyApplied) {
      detectedNativeDark = checkIfSiteIsAlreadyDark();
    }
    updateDarkEngine();
  });

  // =========================================================================
  // 5. STORAGE SYNC & ALT+D HOTKEY
  // =========================================================================
  function showDarkToast(message) {
    const t = document.createElement('div');
    t.textContent = message;
    Object.assign(t.style, {
      position: 'fixed',
      bottom: '22px',
      right: '22px',
      zIndex: '2147483647',
      background: '#0f172a',
      color: '#f8fafc',
      border: '1px solid #38bdf8',
      borderRadius: '8px',
      padding: '9px 14px',
      fontSize: '13px',
      fontWeight: '600',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
      pointerEvents: 'none'
    });
    document.documentElement.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  }

  // Hotkey Alt+D toggles Dark Reader on the current site
  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.code === 'KeyD') {
      e.preventDefault();
      chrome.storage.local.get(['darkReaderSettings'], (res) => {
        const s = {
          ...DEFAULT_DARK_SETTINGS,
          ...(res.darkReaderSettings || {})
        };
        const disabled = new Set(s.disabledDomains || []);
        const forced = new Set(s.forcedDomains || []);

        if (isCurrentlyApplied) {
          disabled.add(hostname);
          forced.delete(hostname);
          showDarkToast(`🌙 Тёмная тема выключена для ${hostname} (Alt+D)`);
        } else {
          disabled.delete(hostname);
          forced.add(hostname);
          s.enabled = true;
          showDarkToast(`🌙 Тёмная тема включена для ${hostname} (Alt+D)`);
        }

        s.disabledDomains = Array.from(disabled);
        s.forcedDomains = Array.from(forced);
        chrome.storage.local.set({ darkReaderSettings: s });
      });
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'ULTIBLOCK_GET_DARK_STATUS') {
      sendResponse({
        isApplied: isCurrentlyApplied,
        detectedNativeDark,
        hostname
      });
    }
    return false;
  });

  try {
    chrome.storage.local.get(['darkReaderSettings'], (res) => {
      currentSettings = {
        ...DEFAULT_DARK_SETTINGS,
        ...(res.darkReaderSettings || {})
      };
      detectedNativeDark = checkIfSiteIsAlreadyDark();
      updateDarkEngine();
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.darkReaderSettings) {
        currentSettings = {
          ...DEFAULT_DARK_SETTINGS,
          ...(changes.darkReaderSettings.newValue || {})
        };
        updateDarkEngine();
      }
    });
  } catch (_) {}
})();
