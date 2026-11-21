# 🛡️ UltiBlock Pro 5-en-1 (v1.0)

<p align="center">
  <a href="README.md">🇺🇸 English</a> | <a href="README.ru.md">🇷🇺 Русский</a> | <b>🇪🇸 Español</b>
</p>

**UltiBlock Pro** es una extensión todo-en-uno (Manifest V3) que combina bloqueador de anuncios, mejoras para YouTube y YouTube Music, modo oscuro inteligente y descargador integrado de video, MP3 y fotos.

---

## ✨ Características principales

1. **🛡️ Bloqueador de anuncios y rastreadores**
   - Reglas de red DNR, filtrado cosmético y selector interactivo de elementos.
   - Bloqueo de anuncios en video, popups, telemetría y avisos anti-adblock.
   - Lista blanca por sitio, lista negra de dominios y base en la nube (+3,500 servidores).
2. **▶️ YouTube & YouTube Music Premium**
   - Reproducción en segundo plano sin pausas de «¿Sigues viendo?».
   - **SponsorBlock** integrado (salta patrocinios, intros y outros automáticamente).
   - **Return YouTube Dislike** para ver los «No me gusta» reales.
   - Calidad máxima automática (4K / 1080p60), amplificador HQ 200%, velocidad hasta 4x, captura de fotograma, PiP (`Alt + P`), bucle y modo «Solo audio» en YT Music.
3. **🛠 Enhancer for YouTube y YT Tweaks**
   - Mini-reproductor flotante, volumen con la rueda del ratón, modo cine, filtros de video.
   - Ocultar YouTube Shorts, pantallas finales, barra lateral, comentarios y personalizar columnas en Inicio (4/5/6).
4. **🌙 Smart Dark Reader (Modo Oscuro Inteligente)**
   - Motores **Smart DOM** y **GPU Filter** (120 FPS), 4 paletas (Midnight, Carbon, True OLED, Warm), control de brillo/contraste/calidez y atajo `Alt + D`.
5. **📥 Descargador multimedia integrado**
   - Descarga videos de YouTube, pistas de YouTube Music (MP3 / WEBM) e imágenes/videos web en segundo plano con limitador de velocidad.

---

## 🌍 Idiomas soportados

Detecta automáticamente el idioma del navegador y permite cambiarlo al instante desde el menú superior:

`English (en)` · `Русский (ru)` · `Español (es)` · `Deutsch (de)` · `Français (fr)` · `Português (pt_BR)` · `简体中文 (zh_CN)` · `Українська (uk)`

---

## 🚀 Guía de instalación por navegador

Descarga el proyecto (**Code → Download ZIP**) y extráelo en una carpeta permanente (no la borres después de instalar).

### 1. Google Chrome
1. Abre `chrome://extensions/`.
2. Activa el **Modo de desarrollador** (esquina superior derecha).
3. Haz clic en **Cargar descomprimida**.
4. Selecciona la carpeta del proyecto (o `dist/yandex-opera-edge-chrome`).

### 2. Microsoft Edge
1. Abre `edge://extensions/`.
2. Activa el **Modo de desarrollador** (panel izquierdo).
3. Haz clic en **Cargar descomprimida** y selecciona la carpeta de la extensión.

### 3. Yandex Browser
1. Abre `browser://extensions/`.
2. Activa el **Modo de desarrollador** (arriba a la derecha).
3. Haz clic en **Cargar extensión descomprimida** y elige la carpeta.

### 4. Opera / Opera GX
1. Abre `opera://extensions/`.
2. Activa el **Modo de desarrollador**.
3. Haz clic en **Cargar descomprimida** y selecciona la carpeta.
4. *(Recomendado)* Desactiva el bloqueador nativo de Opera en YouTube para evitar conflictos.

### 5. Brave / Vivaldi / Arc
1. Abre `chrome://extensions/` (o `brave://extensions/` / `vivaldi://extensions/`).
2. Activa el **Modo de desarrollador** → **Cargar descomprimida** y elige la carpeta.

### 6. Mozilla Firefox (Gecko MV3)
> Ejecuta `node build-ports.js` (o usa `dist/firefox/` de Releases).

- **Instalación temporal:** abre `about:debugging#/runtime/this-firefox` → **Cargar complemento temporal...** → elige `dist/firefox/manifest.json`.
- **Instalación permanente (Developer Edition / Nightly / LibreWolf / Floorp):** en `about:config` pon `xpinstall.signatures.required = false`, luego en `about:addons` → ⚙️ → **Instalar complemento desde archivo...** → `dist/ultiblock-pro-firefox.xpi`.

---

## 🛠️ Compilar paquetes localmente

```bash
node build-ports.js
```

---

## 📄 Licencia

Licencia **MIT**. Consulta [LICENSE](LICENSE).
