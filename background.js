/**
 * UltiBlock Pro — Background Service Worker (Manifest V3)
 * Manages:
 * - Static & Dynamic DeclarativeNetRequest (DNR) rulesets
 * - Per-tab & global statistics + extension badge counter
 * - Custom domain blocking & per-site whitelist exceptions
 * - Live Cloud Filter Updater
 * - YouTube Premium & YouTube Music Premium API proxy (SponsorBlock + Return YouTube Dislike)
 * - 100% Native Direct Downloader via YouTube InnerTube (ANDROID_VR) + chrome.downloads
 */

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

const DEFAULT_STATE = {
  enabled: true,
  hoverDownloader: true,
  downloadSpeedLimitMBps: 2.5,
  activeDownloads: [],
  disabledDomains: [],
  disabledDownloaderDomains: [],
  customBlockedDomains: [],
  customSelectors: {},
  cloudRulesCount: 0,
  lastCloudUpdate: null,
  ytPremiumSettings: DEFAULT_YT_PREMIUM,
  darkReaderSettings: DEFAULT_DARK_READER,
  totalStats: {
    network: 0,
    dom: 0,
    youtube: 0,
    popup: 0,
    sponsor: 0
  }
};

const tabCounts = new Map();
const sponsorCache = new Map();
const dislikeCache = new Map();

const ALLOW_RULE_ID = 1000;
const CUSTOM_DOMAIN_RULE_BASE = 2000;
const CLOUD_RULE_BASE = 3000;

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_STATE));
  const merged = {};
  for (const [k, v] of Object.entries(DEFAULT_STATE)) {
    if (stored[k] === undefined) {
      merged[k] = v;
    }
  }
  if (stored.ytPremiumSettings) {
    merged.ytPremiumSettings = {
      ...DEFAULT_YT_PREMIUM,
      ...stored.ytPremiumSettings
    };
  }
  if (stored.darkReaderSettings) {
    merged.darkReaderSettings = {
      ...DEFAULT_DARK_READER,
      ...stored.darkReaderSettings
    };
  }
  if (Object.keys(merged).length > 0) {
    await chrome.storage.local.set(merged);
  }

  try {
    Promise.resolve(chrome.action.setBadgeBackgroundColor({ color: '#ef4444' })).catch(() => {});
    if (chrome.action.setBadgeTextColor) {
      Promise.resolve(chrome.action.setBadgeTextColor({ color: '#ffffff' })).catch(() => {});
    }
  } catch (_) {}

  try {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: 'ultiblock-dl-media',
        title:
          (chrome.i18n && chrome.i18n.getMessage('contextMenuDownload')) ||
          '📥 UltiBlock: Download photo / video / audio directly',
        contexts: ['image', 'video', 'audio']
      });
    });
  } catch (_) {}

  await syncDnrRules();
});

if (chrome.runtime && chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(async () => {
    try {
      Promise.resolve(chrome.action.setBadgeBackgroundColor({ color: '#ef4444' })).catch(() => {});
      if (chrome.action.setBadgeTextColor) {
        Promise.resolve(chrome.action.setBadgeTextColor({ color: '#ffffff' })).catch(() => {});
      }
    } catch (_) {}
    await syncDnrRules();
  });
}

if (chrome.contextMenus && chrome.contextMenus.onClicked) {
  chrome.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId === 'ultiblock-dl-media' && info.srcUrl) {
      let url = info.srcUrl;
      if (info.linkUrl && info.linkUrl.includes('imgurl=')) {
        try {
          const u = new URL(info.linkUrl);
          const orig = u.searchParams.get('imgurl');
          if (orig) url = orig;
        } catch (_) {}
      }
      triggerChromeDownload(url);
    }
  });
}

function sanitizeFilename(name) {
  if (!name || typeof name !== 'string') return '';
  return name
    .replace(/[\\/:*?"<>|~#%&{}+]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

function triggerChromeDownload(url, filename) {
  if (!url || typeof url !== 'string') return;
  const opts = { url, conflictAction: 'uniquify' };
  const cleanName = sanitizeFilename(filename);
  if (cleanName) {
    opts.filename = cleanName;
  }
  try {
    chrome.downloads.download(opts, () => {
      if (chrome.runtime.lastError && opts.filename) {
        delete opts.filename;
        chrome.downloads.download(opts);
      }
    });
  } catch (_) {}
}

function formatBytes(bytes) {
  const b = Number(bytes || 0);
  if (!b || b <= 0) return '';
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} КБ`;
  return `${(b / (1024 * 1024)).toFixed(1)} МБ`;
}

let ytHeaderRulesReady = false;
let cachedVisitorData = '';
let creatingOffscreenPromise = null;
const downloadJobsMap = new Map();

async function ensureOffscreenDocument() {
  if (!chrome.offscreen) return;
  try {
    if (chrome.runtime.getContexts) {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
      });
      if (contexts && contexts.length > 0) return;
    }
  } catch (_) {}

  if (creatingOffscreenPromise) {
    await creatingOffscreenPromise;
    return;
  }

  creatingOffscreenPromise = chrome.offscreen
    .createDocument({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK', 'BLOBS'],
      justification:
        'Background MP3 192kbps encoding and MP4 muxing without interrupting user browsing'
    })
    .catch(() => {})
    .finally(() => {
      creatingOffscreenPromise = null;
    });

  await creatingOffscreenPromise;
}

function syncDownloadsState() {
  const list = Array.from(downloadJobsMap.values()).slice(-15);
  try {
    Promise.resolve(chrome.storage.local.set({ activeDownloads: list })).catch(() => {});
  } catch (_) {}

  const running = list.filter(
    (j) =>
      j.status === 'downloading' ||
      j.status === 'converting' ||
      j.status === 'muxing'
  );
  try {
    if (running.length > 0) {
      const active = running[running.length - 1];
      const pctText = `${Math.max(1, Math.min(99, Math.round(active.progress || 1)))}%`;
      Promise.resolve(chrome.action.setBadgeBackgroundColor({ color: '#0284c7' })).catch(() => {});
      Promise.resolve(chrome.action.setBadgeText({ text: pctText })).catch(() => {});
    } else {
      Promise.resolve(chrome.action.setBadgeBackgroundColor({ color: '#ef4444' })).catch(() => {});
      Promise.resolve(chrome.action.setBadgeText({ text: '' })).catch(() => {});
    }
  } catch (_) {}
}

function handleOffscreenCallback(msg) {
  if (!msg || !msg.type || !msg.jobId) return;

  if (msg.type === 'ULTIBLOCK_OFFSCREEN_PROGRESS') {
    const existing = downloadJobsMap.get(msg.jobId);
    if (existing) {
      if (msg.status) existing.status = msg.status;
      if (typeof msg.progress === 'number') existing.progress = msg.progress;
      if (typeof msg.downloadedBytes === 'number') {
        existing.downloadedBytes = msg.downloadedBytes;
      }
      if (typeof msg.totalBytes === 'number' && msg.totalBytes > 0) {
        existing.totalBytes = msg.totalBytes;
      }
      if (typeof msg.speedBps === 'number') existing.speedBps = msg.speedBps;
      if (msg.stageText) existing.stageText = msg.stageText;
      syncDownloadsState();
    }
  } else if (msg.type === 'ULTIBLOCK_OFFSCREEN_FINISH') {
    const existing = downloadJobsMap.get(msg.jobId);
    if (existing) {
      existing.status = 'completed';
      existing.progress = 100;
      existing.speedBps = 0;
      if (msg.finalBytes) {
        existing.downloadedBytes = msg.finalBytes;
        existing.totalBytes = msg.finalBytes;
      }
      existing.stageText = '✅ Сохранено в Загрузки';
      syncDownloadsState();
    }
    if (msg.blobUrl) {
      triggerChromeDownload(msg.blobUrl, msg.filename);
    }
  }
}

globalThis.__ultiblockBgReceiver = handleOffscreenCallback;

async function ensureYtDownloadHeaderRules() {
  if (ytHeaderRulesReady) return;
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [9901, 9902, 9903],
      addRules: [
        {
          id: 9901,
          priority: 9999,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'origin', operation: 'remove' },
              { header: 'cookie', operation: 'remove' },
              { header: 'referer', operation: 'remove' },
              {
                header: 'user-agent',
                operation: 'set',
                value:
                  'com.google.android.youtube/20.03.35 (Linux; U; Android 14) gzip'
              }
            ]
          },
          condition: {
            urlFilter: '||youtube.com/youtubei/v1/player*ultiblock_dl=android*',
            resourceTypes: ['xmlhttprequest', 'other']
          }
        },
        {
          id: 9903,
          priority: 9999,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'origin', operation: 'remove' },
              { header: 'cookie', operation: 'remove' },
              { header: 'referer', operation: 'remove' },
              {
                header: 'user-agent',
                operation: 'set',
                value:
                  'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15'
              }
            ]
          },
          condition: {
            urlFilter: '||youtube.com/youtubei/v1/player*ultiblock_dl=visionos*',
            resourceTypes: ['xmlhttprequest', 'other']
          }
        },
        {
          id: 9902,
          priority: 9999,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { header: 'origin', operation: 'remove' },
              { header: 'cookie', operation: 'remove' },
              { header: 'referer', operation: 'remove' }
            ]
          },
          condition: {
            urlFilter: '||googlevideo.com/videoplayback*',
            excludedInitiatorDomains: [
              'youtube.com',
              'www.youtube.com',
              'music.youtube.com',
              'm.youtube.com'
            ]
          }
        }
      ]
    });
    ytHeaderRulesReady = true;
  } catch (_) {}
}

/**
 * Queries YouTube's official InnerTube API in two stages:
 * 1. ANDROID (20.03.35) -> obtains trusted visitorData + muxed 360p stream
 * 2. VISIONOS (1.02) + visitorData -> obtains unrestricted adaptiveFormats (c=VISIONOS)
 *    which do NOT enforce 60-second GVS poToken HTTP 403 cutoffs!
 */
async function fetchDirectYouTubeStreams(videoId) {
  await ensureYtDownloadHeaderRules();

  let androidData = null;
  let visionData = null;
  let lastErr = '';

  // Stage 1: ANDROID (for visitorData and muxed 360p format)
  try {
    const resp1 = await fetch(
      'https://www.youtube.com/youtubei/v1/player?prettyPrint=false&ultiblock_dl=android',
      {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          context: {
            client: {
              clientName: 'ANDROID',
              clientVersion: '20.03.35',
              androidSdkVersion: 34,
              osName: 'Android',
              osVersion: '14',
              hl: 'ru',
              gl: 'US'
            }
          }
        })
      }
    );
    if (resp1.ok) {
      const json1 = await resp1.json();
      if (json1 && json1.responseContext && json1.responseContext.visitorData) {
        cachedVisitorData = json1.responseContext.visitorData;
      }
      if (json1 && json1.streamingData) {
        androidData = json1;
      }
    }
  } catch (e) {
    lastErr = String(e);
  }

  // Stage 2: VISIONOS 1.02 + visitorData (for unrestricted adaptiveFormats without 60s HTTP 403!)
  try {
    const vdata =
      (androidData &&
        androidData.responseContext &&
        androidData.responseContext.visitorData) ||
      cachedVisitorData ||
      '';

    const visionHeaders = { 'Content-Type': 'application/json' };
    if (vdata) {
      visionHeaders['X-Goog-Visitor-Id'] = vdata;
    }

    const resp2 = await fetch(
      'https://www.youtube.com/youtubei/v1/player?prettyPrint=false&ultiblock_dl=visionos',
      {
        method: 'POST',
        credentials: 'omit',
        headers: visionHeaders,
        body: JSON.stringify({
          videoId,
          context: {
            client: {
              clientName: 'VISIONOS',
              clientVersion: '1.02',
              deviceMake: 'Apple',
              deviceModel: 'RealityDevice17,1',
              userAgent:
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
              osName: 'visionOS',
              osVersion: '26.5.23O471',
              hl: 'ru',
              gl: 'US',
              ...(vdata ? { visitorData: vdata } : {})
            }
          }
        })
      }
    );
    if (resp2.ok) {
      const json2 = await resp2.json();
      if (
        json2 &&
        json2.streamingData &&
        json2.streamingData.adaptiveFormats &&
        json2.streamingData.adaptiveFormats.length > 0
      ) {
        visionData = json2;
      }
    }
  } catch (e) {
    lastErr = String(e);
  }

  const primaryData = visionData || androidData;
  if (!primaryData || !primaryData.streamingData) {
    throw new Error(lastErr || 'Прямые потоки недоступны');
  }

  const vd =
    (androidData && androidData.videoDetails) ||
    primaryData.videoDetails ||
    {};

  const title = vd.title || `YouTube_${videoId}`;
  const author = vd.author || 'YouTube';

  const muxed = [];
  const rawFormats =
    (androidData &&
      androidData.streamingData &&
      androidData.streamingData.formats) ||
    primaryData.streamingData.formats ||
    [];

  for (const f of rawFormats) {
    if (!f.url) continue;
    const mime = (f.mimeType || 'video/mp4').split(';')[0];
    muxed.push({
      itag: f.itag,
      quality: f.qualityLabel || f.quality || '360p',
      mime,
      ext: mime.includes('webm') ? 'webm' : 'mp4',
      bytes: Number(f.contentLength || 0),
      size: formatBytes(f.contentLength),
      url: f.url
    });
  }

  const webmAudio = [];
  const aacAudio = [];
  const videoOnly = [];

  const adaptiveList =
    (visionData &&
      visionData.streamingData &&
      visionData.streamingData.adaptiveFormats) ||
    (androidData &&
      androidData.streamingData &&
      androidData.streamingData.adaptiveFormats) ||
    [];

  for (const f of adaptiveList) {
    if (!f.url) continue;
    const fullMime = f.mimeType || '';
    const mime = fullMime.split(';')[0];
    if (mime.startsWith('audio/')) {
      const kbps = f.bitrate ? `${Math.round(f.bitrate / 1000)} kbps` : 'HQ';
      const isM4a = mime.includes('mp4');
      const isDefaultAudio =
        !f.audioTrack || f.audioTrack.audioIsDefault !== false;
      const item = {
        itag: f.itag,
        bitrate: f.bitrate || 0,
        isDefaultAudio,
        mime,
        label: isM4a ? `AAC • ${kbps}` : `WEBM • ${kbps}`,
        ext: isM4a ? 'm4a' : 'webm',
        bytes: Number(f.contentLength || 0),
        size: formatBytes(f.contentLength),
        url: f.url
      };
      if (isM4a) {
        aacAudio.push(item);
      } else {
        webmAudio.push(item);
      }
    } else if (
      mime.startsWith('video/mp4') &&
      f.qualityLabel &&
      fullMime.includes('avc1')
    ) {
      videoOnly.push({
        itag: f.itag,
        height: f.height || 0,
        fps: f.fps || 30,
        bitrate: f.bitrate || 0,
        quality: f.qualityLabel,
        mime,
        ext: 'mp4',
        bytes: Number(f.contentLength || 0),
        size: formatBytes(f.contentLength),
        url: f.url
      });
    }
  }

  // Sort WEBM audio (for standalone music download) and AAC audio (for MP4 video muxing)
  const sortAudio = (a, b) => {
    if (a.isDefaultAudio !== b.isDefaultAudio) {
      return a.isDefaultAudio ? -1 : 1;
    }
    return b.bitrate - a.bitrate;
  };
  webmAudio.sort(sortAudio);
  aacAudio.sort(sortAudio);

  // Deduplicate videoOnly by qualityLabel (keep highest bitrate H.264 avc1 per resolution)
  const seenQualities = new Set();
  const uniqueVideoOnly = [];
  videoOnly.sort((a, b) => {
    if (b.height !== a.height) return b.height - a.height;
    return b.bitrate - a.bitrate;
  });
  for (const v of videoOnly) {
    if (!seenQualities.has(v.quality)) {
      seenQualities.add(v.quality);
      uniqueVideoOnly.push(v);
    }
  }

  return {
    videoId,
    title,
    author,
    muxed,
    audio: webmAudio.slice(0, 1),
    aacAudio: aacAudio[0] || null,
    videoOnly: uniqueVideoOnly
  };
}

async function syncDnrRules() {
  const data = await chrome.storage.local.get([
    'enabled',
    'disabledDomains',
    'customBlockedDomains'
  ]);
  const enabled = data.enabled !== undefined ? data.enabled : true;
  const disabledDomains = Array.isArray(data.disabledDomains)
    ? data.disabledDomains
    : [];
  const customBlockedDomains = Array.isArray(data.customBlockedDomains)
    ? data.customBlockedDomains
    : [];

  try {
    if (enabled) {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: ['ads_core', 'annoyances_telemetry'],
        disableRulesetIds: []
      });
    } else {
      await chrome.declarativeNetRequest.updateEnabledRulesets({
        enableRulesetIds: [],
        disableRulesetIds: ['ads_core', 'annoyances_telemetry']
      });
    }
  } catch (err) {
    console.warn('UltiBlock: updateEnabledRulesets error:', err);
  }

  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existingRules
    .filter((r) => (!enabled || r.id < CLOUD_RULE_BASE) && r.id < 9900)
    .map((r) => r.id);

  const addRules = [];

  if (enabled) {
    if (disabledDomains.length > 0) {
      addRules.push({
        id: ALLOW_RULE_ID,
        priority: 10000,
        action: { type: 'allow' },
        condition: {
          initiatorDomains: disabledDomains
        }
      });
    }

    if (customBlockedDomains.length > 0) {
      addRules.push({
        id: CUSTOM_DOMAIN_RULE_BASE,
        priority: 500,
        action: { type: 'block' },
        condition: {
          requestDomains: customBlockedDomains
        }
      });
    }
  }

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds,
      addRules
    });
  } catch (err) {
    console.warn('UltiBlock: updateDynamicRules error:', err);
  }
}

async function updateCloudFilters() {
  const sources = [
    'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=nohtml&showintro=0&mimetype=plaintext'
  ];

  const domainSet = new Set();

  for (const url of sources) {
    try {
      const resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) continue;
      const text = await resp.text();
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim().toLowerCase();
        if (
          line &&
          !line.startsWith('#') &&
          !line.startsWith('!') &&
          /^[a-z0-9.-]+\.[a-z]{2,}$/.test(line)
        ) {
          domainSet.add(line);
        }
      }
    } catch (err) {
      console.warn('UltiBlock cloud fetch failed for', url, err);
    }
  }

  const allDomains = Array.from(domainSet);
  if (allDomains.length === 0) {
    return { ok: false, error: 'Не удалось загрузить внешние списки доменов' };
  }

  const CHUNK_SIZE = 250;
  const cloudRules = [];
  for (let i = 0; i < allDomains.length && cloudRules.length < 100; i += CHUNK_SIZE) {
    const chunk = allDomains.slice(i, i + CHUNK_SIZE);
    cloudRules.push({
      id: CLOUD_RULE_BASE + cloudRules.length,
      priority: 95,
      action: { type: 'block' },
      condition: {
        requestDomains: chunk
      }
    });
  }

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const oldCloudIds = existing
    .filter((r) => r.id >= CLOUD_RULE_BASE && r.id < CLOUD_RULE_BASE + 1000)
    .map((r) => r.id);

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: oldCloudIds,
    addRules: cloudRules
  });

  const nowIso = new Date().toLocaleString('ru-RU');
  await chrome.storage.local.set({
    cloudRulesCount: allDomains.length,
    lastCloudUpdate: nowIso
  });

  return { ok: true, count: allDomains.length, updatedAt: nowIso };
}

async function fetchSponsorSegments(videoId) {
  if (!videoId || typeof videoId !== 'string') return [];
  if (sponsorCache.has(videoId)) return sponsorCache.get(videoId);

  const categories = JSON.stringify([
    'sponsor',
    'selfpromo',
    'interaction',
    'intro',
    'outro',
    'preview',
    'music_offtopic'
  ]);
  const url = `https://sponsor.ajay.app/api/skipSegments?videoID=${encodeURIComponent(
    videoId
  )}&categories=${encodeURIComponent(categories)}`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      sponsorCache.set(videoId, []);
      return [];
    }
    const data = await resp.json();
    const segments = Array.isArray(data)
      ? data.map((item) => ({
          category: item.category,
          segment: item.segment,
          UUID: item.UUID
        }))
      : [];
    if (sponsorCache.size > 300) {
      const firstKey = sponsorCache.keys().next().value;
      sponsorCache.delete(firstKey);
    }
    sponsorCache.set(videoId, segments);
    return segments;
  } catch (_) {
    return [];
  }
}

async function fetchDislikes(videoId) {
  if (!videoId || typeof videoId !== 'string') return null;
  if (dislikeCache.has(videoId)) return dislikeCache.get(videoId);

  const url = `https://returnyoutubedislikeapi.com/votes?videoId=${encodeURIComponent(
    videoId
  )}`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    const result = {
      likes: data.likes || 0,
      dislikes: data.dislikes || 0,
      rating: data.rating || 0,
      viewCount: data.viewCount || 0
    };
    if (dislikeCache.size > 300) {
      const firstKey = dislikeCache.keys().next().value;
      dislikeCache.delete(firstKey);
    }
    dislikeCache.set(videoId, result);
    return result;
  } catch (_) {
    return null;
  }
}

function incrementBadge(tabId, delta = 1) {
  if (typeof tabId !== 'number' || tabId < 0) return;
  const current = (tabCounts.get(tabId) || 0) + delta;
  tabCounts.set(tabId, current);
  const label = current > 999 ? '999+' : String(current);
  chrome.action.setBadgeText({ tabId, text: label }).catch(() => {});
}

if (
  chrome.declarativeNetRequest &&
  chrome.declarativeNetRequest.onRuleMatchedDebug
) {
  chrome.declarativeNetRequest.onRuleMatchedDebug.addListener((info) => {
    if (info.rule && info.request && info.request.tabId >= 0) {
      incrementBadge(info.request.tabId, 1);
      chrome.storage.local.get(['totalStats'], (res) => {
        const stats = res.totalStats || {
          network: 0,
          dom: 0,
          youtube: 0,
          popup: 0,
          sponsor: 0
        };
        stats.network = (stats.network || 0) + 1;
        chrome.storage.local.set({ totalStats: stats });
      });
    }
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  tabCounts.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    tabCounts.set(tabId, 0);
    chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  if (msg.type === 'ULTIBLOCK_RECORD_STATS') {
    const incoming = msg.stats || {};
    const deltaTotal =
      (incoming.network || 0) +
      (incoming.dom || 0) +
      (incoming.youtube || 0) +
      (incoming.popup || 0) +
      (incoming.sponsor || 0);

    if (sender && sender.tab && sender.tab.id >= 0 && deltaTotal > 0) {
      incrementBadge(sender.tab.id, deltaTotal);
    }

    chrome.storage.local.get(['totalStats'], (res) => {
      const stats = res.totalStats || {
        network: 0,
        dom: 0,
        youtube: 0,
        popup: 0,
        sponsor: 0
      };
      stats.network = (stats.network || 0) + (incoming.network || 0);
      stats.dom = (stats.dom || 0) + (incoming.dom || 0);
      stats.youtube =
        (stats.youtube || 0) + (incoming.youtube || 0) + (incoming.sponsor || 0);
      stats.popup = (stats.popup || 0) + (incoming.popup || 0);
      stats.sponsor = (stats.sponsor || 0) + (incoming.sponsor || 0);
      chrome.storage.local.set({ totalStats: stats });
    });

    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'ULTIBLOCK_NATIVE_DOWNLOAD') {
    triggerChromeDownload(msg.url, msg.filename);
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'ULTIBLOCK_START_BG_DOWNLOAD' && msg.job) {
    (async () => {
      await ensureYtDownloadHeaderRules();

      const stored = await chrome.storage.local.get(['downloadSpeedLimitMBps']);
      const speedLimitMBps =
        stored.downloadSpeedLimitMBps !== undefined
          ? Number(stored.downloadSpeedLimitMBps)
          : 2.5;

      const jobId =
        msg.job.id || `dl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const cleanFilename = sanitizeFilename(msg.job.filename || 'media.mp3');

      const jobRecord = {
        id: jobId,
        kind: msg.job.kind,
        videoId: msg.job.videoId || '',
        title: msg.job.title || cleanFilename,
        qualityLabel: msg.job.qualityLabel || '',
        filename: cleanFilename,
        status: 'downloading',
        progress: 1,
        downloadedBytes: 0,
        totalBytes: Number(msg.job.totalBytes) || 0,
        speedBps: 0,
        stageText: 'Подготовка скачивания...',
        createdAt: Date.now()
      };

      downloadJobsMap.set(jobId, jobRecord);
      syncDownloadsState();

      const fullJob = {
        ...msg.job,
        id: jobId,
        filename: cleanFilename,
        speedLimitMBps
      };

      if (
        globalThis.__ultiblockOffscreenEngine &&
        typeof globalThis.__ultiblockOffscreenEngine.startJob === 'function'
      ) {
        globalThis.__ultiblockOffscreenEngine.startJob(fullJob);
      } else {
        await ensureOffscreenDocument();
        chrome.runtime.sendMessage({
          type: 'ULTIBLOCK_OFFSCREEN_START_JOB',
          job: fullJob
        });
      }

      sendResponse({ ok: true, jobId });
    })();
    return true;
  }

  if (
    (msg.type === 'ULTIBLOCK_OFFSCREEN_PROGRESS' ||
      msg.type === 'ULTIBLOCK_OFFSCREEN_FINISH') &&
    msg.jobId
  ) {
    handleOffscreenCallback(msg);
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'ULTIBLOCK_CANCEL_BG_DOWNLOAD' && msg.jobId) {
    const existing = downloadJobsMap.get(msg.jobId);
    if (existing) {
      existing.status = 'cancelled';
      existing.speedBps = 0;
      existing.stageText = 'Отменено пользователем';
      syncDownloadsState();
    }
    if (
      globalThis.__ultiblockOffscreenEngine &&
      typeof globalThis.__ultiblockOffscreenEngine.cancelJob === 'function'
    ) {
      globalThis.__ultiblockOffscreenEngine.cancelJob(msg.jobId);
    } else {
      try {
        Promise.resolve(
          chrome.runtime.sendMessage({
            type: 'ULTIBLOCK_OFFSCREEN_CANCEL_JOB',
            jobId: msg.jobId
          })
        ).catch(() => {});
      } catch (_) {}
    }
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'ULTIBLOCK_CLEAR_FINISHED_DOWNLOADS') {
    for (const [id, j] of downloadJobsMap.entries()) {
      if (
        j.status === 'completed' ||
        j.status === 'cancelled' ||
        j.status === 'error'
      ) {
        downloadJobsMap.delete(id);
      }
    }
    syncDownloadsState();
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'ULTIBLOCK_SET_SPEED_LIMIT') {
    const limit = Number(msg.speedLimitMBps) || 0;
    chrome.storage.local.set({ downloadSpeedLimitMBps: limit });
    if (
      globalThis.__ultiblockOffscreenEngine &&
      typeof globalThis.__ultiblockOffscreenEngine.setSpeedLimit === 'function'
    ) {
      globalThis.__ultiblockOffscreenEngine.setSpeedLimit(limit);
    } else {
      try {
        Promise.resolve(
          chrome.runtime.sendMessage({
            type: 'ULTIBLOCK_OFFSCREEN_SET_SPEED_LIMIT',
            speedLimitMBps: limit
          })
        ).catch(() => {});
      } catch (_) {}
    }
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'ULTIBLOCK_GET_YT_STREAMS') {
    fetchDirectYouTubeStreams(msg.videoId)
      .then((streams) => sendResponse({ ok: true, streams }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === 'ULTIBLOCK_QUICK_YT_AUDIO_DOWNLOAD') {
    fetchDirectYouTubeStreams(msg.videoId)
      .then((streams) => {
        const bestAudio =
          (streams.audio && streams.audio[0]) ||
          (streams.muxed && streams.muxed[0]);
        if (!bestAudio) {
          sendResponse({ ok: false, error: 'Аудиопоток не найден' });
          return;
        }
        const baseName = sanitizeFilename(
          msg.title || `${streams.author} - ${streams.title}`
        ).slice(0, 85);
        triggerChromeDownload(bestAudio.url, `${baseName}.${bestAudio.ext}`);
        sendResponse({ ok: true });
      })
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === 'ULTIBLOCK_FETCH_YT_EXTRAS') {
    const videoId = msg.videoId;
    Promise.all([
      msg.needSponsor ? fetchSponsorSegments(videoId) : Promise.resolve([]),
      msg.needDislikes ? fetchDislikes(videoId) : Promise.resolve(null)
    ])
      .then(([segments, dislikes]) => {
        sendResponse({ ok: true, videoId, segments, dislikes });
      })
      .catch((err) => {
        sendResponse({ ok: false, error: String(err) });
      });
    return true;
  }

  if (msg.type === 'ULTIBLOCK_SYNC_RULES') {
    syncDnrRules().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'ULTIBLOCK_UPDATE_CLOUD_FILTERS') {
    updateCloudFilters()
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (msg.type === 'ULTIBLOCK_GET_TAB_COUNT') {
    const count = tabCounts.get(msg.tabId) || 0;
    sendResponse({ count });
    return false;
  }

  return false;
});
