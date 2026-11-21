/**
 * UltiBlock Pro — Universal Media Downloader (Google Images, Search, Videos, Photos & YouTube Bridge)
 * Runs in ISOLATED world.
 * Provides:
 * 1. Floating "📥 Скачать" button when hovering over images (>=130x130) or videos on Google Search/Images & websites
 * 2. Smart extraction of original full-resolution URLs on Google Images (imgurl parameter / srcset)
 * 3. Bridges YouTube & YouTube Music download requests to background Service Worker (chrome.downloads)
 */
(function () {
  'use strict';

  if (window.__ultiblockMediaDownloaderInjected) return;
  window.__ultiblockMediaDownloaderInjected = true;

  const hostname = (location.hostname || '').toLowerCase().replace(/^www\./, '');
  const isYouTube =
    hostname.includes('youtube.com') || hostname === 'youtu.be';

  let hoverBtn = null;
  let currentMediaTarget = null;
  let hideBtnTimer = null;
  let hoverDownloaderEnabled = true;

  try {
    if (localStorage.getItem('__ub_site_disabled') === '1' || localStorage.getItem('__ub_dl_disabled') === '1') {
      hoverDownloaderEnabled = false;
    }
  } catch (_) {}

  function syncDownloaderState(res) {
    const extEnabled = res.enabled !== undefined ? res.enabled : true;
    const disabledDomains = Array.isArray(res.disabledDomains) ? res.disabledDomains : [];
    const disabledDlDomains = Array.isArray(res.disabledDownloaderDomains)
      ? res.disabledDownloaderDomains
      : [];
    const siteDisabled = disabledDomains.includes(hostname);
    const dlSiteDisabled = disabledDlDomains.includes(hostname);
    const globalDl = res.hoverDownloader !== undefined ? res.hoverDownloader : true;

    hoverDownloaderEnabled = extEnabled && !siteDisabled && globalDl && !dlSiteDisabled;

    try {
      if (dlSiteDisabled) {
        localStorage.setItem('__ub_dl_disabled', '1');
      } else {
        localStorage.removeItem('__ub_dl_disabled');
      }
    } catch (_) {}

    if (!hoverDownloaderEnabled && hoverBtn) {
      hoverBtn.style.display = 'none';
    }
  }

  chrome.storage.local.get(
    ['enabled', 'hoverDownloader', 'disabledDomains', 'disabledDownloaderDomains'],
    syncDownloaderState
  );

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.activeDownloads) {
        window.postMessage(
          {
            __ultiblock: true,
            type: 'ULTIBLOCK_DOWNLOADS_UPDATED',
            downloads: changes.activeDownloads.newValue || []
          },
          '*'
        );
      }
      chrome.storage.local.get(
        ['enabled', 'hoverDownloader', 'disabledDomains', 'disabledDownloaderDomains'],
        syncDownloaderState
      );
    }
  });

  // Listen for download triggers from MAIN world (yt_premium.js)
  window.addEventListener('message', (event) => {
    if (
      event.source !== window ||
      !event.data ||
      event.data.__ultiblock !== true
    ) {
      return;
    }

    if (event.data.type === 'ULTIBLOCK_TRIGGER_DOWNLOAD') {
      chrome.runtime.sendMessage({
        type: 'ULTIBLOCK_NATIVE_DOWNLOAD',
        url: event.data.url,
        filename: event.data.filename
      });
    } else if (event.data.type === 'ULTIBLOCK_START_BG_DOWNLOAD') {
      chrome.runtime.sendMessage({
        type: 'ULTIBLOCK_START_BG_DOWNLOAD',
        job: event.data.job
      });
    } else if (event.data.type === 'ULTIBLOCK_CANCEL_BG_DOWNLOAD') {
      chrome.runtime.sendMessage({
        type: 'ULTIBLOCK_CANCEL_BG_DOWNLOAD',
        jobId: event.data.jobId
      });
    } else if (event.data.type === 'ULTIBLOCK_REQUEST_YT_STREAMS') {
      chrome.runtime.sendMessage(
        {
          type: 'ULTIBLOCK_GET_YT_STREAMS',
          videoId: event.data.videoId
        },
        (res) => {
          window.postMessage(
            {
              __ultiblock: true,
              type: 'ULTIBLOCK_YT_STREAMS_RESULT',
              videoId: event.data.videoId,
              ok: Boolean(res && res.ok),
              streams: res ? res.streams : null,
              error: res ? res.error : null
            },
            '*'
          );
        }
      );
    } else if (event.data.type === 'ULTIBLOCK_QUICK_YT_AUDIO') {
      chrome.runtime.sendMessage({
        type: 'ULTIBLOCK_QUICK_YT_AUDIO_DOWNLOAD',
        videoId: event.data.videoId,
        title: event.data.title
      });
    }
  });

  // Extract highest resolution URL from an <img> or <video> (especially on Google Images)
  function extractBestMediaUrl(el) {
    if (!el) return null;

    if (el.tagName === 'VIDEO') {
      const vSrc = el.currentSrc || el.src || '';
      if (vSrc && /^https?:\/\//i.test(vSrc)) return { url: vSrc, ext: 'mp4' };
      const sourceEl = el.querySelector('source[src]');
      if (sourceEl && /^https?:\/\//i.test(sourceEl.src)) {
        return { url: sourceEl.src, ext: 'mp4' };
      }
      return null;
    }

    if (el.tagName === 'IMG') {
      // 1. Check if wrapped in a Google Images link containing ?imgurl=...
      const parentLink = el.closest('a[href]');
      if (parentLink && parentLink.href) {
        try {
          const u = new URL(parentLink.href, location.href);
          const imgurl = u.searchParams.get('imgurl') || u.searchParams.get('mediaurl');
          if (imgurl && /^https?:\/\//i.test(imgurl)) {
            return { url: imgurl, ext: guessImageExt(imgurl) };
          }
        } catch (_) {}
      }

      // 2. Check srcset for highest resolution candidate
      const srcset = el.getAttribute('srcset');
      if (srcset) {
        const candidates = srcset
          .split(',')
          .map((s) => s.trim().split(/\s+/)[0])
          .filter((u) => /^https?:\/\//i.test(u));
        if (candidates.length > 0) {
          const best = candidates[candidates.length - 1];
          return { url: best, ext: guessImageExt(best) };
        }
      }

      // 3. Standard src or data-src / data-iurl
      const src =
        el.currentSrc ||
        el.src ||
        el.getAttribute('data-iurl') ||
        el.getAttribute('data-src') ||
        '';
      if (src && (/^https?:\/\//i.test(src) || /^data:image\//i.test(src))) {
        return { url: src, ext: guessImageExt(src) };
      }
    }

    return null;
  }

  function guessImageExt(url) {
    if (!url) return 'jpg';
    if (url.startsWith('data:image/png')) return 'png';
    if (url.startsWith('data:image/webp')) return 'webp';
    if (url.startsWith('data:image/gif')) return 'gif';
    const m = url.match(/\.(png|jpe?g|webp|gif|svg|avif|mp4|webm)(?:[?#]|$)/i);
    return m ? m[1].toLowerCase() : 'jpg';
  }

  function ensureHoverButton() {
    if (hoverBtn && document.contains(hoverBtn)) return hoverBtn;
    hoverBtn = document.createElement('button');
    hoverBtn.id = 'ultiblock-media-hover-dl';
    hoverBtn.type = 'button';
    hoverBtn.textContent = '📥 Скачать';
    hoverBtn.title = 'Скачать фото/видео в оригинальном качестве (UltiBlock Pro)';
    Object.assign(hoverBtn.style, {
      position: 'fixed',
      zIndex: '2147483645',
      display: 'none',
      background: 'rgba(15, 23, 42, 0.9)',
      backdropFilter: 'blur(6px)',
      color: '#f8fafc',
      border: '1px solid rgba(16, 185, 129, 0.7)',
      borderRadius: '7px',
      padding: '5px 10px',
      fontSize: '11.5px',
      fontWeight: '700',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      cursor: 'pointer',
      boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
      transition: 'transform 0.12s ease, opacity 0.12s ease'
    });

    hoverBtn.addEventListener('mouseenter', () => {
      if (hideBtnTimer) clearTimeout(hideBtnTimer);
      hoverBtn.style.background = '#10b981';
      hoverBtn.style.color = '#052e16';
    });

    hoverBtn.addEventListener('mouseleave', () => {
      hoverBtn.style.background = 'rgba(15, 23, 42, 0.9)';
      hoverBtn.style.color = '#f8fafc';
      hoverBtn.style.display = 'none';
    });

    hoverBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!currentMediaTarget) return;

      const info = extractBestMediaUrl(currentMediaTarget);
      if (!info || !info.url) return;

      const altText = (
        currentMediaTarget.getAttribute('alt') ||
        document.title ||
        'media'
      )
        .replace(/[\\/:*?"<>|]+/g, '_')
        .trim()
        .slice(0, 60);

      const filename = `${altText || 'download'}_${Date.now().toString().slice(-4)}.${info.ext}`;
      chrome.runtime.sendMessage({
        type: 'ULTIBLOCK_NATIVE_DOWNLOAD',
        url: info.url,
        filename
      });

      hoverBtn.textContent = '✅ Сохранено!';
      setTimeout(() => {
        if (hoverBtn) hoverBtn.textContent = '📥 Скачать';
      }, 1400);
    });

    (document.body || document.documentElement).appendChild(hoverBtn);
    return hoverBtn;
  }

  // Hover listener for images & videos on Google Search / Images & random sites
  window.addEventListener(
    'mouseover',
    (e) => {
      if (!hoverDownloaderEnabled || isYouTube) return;
      const target = e.target;
      if (!target || !(target instanceof HTMLElement)) return;
      if (target === hoverBtn) return;

      const media =
        target.tagName === 'IMG' || target.tagName === 'VIDEO'
          ? target
          : target.querySelector
          ? target.querySelector('img, video')
          : null;

      if (!media || (media.tagName !== 'IMG' && media.tagName !== 'VIDEO')) {
        return;
      }

      const rect = media.getBoundingClientRect();
      // Only show on reasonably sized photos/videos (>= 135x135 px), not tiny icons/avatars
      if (rect.width < 135 || rect.height < 135) return;

      const info = extractBestMediaUrl(media);
      if (!info || !info.url) return;

      if (hideBtnTimer) clearTimeout(hideBtnTimer);
      currentMediaTarget = media;
      const btn = ensureHoverButton();
      Object.assign(btn.style, {
        display: 'block',
        top: `${Math.max(8, rect.top + 8)}px`,
        left: `${Math.max(8, rect.left + 8)}px`
      });
    },
    { passive: true }
  );

  window.addEventListener(
    'mouseout',
    (e) => {
      if (!hoverBtn || hoverBtn.style.display === 'none') return;
      if (e.relatedTarget === hoverBtn) return;
      hideBtnTimer = setTimeout(() => {
        if (hoverBtn) hoverBtn.style.display = 'none';
      }, 650);
    },
    { passive: true }
  );

  window.addEventListener(
    'scroll',
    () => {
      if (hoverBtn && hoverBtn.style.display !== 'none') {
        hoverBtn.style.display = 'none';
      }
    },
    { passive: true }
  );
})();
