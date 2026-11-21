/**
 * UltiBlock Pro — Cross-Browser Porting & Packaging Script
 * Generates ready-to-load folders and archives in ./dist/:
 * 1. dist/yandex-opera-edge-chrome/ (+ ultiblock-pro-chromium.zip) -> Yandex Browser, Opera/GX, Edge, Chrome
 * 2. dist/firefox/ (+ ultiblock-pro-firefox.zip & ultiblock-pro-firefox.xpi) -> Mozilla Firefox (Gecko MV3)
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

const FILES_TO_COPY = [
  'background.js',
  'offscreen.html',
  'offscreen.js',
  'lib/lame.min.js',
  'popup/popup.html',
  'popup/popup.css',
  'popup/i18n.js',
  'popup/popup.js',
  'content/stealth_main.js',
  'content/yt_premium.js',
  'content/blocker_isolated.js',
  'content/cosmetic.css',
  'content/dark_engine.js',
  'content/media_downloader.js',
  'rules/ads_core.json',
  'rules/annoyances_telemetry.json'
];

function copyFileEnsureDir(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDirRecursive(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function buildPorts() {
  if (fs.existsSync(DIST)) {
    fs.rmSync(DIST, { recursive: true, force: true });
  }
  fs.mkdirSync(DIST, { recursive: true });

  const baseManifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')
  );

  // =========================================================================
  // 1. CHROMIUM PORT (Yandex Browser, Opera / Opera GX, Microsoft Edge, Chrome)
  // =========================================================================
  const chromiumDir = path.join(DIST, 'yandex-opera-edge-chrome');
  fs.mkdirSync(chromiumDir, { recursive: true });

  for (const rel of FILES_TO_COPY) {
    copyFileEnsureDir(path.join(ROOT, rel), path.join(chromiumDir, rel));
  }
  copyDirRecursive(path.join(ROOT, '_locales'), path.join(chromiumDir, '_locales'));

  const chromiumManifest = {
    ...baseManifest,
    minimum_chrome_version: '109'
  };
  fs.writeFileSync(
    path.join(chromiumDir, 'manifest.json'),
    JSON.stringify(chromiumManifest, null, 2),
    'utf8'
  );

  // =========================================================================
  // 2. MOZILLA FIREFOX PORT (Gecko Manifest V3)
  // =========================================================================
  const firefoxDir = path.join(DIST, 'firefox');
  fs.mkdirSync(firefoxDir, { recursive: true });

  for (const rel of FILES_TO_COPY) {
    copyFileEnsureDir(path.join(ROOT, rel), path.join(firefoxDir, rel));
  }
  copyDirRecursive(path.join(ROOT, '_locales'), path.join(firefoxDir, '_locales'));

  const firefoxManifest = {
    manifest_version: 3,
    default_locale: baseManifest.default_locale || 'en',
    name: baseManifest.name,
    version: baseManifest.version,
    description: baseManifest.description,
    browser_specific_settings: {
      gecko: {
        id: 'ultiblock-pro@ultiblock.local',
        strict_min_version: '115.0'
      }
    },
    permissions: [
      'declarativeNetRequest',
      'declarativeNetRequestWithHostAccess',
      'storage',
      'activeTab',
      'scripting',
      'tabs',
      'downloads',
      'contextMenus'
    ],
    host_permissions: ['<all_urls>'],
    background: {
      scripts: ['lib/lame.min.js', 'offscreen.js', 'background.js']
    },
    action: baseManifest.action,
    declarative_net_request: baseManifest.declarative_net_request,
    content_scripts: [
      {
        matches: ['<all_urls>'],
        js: ['content/stealth_main.js'],
        run_at: 'document_start',
        world: 'MAIN',
        all_frames: true
      },
      {
        matches: ['*://*.youtube.com/*', '*://youtu.be/*'],
        js: ['content/yt_premium.js'],
        run_at: 'document_start',
        world: 'MAIN',
        all_frames: false
      },
      {
        matches: ['<all_urls>'],
        css: ['content/cosmetic.css'],
        js: ['content/blocker_isolated.js'],
        run_at: 'document_start',
        all_frames: true
      },
      {
        matches: ['<all_urls>'],
        js: ['content/dark_engine.js', 'content/media_downloader.js'],
        run_at: 'document_start',
        all_frames: false
      }
    ],
    web_accessible_resources: baseManifest.web_accessible_resources
  };

  fs.writeFileSync(
    path.join(firefoxDir, 'manifest.json'),
    JSON.stringify(firefoxManifest, null, 2),
    'utf8'
  );

  // Create ZIP & XPI archives (supports Linux/macOS zip and Windows PowerShell)
  const chromiumZip = path.join(DIST, 'ultiblock-pro-yandex-opera-edge-chrome.zip');
  const firefoxZip = path.join(DIST, 'ultiblock-pro-firefox.zip');
  const firefoxXpi = path.join(DIST, 'ultiblock-pro-firefox.xpi');

  try {
    if (process.platform === 'win32') {
      execSync(
        `powershell -NoProfile -Command "Compress-Archive -Path '${chromiumDir}\\*' -DestinationPath '${chromiumZip}' -Force"`
      );
      execSync(
        `powershell -NoProfile -Command "Compress-Archive -Path '${firefoxDir}\\*' -DestinationPath '${firefoxZip}' -Force"`
      );
    } else {
      execSync(`cd "${chromiumDir}" && zip -rq "${chromiumZip}" .`);
      execSync(`cd "${firefoxDir}" && zip -rq "${firefoxZip}" .`);
    }
    fs.copyFileSync(firefoxZip, firefoxXpi);
  } catch (e) {
    console.warn('Archive creation warning:', e.message);
  }

  console.log('Successfully built all browser ports in:', DIST);
}

buildPorts();
