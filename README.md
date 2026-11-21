# 🛡️ UltiBlock Pro 5-in-1 (v1.0)

<p align="center">
  <b>English</b> | <a href="README.ru.md">🇷🇺 Русский</a> | <a href="README.es.md">🇪🇸 Español</a>
</p>

**UltiBlock Pro** is an all-in-one Manifest V3 browser extension combining an ad blocker, YouTube & YouTube Music enhancements, a smart dark theme engine, and a built-in media downloader.

---

## ✨ Key Features

1. **🛡️ Ad & Tracker Blocker (DNR + Cosmetic + Stealth)**
   - Declarative Net Request (DNR) network rules + cosmetic filtering + interactive Element Picker.
   - Blocks video pre-rolls, popunders, telemetry, and annoying overlays.
   - Per-site whitelist, custom domain blacklist, and one-click cloud filter list update (+3,500 ad domains).
2. **▶️ YouTube & YouTube Music Premium Suite**
   - Background playback & anti-idle ("Are you still watching?" bypass).
   - Built-in **SponsorBlock** (auto-skip sponsors, intros, outros, self-promo).
   - **Return YouTube Dislike** integration.
   - Auto max quality (4K / 1080p60), HQ 200% Studio Audio Booster, 1x–4x speed control, frame screenshot, PiP (`Alt + P`), Loop.
   - YouTube Music "Audio-only" mode.
3. **🛠 Enhancer for YouTube & YT Tweaks**
   - Floating mini-player when scrolling comments, mouse-wheel volume control, cinema dimmer, video filters/rotate.
   - Hide YouTube Shorts, hide end-screens, hide sidebar/comments, square corners, custom Home grid columns (4/5/6).
4. **🌙 Smart Dark Reader**
   - Two rendering engines: **Smart DOM** (preserves photos & colors) and **GPU Filter** (120 FPS).
   - 4 built-in palettes: Midnight, Carbon, True OLED, Warm.
   - Brightness, contrast, eye-care warmth sliders, auto-skip for native dark sites, hotkey `Alt + D`.
5. **📥 Built-in Media Downloader**
   - Download YouTube videos (with audio muxing), YouTube Music tracks (MP3 / WEBM), and web images/videos directly in the background with anti-lag speed limiter.

---

## 🌍 Supported Languages

UltiBlock Pro automatically detects your browser language and also lets you switch languages anytime from the popup header:

| Code | Language |
| :--- | :--- |
| `en` | English (Default) |
| `ru` | Русский (Russian) |
| `es` | Español (Spanish) |
| `de` | Deutsch (German) |
| `fr` | Français (French) |
| `pt_BR` | Português (Brasil) |
| `zh_CN` | 简体中文 (Chinese Simplified) |
| `uk` | Українська (Ukrainian) |

---

## 🚀 Installation Guide (All Browsers)

First, download the project:
- Click **Code → Download ZIP** on GitHub and extract the archive to a permanent folder (e.g., `Documents/universal-adblock`), **or** download the ready-made browser port from **Releases** (or build it locally with `node build-ports.js`).

> **Important:** Do not delete the extracted folder after installing in Developer Mode — the browser loads the extension directly from that folder.

### 1. Google Chrome
1. Open `chrome://extensions/` in the address bar.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Select the extracted extension folder (root folder or `dist/yandex-opera-edge-chrome`).
5. Pin **UltiBlock Pro** from the puzzle icon 🧩 in the toolbar.

### 2. Microsoft Edge
1. Open `edge://extensions/` in the address bar.
2. Enable **Developer mode** (left sidebar toggle).
3. Click **Load unpacked**.
4. Select the extracted extension folder (root folder or `dist/yandex-opera-edge-chrome`).

### 3. Yandex Browser
1. Open `browser://extensions/` in the address bar.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked extension**.
4. Select the extracted extension folder (root folder or `dist/yandex-opera-edge-chrome`).

### 4. Opera / Opera GX
1. Open `opera://extensions/` in the address bar.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select the extracted extension folder (root folder or `dist/yandex-opera-edge-chrome`).
5. *(Recommended)* Disable Opera's built-in ad blocker on YouTube to avoid conflicts.

### 5. Brave / Vivaldi / Arc (Other Chromium Browsers)
1. Open `chrome://extensions/` (or `brave://extensions/` / `vivaldi://extensions/`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and choose the extracted extension folder.
4. *(For Brave)* Set Brave Shields to "Allow ads" on YouTube if you want UltiBlock Pro to handle YouTube exclusively.

### 6. Mozilla Firefox (Gecko MV3)
> First run `node build-ports.js` (or use `dist/firefox/` from Releases) so you have the Firefox-compatible `manifest.json`.

**Temporary install (Standard Firefox):**
1. Open `about:debugging#/runtime/this-firefox` in the address bar.
2. Click **Load Temporary Add-on...**
3. Select `dist/firefox/manifest.json`.

**Permanent install (Firefox Developer Edition / Nightly / Waterfox / Floorp / LibreWolf):**
1. Open `about:config`, search for `xpinstall.signatures.required`, and set it to `false`.
2. Open `about:addons` → gear icon ⚙️ → **Install Add-on From File...**
3. Select `dist/ultiblock-pro-firefox.xpi`.

---

## ⌨️ Hotkeys

| Shortcut | Action |
| :--- | :--- |
| `Alt + D` | Toggle Smart Dark Reader on the current site |
| `Alt + P` | Toggle Picture-in-Picture (PiP) on YouTube |
| `Esc` | Cancel Element Picker mode |

---

## 🛠️ Building Browser Ports Locally

Requires [Node.js](https://nodejs.org/):

```bash
node build-ports.js
```

This generates ready-to-load folders and archives inside `dist/`:
- `dist/yandex-opera-edge-chrome/` + `ultiblock-pro-yandex-opera-edge-chrome.zip`
- `dist/firefox/` + `ultiblock-pro-firefox.zip` + `ultiblock-pro-firefox.xpi`

---

## 📄 License

Distributed under the **MIT License**. See [LICENSE](LICENSE) for details.
