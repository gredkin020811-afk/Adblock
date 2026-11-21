/**
 * UltiBlock Pro — Background Offscreen Media Engine (v4.1.0)
 * Handles:
 * 1. Discord-Friendly Throttled Sequential Downloading (256 KB chunks + token-bucket speed limiter)
 * 2. Real MP3 192 kbps Conversion via OfflineAudioContext.decodeAudioData + lame.min.js
 * 3. Standard Non-Fragmented MP4 (ftypmp42) Video+Audio Remuxing
 * 4. Persistent background execution (never interrupted by closing popovers, popups, or tabs)
 */
(function () {
  'use strict';

  const activeJobs = new Map(); // jobId -> { abortCtrl }
  let currentSpeedLimitMBps = 2.5; // Default: 2.5 MB/s (anti-bufferbloat for Discord)

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function notifyBackground(msg) {
    if (typeof globalThis.__ultiblockBgReceiver === 'function') {
      try {
        globalThis.__ultiblockBgReceiver(msg);
        return;
      } catch (_) {}
    }
    try {
      chrome.runtime.sendMessage(msg);
    } catch (_) {}
  }

  function sendProgress(jobId, patch) {
    notifyBackground({
      type: 'ULTIBLOCK_OFFSCREEN_PROGRESS',
      jobId,
      ...patch
    });
  }

  // =========================================================================
  // 1. DISCORD-FRIENDLY THROTTLED SEQUENTIAL CHUNK DOWNLOADER
  // =========================================================================
  async function fetchStreamThrottled(url, totalBytes, onChunkProgress, signal) {
    let fileSize = Number(totalBytes) || 0;

    if (!fileSize) {
      const probeUrl = url.includes('?') ? `${url}&range=0-0` : `${url}?range=0-0`;
      const probeResp = await fetch(probeUrl, {
        credentials: 'omit',
        cache: 'no-store',
        signal
      });
      if (!probeResp.ok) {
        throw new Error(`HTTP ${probeResp.status}`);
      }
      const cr = probeResp.headers.get('content-range') || '';
      const m = cr.match(/\/(\d+)/);
      if (m) {
        fileSize = parseInt(m[1], 10);
      }
    }

    if (!fileSize) {
      const resp = await fetch(url, {
        credentials: 'omit',
        cache: 'no-store',
        signal
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = await resp.arrayBuffer();
      const u8 = new Uint8Array(buf);
      if (onChunkProgress) onChunkProgress(u8.byteLength, u8.byteLength, 0);
      return u8;
    }

    // 256 KB chunks prevent TCP bufferbloat so Discord voice/WebSocket packets never lag
    const CHUNK_SIZE = 256 * 1024;
    const out = new Uint8Array(fileSize);
    let offset = 0;
    let speedWindowBytes = 0;
    let speedWindowStart = performance.now();
    let currentSpeedBps = 0;

    while (offset < fileSize) {
      if (signal && signal.aborted) {
        throw new Error('Отменено');
      }

      const end = Math.min(offset + CHUNK_SIZE - 1, fileSize - 1);
      const chunkUrl = url.includes('?')
        ? `${url}&range=${offset}-${end}`
        : `${url}?range=${offset}-${end}`;

      const t0 = performance.now();
      let buf = null;
      let lastErr = null;

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const resp = await fetch(chunkUrl, {
            credentials: 'omit',
            cache: 'no-store',
            signal
          });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          buf = await resp.arrayBuffer();
          break;
        } catch (err) {
          lastErr = err;
          if (signal && signal.aborted) throw err;
          await sleep(250 * (attempt + 1));
        }
      }

      if (!buf) {
        throw lastErr || new Error('Сбой сети');
      }

      const chunkU8 = new Uint8Array(buf);
      if (chunkU8.byteLength === 0) break;

      out.set(chunkU8.subarray(0, Math.min(chunkU8.byteLength, fileSize - offset)), offset);
      offset += chunkU8.byteLength;

      const now = performance.now();
      speedWindowBytes += chunkU8.byteLength;
      const windowElapsedSec = (now - speedWindowStart) / 1000;
      if (windowElapsedSec >= 0.35) {
        currentSpeedBps = Math.round(speedWindowBytes / windowElapsedSec);
        speedWindowBytes = 0;
        speedWindowStart = now;
      }

      if (onChunkProgress) {
        onChunkProgress(Math.min(offset, fileSize), fileSize, currentSpeedBps);
      }

      // Anti-bufferbloat pacing for Discord & smooth browsing
      if (offset < fileSize) {
        const elapsedMs = now - t0;
        const limitMBps = Number(currentSpeedLimitMBps) || 0;
        let delayMs = 35; // Minimum 35ms breathing room between chunks even in Unlimited mode
        if (limitMBps > 0) {
          const targetBytesPerSec = limitMBps * 1024 * 1024;
          const expectedMs = (chunkU8.byteLength / targetBytesPerSec) * 1000;
          delayMs = Math.max(40, Math.round(expectedMs - elapsedMs));
        }
        await sleep(delayMs);
      }
    }

    return out;
  }

  // =========================================================================
  // 2. STANDARD NON-FRAGMENTED MP4 (ftypmp42) BUILDER FROM DASH fMP4
  // =========================================================================
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

    const stscPayload = new Uint8Array(8 + t.chunkSampleCounts.length * 12);
    writeU32(stscPayload, 4, t.chunkSampleCounts.length);
    for (let i = 0; i < t.chunkSampleCounts.length; i++) {
      writeU32(stscPayload, 8 + i * 12, i + 1);
      writeU32(stscPayload, 12 + i * 12, t.chunkSampleCounts[i]);
      writeU32(stscPayload, 16 + i * 12, 1);
    }
    const stscBox = makeMp4Box('stsc', [stscPayload]);

    const stcoPayload = new Uint8Array(8 + chunkOffsets.length * 4);
    writeU32(stcoPayload, 4, chunkOffsets.length);
    for (let i = 0; i < chunkOffsets.length; i++) {
      writeU32(stcoPayload, 8 + i * 4, chunkOffsets[i]);
    }
    const stcoBox = makeMp4Box('stco', [stcoPayload]);

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
    tkhd[11] = 3;
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

  function buildStandardMp4FromFmp4(primaryU8, secondaryAudioU8, primaryIsVideo = true) {
    try {
      const pTrack = parseFmp4Track(primaryU8, primaryIsVideo);
      const aTrack = secondaryAudioU8
        ? parseFmp4Track(secondaryAudioU8, false)
        : null;
      if (!pTrack) return [primaryU8];

      const ftyp = new Uint8Array([
        0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50, 0, 0, 0, 0, 105, 115,
        111, 109, 109, 112, 52, 50
      ]);

      const mvhd = primaryU8.slice(
        pTrack.mvhdBox.pos,
        pTrack.mvhdBox.pos + pTrack.mvhdBox.size
      );
      const mvhdVer = mvhd[8];
      const pDurInMvhd = Math.round(
        (pTrack.totalDuration / pTrack.trackTimescale) * pTrack.mvhdTimescale
      );
      if (mvhdVer === 0) {
        writeU32(mvhd, 24, pDurInMvhd);
      }
      writeU32(mvhd, mvhd.byteLength - 4, aTrack ? 3 : 2);

      const dummyPOffsets = new Array(pTrack.chunkPayloads.length).fill(0);
      const dummyAOffsets = aTrack
        ? new Array(aTrack.chunkPayloads.length).fill(0)
        : [];

      const dummyPTrak = buildTrackTrakBox(
        pTrack,
        1,
        pTrack.mvhdTimescale,
        dummyPOffsets
      );
      const dummyATrak = aTrack
        ? buildTrackTrakBox(aTrack, 2, pTrack.mvhdTimescale, dummyAOffsets)
        : null;
      const dummyMoov = makeMp4Box(
        'moov',
        dummyATrak ? [mvhd, dummyPTrak, dummyATrak] : [mvhd, dummyPTrak]
      );

      let runningOffset = ftyp.byteLength + dummyMoov.byteLength + 8;
      const realPOffsets = [];
      let totalMdatPayload = 0;

      for (const chunk of pTrack.chunkPayloads) {
        realPOffsets.push(runningOffset);
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

      const realPTrak = buildTrackTrakBox(
        pTrack,
        1,
        pTrack.mvhdTimescale,
        realPOffsets
      );
      const realATrak = aTrack
        ? buildTrackTrakBox(aTrack, 2, pTrack.mvhdTimescale, realAOffsets)
        : null;
      const realMoov = makeMp4Box(
        'moov',
        realATrak ? [mvhd, realPTrak, realATrak] : [mvhd, realPTrak]
      );

      const mdatHeader = new Uint8Array(8);
      writeU32(mdatHeader, 0, 8 + totalMdatPayload);
      mdatHeader[4] = 109;
      mdatHeader[5] = 100;
      mdatHeader[6] = 97;
      mdatHeader[7] = 116;

      return [
        ftyp,
        realMoov,
        mdatHeader,
        ...pTrack.chunkPayloads,
        ...(aTrack ? aTrack.chunkPayloads : [])
      ];
    } catch (_) {
      return [primaryU8];
    }
  }

  // =========================================================================
  // 3. REAL MP3 192 KBPS ENCODER (Web Audio decodeAudioData + lame.min.js)
  // =========================================================================
  function floatTo16BitPCM(float32Arr) {
    const out = new Int16Array(float32Arr.length);
    for (let i = 0; i < float32Arr.length; i++) {
      let s = float32Arr[i];
      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }

  async function convertAudioBytesToMp3Blob(u8, isFmp4Aac, onEncodeProgress, signal) {
    let decodeBuffer = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

    // If source is fragmented MP4 AAC (ftypdash), defragment to standard MP4 first so decodeAudioData succeeds
    if (isFmp4Aac) {
      const parts = buildStandardMp4FromFmp4(u8, null, false);
      const blob = new Blob(parts, { type: 'audio/mp4' });
      decodeBuffer = await blob.arrayBuffer();
    }

    const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const offlineCtx = new OfflineCtx(2, 1, 44100);
    const audioBuffer = await offlineCtx.decodeAudioData(decodeBuffer);

    const channels = Math.min(2, audioBuffer.numberOfChannels || 1);
    const sampleRate = audioBuffer.sampleRate || 44100;
    const leftPCM = floatTo16BitPCM(audioBuffer.getChannelData(0));
    const rightPCM =
      channels > 1
        ? floatTo16BitPCM(audioBuffer.getChannelData(1))
        : leftPCM;

    const mp3Encoder = new globalThis.lamejs.Mp3Encoder(channels, sampleRate, 192);
    const mp3Chunks = [];
    const blockSize = 1152 * 24; // ~0.6s per iteration
    const totalSamples = leftPCM.length;

    for (let i = 0; i < totalSamples; i += blockSize) {
      if (signal && signal.aborted) {
        throw new Error('Отменено');
      }
      const leftSub = leftPCM.subarray(i, i + blockSize);
      const rightSub = channels > 1 ? rightPCM.subarray(i, i + blockSize) : undefined;
      const encoded =
        channels > 1
          ? mp3Encoder.encodeBuffer(leftSub, rightSub)
          : mp3Encoder.encodeBuffer(leftSub);
      if (encoded && encoded.length > 0) {
        mp3Chunks.push(new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength));
      }
      if (onEncodeProgress) {
        onEncodeProgress(Math.min(1, (i + blockSize) / totalSamples));
      }
      await sleep(0); // Yield to keep event loop responsive
    }

    const flushed = mp3Encoder.flush();
    if (flushed && flushed.length > 0) {
      mp3Chunks.push(new Uint8Array(flushed.buffer, flushed.byteOffset, flushed.byteLength));
    }

    return new Blob(mp3Chunks, { type: 'audio/mpeg' });
  }

  // =========================================================================
  // 4. BACKGROUND JOB RUNNER
  // =========================================================================
  async function runDownloadJob(job) {
    const jobId = job.id;
    const abortCtrl = new AbortController();
    activeJobs.set(jobId, { abortCtrl });

    if (typeof job.speedLimitMBps === 'number') {
      currentSpeedLimitMBps = job.speedLimitMBps;
    }

    try {
      if (job.kind === 'mp3') {
        const primaryStream = job.audioStream;
        const fallbackAac = job.fallbackAacStream || null;
        if (!primaryStream) {
          throw new Error('Аудиопоток не найден');
        }

        const totalBytes = Number(primaryStream.bytes) || 0;
        sendProgress(jobId, {
          status: 'downloading',
          progress: 1,
          downloadedBytes: 0,
          totalBytes,
          speedBps: 0,
          stageText: 'Скачивание аудио...'
        });

        let lastReport = 0;
        const audioU8 = await fetchStreamThrottled(
          primaryStream.url,
          totalBytes,
          (done, total, speedBps) => {
            const now = Date.now();
            if (now - lastReport < 200 && done < total) return;
            lastReport = now;
            const dlPct = total ? Math.round((done / total) * 80) : 40;
            sendProgress(jobId, {
              status: 'downloading',
              progress: Math.max(1, Math.min(80, dlPct)),
              downloadedBytes: done,
              totalBytes: total,
              speedBps,
              stageText: 'Скачивание аудио...'
            });
          },
          abortCtrl.signal
        );

        sendProgress(jobId, {
          status: 'converting',
          progress: 82,
          downloadedBytes: audioU8.byteLength,
          totalBytes: audioU8.byteLength,
          speedBps: 0,
          stageText: 'Конвертация в MP3 (192 kbps)...'
        });

        let mp3Blob = null;
        const isFmp4 = (primaryStream.mime || '').includes('mp4');
        try {
          mp3Blob = await convertAudioBytesToMp3Blob(
            audioU8,
            isFmp4,
            (ratio) => {
              const pct = 82 + Math.round(ratio * 17);
              sendProgress(jobId, {
                status: 'converting',
                progress: Math.min(99, pct),
                downloadedBytes: audioU8.byteLength,
                totalBytes: audioU8.byteLength,
                speedBps: 0,
                stageText: `Конвертация в MP3: ${Math.round(ratio * 100)}%`
              });
            },
            abortCtrl.signal
          );
        } catch (decodeErr) {
          if (abortCtrl.signal.aborted) throw decodeErr;
          if (fallbackAac && fallbackAac.url !== primaryStream.url) {
            const aacU8 = await fetchStreamThrottled(
              fallbackAac.url,
              fallbackAac.bytes || 0,
              null,
              abortCtrl.signal
            );
            mp3Blob = await convertAudioBytesToMp3Blob(
              aacU8,
              true,
              (ratio) => {
                const pct = 82 + Math.round(ratio * 17);
                sendProgress(jobId, {
                  status: 'converting',
                  progress: Math.min(99, pct),
                  stageText: `Конвертация в MP3: ${Math.round(ratio * 100)}%`
                });
              },
              abortCtrl.signal
            );
          } else {
            throw decodeErr;
          }
        }

        const blobUrl = URL.createObjectURL(mp3Blob);
        setTimeout(() => {
          try {
            URL.revokeObjectURL(blobUrl);
          } catch (_) {}
        }, 120000);

        notifyBackground({
          type: 'ULTIBLOCK_OFFSCREEN_FINISH',
          jobId,
          blobUrl,
          filename: job.filename,
          finalBytes: mp3Blob.size
        });
      } else if (job.kind === 'mp4') {
        const vStream = job.videoStream;
        const aStream = job.isMuxed ? null : job.audioStream;
        if (!vStream) {
          throw new Error('Видеопоток не найден');
        }

        const vTotal = Number(vStream.bytes) || 0;
        const aTotal = aStream ? Number(aStream.bytes) || 0 : 0;
        const grandTotal = vTotal + aTotal;

        sendProgress(jobId, {
          status: 'downloading',
          progress: 1,
          downloadedBytes: 0,
          totalBytes: grandTotal,
          speedBps: 0,
          stageText: `Скачивание видео (${job.qualityLabel})...`
        });

        let lastReport = 0;
        // Step 1: Download video sequentially (never in parallel with audio -> zero Discord lag!)
        const videoU8 = await fetchStreamThrottled(
          vStream.url,
          vTotal,
          (done, total, speedBps) => {
            const now = Date.now();
            if (now - lastReport < 200 && done < total) return;
            lastReport = now;
            const totalExpected = grandTotal || total;
            const pct = totalExpected
              ? Math.round((done / totalExpected) * 94)
              : 45;
            sendProgress(jobId, {
              status: 'downloading',
              progress: Math.max(1, Math.min(94, pct)),
              downloadedBytes: done,
              totalBytes: totalExpected,
              speedBps,
              stageText: `Скачивание видео (${job.qualityLabel})...`
            });
          },
          abortCtrl.signal
        );

        // Step 2: Download audio sequentially if adaptive stream
        let audioU8 = null;
        if (aStream) {
          audioU8 = await fetchStreamThrottled(
            aStream.url,
            aTotal,
            (done, total, speedBps) => {
              const now = Date.now();
              if (now - lastReport < 200 && done < total) return;
              lastReport = now;
              const combinedDone = videoU8.byteLength + done;
              const combinedTotal = videoU8.byteLength + (total || aTotal);
              const pct = combinedTotal
                ? Math.round((combinedDone / combinedTotal) * 94)
                : 90;
              sendProgress(jobId, {
                status: 'downloading',
                progress: Math.max(1, Math.min(95, pct)),
                downloadedBytes: combinedDone,
                totalBytes: combinedTotal,
                speedBps,
                stageText: 'Скачивание аудиодорожки...'
              });
            },
            abortCtrl.signal
          );
        }

        sendProgress(jobId, {
          status: 'muxing',
          progress: 97,
          downloadedBytes: videoU8.byteLength + (audioU8 ? audioU8.byteLength : 0),
          totalBytes: videoU8.byteLength + (audioU8 ? audioU8.byteLength : 0),
          speedBps: 0,
          stageText: 'Сборка MP4 со звуком...'
        });

        await sleep(20);
        const mp4Parts =
          !job.isMuxed && audioU8
            ? buildStandardMp4FromFmp4(videoU8, audioU8, true)
            : [videoU8];

        const mp4Blob = new Blob(mp4Parts, { type: 'video/mp4' });
        const blobUrl = URL.createObjectURL(mp4Blob);
        setTimeout(() => {
          try {
            URL.revokeObjectURL(blobUrl);
          } catch (_) {}
        }, 120000);

        notifyBackground({
          type: 'ULTIBLOCK_OFFSCREEN_FINISH',
          jobId,
          blobUrl,
          filename: job.filename,
          finalBytes: mp4Blob.size
        });
      }
    } catch (err) {
      const isCancelled = abortCtrl.signal.aborted;
      sendProgress(jobId, {
        status: isCancelled ? 'cancelled' : 'error',
        progress: 0,
        speedBps: 0,
        stageText: isCancelled
          ? 'Загрузка отменена'
          : `Ошибка: ${err && err.message ? err.message : String(err)}`
      });
    } finally {
      activeJobs.delete(jobId);
    }
  }

  // Expose direct in-context API for Firefox Background Event Page / fallback mode
  globalThis.__ultiblockOffscreenEngine = {
    startJob(job) {
      runDownloadJob(job);
    },
    cancelJob(jobId) {
      const entry = activeJobs.get(jobId);
      if (entry && entry.abortCtrl) {
        entry.abortCtrl.abort();
      }
      activeJobs.delete(jobId);
    },
    setSpeedLimit(speedLimitMBps) {
      currentSpeedLimitMBps = Number(speedLimitMBps) || 0;
    }
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || !msg.type) return false;

    if (msg.type === 'ULTIBLOCK_OFFSCREEN_START_JOB' && msg.job) {
      runDownloadJob(msg.job);
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === 'ULTIBLOCK_OFFSCREEN_CANCEL_JOB' && msg.jobId) {
      const entry = activeJobs.get(msg.jobId);
      if (entry && entry.abortCtrl) {
        entry.abortCtrl.abort();
      }
      activeJobs.delete(msg.jobId);
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === 'ULTIBLOCK_OFFSCREEN_SET_SPEED_LIMIT') {
      currentSpeedLimitMBps = Number(msg.speedLimitMBps) || 0;
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });
})();
