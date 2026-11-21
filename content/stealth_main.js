/**
 * UltiBlock Pro — MAIN World Stealth & Interceptor Script
 * Runs at document_start in the page's MAIN execution world.
 * Handles:
 * 1. YouTube Player API & JSON payload sanitization (adPlacements, adSlots, anti-adblock popup)
 * 2. VAST/VMAP & Online Cinema pre-roll neutralization (returns empty VAST XML so players don't hang)
 * 3. Anti-Popunder / Clickunder window.open guard with dummy Window proxy
 * 4. Anti-Adblock defuser (BlockAdBlock, FuckAdBlock, canRunAds, bait element geometry spoofing)
 */
(function () {
  'use strict';

  // Fallback for browsers (e.g. older Firefox ESR) that run content_scripts in ISOLATED world
  try {
    if (
      typeof chrome !== 'undefined' &&
      chrome.runtime &&
      chrome.runtime.id &&
      typeof chrome.runtime.getURL === 'function'
    ) {
      const s = document.createElement('script');
      s.src = chrome.runtime.getURL('content/stealth_main.js');
      s.onload = () => s.remove();
      (document.head || document.documentElement).appendChild(s);
      return;
    }
  } catch (_) {}

  if (window.__ultiblockMainInjected) return;
  window.__ultiblockMainInjected = true;

  const hostname = (location.hostname || '').toLowerCase().replace(/^www\./, '');
  const isYouTube =
    hostname === 'youtube.com' ||
    hostname === 'm.youtube.com' ||
    hostname === 'music.youtube.com' ||
    hostname === 'youtu.be';

  function isDisabled() {
    try {
      if (localStorage.getItem('__ub_site_disabled') === '1') {
        return true;
      }
    } catch (_) {}
    return Boolean(
      document.documentElement &&
      document.documentElement.dataset &&
      document.documentElement.dataset.ultiblockDisabled === 'true'
    );
  }

  // If user disabled UltiBlock on this site, exit before monkeypatching any prototypes
  if (isDisabled()) {
    return;
  }

  function notifyBlocked(kind, count = 1) {
    try {
      window.postMessage(
        { __ultiblock: true, type: 'ULTIBLOCK_STAT', kind, count },
        '*'
      );
    } catch (_) {}
  }

  // =========================================================================
  // 1. YOUTUBE DEEP JSON / PLAYER RESPONSE SANITIZER
  // =========================================================================
  // NOTE: only adPlacements/adSlots are pruned (same as uBlock Origin quick-fixes).
  // Removing playerAds / adBreakHeartbeatParams is now detected by YouTube and
  // results in "audio only, no picture" + "Ошибка. Повторите попытку позже."
  const YT_AD_KEYS = [
    'adPlacements',
    'adSlots'
  ];

  function sanitizeYouTubeObject(obj, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 8 || isDisabled()) {
      return obj;
    }

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        if (obj[i] && typeof obj[i] === 'object') {
          sanitizeYouTubeObject(obj[i], depth + 1);
        }
      }
      return obj;
    }

    if (obj.videoDetails && obj.videoDetails.videoId) {
      window.__ultiblockLastVideoId = obj.videoDetails.videoId;
      if (obj.videoDetails.title) {
        window.__ultiblockLastVideoTitle = obj.videoDetails.title;
      }
      if (obj.videoDetails.author) {
        window.__ultiblockLastVideoAuthor = obj.videoDetails.author;
      }
    }

    let modified = false;

    for (const key of YT_AD_KEYS) {
      if (key in obj) {
        if (Array.isArray(obj[key]) && obj[key].length > 0) {
          modified = true;
        } else if (obj[key]) {
          modified = true;
        }
        delete obj[key];
      }
    }

    // NOTE: paygatedQualityDetails is intentionally kept. Removing it makes the
    // player think "1080p Premium" is playable; the server then refuses the
    // video stream -> audio only + "Ошибка. Повторите попытку позже."
    if (obj.messages && Array.isArray(obj.messages)) {
      obj.messages = obj.messages.filter(
        (m) => !m || (!m.mealbarPromoRenderer && !m.upsellDialogRenderer)
      );
    }

    // Remove YouTube anti-adblock enforcement message modal from player response
    if (
      obj.auxiliaryUi &&
      obj.auxiliaryUi.messageRenderers &&
      (obj.auxiliaryUi.messageRenderers.bkaEnforcementMessageViewModel ||
        obj.auxiliaryUi.messageRenderers.enforcementMessageViewModel)
    ) {
      delete obj.auxiliaryUi.messageRenderers.bkaEnforcementMessageViewModel;
      delete obj.auxiliaryUi.messageRenderers.enforcementMessageViewModel;
      modified = true;
    }

    // (Removed: forcing playabilityStatus.status = 'OK' on error responses.
    //  A response without streamingData can't be played anyway and only
    //  produces the generic player error screen.)

    // Filter feed/home/search richItemRenderer ad slots
    if (Array.isArray(obj.contents)) {
      obj.contents = obj.contents.filter((item) => {
        if (!item || typeof item !== 'object') return true;
        if (
          item.adSlotRenderer ||
          item.promotedSparklesWebRenderer ||
          item.inFeedAdLayoutRenderer ||
          (item.richItemRenderer &&
            item.richItemRenderer.content &&
            (item.richItemRenderer.content.adSlotRenderer ||
              item.richItemRenderer.content.inFeedAdLayoutRenderer))
        ) {
          modified = true;
          return false;
        }
        return true;
      });
    }

    if (obj.playerResponse && typeof obj.playerResponse === 'object') {
      sanitizeYouTubeObject(obj.playerResponse, depth + 1);
    }
    if (obj.response && typeof obj.response === 'object') {
      sanitizeYouTubeObject(obj.response, depth + 1);
    }

    if (modified) {
      notifyBlocked('youtube', 1);
    }

    return obj;
  }

  if (isYouTube) {
    // Trap window.ytInitialPlayerResponse and window.ytInitialData
    let _ytInitialPlayerResponse = window.ytInitialPlayerResponse;
    let _ytInitialData = window.ytInitialData;

    try {
      Object.defineProperty(window, 'ytInitialPlayerResponse', {
        configurable: true,
        enumerable: true,
        get() {
          return _ytInitialPlayerResponse;
        },
        set(val) {
          _ytInitialPlayerResponse = sanitizeYouTubeObject(val);
        }
      });

      Object.defineProperty(window, 'ytInitialData', {
        configurable: true,
        enumerable: true,
        get() {
          return _ytInitialData;
        },
        set(val) {
          _ytInitialData = sanitizeYouTubeObject(val);
        }
      });
    } catch (_) {}

    // Wrap JSON.parse on YouTube to catch player & next payloads seamlessly
    const origJSONParse = JSON.parse;
    JSON.parse = function (text, reviver) {
      const parsed = origJSONParse.call(this, text, reviver);
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof text === 'string' &&
        (text.includes('adPlacements') ||
          text.includes('playerAds') ||
          text.includes('adSlots') ||
          text.includes('bkaEnforcementMessageViewModel') ||
          text.includes('enforcementMessageViewModel') ||
          text.includes('adSlotRenderer'))
      ) {
        try {
          sanitizeYouTubeObject(parsed);
        } catch (_) {}
      }
      return parsed;
    };
    // Preserve toString for stealth
    JSON.parse.toString = () => origJSONParse.toString();

    // Wrap Response.prototype.json
    const origResponseJson = Response.prototype.json;
    Response.prototype.json = async function () {
      const data = await origResponseJson.call(this);
      try {
        if (
          this.url &&
          (this.url.includes('/youtubei/v1/player') ||
            this.url.includes('/youtubei/v1/next') ||
            this.url.includes('/youtubei/v1/get_watch') ||
            this.url.includes('/youtubei/v1/browse') ||
            this.url.includes('/youtubei/v1/search'))
        ) {
          sanitizeYouTubeObject(data);
        }
      } catch (_) {}
      return data;
    };
    Response.prototype.json.toString = () => origResponseJson.toString();

    // Wrap Response.prototype.text for /player, /next and /get_watch endpoints
    // Use exact same-length key replacements so multipart Content-Length framing is never corrupted.
    const origResponseText = Response.prototype.text;
    Response.prototype.text = async function () {
      let text = await origResponseText.call(this);
      try {
        if (
          this.url &&
          (this.url.includes('/youtubei/v1/player') ||
            this.url.includes('/youtubei/v1/next') ||
            this.url.includes('/youtubei/v1/get_watch') ||
            this.url.includes('/watch?'))
        ) {
          text = text
            .replace(/"adPlacements"/g, '"_noAdsPlace_"')
            .replace(/"adSlots"/g, '"_noAds_"');
        }
      } catch (_) {}
      return text;
    };
    Response.prototype.text.toString = () => origResponseText.toString();

    installYouTubeAntiDetection();
  }

  // =========================================================================
  // 1b. YOUTUBE ANTI-DETECTION & PLAYBACK RECOVERY
  // Port of the current uBlock Origin "quick-fixes" for YouTube (uAssets #30157):
  //  - neutralize the player's onAbnormalityDetected handler
  //  - remove the artificial 17s delay for suspected adblock users
  //  - stop YouTube from grabbing clean fetch/JSON.parse via a fresh iframe
  //  - when the player gets "punished" (audio only, 0x0 video, or the
  //    "Ошибка. Повторите попытку позже." screen) reload the video with a
  //    modified /player request context that the server serves without ads
  //  - skip server-side stitched (SSAP) ads via the player API
  // =========================================================================
  function installYouTubeAntiDetection() {
    const fnToString = Function.prototype.toString;
    const origStringify = JSON.stringify;
    const origParseRef = JSON.parse;

    // --- 1. onAbnormalityDetected neutralizer -----------------------------
    try {
      Promise.prototype.then = new Proxy(Promise.prototype.then, {
        apply(target, thisArg, args) {
          const cb = args[0];
          if (typeof cb === 'function' && !isDisabled()) {
            try {
              if (fnToString.call(cb).includes('onAbnormalityDetected')) {
                args[0] = function () {};
              }
            } catch (_) {}
          }
          return Reflect.apply(target, thisArg, args);
        }
      });
    } catch (_) {}

    // --- 2. Remove the 17 s "adblock penalty" timeout ----------------------
    try {
      window.setTimeout = new Proxy(window.setTimeout, {
        apply(target, thisArg, args) {
          if (args[1] === 17000 && typeof args[0] === 'function' && !isDisabled()) {
            try {
              if (fnToString.call(args[0]).includes('[native code]')) {
                args[1] = 17;
              }
            } catch (_) {}
          }
          return Reflect.apply(target, window, args);
        }
      });
    } catch (_) {}

    // --- 3. Prevent iframe bypass of our fetch / JSON.parse hooks ----------
    try {
      Node.prototype.appendChild = new Proxy(Node.prototype.appendChild, {
        apply(target, thisArg, args) {
          const ret = Reflect.apply(target, thisArg, args);
          const node = args[0];
          if (node && node.tagName === 'IFRAME' && !isDisabled()) {
            try {
              const w = node.contentWindow;
              if (w && w !== window) {
                const topFetch = window.fetch;
                w.fetch = function () {
                  return topFetch.apply(window, arguments);
                };
                w.JSON.parse = JSON.parse;
                w.JSON.stringify = JSON.stringify;
              }
            } catch (_) {}
          }
          return ret;
        }
      });
    } catch (_) {}

    // --- 4. SSAP detection & 0:00 / unstarted playback watchdog ------------
    let watchedVideoId = '';
    let videoNavigatedAt = 0;
    let recoveredVideoId = '';

    function getWatchPageVideoInfo() {
      try {
        const u = new URL(location.href);
        if (u.pathname === '/watch' && u.searchParams.has('v')) {
          const vid = u.searchParams.get('v') || '';
          const tRaw = u.searchParams.get('t') || '';
          let startSeconds = 0;
          if (tRaw) {
            const num = parseInt(tRaw.replace(/s$/i, ''), 10);
            if (Number.isFinite(num) && num > 0) startSeconds = num;
          }
          return { vid, startSeconds };
        }
      } catch (_) {}
      return { vid: '', startSeconds: 0 };
    }

    function markVideoNavigated() {
      const { vid } = getWatchPageVideoInfo();
      if (vid && vid !== watchedVideoId) {
        watchedVideoId = vid;
        videoNavigatedAt = Date.now();
        recoveredVideoId = '';
      } else if (!vid) {
        watchedVideoId = '';
        videoNavigatedAt = 0;
        recoveredVideoId = '';
      }
    }

    window.addEventListener('yt-navigate-finish', markVideoNavigated, true);
    window.addEventListener('popstate', markVideoNavigated, true);

    setInterval(() => {
      if (isDisabled()) return;

      const { vid, startSeconds } = getWatchPageVideoInfo();
      if (vid !== watchedVideoId) {
        watchedVideoId = vid;
        videoNavigatedAt = vid ? Date.now() : 0;
        recoveredVideoId = '';
      }

      const player = document.getElementById('movie_player');
      const video =
        (player && player.querySelector('video.html5-main-video, video')) ||
        document.querySelector('video.html5-main-video');

      // Update SSAP flag so isolated script never seeks/16x a server-stitched main stream
      if (player) {
        const isAd =
          player.classList.contains('ad-showing') ||
          player.classList.contains('ad-interrupting');
        let isSsap = false;
        if (isAd && vid) {
          try {
            const vd =
              typeof player.getVideoData === 'function' ? player.getVideoData() : null;
            if (vd && vd.video_id === vid) {
              isSsap = true;
            }
          } catch (_) {}
        }
        if (document.documentElement) {
          if (isSsap) {
            document.documentElement.dataset.ultiblockSsapAd = 'true';
          } else if (document.documentElement.dataset.ultiblockSsapAd) {
            delete document.documentElement.dataset.ultiblockSsapAd;
          }
        }
      }

      // Auto-recover if video is stuck at 0:00 (duration 0 / unstarted) after opening
      if (!vid || !player || !video || recoveredVideoId === vid) return;
      if (!videoNavigatedAt || Date.now() - videoNavigatedAt < 1800) return;

      try {
        // Do not reload genuinely unavailable/private/age-gated/offline streams
        if (typeof player.getPlayerResponse === 'function') {
          const pr = player.getPlayerResponse();
          const st = pr && pr.playabilityStatus && pr.playabilityStatus.status;
          if (
            st === 'LOGIN_REQUIRED' ||
            st === 'UNPLAYABLE' ||
            st === 'LIVE_STREAM_OFFLINE' ||
            st === 'CONTENT_CHECK_REQUIRED'
          ) {
            recoveredVideoId = vid;
            return;
          }
        }

        const pDur =
          typeof player.getDuration === 'function' ? Number(player.getDuration()) : 0;
        const vDur = Number(video.duration);
        const hasValidDuration =
          (Number.isFinite(vDur) && vDur > 0) || (Number.isFinite(pDur) && pDur > 0);

        if (hasValidDuration) {
          // Video loaded fine
          recoveredVideoId = vid;
          return;
        }

        const pState =
          typeof player.getPlayerState === 'function' ? player.getPlayerState() : -1;
        // Stuck at 0:00 (duration is 0/NaN, readyState 0 or unstarted/buffering/ended-at-0)
        const isStuckZero =
          !hasValidDuration &&
          (video.readyState === 0 || pState === -1 || pState === 0 || pState === 3 || pState === 5);

        if (isStuckZero) {
          recoveredVideoId = vid;
          if (typeof player.loadVideoById === 'function') {
            player.loadVideoById({ videoId: vid, startSeconds });
          } else if (typeof player.playVideo === 'function') {
            player.playVideo();
          }
        }
      } catch (_) {}
    }, 500);

  }

  // =========================================================================
  // 2. UNIVERSAL VAST / VMAP VIDEO AD & FETCH/XHR INTERCEPTOR
  // =========================================================================
  const EMPTY_VAST_XML =
    '<?xml version="1.0" encoding="UTF-8"?><VAST version="3.0"></VAST>';

  const AD_URL_PATTERNS = [
    /\/vast(\.xml|\?|$|\/)/i,
    /\/vmap(\.xml|\?|$|\/)/i,
    /[?&]ad_type=(video|preroll|midroll|vast)/i,
    /\/(preroll|midroll|postroll)(\.xml|\.json|\?|\/|$)/i,
    /\/api\/v[12]\/advertising\//i,
    /an\.yandex\.ru\/meta\//i,
    /ads\.adfox\.ru\//i,
    /rutube\.ru\/api\/v2\/advertising/i,
    /target\.my\.com\/.*\b(vast|preroll)/i,
    /videoroll\.net|viboom\.com|beseed\.ru|nativeroll\.tv|pladform\.ru\/getVast/i
  ];

  function isVideoAdRequest(url) {
    if (!url || typeof url !== 'string' || isDisabled()) return false;
    return AD_URL_PATTERNS.some((re) => re.test(url));
  }

  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = async function (input, init) {
      const url =
        typeof input === 'string'
          ? input
          : input && typeof input.url === 'string'
          ? input.url
          : '';

      if (isVideoAdRequest(url)) {
        notifyBlocked('network', 1);
        const isJson = url.includes('.json') || url.includes('format=json');
        return new Response(isJson ? '{}' : EMPTY_VAST_XML, {
          status: 200,
          headers: {
            'Content-Type': isJson
              ? 'application/json; charset=utf-8'
              : 'application/xml; charset=utf-8'
          }
        });
      }

      return origFetch.apply(this || window, arguments);
    };
    window.fetch.toString = () => origFetch.toString();
  }

  // Intercept XMLHttpRequest for VAST/VMAP and YouTube player requests
  const origXhrOpen = XMLHttpRequest.prototype.open;
  const origXhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__ultiblockUrl = typeof url === 'string' ? url : String(url || '');
    return origXhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    const url = this.__ultiblockUrl || '';
    if (isVideoAdRequest(url)) {
      notifyBlocked('network', 1);
      Object.defineProperty(this, 'readyState', { value: 4, configurable: true });
      Object.defineProperty(this, 'status', { value: 200, configurable: true });
      Object.defineProperty(this, 'responseText', {
        value: EMPTY_VAST_XML,
        configurable: true
      });
      Object.defineProperty(this, 'response', {
        value: EMPTY_VAST_XML,
        configurable: true
      });
      try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(EMPTY_VAST_XML, 'text/xml');
        Object.defineProperty(this, 'responseXML', {
          value: xmlDoc,
          configurable: true
        });
      } catch (_) {}
      setTimeout(() => {
        if (typeof this.onreadystatechange === 'function') {
          try {
            this.onreadystatechange(new Event('readystatechange'));
          } catch (_) {}
        }
        if (typeof this.onload === 'function') {
          try {
            this.onload(new ProgressEvent('load'));
          } catch (_) {}
        }
        this.dispatchEvent(new Event('readystatechange'));
        this.dispatchEvent(new ProgressEvent('load'));
        this.dispatchEvent(new ProgressEvent('loadend'));
      }, 1);
      return;
    }
    return origXhrSend.apply(this, arguments);
  };

  // =========================================================================
  // 3. ANTI-POPUNDER & UNWANTED WINDOW.OPEN GUARD
  // =========================================================================
  const POPUP_BAD_PATTERNS = [
    /1xbet|1xstavka|melbet|mostbet|vavada|joycasino|casino|vulkan|azino|1win|pin-up|dragonmoney|betboom|fonbet|olymptrade|binomo/i,
    /propeller|popads|popcash|popunder|clickunder|clickadu|adsterra|exoclick|trafficstars|juicyads|hilltopads|evadav|galaksion|tsyndicate|realsrv|oclasrv|onclkds|twinrds/i,
    /[?&](utm_source=pop|clickid=|subid=|aff_id=|zoneid=|banid=)/i
  ];

  let lastTrustedClickTime = 0;
  let lastTrustedClickHref = '';

  window.addEventListener(
    'pointerdown',
    (e) => {
      if (!e.isTrusted) return;
      const anchor = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (anchor) {
        lastTrustedClickTime = Date.now();
        lastTrustedClickHref = anchor.href || '';
      } else {
        lastTrustedClickHref = '';
      }
    },
    true
  );

  function createDummyWindow() {
    const dummy = {
      closed: false,
      opener: window,
      name: '',
      location: { href: 'about:blank', assign() {}, replace() {}, reload() {} },
      document: {
        open() { return this; },
        write() {},
        writeln() {},
        close() {},
        createElement() { return document.createElement('div'); },
        body: document.createElement('body')
      },
      focus() {},
      blur() {},
      close() { this.closed = true; },
      postMessage() {},
      addEventListener() {},
      removeEventListener() {}
    };
    return new Proxy(dummy, {
      get(target, prop) {
        return prop in target ? target[prop] : () => {};
      },
      set(target, prop, val) {
        target[prop] = val;
        return true;
      }
    });
  }

  const origWindowOpen = window.open;
  window.open = function (url, target, features) {
    if (isDisabled()) {
      return origWindowOpen.apply(this || window, arguments);
    }

    const urlStr = String(url || '');

    // Always block known ad/casino/popunder URLs
    if (POPUP_BAD_PATTERNS.some((re) => re.test(urlStr))) {
      notifyBlocked('popup', 1);
      return createDummyWindow();
    }

    // Block untrusted background popups or clickjacking when the user didn't click a real link
    const now = Date.now();
    const recentTrustedAnchorClick = now - lastTrustedClickTime < 1200;

    // Allow OAuth / payment / login popups initiated intentionally
    const isAuthPopup =
      /oauth|auth|login|signin|passport|accounts\.google|vk\.com\/login|t\.me|telegram|pay|checkout|sber|tinkoff|yoomoney/i.test(
        urlStr
      );

    if (!recentTrustedAnchorClick && !isAuthPopup) {
      // Script tried to open a popup without user clicking a link or outside auth flow
      if (
        !urlStr ||
        urlStr === 'about:blank' ||
        (urlStr.startsWith('http') && !urlStr.includes(hostname))
      ) {
        notifyBlocked('popup', 1);
        return createDummyWindow();
      }
    }

    return origWindowOpen.apply(this || window, arguments);
  };
  window.open.toString = () => origWindowOpen.toString();

  // =========================================================================
  // 4. ANTI-ADBLOCK KILLER (DEFUSER & BAIT ELEMENT SPOOFER)
  // =========================================================================
  try {
    const noop = function () {};
    const FakeAdBlockDetector = function () {};
    FakeAdBlockDetector.prototype = {
      on(detected, fn) {
        if (detected === false && typeof fn === 'function') {
          try { fn(); } catch (_) {}
        }
        return this;
      },
      onDetected: noop,
      onNotDetected(fn) {
        if (typeof fn === 'function') {
          try { fn(); } catch (_) {}
        }
        return this;
      },
      check() { return false; },
      emitEvent() { return this; },
      clearEvent: noop,
      setOption() { return this; }
    };
    const fakeInstance = new FakeAdBlockDetector();

    const antiAdblockProps = {
      canRunAds: true,
      isAdBlockActive: false,
      adblock: false,
      adBlockEnabled: false,
      google_ad_status: 1,
      FuckAdBlock: FakeAdBlockDetector,
      BlockAdBlock: FakeAdBlockDetector,
      fuckAdBlock: fakeInstance,
      blockAdBlock: fakeInstance
    };

    for (const [prop, val] of Object.entries(antiAdblockProps)) {
      if (!(prop in window)) {
        try {
          Object.defineProperty(window, prop, {
            configurable: true,
            get() { return val; },
            set() {}
          });
        } catch (_) {}
      }
    }
  } catch (_) {}

  // Spoof offsetHeight / offsetWidth for classic anti-adblock bait elements
  const BAIT_CLASS_REGEX = /\b(adsbox|ad-banner|ad-placement|doubleclick|textads|banner_ads|ad-unit)\b/i;

  function isBaitElement(el) {
    if (!el || !(el instanceof HTMLElement) || isDisabled()) return false;
    const cls = typeof el.className === 'string' ? el.className : '';
    const id = el.id || '';
    return BAIT_CLASS_REGEX.test(cls) || BAIT_CLASS_REGEX.test(id);
  }

  try {
    const origOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetHeight'
    );
    const origOffsetWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'offsetWidth'
    );

    if (origOffsetHeight && origOffsetHeight.get) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
        configurable: true,
        get() {
          if (isBaitElement(this)) return 10;
          return origOffsetHeight.get.call(this);
        }
      });
    }
    if (origOffsetWidth && origOffsetWidth.get) {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
        configurable: true,
        get() {
          if (isBaitElement(this)) return 10;
          return origOffsetWidth.get.call(this);
        }
      });
    }
  } catch (_) {}
})();
