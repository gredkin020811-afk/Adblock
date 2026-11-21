/**
 * UltiBlock Pro — Popup Internationalization (i18n) Engine
 * Supports automatic browser language detection + live manual language switching.
 * Reads translations directly from _locales/<locale>/messages.json.
 */
(function () {
  'use strict';

  const SUPPORTED_LOCALES = ['en', 'ru', 'es', 'de', 'fr', 'pt_BR', 'zh_CN', 'uk'];
  const cache = new Map();

  let selectedPref = 'auto';
  let resolvedLocale = 'en';
  let currentMessages = {};
  let fallbackMessages = {};

  function resolveBrowserLocale() {
    let raw = '';
    try {
      if (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getUILanguage) {
        raw = chrome.i18n.getUILanguage();
      }
    } catch (_) {}
    if (!raw) raw = navigator.language || 'en';
    const norm = raw.replace('-', '_').toLowerCase();

    if (norm.startsWith('ru')) return 'ru';
    if (norm.startsWith('es')) return 'es';
    if (norm.startsWith('de')) return 'de';
    if (norm.startsWith('fr')) return 'fr';
    if (norm.startsWith('pt')) return 'pt_BR';
    if (norm.startsWith('zh')) return 'zh_CN';
    if (norm.startsWith('uk')) return 'uk';
    return 'en';
  }

  async function loadLocaleFile(locale) {
    if (cache.has(locale)) return cache.get(locale);
    const url =
      typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL
        ? chrome.runtime.getURL(`_locales/${locale}/messages.json`)
        : `../_locales/${locale}/messages.json`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      const flat = {};
      for (const [k, v] of Object.entries(json)) {
        if (v && typeof v.message === 'string') {
          flat[k] = v.message;
        }
      }
      cache.set(locale, flat);
      return flat;
    } catch (_) {
      return {};
    }
  }

  function t(key, vars) {
    let str = currentMessages[key] ?? fallbackMessages[key] ?? key;
    if (vars && typeof vars === 'object') {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return str;
  }

  function applyToDOM(root = document) {
    document.documentElement.lang = resolvedLocale.replace('_', '-');

    const textEls = root.querySelectorAll('[data-i18n]');
    for (const el of textEls) {
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = t(key);
    }

    const titleEls = root.querySelectorAll('[data-i18n-title]');
    for (const el of titleEls) {
      const key = el.getAttribute('data-i18n-title');
      if (key) el.setAttribute('title', t(key));
    }

    const placeholderEls = root.querySelectorAll('[data-i18n-placeholder]');
    for (const el of placeholderEls) {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) el.setAttribute('placeholder', t(key));
    }
  }

  async function setLanguage(pref, persist = true) {
    selectedPref =
      pref === 'auto' || SUPPORTED_LOCALES.includes(pref) ? pref : 'auto';
    resolvedLocale =
      selectedPref === 'auto' ? resolveBrowserLocale() : selectedPref;

    if (!fallbackMessages || Object.keys(fallbackMessages).length === 0) {
      fallbackMessages = await loadLocaleFile('en');
    }
    currentMessages =
      resolvedLocale === 'en'
        ? fallbackMessages
        : await loadLocaleFile(resolvedLocale);

    if (persist) {
      try {
        await chrome.storage.local.set({ uiLanguage: selectedPref });
      } catch (_) {}
    }

    applyToDOM();
    return resolvedLocale;
  }

  async function init() {
    let pref = 'auto';
    try {
      const res = await chrome.storage.local.get(['uiLanguage']);
      if (res && typeof res.uiLanguage === 'string') {
        pref = res.uiLanguage;
      }
    } catch (_) {}
    await setLanguage(pref, false);
    return { selectedPref, resolvedLocale };
  }

  window.UltiI18n = {
    SUPPORTED_LOCALES,
    init,
    setLanguage,
    getLanguage: () => selectedPref,
    getResolvedLocale: () => resolvedLocale,
    t,
    applyToDOM
  };
})();
