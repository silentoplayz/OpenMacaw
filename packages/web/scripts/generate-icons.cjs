#!/usr/bin/env node
/**
 * generate-icons.cjs
 *
 * Generates PNG PWA icons using only Node.js built-ins (zlib + fs).
 * No external dependencies required.
 *
 * Output:
 *   public/icons/icon-192.png    — standard 192×192 icon
 *   public/icons/icon-512.png    — standard 512×512 icon
 *   public/icons/maskable-512.png — full-bleed 512×512 for Android adaptive icons
 */

'use strict';
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// ── CRC32 ─────────────────────────────────────────────────────────────────────
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  CRC_TABLE[n] = c;
}
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ── PNG chunk builder ─────────────────────────────────────────────────────────
function makeChunk(type, data) {
  const tBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.allocUnsafe(4); lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.allocUnsafe(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([tBuf, data])), 0);
  return Buffer.concat([lenBuf, tBuf, data, crcBuf]);
}

// ── Build a full PNG from an RGBA pixel array ─────────────────────────────────
function buildPNG(w, h, pixels) {
  // Raw image data: one filter byte (0 = None) per row, then RGBA per pixel
  const raw = Buffer.allocUnsafe(h * (1 + w * 4));
  let off = 0;
  for (let y = 0; y < h; y++) {
    raw[off++] = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      raw[off++] = pixels[i];
      raw[off++] = pixels[i + 1];
      raw[off++] = pixels[i + 2];
      raw[off++] = pixels[i + 3];
    }
  }
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // RGBA, no interlace
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Pixel helpers ─────────────────────────────────────────────────────────────
function setPixelAlpha(px, w, x, y, r, g, b, a) {
  if (x < 0 || x >= w || y < 0 || y >= w) return;
  const i = (y * w + x) * 4;
  const sa = a / 255, da = px[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa < 0.001) { px[i + 3] = 0; return; }
  px[i]     = Math.round((r * sa + px[i]     * da * (1 - sa)) / oa);
  px[i + 1] = Math.round((g * sa + px[i + 1] * da * (1 - sa)) / oa);
  px[i + 2] = Math.round((b * sa + px[i + 2] * da * (1 - sa)) / oa);
  px[i + 3] = Math.round(oa * 255);
}

// Anti-aliased line segment
function drawLine(px, w, x1, y1, x2, y2, lw, r, g, b) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const minX = Math.floor(Math.min(x1, x2) - lw - 1);
  const maxX = Math.ceil(Math.max(x1, x2)  + lw + 1);
  const minY = Math.floor(Math.min(y1, y2) - lw - 1);
  const maxY = Math.ceil(Math.max(y1, y2)  + lw + 1);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (len * len)));
      const projX = x1 + t * dx, projY = y1 + t * dy;
      const dist = Math.hypot(x - projX, y - projY);
      if (dist < lw / 2 + 1) {
        const alpha = Math.round(Math.max(0, Math.min(255, 255 * (1 - Math.max(0, dist - lw / 2)))));
        setPixelAlpha(px, w, x, y, r, g, b, alpha);
      }
    }
  }
}

// ── Draw the OpenMacaw icon ───────────────────────────────────────────────────
// Design: dark background + rounded corners + cyan shield outline + checkmark
function drawOpenMacaw(size, maskable) {
  const px = new Uint8Array(size * size * 4);

  // Fill background #09090b
  for (let i = 0; i < size * size; i++) {
    px[i * 4]     = 9;
    px[i * 4 + 1] = 9;
    px[i * 4 + 2] = 11;
    px[i * 4 + 3] = 255;
  }

  // Rounded corners (clip to transparent) — skip for maskable
  if (!maskable) {
    const cr = Math.round(size * 0.19);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let outside = false;
        if      (x <  cr     && y <  cr)      outside = Math.hypot(x - cr,        y - cr)        > cr;
        else if (x >= size-cr && y <  cr)      outside = Math.hypot(x - (size-cr), y - cr)        > cr;
        else if (x <  cr     && y >= size-cr)  outside = Math.hypot(x - cr,        y - (size-cr)) > cr;
        else if (x >= size-cr && y >= size-cr) outside = Math.hypot(x - (size-cr), y - (size-cr)) > cr;
        if (outside) px[(y * size + x) * 4 + 3] = 0;
      }
    }
  }

  // Shield geometry (all values relative to size)
  const cx   = size * 0.50;
  const topY = size * 0.17;
  const midY = size * 0.57;
  const botY = size * 0.83;
  const hw   = size * 0.26; // half-width
  const lw   = Math.max(2, size * 0.028); // line width
  const C    = [6, 182, 212]; // #06b6d4

  // Pentagon shield path
  const pts = [
    [cx - hw,  topY],
    [cx + hw,  topY],
    [cx + hw,  midY],
    [cx,       botY],
    [cx - hw,  midY],
  ];
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    drawLine(px, size, x1, y1, x2, y2, lw, C[0], C[1], C[2]);
  }

  // Checkmark inside the shield
  const clw  = Math.max(2, size * 0.042);
  const ckMid = [cx - hw * 0.07, size * 0.63];
  drawLine(px, size, cx - hw * 0.38, size * 0.50, ckMid[0], ckMid[1], clw, C[0], C[1], C[2]);
  drawLine(px, size, ckMid[0], ckMid[1], cx + hw * 0.44, size * 0.39, clw, C[0], C[1], C[2]);

  return buildPNG(size, size, px);
}

// ── Write files ───────────────────────────────────────────────────────────────
const outDir = path.resolve(__dirname, '../public/icons');
fs.mkdirSync(outDir, { recursive: true });

fs.writeFileSync(path.join(outDir, 'icon-192.png'),     drawOpenMacaw(192, false));
fs.writeFileSync(path.join(outDir, 'icon-512.png'),     drawOpenMacaw(512, false));
fs.writeFileSync(path.join(outDir, 'maskable-512.png'), drawOpenMacaw(512, true));

console.log('✓ PWA icons generated (192px, 512px, maskable-512px)');
