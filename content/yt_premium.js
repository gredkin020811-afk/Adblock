/**
 * UltiBlock Pro — YouTube & Music Premium + Enhancer for YouTube + YT Tweaks + YT Downloader (MAIN World)
 * Combines:
 * - YouTube Premium & YouTube Music Premium (Background play, SponsorBlock, 4K, Return Dislikes, Audio-Only)
 * - Enhancer for YouTube (ponfpcnoihfmfllpaingbgckeeldkhle):
 *   Cinema Dimmer (💡), Video Flip/Rotate/Color Filters (🎨), Floating Mini-Player on Scroll (📌),
 *   Speed up to 4x, WebAudio 200% HQ Studio Booster, Frame Screenshot (📸), PiP (🖼️), Mouse Wheel Volume HUD
 * - YT Tweaks (oeakphpfoaeggagmgphfejmfjbhjfhhh):
 *   Hide Shorts, Custom Grid Columns (4/5/6 per row), Hide Endscreens/Cards, Square Corners, Hide Sidebar/Comments
 * - Built-in YouTube Video & YouTube Music Audio Downloader (📥)
 */
(function () {
  'use strict';

  const hostname = (location.hostname || '').toLowerCase();
  const isYT =
    hostname === 'www.youtube.com' ||
    hostname === 'youtube.com' ||
    hostname === 'm.youtube.com' ||
    hostname === 'youtu.be';
  const isYTMusic = hostname === 'music.youtube.com';

  if (!isYT && !isYTMusic) return;

  // Fallback for browsers (e.g. older Firefox ESR) that run content_scripts in ISOLATED world
  try {
    if (
      typeof chrome !== 'undefined' &&
      chrome.runtime &&
      chrome.runtime.id &&
      typeof chrome.runtime.getURL === 'function'
    ) {
      const s = document.createElement('script');
      s.src = chrome.runtime.getURL('content/yt_premium.js');
      s.onload = () => s.remove();
      (document.head || document.documentElement).appendChild(s);
      return;
    }
  } catch (_) {}

  if (window.__ultiblockYtPremiumInjected) return;
  window.__ultiblockYtPremiumInjected = true;

  const DEFAULT_CONFIG = {
    nonStopBackground: true,
    sponsorBlock: true,
    autoMaxQuality: true,
    returnDislikes: true,
    playerEnhancements: true,
    ytMusicPremium: true,
    showDownloadButtons: true,
    premiumLogo: true,
    // Enhancer for YouTube & YT Tweaks settings
    miniPlayerOnScroll: true,
    wheelVolumeControl: true,
    hideShorts: false,
    hideEndscreens: true,
    squareCorners: false,
    hideSidebar: false,
    hideComments: false,
    gridColumns: 0 // 0 = Auto, 4, 5, 6
  };

  function getConfig() {
    try {
      const raw =
        (document.documentElement &&
          document.documentElement.dataset &&
          document.documentElement.dataset.ultiblockYtConfig) ||
        localStorage.getItem('__ub_yt_config');
      if (raw) {
        return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
      }
    } catch (_) {}
    return DEFAULT_CONFIG;
  }

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

  if (isDisabled()) {
    return;
  }

  // =========================================================================
  // 1. BACKGROUND PLAYBACK & NON-STOP ANTI-IDLE ("ВЫ ЕЩЁ СМОТРИТЕ?")
  // =========================================================================
  try {
    Object.defineProperty(Document.prototype, 'hidden', {
      configurable: true,
      get() {
        return false;
      }
    });

    Object.defineProperty(Document.prototype, 'visibilityState', {
      configurable: true,
      get() {
        return 'visible';
      }
    });

    Object.defineProperty(Document.prototype, 'webkitVisibilityState', {
      configurable: true,
      get() {
        return 'visible';
      }
    });

    const BLOCKED_EVENTS = [
      'visibilitychange',
      'webkitvisibilitychange',
      'mozvisibilitychange',
      'freeze'
    ];

    for (const evtName of BLOCKED_EVENTS) {
      window.addEventListener(
        evtName,
        (e) => {
          if (!isDisabled() && getConfig().nonStopBackground) {
            e.stopImmediatePropagation();
          }
        },
        true
      );
      document.addEventListener(
        evtName,
        (e) => {
          if (!isDisabled() && getConfig().nonStopBackground) {
            e.stopImmediatePropagation();
          }
        },
        true
      );
    }

    if (isYTMusic) {
      window.addEventListener(
        'blur',
        (e) => {
          if (!isDisabled() && getConfig().nonStopBackground) {
            e.stopImmediatePropagation();
          }
        },
        true
      );
    }
  } catch (_) {}

  // Keep YouTube's internal user activity timestamp (_lact) fresh so "Continue watching?" never triggers
  setInterval(() => {
    if (isDisabled() || !getConfig().nonStopBackground) return;
    try {
      window._lact = Date.now();
    } catch (_) {}

    const youThere = document.querySelector(
      'ytmusic-you-there-renderer button, yt-confirm-dialog-renderer #confirm-button button'
    );
    if (youThere) {
      const dialogEl = youThere.closest(
        'ytmusic-you-there-renderer, yt-confirm-dialog-renderer'
      );
      const dialogText = (dialogEl ? dialogEl.textContent || '' : '').toLowerCase();
      if (
        dialogText.includes('продолжить') ||
        dialogText.includes('continue') ||
        dialogText.includes('смотрите') ||
        dialogText.includes('watching') ||
        isYTMusic
      ) {
        try {
          youThere.click();
          const video = document.querySelector('video');
          if (video && video.paused) video.play();
        } catch (_) {}
      }
    }
  }, 4000);

  // =========================================================================
  // 2. TOAST NOTIFICATION HELPER INSIDE PLAYER
  // =========================================================================
  let toastEl = null;
  let toastTimer = null;

  function showPlayerToast(text) {
    const useFixedBody = isYTMusic || !document.querySelector('#movie_player');
    const container = useFixedBody
      ? document.body
      : document.querySelector('#movie_player') || document.body;
    if (!container) return;

    if (!toastEl || !container.contains(toastEl)) {
      toastEl = document.createElement('div');
      toastEl.id = 'ultiblock-yt-toast';
      Object.assign(toastEl.style, {
        position: useFixedBody ? 'fixed' : 'absolute',
        top: useFixedBody ? 'auto' : '18px',
        bottom: useFixedBody ? '88px' : 'auto',
        right: '18px',
        zIndex: '2147483646',
        background: 'rgba(15, 23, 42, 0.92)',
        backdropFilter: 'blur(8px)',
        color: '#f8fafc',
        border: '1px solid rgba(239, 68, 68, 0.65)',
        borderRadius: '8px',
        padding: '8px 14px',
        fontSize: '13px',
        fontWeight: '600',
        fontFamily: 'Roboto, Arial, sans-serif',
        boxShadow: '0 6px 20px rgba(0, 0, 0, 0.45)',
        pointerEvents: 'none',
        transition: 'opacity 0.2s ease, transform 0.2s ease',
        opacity: '0',
        transform: 'translateY(-6px)'
      });
      container.appendChild(toastEl);
    }

    toastEl.textContent = text;
    toastEl.style.opacity = '1';
    toastEl.style.transform = 'translateY(0)';

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (toastEl) {
        toastEl.style.opacity = '0';
        toastEl.style.transform = 'translateY(-6px)';
      }
    }, 2600);
  }

  // =========================================================================
  // 3. SPONSORBLOCK + RETURN YOUTUBE DISLIKE + AUTO 4K QUALITY
  // =========================================================================
  let currentVideoId = '';
  let currentSegments = [];
  let currentDislikes = null;
  let qualityAppliedForVideoId = '';
  let lastSkippedUUID = '';

  const CATEGORY_META = {
    sponsor: { name: 'Спонсорская интеграция', color: '#00d400' },
    selfpromo: { name: 'Самореклама', color: '#ffff00' },
    interaction: { name: 'Напоминание о подписке/лайке', color: '#cc00ff' },
    intro: { name: 'Интро / Заставка', color: '#00ffff' },
    outro: { name: 'Титры / Аутро', color: '#0202ed' },
    preview: { name: 'Анонс / Обзор', color: '#008fd6' },
    music_offtopic: { name: 'Сцена без музыки', color: '#ff9900' }
  };

  function getActiveVideoId() {
    try {
      const u = new URL(location.href);
      if (u.searchParams.has('v')) {
        return u.searchParams.get('v') || '';
      }
      const shortsMatch = u.pathname.match(/^\/shorts\/([a-zA-Z0-9_-]{11})/);
      if (shortsMatch) return shortsMatch[1];

      const player = document.getElementById('movie_player');
      if (player) {
        if (typeof player.getVideoData === 'function') {
          const vd = player.getVideoData();
          if (vd && vd.video_id) return vd.video_id;
        }
        if (typeof player.getVideoUrl === 'function') {
          const vUrlStr = player.getVideoUrl();
          if (vUrlStr) {
            const vUrl = new URL(vUrlStr, location.origin);
            if (vUrl.searchParams.has('v')) return vUrl.searchParams.get('v') || '';
          }
        }
      }

      if (isYTMusic) {
        const ytmApp = document.querySelector('ytmusic-app');
        if (
          ytmApp &&
          ytmApp.playerApi &&
          typeof ytmApp.playerApi.getVideoData === 'function'
        ) {
          const vd = ytmApp.playerApi.getVideoData();
          if (vd && vd.video_id) return vd.video_id;
        }

        const titleLink = document.querySelector(
          'ytmusic-player-bar a.ytp-title-link[href*="v="], ytmusic-player-bar a[href*="watch?v="], .ytp-title-link[href*="v="]'
        );
        if (titleLink && titleLink.href) {
          const lUrl = new URL(titleLink.href, location.origin);
          if (lUrl.searchParams.has('v')) return lUrl.searchParams.get('v') || '';
        }

        const vidAttrEl = document.querySelector(
          'ytmusic-player-bar [video-id], ytmusic-player [video-id], ytmusic-player-queue-item[selected][video-id], ytmusic-player-queue-item[play-button-state="playing"][video-id]'
        );
        if (vidAttrEl) {
          const attrId = vidAttrEl.getAttribute('video-id');
          if (attrId) return attrId;
        }
      }

      if (window.__ultiblockLastVideoId) {
        return window.__ultiblockLastVideoId;
      }
    } catch (_) {}
    return '';
  }

  function getActiveVideoMetadata() {
    let title =
      window.__ultiblockLastVideoTitle ||
      document.title.replace(/\s*-\s*YouTube(\s+Music)?$/i, '').trim();
    let author = window.__ultiblockLastVideoAuthor || '';
    const vid = getActiveVideoId();
    try {
      const player = document.getElementById('movie_player');
      if (player && typeof player.getVideoData === 'function') {
        const vd = player.getVideoData();
        if (vd && vd.title) title = vd.title;
        if (vd && vd.author) author = vd.author;
      }
    } catch (_) {}

    if (isYTMusic) {
      const titleEl = document.querySelector('ytmusic-player-bar .title');
      const bylineEl = document.querySelector('ytmusic-player-bar .byline');
      if (titleEl && titleEl.textContent) title = titleEl.textContent.trim();
      if (bylineEl && bylineEl.textContent) {
        author = bylineEl.textContent.split('•')[0].trim();
      }
    }

    return {
      videoId: vid,
      title: title || 'YouTube_Media',
      author: author || 'YouTube'
    };
  }

  window.addEventListener('message', (event) => {
    if (
      event.source !== window ||
      !event.data ||
      event.data.__ultiblock !== true ||
      event.data.type !== 'ULTIBLOCK_YT_VIDEO_DATA'
    ) {
      return;
    }

    if (event.data.videoId !== currentVideoId) return;
    currentSegments = Array.isArray(event.data.segments)
      ? event.data.segments
      : [];
    currentDislikes = event.data.dislikes || null;

    renderSponsorMarkers();
    if (currentDislikes && getConfig().returnDislikes) {
      renderDislikeCount(currentDislikes);
    }
  });

  function renderSponsorMarkers() {
    const oldBar = document.getElementById('ultiblock-sb-markers');
    if (oldBar) oldBar.remove();

    if (isDisabled() || !getConfig().sponsorBlock || currentSegments.length === 0) {
      return;
    }

    const progressList =
      document.querySelector('.ytp-progress-bar .ytp-progress-list') ||
      document.querySelector('.ytp-progress-bar');
    const video = document.querySelector('video');
    if (!progressList || !video || !Number.isFinite(video.duration) || video.duration <= 0) {
      return;
    }

    const markerContainer = document.createElement('div');
    markerContainer.id = 'ultiblock-sb-markers';
    Object.assign(markerContainer.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '45'
    });

    for (const item of currentSegments) {
      if (!Array.isArray(item.segment) || item.segment.length < 2) continue;
      const [start, end] = item.segment;
      const leftPct = Math.max(0, Math.min(100, (start / video.duration) * 100));
      const widthPct = Math.max(
        0.3,
        Math.min(100 - leftPct, ((end - start) / video.duration) * 100)
      );
      const meta = CATEGORY_META[item.category] || {
        name: item.category,
        color: '#00d400'
      };

      const dot = document.createElement('div');
      dot.title = `SponsorBlock: ${meta.name}`;
      Object.assign(dot.style, {
        position: 'absolute',
        left: `${leftPct}%`,
        width: `${widthPct}%`,
        height: '100%',
        backgroundColor: meta.color,
        opacity: '0.78'
      });
      markerContainer.appendChild(dot);
    }

    progressList.appendChild(markerContainer);
  }

  function checkSponsorSegments() {
    if (isDisabled() || !getConfig().sponsorBlock || currentSegments.length === 0) {
      return;
    }

    const video = document.querySelector('video');
    if (!video || video.paused) return;

    if (!document.getElementById('ultiblock-sb-markers') && video.duration > 0) {
      renderSponsorMarkers();
    }

    const t = video.currentTime;
    for (const item of currentSegments) {
      if (!Array.isArray(item.segment) || item.segment.length < 2) continue;
      const [start, end] = item.segment;
      if (t >= start && t < end - 0.25 && lastSkippedUUID !== item.UUID) {
        lastSkippedUUID = item.UUID || `${start}-${end}`;
        const player = document.getElementById('movie_player');
        if (player && typeof player.seekTo === 'function') {
          player.seekTo(end, true);
        } else {
          video.currentTime = end;
        }

        const meta = CATEGORY_META[item.category] || { name: 'Сегмент' };
        const savedSec = Math.max(1, Math.round(end - start));
        showPlayerToast(`⏭ Пропущено: ${meta.name} (${savedSec} сек)`);

        window.postMessage(
          { __ultiblock: true, type: 'ULTIBLOCK_STAT', kind: 'sponsor', count: 1 },
          '*'
        );
        break;
      }
    }
  }

  function applyAutoMaxQuality() {
    if (isDisabled() || !getConfig().autoMaxQuality) return;
    const vid = getActiveVideoId();
    if (!vid || qualityAppliedForVideoId === vid) return;

    const player = document.getElementById('movie_player');
    if (!player || typeof player.getAvailableQualityLevels !== 'function') return;

    // Wait until the player has actually switched to this video and loaded valid metadata
    // (calling setPlaybackQualityRange mid-SPA transition can stall MSE at 0:00).
    if (
      player.classList.contains('ad-showing') ||
      player.classList.contains('ad-interrupting')
    ) {
      return;
    }
    try {
      if (typeof player.getVideoData === 'function') {
        const vd = player.getVideoData();
        if (!vd || vd.video_id !== vid) return;
      }
    } catch (_) {}
    const video = player.querySelector('video.html5-main-video, video');
    if (!video || video.readyState < 1 || !Number.isFinite(video.duration) || video.duration <= 0) {
      return;
    }

    const levels = player.getAvailableQualityLevels();
    if (!Array.isArray(levels) || levels.length === 0) return;

    // Pick the best quality that is actually playable for this account
    // (skip "1080p Premium" / paygated formats - they kill the video track).
    let bestQuality = null;
    try {
      if (typeof player.getAvailableQualityData === 'function') {
        const data = player.getAvailableQualityData() || [];
        const ok = data.find(
          (q) =>
            q &&
            q.quality &&
            q.quality !== 'auto' &&
            q.isPlayable !== false &&
            !q.paygatedQualityDetails
        );
        if (ok) bestQuality = ok.quality;
      }
    } catch (_) {}
    if (!bestQuality) {
      bestQuality = levels.find((l) => l && l !== 'auto') || null;
    }
    if (!bestQuality) return;
    try {
      if (typeof player.setPlaybackQualityRange === 'function') {
        player.setPlaybackQualityRange(bestQuality, bestQuality);
      }
      if (typeof player.setPlaybackQuality === 'function') {
        player.setPlaybackQuality(bestQuality);
      }
      qualityAppliedForVideoId = vid;
    } catch (_) {}
  }

  function formatCompactCount(num) {
    const n = Number(num || 0);
    if (n < 1000) return String(n);
    if (n < 1000000) {
      const k = (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.0', '');
      return `${k.replace('.', ',')} тыс.`;
    }
    const m = (n / 1000000).toFixed(1).replace('.0', '');
    return `${m.replace('.', ',')} млн`;
  }

  function renderDislikeCount(dislikeData) {
    if (isDisabled() || !getConfig().returnDislikes || !dislikeData) return;
    const formatted = formatCompactCount(dislikeData.dislikes);

    const dislikeButtons = document.querySelectorAll(
      'dislike-button-view-model button, ytd-menu-renderer segmented-like-dislike-button-view-model dislike-button-view-model button, #segmented-dislike-button button'
    );

    for (const btn of dislikeButtons) {
      let badge = btn.querySelector('.ultiblock-dislike-text');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'ultiblock-dislike-text';
        Object.assign(badge.style, {
          marginLeft: '6px',
          fontSize: '14px',
          fontWeight: '500',
          fontFamily: 'Roboto, Arial, sans-serif'
        });
        btn.style.width = 'auto';
        btn.style.paddingRight = '14px';
        btn.appendChild(badge);
      }
      if (badge.textContent !== formatted) {
        badge.textContent = formatted;
      }
    }

    const shortsDislikeLabel = document.querySelector(
      'ytd-reel-video-renderer[is-active] #dislike-button .yt-core-attributed-string'
    );
    if (shortsDislikeLabel) {
      shortsDislikeLabel.textContent = formatted;
    }
  }

  // =========================================================================
  // 4. WEBAUDIO STUDIO ENHANCER (200% VOLUME BOOST + BASS / CLARITY EQ)
  // =========================================================================
  let audioCtx = null;
  let audioSource = null;
  let gainNode = null;
  let bassNode = null;
  let clarityNode = null;
  let compressorNode = null;
  let attachedVideoEl = null;
  let currentBoostLevel = 0;

  function cycleAudioBoost() {
    const video = document.querySelector('video');
    if (!video) return 0;

    currentBoostLevel = (currentBoostLevel + 1) % 3;

    try {
      if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContextClass();
      }
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }

      if (attachedVideoEl !== video) {
        video.crossOrigin = 'anonymous';
        audioSource = audioCtx.createMediaElementSource(video);
        bassNode = audioCtx.createBiquadFilter();
        bassNode.type = 'lowshelf';
        bassNode.frequency.value = 110;

        clarityNode = audioCtx.createBiquadFilter();
        clarityNode.type = 'highshelf';
        clarityNode.frequency.value = 4500;

        compressorNode = audioCtx.createDynamicsCompressor();
        compressorNode.threshold.value = -20;
        compressorNode.knee.value = 25;
        compressorNode.ratio.value = 4;
        compressorNode.attack.value = 0.005;
        compressorNode.release.value = 0.2;

        gainNode = audioCtx.createGain();

        audioSource
          .connect(bassNode)
          .connect(clarityNode)
          .connect(compressorNode)
          .connect(gainNode)
          .connect(audioCtx.destination);

        attachedVideoEl = video;
      }

      if (currentBoostLevel === 0) {
        bassNode.gain.value = 0;
        clarityNode.gain.value = 0;
        gainNode.gain.value = 1.0;
        showPlayerToast('🔊 Звук: 100% (Стандартный)');
      } else if (currentBoostLevel === 1) {
        bassNode.gain.value = 4.5;
        clarityNode.gain.value = 3.0;
        gainNode.gain.value = 1.5;
        showPlayerToast('🔊 Студийный звук HQ: 150% + Bass/Clarity');
      } else {
        bassNode.gain.value = 6.5;
        clarityNode.gain.value = 4.5;
        gainNode.gain.value = 2.0;
        showPlayerToast('🔊 Макс. буст звука HQ: 200% + Studio EQ');
      }
    } catch (_) {
      showPlayerToast('🔊 Аудио-бустер переключен');
    }

    return currentBoostLevel;
  }

  // =========================================================================
  // 5. DIRECT YOUTUBE VIDEO & YOUTUBE MUSIC DOWNLOADER (100% NATIVE, NO SITES)
  // =========================================================================
  let downloadModalEl = null;
  let activeDownloadAbort = null;

  function triggerNativeDownload(url, filename) {
    window.postMessage(
      {
        __ultiblock: true,
        type: 'ULTIBLOCK_TRIGGER_DOWNLOAD',
        url,
        filename
      },
      '*'
    );
  }

  function saveBlobToDisk(blob, filename) {
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(blobUrl);
    }, 60000);
  }

  // Fetch a googlevideo.com stream in <1 MB bounded Range chunks so YouTube never returns 403 / .txt
  async function fetchStreamAsUint8Array(url, knownSize, onProgress, signal) {
    let totalBytes = Number(knownSize) || 0;

    if (!totalBytes) {
      const probe = await fetch(url, {
        method: 'GET',
        credentials: 'omit',
        headers: { Range: 'bytes=0-1' },
        signal
      });
      const cr = probe.headers.get('Content-Range') || '';
      const m = cr.match(/\/(\d+)/);
      if (m) {
        totalBytes = Number(m[1]);
      }
    }

    if (!totalBytes) {
      const resp = await fetch(url, { credentials: 'omit', signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = await resp.arrayBuffer();
      const u8 = new Uint8Array(buf);
      if (onProgress) onProgress(u8.byteLength, u8.byteLength);
      return u8;
    }

    // 950 KB chunks stay safely below YouTube's ~1 MB audio range throttle limit
    const CHUNK_SIZE = 950 * 1024;
    const ranges = [];
    for (let start = 0; start < totalBytes; start += CHUNK_SIZE) {
      const end = Math.min(start + CHUNK_SIZE - 1, totalBytes - 1);
      ranges.push({ index: ranges.length, start, end });
    }

    const chunks = new Array(ranges.length);
    let downloaded = 0;
    let cursor = 0;
    const CONCURRENCY = 4;

    async function worker() {
      while (cursor < ranges.length) {
        const item = ranges[cursor++];
        let attempt = 0;
        while (true) {
          try {
            const resp = await fetch(url, {
              method: 'GET',
              credentials: 'omit',
              headers: { Range: `bytes=${item.start}-${item.end}` },
              signal
            });
            if (!resp.ok && resp.status !== 206) {
              throw new Error(`HTTP ${resp.status}`);
            }
            const buf = await resp.arrayBuffer();
            const u8 = new Uint8Array(buf);
            chunks[item.index] = u8;
            downloaded += u8.byteLength;
            if (onProgress) onProgress(downloaded, totalBytes);
            break;
          } catch (err) {
            if (signal && signal.aborted) throw err;
            attempt++;
            if (attempt >= 3) throw err;
            await new Promise((r) => setTimeout(r, 300 * attempt));
          }
        }
      }
    }

    const workers = [];
    for (let i = 0; i < Math.min(CONCURRENCY, ranges.length); i++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    const merged = new Uint8Array(downloaded);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    return merged;
  }

  // Pure JS ISO-BMFF (fMP4) Video + Audio Muxer so 1080p/720p/480p downloads include full AAC sound
  function readU32(u8, pos) {
    return (
      ((u8[pos] << 24) |
        (u8[pos + 1] << 16) |
        (u8[pos + 2] << 8) |
        u8[pos + 3]) >>>
      0
    );
  }

  function writeU32(u8, pos, val) {
    u8[pos] = (val >>> 24) & 0xff;
    u8[pos + 1] = (val >>> 16) & 0xff;
    u8[pos + 2] = (val >>> 8) & 0xff;
    u8[pos + 3] = val & 0xff;
  }

  function readBoxType(u8, pos) {
    return String.fromCharCode(
      u8[pos + 4],
      u8[pos + 5],
      u8[pos + 6],
      u8[pos + 7]
    );
  }

  function parseMp4Boxes(u8, start = 0, end = u8.byteLength) {
    const boxes = [];
    let pos = start;
    while (pos + 8 <= end) {
      const size = readU32(u8, pos);
      const type = readBoxType(u8, pos);
      if (size < 8 || pos + size > end) break;
      boxes.push({ type, pos, size });
      pos += size;
    }
    return boxes;
  }

  function makeMp4Box(type, payloads) {
    let payloadLen = 0;
    for (const p of payloads) payloadLen += p.byteLength;
    const out = new Uint8Array(8 + payloadLen);
    writeU32(out, 0, 8 + payloadLen);
    out[4] = type.charCodeAt(0);
    out[5] = type.charCodeAt(1);
    out[6] = type.charCodeAt(2);
    out[7] = type.charCodeAt(3);
    let offset = 8;
    for (const p of payloads) {
      out.set(p, offset);
      offset += p.byteLength;
    }
    return out;
  }

  function getMoovTimescale(u8, moovBox) {
    const moovChildren = parseMp4Boxes(
      u8,
      moovBox.pos + 8,
      moovBox.pos + moovBox.size
    );
    const trak = moovChildren.find((b) => b.type === 'trak');
    if (!trak) return 1000;
    const trakChildren = parseMp4Boxes(u8, trak.pos + 8, trak.pos + trak.size);
    const mdia = trakChildren.find((b) => b.type === 'mdia');
    if (!mdia) return 1000;
    const mdiaChildren = parseMp4Boxes(u8, mdia.pos + 8, mdia.pos + mdia.size);
    const mdhd = mdiaChildren.find((b) => b.type === 'mdhd');
    if (!mdhd) return 1000;
    const ver = u8[mdhd.pos + 8];
    const tsOffset = mdhd.pos + (ver === 1 ? 28 : 20);
    return readU32(u8, tsOffset) || 1000;
  }

  function parseFmp4Track(u8, isVideo) {
    const topBoxes = parseMp4Boxes(u8);
    const moovBox = topBoxes.find((b) => b.type === 'moov');
    if (!moovBox) return null;

    const moovChildren = parseMp4Boxes(
      u8,
      moovBox.pos + 8,
      moovBox.pos + moovBox.size
    );
    const mvhdBox = moovChildren.find((b) => b.type === 'mvhd');
    const trakBox = moovChildren.find((b) => b.type === 'trak');
    if (!mvhdBox || !trakBox) return null;

    const mvhdVer = u8[mvhdBox.pos + 8];
    const mvhdTimescale =
      readU32(u8, mvhdBox.pos + (mvhdVer === 1 ? 28 : 20)) || 1000;

    let trexDefDur = 0;
    let trexDefSize = 0;
    let trexDefFlags = 0;
    const mvexBox = moovChildren.find((b) => b.type === 'mvex');
    if (mvexBox) {
      const mvexChildren = parseMp4Boxes(
        u8,
        mvexBox.pos + 8,
        mvexBox.pos + mvexBox.size
      );
      const trexBox = mvexChildren.find((b) => b.type === 'trex');
      if (trexBox && trexBox.size >= 32) {
        trexDefDur = readU32(u8, trexBox.pos + 20);
        trexDefSize = readU32(u8, trexBox.pos + 24);
        trexDefFlags = readU32(u8, trexBox.pos + 28);
      }
    }

    const trakChildren = parseMp4Boxes(
      u8,
      trakBox.pos + 8,
      trakBox.pos + trakBox.size
    );
    const tkhdBox = trakChildren.find((b) => b.type === 'tkhd');
    const mdiaBox = trakChildren.find((b) => b.type === 'mdia');
    if (!tkhdBox || !mdiaBox) return null;

    const mdiaChildren = parseMp4Boxes(
      u8,
      mdiaBox.pos + 8,
      mdiaBox.pos + mdiaBox.size
    );
    const mdhdBox = mdiaChildren.find((b) => b.type === 'mdhd');
    const hdlrBox = mdiaChildren.find((b) => b.type === 'hdlr');
    const minfBox = mdiaChildren.find((b) => b.type === 'minf');
    if (!mdhdBox || !hdlrBox || !minfBox) return null;

    const mdhdVer = u8[mdhdBox.pos + 8];
    const trackTimescale =
      readU32(u8, mdhdBox.pos + (mdhdVer === 1 ? 28 : 20)) || 1000;

    const minfChildren = parseMp4Boxes(
      u8,
      minfBox.pos + 8,
      minfBox.pos + minfBox.size
    );
    const mediaHeaderBox = minfChildren.find(
      (b) => b.type === 'vmhd' || b.type === 'smhd'
    );
    const dinfBox = minfChildren.find((b) => b.type === 'dinf');
    const stblBox = minfChildren.find((b) => b.type === 'stbl');
    if (!mediaHeaderBox || !dinfBox || !stblBox) return null;

    const stblChildren = parseMp4Boxes(
      u8,
      stblBox.pos + 8,
      stblBox.pos + stblBox.size
    );
    const stsdBox = stblChildren.find((b) => b.type === 'stsd');
    if (!stsdBox) return null;

    const sampleDurations = [];
    const sampleSizes = [];
    const sampleSyncFlags = [];
    const sampleCtos = [];
    const chunkSampleCounts = [];
    const chunkPayloads = [];
    let totalDuration = 0;

    for (let i = 0; i < topBoxes.length; i++) {
      if (topBoxes[i].type !== 'moof') continue;
      const moof = topBoxes[i];
      const mdat =
        i + 1 < topBoxes.length && topBoxes[i + 1].type === 'mdat'
          ? topBoxes[i + 1]
          : null;
      if (!mdat || mdat.size <= 8) continue;

      const moofChildren = parseMp4Boxes(u8, moof.pos + 8, moof.pos + moof.size);
      const traf = moofChildren.find((b) => b.type === 'traf');
      if (!traf) continue;

      const trafChildren = parseMp4Boxes(u8, traf.pos + 8, traf.pos + traf.size);
      const tfhd = trafChildren.find((b) => b.type === 'tfhd');
      const trun = trafChildren.find((b) => b.type === 'trun');
      if (!tfhd || !trun) continue;

      const tfhdFlags = readU32(u8, tfhd.pos + 8) & 0xffffff;
      let p = tfhd.pos + 16;
      if (tfhdFlags & 0x000001) p += 8;
      if (tfhdFlags & 0x000002) p += 4;
      const defDur = tfhdFlags & 0x000008 ? readU32(u8, p) : trexDefDur;
      if (tfhdFlags & 0x000008) p += 4;
      const defSize = tfhdFlags & 0x000010 ? readU32(u8, p) : trexDefSize;
      if (tfhdFlags & 0x000010) p += 4;
      const defFlags = tfhdFlags & 0x000020 ? readU32(u8, p) : trexDefFlags;

      const trunFlags = readU32(u8, trun.pos + 8) & 0xffffff;
      const sampleCount = readU32(u8, trun.pos + 12);
      if (!sampleCount) continue;

      let tp = trun.pos + 16;
      if (trunFlags & 0x000001) tp += 4;
      const firstSampleFlags =
        trunFlags & 0x000004 ? readU32(u8, tp) : defFlags;
      if (trunFlags & 0x000004) tp += 4;

      for (let s = 0; s < sampleCount; s++) {
        const dur = trunFlags & 0x000100 ? readU32(u8, tp) : defDur;
        if (trunFlags & 0x000100) tp += 4;
        const sz = trunFlags & 0x000200 ? readU32(u8, tp) : defSize;
        if (trunFlags & 0x000200) tp += 4;
        const fl =
          trunFlags & 0x000400
            ? readU32(u8, tp)
            : s === 0
              ? firstSampleFlags
              : defFlags;
        if (trunFlags & 0x000400) tp += 4;
        const cto = trunFlags & 0x000800 ? readU32(u8, tp) | 0 : 0;
        if (trunFlags & 0x000800) tp += 4;

        sampleDurations.push(dur);
        totalDuration += dur;
        sampleSizes.push(sz);
        sampleSyncFlags.push((fl & 0x00010000) === 0);
        sampleCtos.push(cto);
      }

      chunkSampleCounts.push(sampleCount);
      chunkPayloads.push(u8.subarray(mdat.pos + 8, mdat.pos + mdat.size));
    }

    if (sampleSizes.length === 0) return null;

    return {
      u8,
      isVideo,
      mvhdBox,
      mvhdTimescale,
      tkhdBox,
      mdhdBox,
      hdlrBox,
      mediaHeaderBox,
      dinfBox,
      stsdBox,
      trackTimescale,
      totalDuration,
      sampleDurations,
      sampleSizes,
      sampleSyncFlags,
      sampleCtos,
      chunkSampleCounts,
      chunkPayloads
    };
  }

  function buildTrackTrakBox(t, trackId, targetMvhdTimescale, chunkOffsets) {
    // 1. stts (Run-length encoded sample durations)
    const sttsRuns = [];
    for (const d of t.sampleDurations) {
      if (sttsRuns.length > 0 && sttsRuns[sttsRuns.length - 1].delta === d) {
        sttsRuns[sttsRuns.length - 1].count++;
      } else {
        sttsRuns.push({ count: 1, delta: d });
      }
    }
    const sttsPayload = new Uint8Array(8 + sttsRuns.length * 8);
    writeU32(sttsPayload, 4, sttsRuns.length);
    for (let i = 0; i < sttsRuns.length; i++) {
      writeU32(sttsPayload, 8 + i * 8, sttsRuns[i].count);
      writeU32(sttsPayload, 12 + i * 8, sttsRuns[i].delta);
    }
    const sttsBox = makeMp4Box('stts', [sttsPayload]);

    // 2. stsc (Sample-to-Chunk)
    const stscPayload = new Uint8Array(8 + t.chunkSampleCounts.length * 12);
    writeU32(stscPayload, 4, t.chunkSampleCounts.length);
    for (let i = 0; i < t.chunkSampleCounts.length; i++) {
      writeU32(stscPayload, 8 + i * 12, i + 1);
      writeU32(stscPayload, 12 + i * 12, t.chunkSampleCounts[i]);
      writeU32(stscPayload, 16 + i * 12, 1);
    }
    const stscBox = makeMp4Box('stsc', [stscPayload]);

    // 3. stco (Chunk Offsets)
    const stcoPayload = new Uint8Array(8 + chunkOffsets.length * 4);
    writeU32(stcoPayload, 4, chunkOffsets.length);
    for (let i = 0; i < chunkOffsets.length; i++) {
      writeU32(stcoPayload, 8 + i * 4, chunkOffsets[i]);
    }
    const stcoBox = makeMp4Box('stco', [stcoPayload]);

    // 4. stsz (Sample Sizes)
    const stszPayload = new Uint8Array(12 + t.sampleSizes.length * 4);
    writeU32(stszPayload, 8, t.sampleSizes.length);
    for (let i = 0; i < t.sampleSizes.length; i++) {
      writeU32(stszPayload, 12 + i * 4, t.sampleSizes[i]);
    }
    const stszBox = makeMp4Box('stsz', [stszPayload]);

    const stblParts = [
      t.u8.subarray(t.stsdBox.pos, t.stsdBox.pos + t.stsdBox.size),
      sttsBox,
      stscBox,
      stcoBox,
      stszBox
    ];

    if (t.isVideo) {
      // 5. stss (Sync Samples / Keyframes)
      const syncIndices = [];
      for (let i = 0; i < t.sampleSyncFlags.length; i++) {
        if (t.sampleSyncFlags[i]) syncIndices.push(i + 1);
      }
      if (syncIndices.length > 0) {
        const stssPayload = new Uint8Array(8 + syncIndices.length * 4);
        writeU32(stssPayload, 4, syncIndices.length);
        for (let i = 0; i < syncIndices.length; i++) {
          writeU32(stssPayload, 8 + i * 4, syncIndices[i]);
        }
        stblParts.push(makeMp4Box('stss', [stssPayload]));
      }

      // 6. ctts (Composition Time Offsets)
      const hasCto = t.sampleCtos.some((c) => c !== 0);
      if (hasCto) {
        const cttsRuns = [];
        let hasNeg = false;
        for (const c of t.sampleCtos) {
          if (c < 0) hasNeg = true;
          if (cttsRuns.length > 0 && cttsRuns[cttsRuns.length - 1].offset === c) {
            cttsRuns[cttsRuns.length - 1].count++;
          } else {
            cttsRuns.push({ count: 1, offset: c });
          }
        }
        const cttsPayload = new Uint8Array(8 + cttsRuns.length * 8);
        cttsPayload[0] = hasNeg ? 1 : 0;
        writeU32(cttsPayload, 4, cttsRuns.length);
        for (let i = 0; i < cttsRuns.length; i++) {
          writeU32(cttsPayload, 8 + i * 8, cttsRuns[i].count);
          writeU32(cttsPayload, 12 + i * 8, cttsRuns[i].offset >>> 0);
        }
        stblParts.push(makeMp4Box('ctts', [cttsPayload]));
      }
    }

    const stbl = makeMp4Box('stbl', stblParts);
    const minf = makeMp4Box('minf', [
      t.u8.subarray(
        t.mediaHeaderBox.pos,
        t.mediaHeaderBox.pos + t.mediaHeaderBox.size
      ),
      t.u8.subarray(t.dinfBox.pos, t.dinfBox.pos + t.dinfBox.size),
      stbl
    ]);

    const mdhd = t.u8.slice(t.mdhdBox.pos, t.mdhdBox.pos + t.mdhdBox.size);
    const mdhdVer = mdhd[8];
    if (mdhdVer === 0) {
      writeU32(mdhd, 24, t.totalDuration);
    }

    const mdia = makeMp4Box('mdia', [
      mdhd,
      t.u8.subarray(t.hdlrBox.pos, t.hdlrBox.pos + t.hdlrBox.size),
      minf
    ]);

    const tkhd = t.u8.slice(t.tkhdBox.pos, t.tkhdBox.pos + t.tkhdBox.size);
    tkhd[11] = 3; // track_enabled | track_in_movie
    const tkhdVer = tkhd[8];
    const scaledDur = Math.round(
      (t.totalDuration / t.trackTimescale) * targetMvhdTimescale
    );
    if (tkhdVer === 1) {
      writeU32(tkhd, 28, trackId);
    } else {
      writeU32(tkhd, 20, trackId);
      writeU32(tkhd, 28, scaledDur);
    }

    return makeMp4Box('trak', [tkhd, mdia]);
  }

  // Converts DASH fragmented MP4 video + AAC audio into a 100% standard non-fragmented MP4 (ftypmp42 + moov + mdat)
  function buildStandardMp4FromFmp4(videoU8, audioU8) {
    try {
      const vTrack = parseFmp4Track(videoU8, true);
      const aTrack = audioU8 ? parseFmp4Track(audioU8, false) : null;
      if (!vTrack) return [videoU8];

      // Standard ftypmp42 box identical to YouTube itag 18
      const ftyp = new Uint8Array([
        0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50, 0, 0, 0, 0, 105, 115,
        111, 109, 109, 112, 52, 50
      ]);

      const mvhd = videoU8.slice(
        vTrack.mvhdBox.pos,
        vTrack.mvhdBox.pos + vTrack.mvhdBox.size
      );
      const mvhdVer = mvhd[8];
      const vDurInMvhd = Math.round(
        (vTrack.totalDuration / vTrack.trackTimescale) * vTrack.mvhdTimescale
      );
      if (mvhdVer === 0) {
        writeU32(mvhd, 24, vDurInMvhd);
      }
      writeU32(mvhd, mvhd.byteLength - 4, aTrack ? 3 : 2);

      const dummyVOffsets = new Array(vTrack.chunkPayloads.length).fill(0);
      const dummyAOffsets = aTrack
        ? new Array(aTrack.chunkPayloads.length).fill(0)
        : [];

      const dummyVTrak = buildTrackTrakBox(
        vTrack,
        1,
        vTrack.mvhdTimescale,
        dummyVOffsets
      );
      const dummyATrak = aTrack
        ? buildTrackTrakBox(aTrack, 2, vTrack.mvhdTimescale, dummyAOffsets)
        : null;
      const dummyMoov = makeMp4Box(
        'moov',
        dummyATrak ? [mvhd, dummyVTrak, dummyATrak] : [mvhd, dummyVTrak]
      );

      let runningOffset = ftyp.byteLength + dummyMoov.byteLength + 8;
      const realVOffsets = [];
      let totalMdatPayload = 0;

      for (const chunk of vTrack.chunkPayloads) {
        realVOffsets.push(runningOffset);
        runningOffset += chunk.byteLength;
        totalMdatPayload += chunk.byteLength;
      }

      const realAOffsets = [];
      if (aTrack) {
        for (const chunk of aTrack.chunkPayloads) {
          realAOffsets.push(runningOffset);
          runningOffset += chunk.byteLength;
          totalMdatPayload += chunk.byteLength;
        }
      }

      const realVTrak = buildTrackTrakBox(
        vTrack,
        1,
        vTrack.mvhdTimescale,
        realVOffsets
      );
      const realATrak = aTrack
        ? buildTrackTrakBox(aTrack, 2, vTrack.mvhdTimescale, realAOffsets)
        : null;
      const realMoov = makeMp4Box(
        'moov',
        realATrak ? [mvhd, realVTrak, realATrak] : [mvhd, realVTrak]
      );

      const mdatHeader = new Uint8Array(8);
      writeU32(mdatHeader, 0, 8 + totalMdatPayload);
      mdatHeader[4] = 109; // 'm'
      mdatHeader[5] = 100; // 'd'
      mdatHeader[6] = 97; // 'a'
      mdatHeader[7] = 116; // 't'

      return [
        ftyp,
        realMoov,
        mdatHeader,
        ...vTrack.chunkPayloads,
        ...(aTrack ? aTrack.chunkPayloads : [])
      ];
    } catch (_) {
      return [videoU8];
    }
  }

  function requestStreamsFromBg(videoId) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMsg);
        resolve({ ok: false, error: 'Timeout' });
      }, 12000);

      function onMsg(event) {
        if (
          event.source !== window ||
          !event.data ||
          event.data.__ultiblock !== true ||
          event.data.type !== 'ULTIBLOCK_YT_STREAMS_RESULT' ||
          event.data.videoId !== videoId
        ) {
          return;
        }
        clearTimeout(timer);
        window.removeEventListener('message', onMsg);
        resolve(event.data);
      }

      window.addEventListener('message', onMsg);
      window.postMessage(
        {
          __ultiblock: true,
          type: 'ULTIBLOCK_REQUEST_YT_STREAMS',
          videoId
        },
        '*'
      );
    });
  }

  let outsideClickHandler = null;

  function startBackgroundDownloadJob(job) {
    window.postMessage(
      {
        __ultiblock: true,
        type: 'ULTIBLOCK_START_BG_DOWNLOAD',
        job
      },
      '*'
    );
  }

  // Listen for live background download updates to display progress right on the player button
  window.addEventListener('message', (event) => {
    if (
      event.source !== window ||
      !event.data ||
      event.data.__ultiblock !== true ||
      event.data.type !== 'ULTIBLOCK_DOWNLOADS_UPDATED'
    ) {
      return;
    }

    const list = Array.isArray(event.data.downloads) ? event.data.downloads : [];
    const running = list.filter(
      (j) =>
        j.status === 'downloading' ||
        j.status === 'converting' ||
        j.status === 'muxing'
    );

    const ytBtn = document.getElementById('ultiblock-yt-dl-btn');
    const ytmBtn = document.getElementById('ultiblock-ytm-dl-btn');

    if (running.length > 0) {
      const latest = running[running.length - 1];
      const pct = Math.max(1, Math.min(99, Math.round(latest.progress || 1)));
      const label =
        latest.status === 'converting'
          ? `⚙️ MP3 ${pct}%`
          : latest.status === 'muxing'
            ? `⚙️ MP4 ${pct}%`
            : `⏳ ${pct}% • ${latest.qualityLabel || 'DL'}`;
      if (ytBtn) ytBtn.textContent = label;
      if (ytmBtn) ytmBtn.textContent = label;
    } else {
      if (ytBtn) ytBtn.textContent = '📥 Скачать';
      if (ytmBtn) ytmBtn.textContent = '📥 Скачать';
    }
  });

  function closeDownloadPopover() {
    if (downloadModalEl) {
      downloadModalEl.remove();
      downloadModalEl = null;
    }
    if (outsideClickHandler) {
      document.removeEventListener('mousedown', outsideClickHandler, true);
      outsideClickHandler = null;
    }
  }

  function openDownloadModal() {
    if (downloadModalEl) {
      closeDownloadPopover();
      return;
    }

    const meta = getActiveVideoMetadata();
    if (!meta.videoId) {
      showPlayerToast('⚠️ Откройте видео или трек для скачивания');
      return;
    }

    const anchorBtn =
      document.getElementById('ultiblock-ytm-dl-btn') ||
      document.getElementById('ultiblock-yt-dl-btn');

    const popover = document.createElement('div');
    popover.id = 'ultiblock-dl-modal';

    // Position compact non-blocking popover near the button (no separate modal backdrop!)
    let topPx = 70;
    let rightPx = 24;
    let bottomPx = null;

    if (anchorBtn) {
      const rect = anchorBtn.getBoundingClientRect();
      rightPx = Math.max(12, window.innerWidth - rect.right);
      if (rect.top > 240) {
        bottomPx = Math.max(12, window.innerHeight - rect.top + 10);
      } else {
        topPx = Math.min(window.innerHeight - 220, rect.bottom + 10);
      }
    }

    Object.assign(popover.style, {
      position: 'fixed',
      zIndex: '2147483646',
      right: `${rightPx}px`,
      ...(bottomPx !== null ? { bottom: `${bottomPx}px` } : { top: `${topPx}px` }),
      width: '325px',
      maxWidth: '92vw',
      background: '#0f172a',
      border: '1px solid #334155',
      borderRadius: '12px',
      padding: '12px',
      color: '#f8fafc',
      boxShadow: '0 14px 36px rgba(0,0,0,0.65)',
      display: 'flex',
      flexDirection: 'column',
      gap: '9px',
      fontFamily: 'Roboto, system-ui, sans-serif'
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderBottom: '1px solid #1e293b',
      paddingBottom: '7px'
    });

    const hTitle = document.createElement('div');
    hTitle.textContent = isYTMusic
      ? '🎵 Фоновая загрузка (MP3)'
      : '📥 Фоновая загрузка';
    Object.assign(hTitle.style, { fontSize: '13px', fontWeight: '700' });

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    Object.assign(closeBtn.style, {
      background: 'transparent',
      border: 'none',
      color: '#94a3b8',
      fontSize: '14px',
      cursor: 'pointer',
      padding: '0 4px'
    });
    closeBtn.addEventListener('click', () => closeDownloadPopover());

    header.appendChild(hTitle);
    header.appendChild(closeBtn);
    popover.appendChild(header);

    const infoBox = document.createElement('div');
    infoBox.textContent = `${meta.author} — ${meta.title}`;
    Object.assign(infoBox.style, {
      fontSize: '11.5px',
      color: '#cbd5e1',
      background: '#1e293b',
      padding: '6px 8px',
      borderRadius: '7px',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis'
    });
    popover.appendChild(infoBox);

    const streamsBox = document.createElement('div');
    Object.assign(streamsBox.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '7px'
    });

    const loadingText = document.createElement('div');
    loadingText.textContent = '⏳ Получение потоков...';
    Object.assign(loadingText.style, {
      fontSize: '12px',
      color: '#38bdf8',
      textAlign: 'center',
      padding: '8px 0'
    });
    streamsBox.appendChild(loadingText);
    popover.appendChild(streamsBox);

    const hintEl = document.createElement('div');
    hintEl.textContent =
      '💡 Качает в фоне без лагов Discord — прогресс виден на кнопке и в окне расширения.';
    Object.assign(hintEl.style, {
      fontSize: '10.5px',
      color: '#64748b',
      lineHeight: '1.35'
    });
    popover.appendChild(hintEl);

    function createActionRow(label, sublabel, bg, onClick) {
      const btn = document.createElement('button');
      Object.assign(btn.style, {
        width: '100%',
        background: bg,
        color: '#ffffff',
        border: '1px solid rgba(255,255,255,0.14)',
        borderRadius: '8px',
        padding: '9px 11px',
        cursor: 'pointer',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '12.5px',
        fontWeight: '600'
      });
      const left = document.createElement('span');
      left.textContent = label;
      const right = document.createElement('span');
      right.textContent = sublabel;
      Object.assign(right.style, {
        fontSize: '11px',
        opacity: '0.95',
        background: 'rgba(0,0,0,0.28)',
        padding: '2px 7px',
        borderRadius: '5px'
      });
      btn.appendChild(left);
      btn.appendChild(right);
      btn.addEventListener('click', () => onClick(btn, left, right));
      return btn;
    }

    const safeFileBase = `${meta.author} - ${meta.title}`
      .replace(/[\\/:*?"<>|]+/g, '_')
      .slice(0, 85);

    function fmtMb(bytes) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
    }

    requestStreamsFromBg(meta.videoId).then((res) => {
      streamsBox.textContent = '';

      const st = res.streams;
      if (!res.ok || !st) {
        loadingText.textContent = '⚠️ Не удалось получить прямые потоки.';
        streamsBox.appendChild(loadingText);
        return;
      }

      if (isYTMusic) {
        // ==================== YOUTUBE MUSIC: ONLY 2 BUTTONS (MP3 + COVER) ====================
        const bestAudio = (st.audio && st.audio[0]) || st.aacAudio || null;

        if (bestAudio) {
          streamsBox.appendChild(
            createActionRow(
              '🎵 Скачать музыку',
              'MP3 • 192 kbps',
              'linear-gradient(135deg, #8b5cf6, #6d28d9)',
              () => {
                startBackgroundDownloadJob({
                  kind: 'mp3',
                  videoId: meta.videoId,
                  title: `${meta.author} — ${meta.title}`,
                  qualityLabel: 'MP3',
                  filename: `${safeFileBase}.mp3`,
                  audioStream: bestAudio,
                  fallbackAacStream: st.aacAudio || null,
                  totalBytes: bestAudio.bytes || 0
                });
                closeDownloadPopover();
                showPlayerToast(
                  '🎵 Скачивание MP3 запущено в фоне! (Прогресс в окне расширения и на кнопке)'
                );
              }
            )
          );
        }
      } else {
        // ==================== REGULAR YOUTUBE: QUALITY SELECTOR + VIDEO MP4 + COVER ====================
        const aacAudio = st.aacAudio || null;
        const videoChoices = [];

        for (const v of st.videoOnly || []) {
          const combinedBytes =
            (v.bytes || 0) + (aacAudio ? aacAudio.bytes || 0 : 0);
          videoChoices.push({
            quality: v.quality,
            isMuxed: false,
            videoStream: v,
            audioStream: aacAudio,
            totalBytes: combinedBytes,
            sizeText: combinedBytes ? fmtMb(combinedBytes) : v.size || ''
          });
        }

        if (videoChoices.length === 0 && st.muxed && st.muxed.length > 0) {
          for (const m of st.muxed) {
            videoChoices.push({
              quality: m.quality,
              isMuxed: true,
              videoStream: m,
              audioStream: null,
              totalBytes: m.bytes || 0,
              sizeText: m.size || ''
            });
          }
        }

        if (videoChoices.length > 0) {
          let selectedChoice = videoChoices[0];

          const qualityWrap = document.createElement('div');
          Object.assign(qualityWrap.style, {
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: '8px',
            padding: '8px 10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px'
          });

          const qHeader = document.createElement('div');
          Object.assign(qHeader.style, {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '11.5px',
            color: '#94a3b8',
            fontWeight: '600'
          });
          const qTitle = document.createElement('span');
          qTitle.textContent = '⚙️ Качество видео:';
          const qActiveLabel = document.createElement('span');
          qActiveLabel.textContent = `${selectedChoice.quality} ${selectedChoice.sizeText ? '• ' + selectedChoice.sizeText : ''}`;
          Object.assign(qActiveLabel.style, {
            color: '#38bdf8',
            fontWeight: '700'
          });
          qHeader.appendChild(qTitle);
          qHeader.appendChild(qActiveLabel);
          qualityWrap.appendChild(qHeader);

          const pillsRow = document.createElement('div');
          Object.assign(pillsRow.style, {
            display: 'flex',
            flexWrap: 'wrap',
            gap: '5px'
          });

          const pillBtns = [];
          let dlBtnRightBadge = null;
          let dlBtnLeftLabel = null;

          for (const choice of videoChoices) {
            const pBtn = document.createElement('button');
            pBtn.type = 'button';
            pBtn.textContent = choice.quality;
            const applyPillStyle = (active) => {
              Object.assign(pBtn.style, {
                background: active ? '#ef4444' : '#0f172a',
                color: active ? '#ffffff' : '#cbd5e1',
                border: active ? '1px solid #f87171' : '1px solid #334155',
                borderRadius: '6px',
                padding: '4px 8px',
                fontSize: '11.5px',
                fontWeight: active ? '700' : '500',
                cursor: 'pointer'
              });
            };
            applyPillStyle(choice === selectedChoice);

            pBtn.addEventListener('click', () => {
              selectedChoice = choice;
              for (const item of pillBtns) {
                item.update(item.choice === selectedChoice);
              }
              qActiveLabel.textContent = `${choice.quality} ${choice.sizeText ? '• ' + choice.sizeText : ''}`;
              if (dlBtnLeftLabel) {
                dlBtnLeftLabel.textContent = `🎬 Скачать видео (${choice.quality})`;
              }
              if (dlBtnRightBadge) {
                dlBtnRightBadge.textContent = `MP4 ${choice.sizeText ? '• ' + choice.sizeText : ''}`;
              }
            });

            pillBtns.push({ choice, update: applyPillStyle });
            pillsRow.appendChild(pBtn);
          }

          qualityWrap.appendChild(pillsRow);
          streamsBox.appendChild(qualityWrap);

          const videoBtn = createActionRow(
            `🎬 Скачать видео (${selectedChoice.quality})`,
            `MP4 ${selectedChoice.sizeText ? '• ' + selectedChoice.sizeText : ''}`,
            'linear-gradient(135deg, #0ea5e9, #0284c7)',
            () => {
              const choice = selectedChoice;
              startBackgroundDownloadJob({
                kind: 'mp4',
                videoId: meta.videoId,
                title: `${meta.author} — ${meta.title}`,
                qualityLabel: choice.quality,
                filename: `${safeFileBase} (${choice.quality}).mp4`,
                isMuxed: choice.isMuxed,
                videoStream: choice.videoStream,
                audioStream: choice.audioStream,
                totalBytes: choice.totalBytes || 0
              });
              closeDownloadPopover();
              showPlayerToast(
                `🎬 Скачивание ${choice.quality} запущено в фоне! (Прогресс в окне расширения)`
              );
            }
          );

          dlBtnLeftLabel = videoBtn.children[0];
          dlBtnRightBadge = videoBtn.children[1];
          streamsBox.appendChild(videoBtn);
        }
      }

      // Cover / Thumbnail Button (shown on both YouTube and YouTube Music)
      streamsBox.appendChild(
        createActionRow(
          '🖼️ Скачать обложку',
          'JPG HD',
          '#1e293b',
          () => {
            const thumbUrl = `https://i.ytimg.com/vi/${meta.videoId}/maxresdefault.jpg`;
            triggerNativeDownload(thumbUrl, `${safeFileBase}_cover.jpg`);
            closeDownloadPopover();
            showPlayerToast('🖼️ Обложка сохраняется в Загрузки...');
          }
        )
      );
    });

    outsideClickHandler = (e) => {
      if (
        downloadModalEl &&
        !downloadModalEl.contains(e.target) &&
        (!anchorBtn || !anchorBtn.contains(e.target))
      ) {
        closeDownloadPopover();
      }
    };
    setTimeout(() => {
      document.addEventListener('mousedown', outsideClickHandler, true);
    }, 50);

    document.body.appendChild(popover);
    downloadModalEl = popover;
  }

  // =========================================================================
  // 6. ENHANCER FOR YOUTUBE: CINEMA DIMMER, VIDEO FILTERS/ROTATE, MINI-PLAYER
  // =========================================================================
  let cinemaDimmerActive = false;
  let cinemaOverlayEl = null;

  function toggleCinemaDimmer() {
    cinemaDimmerActive = !cinemaDimmerActive;
    if (!cinemaOverlayEl) {
      cinemaOverlayEl = document.createElement('div');
      cinemaOverlayEl.id = 'ultiblock-cinema-dimmer';
      Object.assign(cinemaOverlayEl.style, {
        position: 'fixed',
        inset: '0',
        background: 'rgba(0, 0, 0, 0.86)',
        zIndex: '1000',
        pointerEvents: 'none',
        transition: 'opacity 0.25s ease',
        opacity: '0'
      });
      document.body.appendChild(cinemaOverlayEl);
    }

    const playerContainer =
      document.querySelector('#player-container-outer') ||
      document.querySelector('#player-theater-container') ||
      document.querySelector('#movie_player');

    if (cinemaDimmerActive) {
      cinemaOverlayEl.style.opacity = '1';
      if (playerContainer) {
        playerContainer.style.position = 'relative';
        playerContainer.style.zIndex = '1005';
      }
      showPlayerToast('💡 Режим кинотеатра (Затемнение фона) включён');
    } else {
      cinemaOverlayEl.style.opacity = '0';
      if (playerContainer) {
        playerContainer.style.zIndex = '';
      }
      showPlayerToast('💡 Затемнение фона выключено');
    }
    return cinemaDimmerActive;
  }

  // Enhancer Video Transform & Color Filter State
  const videoTransform = {
    rotate: 0,
    flipX: 1,
    flipY: 1,
    brightness: 100,
    contrast: 100,
    saturate: 100
  };
  let enhancerPanelEl = null;

  function applyVideoTransform() {
    const video = document.querySelector('video.html5-main-video, #movie_player video');
    if (!video) return;

    const transforms = [];
    if (videoTransform.rotate !== 0) {
      transforms.push(`rotate(${videoTransform.rotate}deg)`);
      if (videoTransform.rotate % 180 !== 0) {
        transforms.push('scale(0.56)');
      }
    }
    if (videoTransform.flipX !== 1 || videoTransform.flipY !== 1) {
      transforms.push(`scale(${videoTransform.flipX}, ${videoTransform.flipY})`);
    }
    video.style.transform = transforms.join(' ');

    const filters = [];
    if (videoTransform.brightness !== 100) {
      filters.push(`brightness(${videoTransform.brightness}%)`);
    }
    if (videoTransform.contrast !== 100) {
      filters.push(`contrast(${videoTransform.contrast}%)`);
    }
    if (videoTransform.saturate !== 100) {
      filters.push(`saturate(${videoTransform.saturate}%)`);
    }
    video.style.filter = filters.join(' ');
  }

  function toggleEnhancerPopover() {
    if (enhancerPanelEl && document.contains(enhancerPanelEl)) {
      enhancerPanelEl.remove();
      enhancerPanelEl = null;
      return;
    }

    const player = document.getElementById('movie_player');
    if (!player) return;

    const panel = document.createElement('div');
    panel.id = 'ultiblock-enhancer-popover';
    Object.assign(panel.style, {
      position: 'absolute',
      bottom: '64px',
      right: '16px',
      zIndex: '9999',
      width: '270px',
      background: 'rgba(15, 23, 42, 0.95)',
      backdropFilter: 'blur(10px)',
      border: '1px solid #334155',
      borderRadius: '10px',
      padding: '12px',
      color: '#f8fafc',
      fontFamily: 'Roboto, Arial, sans-serif',
      fontSize: '12px',
      boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px'
    });

    const titleRow = document.createElement('div');
    titleRow.textContent = '🎨 Enhancer: Видео-фильтры и поворот';
    Object.assign(titleRow.style, {
      fontWeight: '700',
      borderBottom: '1px solid #1e293b',
      paddingBottom: '6px'
    });
    panel.appendChild(titleRow);

    // Transform buttons row
    const btnRow = document.createElement('div');
    Object.assign(btnRow.style, {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr',
      gap: '5px'
    });

    function makeSmallAction(text, fn) {
      const b = document.createElement('button');
      b.textContent = text;
      Object.assign(b.style, {
        background: '#1e293b',
        border: '1px solid #334155',
        color: '#f8fafc',
        borderRadius: '6px',
        padding: '5px',
        fontSize: '11px',
        cursor: 'pointer'
      });
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
        applyVideoTransform();
      });
      return b;
    }

    btnRow.appendChild(
      makeSmallAction('↻ Поворот 90°', () => {
        videoTransform.rotate = (videoTransform.rotate + 90) % 360;
      })
    );
    btnRow.appendChild(
      makeSmallAction('↔ Зеркало X', () => {
        videoTransform.flipX *= -1;
      })
    );
    btnRow.appendChild(
      makeSmallAction('🔄 Сброс', () => {
        videoTransform.rotate = 0;
        videoTransform.flipX = 1;
        videoTransform.flipY = 1;
        videoTransform.brightness = 100;
        videoTransform.contrast = 100;
        videoTransform.saturate = 100;
        panel.remove();
        enhancerPanelEl = null;
      })
    );
    panel.appendChild(btnRow);

    function makeFilterSlider(label, prop) {
      const wrap = document.createElement('div');
      Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', gap: '2px' });
      const top = document.createElement('div');
      Object.assign(top.style, { display: 'flex', justifyContent: 'space-between', fontSize: '11px' });
      const lSpan = document.createElement('span');
      lSpan.textContent = label;
      const vSpan = document.createElement('span');
      vSpan.textContent = `${videoTransform[prop]}%`;
      top.appendChild(lSpan);
      top.appendChild(vSpan);

      const input = document.createElement('input');
      input.type = 'range';
      input.min = '50';
      input.max = '180';
      input.value = String(videoTransform[prop]);
      input.style.width = '100%';
      input.addEventListener('input', (e) => {
        e.stopPropagation();
        videoTransform[prop] = Number(input.value);
        vSpan.textContent = `${input.value}%`;
        applyVideoTransform();
      });

      wrap.appendChild(top);
      wrap.appendChild(input);
      return wrap;
    }

    panel.appendChild(makeFilterSlider('Яркость видео', 'brightness'));
    panel.appendChild(makeFilterSlider('Контраст видео', 'contrast'));
    panel.appendChild(makeFilterSlider('Насыщенность', 'saturate'));

    panel.addEventListener('click', (e) => e.stopPropagation());
    player.appendChild(panel);
    enhancerPanelEl = panel;
  }

  // Floating Mini-Player on Scroll (Enhancer for YouTube)
  let miniPlayerDismissedForVideo = '';
  let isMiniPlayerPinned = false;

  function handleScrollMiniPlayer() {
    if (isDisabled() || !isYT || !getConfig().miniPlayerOnScroll) {
      if (isMiniPlayerPinned) unpinMiniPlayer();
      return;
    }

    const isWatchPage = location.pathname === '/watch';
    if (!isWatchPage || miniPlayerDismissedForVideo === currentVideoId) {
      if (isMiniPlayerPinned) unpinMiniPlayer();
      return;
    }

    const player = document.getElementById('movie_player');
    if (!player) return;

    if (window.scrollY > 520 && !document.fullscreenElement) {
      if (!isMiniPlayerPinned) {
        isMiniPlayerPinned = true;
        Object.assign(player.style, {
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          width: '380px',
          height: '214px',
          zIndex: '2147483640',
          borderRadius: '10px',
          boxShadow: '0 12px 36px rgba(0,0,0,0.75)',
          border: '1px solid rgba(255,255,255,0.18)',
          overflow: 'hidden'
        });
      }
    } else if (isMiniPlayerPinned) {
      unpinMiniPlayer();
    }
  }

  function unpinMiniPlayer() {
    isMiniPlayerPinned = false;
    const player = document.getElementById('movie_player');
    if (player) {
      Object.assign(player.style, {
        position: '',
        bottom: '',
        right: '',
        width: '',
        height: '',
        zIndex: '',
        borderRadius: '',
        boxShadow: '',
        border: ''
      });
    }
  }

  window.addEventListener('scroll', handleScrollMiniPlayer, { passive: true });

  // Mouse Wheel Volume Control over the video player (Enhancer for YouTube)
  window.addEventListener(
    'wheel',
    (e) => {
      if (isDisabled() || !isYT || !getConfig().wheelVolumeControl) return;
      const target = e.target;
      if (!target || !(target instanceof Element)) return;
      const video = target.closest('#movie_player video, .html5-video-container');
      if (!video) return;

      // Only trigger when cursor is in the right 30% of the video frame so normal page scrolling works on the left/center
      const player = document.getElementById('movie_player');
      if (!player) return;
      const rect = player.getBoundingClientRect();
      if (e.clientX < rect.left + rect.width * 0.7) return;

      e.preventDefault();
      const vidEl = player.querySelector('video');
      if (!vidEl) return;

      const step = e.deltaY < 0 ? 0.05 : -0.05;
      const nextVol = Math.min(1, Math.max(0, Math.round((vidEl.volume + step) * 100) / 100));
      vidEl.volume = nextVol;
      if (nextVol > 0 && vidEl.muted) vidEl.muted = false;
      showPlayerToast(`🔊 Громкость: ${Math.round(nextVol * 100)}%`);
    },
    { passive: false }
  );

  // =========================================================================
  // 7. YT TWEAKS (oeakphpfoaeggagmgphfejmfjbhjfhhh) DYNAMIC STYLESHEET
  // =========================================================================
  let tweaksStyleEl = null;

  function applyYtTweaksStyles() {
    if (!isYT || isDisabled()) {
      if (tweaksStyleEl) tweaksStyleEl.textContent = '';
      return;
    }

    const cfg = getConfig();
    const rules = [];

    if (cfg.hideShorts) {
      rules.push(`
        ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]),
        ytd-reel-shelf-renderer,
        ytd-guide-entry-renderer:has(a[title="Shorts"]),
        ytd-mini-guide-entry-renderer[aria-label="Shorts"],
        ytm-pivot-bar-item-renderer:has(.pivot-shorts) {
          display: none !important;
        }
      `);
    }

    if (cfg.hideEndscreens) {
      rules.push(`
        .ytp-ce-element,
        .ytp-cards-teaser,
        .ytp-Cards-button {
          display: none !important;
        }
      `);
    }

    if (cfg.squareCorners) {
      rules.push(`
        ytd-thumbnail, ytd-thumbnail #thumbnail, #ytd-player, #movie_player,
        ytd-rich-item-renderer #thumbnail {
          border-radius: 0px !important;
        }
      `);
    }

    if (cfg.hideSidebar) {
      rules.push(`
        #secondary.ytd-watch-flexy {
          display: none !important;
        }
      `);
    }

    if (cfg.hideComments) {
      rules.push(`
        ytd-comments#comments {
          display: none !important;
        }
      `);
    }

    const cols = Number(cfg.gridColumns || 0);
    if (cols >= 3 && cols <= 6) {
      rules.push(`
        ytd-rich-grid-renderer {
          --ytd-rich-grid-items-per-row: ${cols} !important;
        }
      `);
    }

    if (!tweaksStyleEl) {
      tweaksStyleEl = document.createElement('style');
      tweaksStyleEl.id = 'ultiblock-yt-tweaks-style';
      (document.head || document.documentElement).appendChild(tweaksStyleEl);
    }

    const combined = rules.join('\n');
    if (tweaksStyleEl.textContent !== combined) {
      tweaksStyleEl.textContent = combined;
    }
  }

  // =========================================================================
  // 8. YOUTUBE PLAYER PREMIUM + ENHANCER TOOLBAR (.ytp-right-controls)
  // =========================================================================
  const SPEED_STEPS = [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

  function takeVideoScreenshot() {
    const video = document.querySelector('video');
    if (!video || !video.videoWidth) return;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const vid = getActiveVideoId() || 'video';
      const sec = Math.floor(video.currentTime || 0);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `YouTube-${vid}-${sec}s-${canvas.width}x${canvas.height}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        showPlayerToast(`📸 Скриншот сохранён (${canvas.width}×${canvas.height})`);
      }, 'image/png');
    } catch (_) {
      showPlayerToast('⚠️ Не удалось сделать скриншот кадра');
    }
  }

  async function togglePiP() {
    const video = document.querySelector('video');
    if (!video) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        showPlayerToast('🖼️ Выход из режима «Картинка в картинке»');
      } else {
        video.removeAttribute('disablepictureinpicture');
        await video.requestPictureInPicture();
        showPlayerToast('🖼️ Режим «Картинка в картинке» включён');
      }
    } catch (_) {}
  }

  function injectYouTubePlayerControls() {
    const cfg = getConfig();
    if (isDisabled() || !isYT || !cfg.playerEnhancements) {
      const existing = document.getElementById('ultiblock-yt-controls');
      if (existing) existing.remove();
      return;
    }

    const existingDlBtn = document.getElementById('ultiblock-yt-dl-btn');
    if (existingDlBtn) {
      existingDlBtn.style.display =
        cfg.showDownloadButtons === false ? 'none' : '';
    }

    const rightControls = document.querySelector('.ytp-right-controls');
    if (!rightControls || document.getElementById('ultiblock-yt-controls')) return;

    const bar = document.createElement('div');
    bar.id = 'ultiblock-yt-controls';
    Object.assign(bar.style, {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      marginRight: '8px',
      height: '100%',
      verticalAlign: 'top'
    });

    function makeBtn(label, title, onClick) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ultiblock-ytp-btn';
      btn.textContent = label;
      btn.title = title;
      Object.assign(btn.style, {
        background: 'rgba(255, 255, 255, 0.14)',
        color: '#ffffff',
        border: '1px solid rgba(255, 255, 255, 0.22)',
        borderRadius: '6px',
        padding: '0 6px',
        height: '25px',
        lineHeight: '23px',
        fontSize: '11px',
        fontWeight: '700',
        fontFamily: 'Roboto, Arial, sans-serif',
        cursor: 'pointer',
        transition: 'background 0.15s ease'
      });
      btn.addEventListener('mouseenter', () => {
        btn.style.background = 'rgba(239, 68, 68, 0.78)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background =
          btn.dataset.active === '1'
            ? 'rgba(239, 68, 68, 0.85)'
            : 'rgba(255, 255, 255, 0.14)';
      });
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick(btn);
      });
      return btn;
    }

    // 1. Download Video / Cover Button (📥)
    const dlBtn = makeBtn(
      '📥 Скачать',
      'Скачать видео (с выбором качества) или обложку',
      () => openDownloadModal()
    );
    dlBtn.id = 'ultiblock-yt-dl-btn';
    dlBtn.style.background = 'rgba(16, 185, 129, 0.35)';
    dlBtn.style.borderColor = 'rgba(16, 185, 129, 0.65)';
    if (cfg.showDownloadButtons === false) {
      dlBtn.style.display = 'none';
    }

    // 2. Speed Button (1x..4x + mouse wheel)
    const speedBtn = makeBtn(
      '1x',
      'Скорость видео (Клик: до 4x, Колёсико: ±0.1x)',
      (btn) => {
        const video = document.querySelector('video');
        if (!video) return;
        const idx = SPEED_STEPS.findIndex(
          (s) => Math.abs(s - video.playbackRate) < 0.05
        );
        const nextSpeed = SPEED_STEPS[(idx + 1) % SPEED_STEPS.length];
        video.playbackRate = nextSpeed;
        btn.textContent = `${nextSpeed}x`;
        btn.dataset.active = nextSpeed !== 1 ? '1' : '0';
        showPlayerToast(`⚡ Скорость воспроизведения: ${nextSpeed}x`);
      }
    );

    speedBtn.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        const video = document.querySelector('video');
        if (!video) return;
        const delta = e.deltaY < 0 ? 0.1 : -0.1;
        const next = Math.min(
          4,
          Math.max(0.25, Math.round((video.playbackRate + delta) * 10) / 10)
        );
        video.playbackRate = next;
        speedBtn.textContent = `${next}x`;
        speedBtn.dataset.active = next !== 1 ? '1' : '0';
        showPlayerToast(`⚡ Скорость воспроизведения: ${next}x`);
      },
      { passive: false }
    );

    // 3. HQ Audio Booster Button
    const audioBtn = makeBtn(
      '🔊 HQ',
      'Улучшение звука (100% -> 150% Studio Bass -> 200% Max)',
      (btn) => {
        const lvl = cycleAudioBoost();
        btn.textContent = lvl === 0 ? '🔊 HQ' : lvl === 1 ? '🔊 150%' : '🔊 200%';
        btn.dataset.active = lvl > 0 ? '1' : '0';
      }
    );

    // 4. Enhancer Video Filters & Rotate Button (🎨)
    const filterBtn = makeBtn(
      '🎨',
      'Enhancer: Видео-фильтры, Поворот 90° и Зеркало',
      () => toggleEnhancerPopover()
    );

    // 5. Enhancer Cinema Dimmer Button (💡)
    const cinemaBtn = makeBtn(
      '💡',
      'Enhancer: Режим кинотеатра (затемнить страницу вокруг плеера)',
      (btn) => {
        const on = toggleCinemaDimmer();
        btn.dataset.active = on ? '1' : '0';
      }
    );

    // 6. Screenshot Button (📸)
    const snapBtn = makeBtn(
      '📸',
      'Скриншот кадра в оригинальном разрешении (4K/1080p)',
      () => takeVideoScreenshot()
    );

    // 7. Picture-in-Picture Button (🖼️)
    const pipBtn = makeBtn(
      '🖼️ PiP',
      'Картинка в картинке (Alt+P)',
      () => togglePiP()
    );

    // 8. Loop Button (🔁)
    const loopBtn = makeBtn('🔁', 'Бесконечный повтор видео (Loop)', (btn) => {
      const video = document.querySelector('video');
      if (!video) return;
      video.loop = !video.loop;
      btn.dataset.active = video.loop ? '1' : '0';
      showPlayerToast(
        video.loop ? '🔁 Повтор видео включён' : '🔁 Повтор видео выключен'
      );
    });

    bar.appendChild(dlBtn);
    bar.appendChild(speedBtn);
    bar.appendChild(audioBtn);
    bar.appendChild(filterBtn);
    bar.appendChild(cinemaBtn);
    bar.appendChild(snapBtn);
    bar.appendChild(pipBtn);
    bar.appendChild(loopBtn);

    rightControls.insertBefore(bar, rightControls.firstChild);
  }

  // =========================================================================
  // 9. YOUTUBE MUSIC PREMIUM CONTROLS + TRACK DOWNLOADER (music.youtube.com)
  // =========================================================================
  let ytMusicAudioOnly = false;

  function injectYouTubeMusicPremiumControls() {
    const cfg = getConfig();
    if (isDisabled() || !isYTMusic || !cfg.ytMusicPremium) {
      const existing = document.getElementById('ultiblock-ytm-controls');
      if (existing) existing.remove();
      return;
    }

    const existingYtmDlBtn = document.getElementById('ultiblock-ytm-dl-btn');
    if (existingYtmDlBtn) {
      existingYtmDlBtn.style.display =
        cfg.showDownloadButtons === false ? 'none' : '';
    }

    const rightControls = document.querySelector(
      'ytmusic-player-bar .right-controls-buttons'
    );
    if (!rightControls || document.getElementById('ultiblock-ytm-controls')) return;

    const wrap = document.createElement('div');
    wrap.id = 'ultiblock-ytm-controls';
    Object.assign(wrap.style, {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      marginRight: '10px'
    });

    function makeYtmBtn(text, title, onClick) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.title = title;
      Object.assign(b.style, {
        background: 'rgba(255, 255, 255, 0.1)',
        color: '#ffffff',
        border: '1px solid rgba(255, 255, 255, 0.2)',
        borderRadius: '14px',
        padding: '4px 10px',
        fontSize: '11px',
        fontWeight: '600',
        cursor: 'pointer'
      });
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('mousedown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick(b);
      });
      return b;
    }

    const dlMusicBtn = makeYtmBtn(
      '📥 Скачать',
      'Скачать музыку (WEBM) или обложку (JPG HD)',
      () => openDownloadModal()
    );
    dlMusicBtn.id = 'ultiblock-ytm-dl-btn';
    dlMusicBtn.style.background = 'rgba(16, 185, 129, 0.3)';
    dlMusicBtn.style.borderColor = 'rgba(16, 185, 129, 0.65)';
    if (cfg.showDownloadButtons === false) {
      dlMusicBtn.style.display = 'none';
    }

    const audioOnlyBtn = makeYtmBtn(
      '🎧 Только аудио',
      'Режим YouTube Music Premium: отключить видеоряд клипа и оставить только звук',
      (btn) => {
        ytMusicAudioOnly = !ytMusicAudioOnly;
        document.documentElement.dataset.ultiblockYtmAudioOnly = ytMusicAudioOnly
          ? 'true'
          : 'false';
        btn.style.background = ytMusicAudioOnly
          ? '#ef4444'
          : 'rgba(255, 255, 255, 0.1)';
        showPlayerToast(
          ytMusicAudioOnly
            ? '🎧 Режим «Только аудио» включён'
            : '🎬 Режим видеоклипа включён'
        );
      }
    );

    const hqSoundBtn = makeYtmBtn(
      '🔊 HQ Studio',
      'Студийный эквалайзер и буст громкости YouTube Music Premium',
      (btn) => {
        const lvl = cycleAudioBoost();
        btn.textContent =
          lvl === 0 ? '🔊 HQ Studio' : lvl === 1 ? '🔊 HQ 150%' : '🔊 HQ 200%';
        btn.style.background =
          lvl > 0 ? '#ef4444' : 'rgba(255, 255, 255, 0.1)';
      }
    );

    wrap.appendChild(dlMusicBtn);
    wrap.appendChild(audioOnlyBtn);
    wrap.appendChild(hqSoundBtn);
    rightControls.insertBefore(wrap, rightControls.firstChild);
  }

  // =========================================================================
  // 10. PREMIUM LOGO BADGE & PERIODIC WATCHER
  // =========================================================================
  function applyPremiumLogoBadge() {
    if (isDisabled() || !getConfig().premiumLogo) return;

    if (isYT) {
      const countryCode = document.querySelector(
        'ytd-topbar-logo-renderer #country-code'
      );
      if (countryCode && countryCode.textContent !== 'PREMIUM') {
        countryCode.textContent = 'PREMIUM';
        Object.assign(countryCode.style, {
          color: '#ef4444',
          fontWeight: '800',
          fontSize: '10px',
          letterSpacing: '0.6px',
          marginLeft: '4px'
        });
      }
    } else if (isYTMusic) {
      const navBar = document.querySelector('ytmusic-nav-bar .left-content');
      if (navBar && !document.getElementById('ultiblock-ytm-premium-badge')) {
        const badge = document.createElement('span');
        badge.id = 'ultiblock-ytm-premium-badge';
        badge.textContent = 'PREMIUM';
        Object.assign(badge.style, {
          background: 'linear-gradient(135deg, #ef4444, #b91c1c)',
          color: '#fff',
          fontSize: '9px',
          fontWeight: '800',
          padding: '2px 6px',
          borderRadius: '4px',
          marginLeft: '6px',
          letterSpacing: '0.6px'
        });
        navBar.appendChild(badge);
      }
    }
  }

  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.code === 'KeyP' && !isDisabled()) {
      e.preventDefault();
      togglePiP();
    }
  });

  setInterval(() => {
    if (isDisabled()) return;

    const vid = getActiveVideoId();
    if (vid && vid !== currentVideoId) {
      currentVideoId = vid;
      qualityAppliedForVideoId = '';
      currentSegments = [];
      currentDislikes = null;
      lastSkippedUUID = '';

      const cfg = getConfig();
      window.postMessage(
        {
          __ultiblock: true,
          type: 'ULTIBLOCK_YT_VIDEO_CHANGE',
          videoId: vid,
          needSponsor: cfg.sponsorBlock,
          needDislikes: cfg.returnDislikes
        },
        '*'
      );
    }

    checkSponsorSegments();
    applyAutoMaxQuality();
    applyYtTweaksStyles();
    injectYouTubePlayerControls();
    injectYouTubeMusicPremiumControls();
    applyPremiumLogoBadge();

    if (currentDislikes && getConfig().returnDislikes) {
      renderDislikeCount(currentDislikes);
    }
  }, 350);
})();
