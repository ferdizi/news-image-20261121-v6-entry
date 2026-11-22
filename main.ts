// news-image-20261121 v6 REBUILD (from zero) — "Saturday 21 November 2026"
// Node 22 stdlib only. No network, no Date, no random, no binary assets.
// Every glyph is a SOLID FILLED polygon (nonzero-winding fill, counters as
// opposite-winding holes). One single render path for ALL sizes — no strips,
// no scanline/hatch patterns, no stroke-only outlines. Rendered at 3x
// supersampling, box-downsampled to 1024x1024.
import * as fs from "node:fs";
import * as zlib from "node:zlib";

const W = 1024, H = 1024, SS = 3;
const SW = W * SS, SH = H * SS;
const buf = new Uint8Array(SW * SH * 3);

type RGB = [number, number, number];
type Pt = [number, number];
type Ctr = Pt[];

// ---------- pixel buffer ----------
function fillBuf(r: number, g: number, b: number): void {
  const row = new Uint8Array(SW * 3);
  for (let x = 0; x < SW; x++) { row[x * 3] = r; row[x * 3 + 1] = g; row[x * 3 + 2] = b; }
  for (let y = 0; y < SH; y++) buf.set(row, y * SW * 3);
}
function setPx(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= SW || y >= SH) return;
  const i = (y * SW + x) * 3; buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
}
// fill axis-aligned rect given in 1024-space coords (x,y,w,h), scaled by SS
function fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.max(0, Math.round(x * SS)), x1 = Math.min(SW, Math.round((x + w) * SS));
  const y0 = Math.max(0, Math.round(y * SS)), y1 = Math.min(SH, Math.round((y + h) * SS));
  for (let yy = y0; yy < y1; yy++) {
    let i = (yy * SW + x0) * 3;
    for (let xx = x0; xx < x1; xx++) { buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; i += 3; }
  }
}
// nonzero-winding scanline fill of polygons in SS pixel coords.
// Solids and holes must wind opposite — C() / Hh() normalise that at build time.
function fillPolySS(contours: Ctr[], c: RGB): void {
  const edges: [number, number, number, number][] = [];
  let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
  for (const p of contours) {
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      if (a[1] === b[1]) continue;
      edges.push([a[0], a[1], b[0], b[1]]);
      minY = Math.min(minY, a[1], b[1]); maxY = Math.max(maxY, a[1], b[1]);
      minX = Math.min(minX, a[0], b[0]); maxX = Math.max(maxX, a[0], b[0]);
    }
  }
  if (!edges.length) return;
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(SH - 1, Math.ceil(maxY));
  const x0b = Math.max(0, Math.floor(minX)), x1b = Math.min(SW - 1, Math.ceil(maxX));
  const xs: [number, number][] = [];
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5; xs.length = 0;
    for (const e of edges) {
      const [x0, y0e, x1, y1e] = e;
      if ((y0e <= yc && yc < y1e) || (y1e <= yc && yc < y0e)) {
        const x = x0 + (yc - y0e) * (x1 - x0) / (y1e - y0e);
        xs.push([x, y1e > y0e ? 1 : -1]);
      }
    }
    if (!xs.length) continue;
    xs.sort((p, q) => p[0] - q[0]);
    let wind = 0;
    for (let i = 0; i < xs.length; i++) {
      const xa = xs[i][0]; wind += xs[i][1];
      const xb = i + 1 < xs.length ? xs[i + 1][0] : xa;
      if (wind !== 0 && xb > xa) {
        const lo = Math.max(x0b, Math.ceil(xa - 0.5)), hi = Math.min(x1b, Math.ceil(xb - 0.5) - 1);
        let idx = (y * SW + lo) * 3;
        for (let xx = lo; xx <= hi; xx++) { buf[idx] = c[0]; buf[idx + 1] = c[1]; buf[idx + 2] = c[2]; idx += 3; }
      }
    }
  }
}
// polygon fill in 1024-space coords
function fillPoly(pts: Ctr[], c: RGB): void {
  fillPolySS(pts.map(p => p.map(([x, y]): Pt => [x * SS, y * SS])), c);
}
function fillEllipse(cx: number, cy: number, rx: number, ry: number, c: RGB, n = 40): void {
  const p: Pt[] = [];
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; p.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); }
  fillPoly([p], c);
}
function fillCircle(cx: number, cy: number, r: number, c: RGB): void { fillEllipse(cx, cy, r, r, c); }
// thick line in 1024-space (as a filled quad)
function line(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB): void {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L * w / 2, ny = dx / L * w / 2;
  fillPoly([[[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]]], c);
}

// ---------- PNG encoder (stdlib zlib) ----------
const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
function writePNG(path: string, rgb: Uint8Array, w: number, h: number): void {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(h * (1 + w * 3));
  const bpp = 3;
  for (let y = 0; y < h; y++) {
    const row = rgb.subarray(y * w * 3, (y + 1) * w * 3);
    const up = y > 0 ? rgb.subarray((y - 1) * w * 3, y * w * 3) : null;
    let best: Buffer | null = null, bestScore = Infinity, bestF = 0;
    for (let f = 0; f <= 4; f++) {
      const fb = Buffer.alloc(w * 3);
      let score = 0;
      for (let x = 0; x < w * 3; x++) {
        const v = row[x];
        const a = x >= bpp ? row[x - bpp] : 0;
        const b = up ? up[x] : 0;
        const cc = x >= bpp && up ? up[x - bpp] : 0;
        let fv: number;
        if (f === 0) fv = v; else if (f === 1) fv = (v - a) & 0xff;
        else if (f === 2) fv = (v - b) & 0xff;
        else if (f === 3) fv = (v - ((a + b) >> 1)) & 0xff;
        else fv = (v - paeth(a, b, cc)) & 0xff;
        fb[x] = fv;
        const sv = fv > 127 ? fv - 256 : fv; score += Math.abs(sv);
      }
      if (score < bestScore) { bestScore = score; best = fb; bestF = f; }
    }
    raw[y * (1 + w * 3)] = bestF;
    best!.copy(raw, y * (1 + w * 3) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0)),
  ]);
  fs.writeFileSync(path, png);
  fs.chmodSync(path, 0o644);
}
// downsample the SS buffer to 1024x1024 RGB
function downsample(): Uint8Array {
  const out = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) {
        const i = ((y * SS + dy) * SW + x * SS + dx) * 3;
        r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
      }
      const n = SS * SS, o = (y * W + x) * 3;
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n);
    }
  }
  return out;
}

// ---------- FONT PRIMITIVES ----------
// Em = 100 units. Baseline y=70, cap top y=0, x-height top y=20, descender y=90.
// Every contour is a CLOSED FILLED polygon. Solids wind one way, holes the
// opposite way; fill uses the nonzero winding rule, so overlapping solids
// union and holes stay empty. No strokes, no scanlines, no hatch.
function sarea(p: Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
  return a / 2;
}
function C(p: Pt[]): Ctr { return sarea(p) < 0 ? p.slice().reverse() : p; }   // solid
function Hh(p: Pt[]): Ctr { return sarea(p) > 0 ? p.slice().reverse() : p; }  // hole
function rect(x: number, y: number, w: number, h: number): Ctr {
  return C([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
}
function quad(a: Pt, b: Pt, c: Pt, d: Pt): Ctr { return C([a, b, c, d]); }
function ell(cx: number, cy: number, rx: number, ry: number, n = 28): Ctr {
  const p: Pt[] = [];
  for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; p.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); }
  return C(p);
}
// sampled ellipse arc, angles in degrees, y-down (0=right, 90=down, 180=left, 270=up)
function arcPts(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, step = 8): Pt[] {
  const p: Pt[] = [];
  const dir = a1 >= a0 ? 1 : -1, st = step * dir;
  for (let a = a0; dir > 0 ? a <= a1 : a >= a1; a += st) {
    const r = a * Math.PI / 180; p.push([cx + rx * Math.cos(r), cy + ry * Math.sin(r)]);
  }
  const r = a1 * Math.PI / 180;
  const ex = cx + rx * Math.cos(r), ey = cy + ry * Math.sin(r);
  const last = p[p.length - 1];
  if (!last || Math.hypot(last[0] - ex, last[1] - ey) > 0.01) p.push([ex, ey]);
  return p;
}
// annular sector: outer arc a0->a1 then inner arc back (single closed contour)
function ring(cx: number, cy: number, rox: number, roy: number, rix: number, riy: number, a0: number, a1: number): Ctr {
  return C([...arcPts(cx, cy, rox, roy, a0, a1, 7), ...arcPts(cx, cy, rix, riy, a1, a0, 7)]);
}
// constant-width stroked polyline -> ONE solid filled polygon (square caps)
function stroke(pts: Pt[], w: number): Ctr {
  const h = w / 2;
  const p: Pt[] = pts.slice();
  let dx = p[1][0] - p[0][0], dy = p[1][1] - p[0][1];
  let L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
  p.unshift([p[0][0] - dx * h, p[0][1] - dy * h]);
  const n = p.length;
  dx = p[n - 1][0] - p[n - 2][0]; dy = p[n - 1][1] - p[n - 2][1];
  L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
  p.push([p[n - 1][0] + dx * h, p[n - 1][1] + dy * h]);
  const left: Pt[] = [], right: Pt[] = [];
  for (let i = 0; i < p.length; i++) {
    let nx: number, ny: number;
    if (i === 0 || i === p.length - 1) {
      const j = i === 0 ? 0 : i - 1, k = i === 0 ? 1 : i;
      const ex = p[k][0] - p[j][0], ey = p[k][1] - p[j][1], l = Math.hypot(ex, ey) || 1;
      nx = -ey / l; ny = ex / l;
      left.push([p[i][0] + nx * h, p[i][1] + ny * h]);
      right.push([p[i][0] - nx * h, p[i][1] - ny * h]);
      continue;
    }
    const e1x = p[i][0] - p[i - 1][0], e1y = p[i][1] - p[i - 1][1], l1 = Math.hypot(e1x, e1y) || 1;
    const e2x = p[i + 1][0] - p[i][0], e2y = p[i + 1][1] - p[i][1], l2 = Math.hypot(e2x, e2y) || 1;
    let mx = -e1y / l1 + -e2y / l2, my = e1x / l1 + e2x / l2;
    const ml = Math.hypot(mx, my) || 1; mx /= ml; my /= ml;
    const dot = mx * (-e1y / l1) + my * (e1x / l1);
    let sc = dot > 0.25 ? 1 / dot : 4;
    if (sc > 2.4) sc = 2.4;
    nx = mx * sc; ny = my * sc;
    left.push([p[i][0] + nx * h, p[i][1] + ny * h]);
    right.push([p[i][0] - nx * h, p[i][1] - ny * h]);
  }
  right.reverse();
  return C([...left, ...right]);
}

// ---------- GLYPH SET ----------
// glyph(ch, t, serif) -> {a: advance width, c: contours} in em units (100/em).
// t = stem width. serif=true adds bracket serifs on stems + feet on diagonals.
// One shape definition serves both fonts; serif only changes terminals.
type Glyph = { a: number; c: Ctr[] };
const glyphCache = new Map<string, Glyph>();
function glyph(ch: string, t: number, serif: boolean): Glyph {
  const key = ch + "|" + t + "|" + (serif ? 1 : 0);
  const hit = glyphCache.get(key);
  if (hit) return hit;
  const s = t, th = t * 0.62, hn = t * 0.4, sf = serif;
  const BL = 70, XT = 20;
  const sh = s * 0.45; // serif height
  // vertical stem with optional serif trapezoids
  function VS(x: number, y0: number, y1: number, w: number, top = false, bot = false): Ctr[] {
    const out: Ctr[] = [rect(x, y0, w, y1 - y0)];
    const fl = w * 0.5;
    if (sf && top) out.push(C([[x - fl, y0], [x + w + fl, y0], [x + w - 1, y0 + sh], [x + 1, y0 + sh]]));
    if (sf && bot) out.push(C([[x - fl, y1], [x + w + fl, y1], [x + w - 1, y1 - sh], [x + 1, y1 - sh]]));
    return out;
  }
  // serif foot under a diagonal leg ending at (x0..x1, y)
  function foot(x0: number, x1: number, y: number): Ctr {
    return quad([x0 - 2, y], [x1 + 2, y], [x1, y - sh], [x0, y - sh]);
  }
  let a = 60;
  let c: Ctr[] = [];
  switch (ch) {
    case "A": a = 68; c = [
      stroke([[6, BL], [34, 0]], s * 0.95), stroke([[62, BL], [34, 0]], s * 0.8),
      rect(17, 44, 34, th),
      ...(sf ? [foot(0, 12, BL), foot(56, 68, BL)] : []),
    ]; break;
    case "B": a = 64; c = [
      ...VS(0, 0, BL, s, true, true),
      ring(6, 19, 32, 19, 32 - s * 0.9, 19 - th, -90, 90),
      ring(6, 50, 34, 20, 34 - s * 0.9, 20 - th, -90, 90),
    ]; break;
    case "C": a = 66; c = [ring(35, 35, 31, 35, 31 - s * 0.95, 35 - th, 52, 308)]; break;
    case "D": a = 70; c = [
      ...VS(0, 0, BL, s, true, true),
      ring(8, 35, 54, 35, 54 - s, 35 - th, -90, 90),
    ]; break;
    case "E": a = 60; c = [
      ...VS(0, 0, BL, s, true, true),
      rect(0, 0, 56, th), rect(0, 32, 44, th), rect(0, BL - th, 56, th),
    ]; break;
    case "F": a = 58; c = [
      ...VS(0, 0, BL, s, true, true),
      rect(0, 0, 56, th), rect(0, 32, 44, th),
    ]; break;
    case "G": a = 70; c = [
      ring(36, 35, 31, 35, 31 - s * 0.95, 35 - th, 48, 312),
      rect(38, 32, 26, th), rect(56, 32, 7, 16),
    ]; break;
    case "H": a = 70; c = [
      ...VS(0, 0, BL, s, true, true), ...VS(62, 0, BL, s, true, true),
      rect(8, 32, 54, th),
    ]; break;
    case "I": a = 32; c = [...VS((32 - s) / 2, 0, BL, s, true, true)]; break;
    case "J": a = 56; c = [
      rect(14, 0, 40, th),
      stroke([[40, 4], [40, 52], ...arcPts(26, 52, 14, 16, 0, 90, 8)], s * 0.9),
    ]; break;
    case "K": a = 66; c = [
      ...VS(0, 0, BL, s, true, true),
      stroke([[10, 36], [60, 0]], th), stroke([[14, 40], [62, BL]], s * 0.9),
    ]; break;
    case "L": a = 58; c = [...VS(0, 0, BL, s, true, true), rect(0, BL - th, 56, th)]; break;
    case "M": a = 82; c = [
      ...VS(0, 0, BL, s, true, true), ...VS(74, 0, BL, s, true, true),
      stroke([[8, 0], [41, 44]], th), stroke([[74, 0], [41, 44]], th),
    ]; break;
    case "N": a = 72; c = [
      ...VS(0, 0, BL, s, true, true), ...VS(64, 0, BL, s, true, true),
      stroke([[8, 0], [64, BL]], th),
    ]; break;
    case "O": a = 70; c = [ell(35, 35, 33, 35), Hh(ell(35, 35, 33 - s, 35 - th))]; break;
    case "P": a = 62; c = [
      ...VS(0, 0, BL, s, true, true),
      ring(6, 18, 32, 18, 32 - s, 18 - th, -90, 90),
    ]; break;
    case "Q": a = 72; c = [
      ell(35, 35, 33, 35), Hh(ell(35, 35, 33 - s, 35 - th)),
      stroke([[50, 52], [70, 72]], th),
    ]; break;
    case "R": a = 64; c = [
      ...VS(0, 0, BL, s, true, true),
      ring(6, 18, 32, 18, 32 - s, 18 - th, -90, 90),
      stroke([[30, 36], [62, BL]], s * 0.85),
    ]; break;
    case "S": a = 62; c = [stroke([
      ...arcPts(31, 20, 14, 13, 20, -230, 10),
      [28, 35], [36, 39], [45.7, 42],
      ...arcPts(31, 50, 17, 16, -30, 195, 10),
    ], s * 1.0)]; break;
    case "T": a = 62; c = [rect(0, 0, 62, th), ...VS((62 - s) / 2, 0, BL, s, false, true)]; break;
    case "U": a = 70; c = [
      rect(0, 0, s, 52), rect(62, 0, s, 52),
      stroke(arcPts(35, 50, 27, 20, 180, 0, 8), s),
      ...(sf ? [foot(0, s + 4, 52), foot(58, 62 + 4, 52)] : []),
    ]; break;
    case "V": a = 68; c = [
      stroke([[2, 0], [34, BL]], s * 0.95), stroke([[66, 0], [34, BL]], s * 0.8),
      ...(sf ? [foot(28, 40, BL)] : []),
    ]; break;
    case "W": a = 92; c = [
      stroke([[2, 0], [23, BL]], s * 0.9), stroke([[44, 0], [23, BL]], s * 0.85),
      stroke([[44, 0], [69, BL]], s * 0.85), stroke([[90, 0], [69, BL]], s * 0.9),
    ]; break;
    case "X": a = 66; c = [
      stroke([[2, 0], [64, BL]], s * 0.85), stroke([[64, 0], [2, BL]], s * 0.85),
    ]; break;
    case "Y": a = 64; c = [
      stroke([[2, 0], [32, 34]], s * 0.9), stroke([[62, 0], [32, 34]], s * 0.9),
      ...VS(32 - s / 2, 34, BL, s, false, true),
    ]; break;
    case "Z": a = 62; c = [
      rect(0, 0, 62, th), rect(0, BL - th, 62, th),
      stroke([[58, 4], [4, 66]], th),
    ]; break;
    case "a": a = 56;
      if (sf) c = [
        ring(45, 29, 14, 11, 14 - th, 11 - th, 90, 270),
        ring(45, 52, 18, 16, 18 - th, 16 - th, 90, 270),
        ...VS(42, 20, BL, s, false, true),
      ]; else c = [
        ring(45, 48, 22, 16, 22 - th, 16 - th, 90, 270),
        rect(44, XT, s, 50),
      ]; break;
    case "b": a = 58; c = [
      ...VS(0, 0, BL, s, true, true),
      ring(6, 50, 22, 16, 22 - th, 16 - th, -90, 90),
    ]; break;
    case "c": a = 52; c = [ring(27, 46, 16, 16, 16 - th, 16 - th, 55, 305)]; break;
    case "d": a = 58; c = [
      ring(52, 50, 22, 16, 22 - th, 16 - th, 90, 270),
      ...VS(50, 0, BL, s, true, true),
    ]; break;
    case "e": a = 54; c = [stroke([
      ...arcPts(27, 48, 15, 15, 20, -340, 9), [41, 47], [14, 47],
    ], th)]; break;
    case "f": a = 34; c = [
      stroke([[22, BL], [22, 12], [30, 2], [38, 6]], s * 0.9),
      rect(6, 30, 26, th),
      ...(sf ? [foot(18, 27, BL)] : []),
    ]; break;
    case "g": a = 56;
      if (sf) c = [
        ring(45, 46, 17, 15, 17 - th, 15 - th, 90, 270),
        ...VS(44, XT, 84, s, false, false),
        ring(45, 84, 16, 10, 16 - th, 10 - th, 90, 270),
      ]; else c = [
        ring(45, 46, 17, 15, 17 - th, 15 - th, 90, 270),
        rect(44, XT, s, 64),
        stroke([[50, 84], [46, 91], [38, 92]], th),
      ]; break;
    case "h": a = 58; c = [
      ...VS(0, 0, BL, s, true, true),
      stroke([...arcPts(28, 34, 18, 14, 180, 360, 8), [46, BL]], s * 0.9),
    ]; break;
    case "i": a = 28; c = [
      ell(14, 8, 4.5, 4.5),
      ...VS(14 - s / 2, XT, BL, s, false, true),
    ]; break;
    case "j": a = 30; c = [
      ell(15, 8, 4.5, 4.5),
      stroke([[16, XT], [16, 62], ...arcPts(10, 62, 8, 20, 0, 95, 8)], s * 0.9),
    ]; break;
    case "k": a = 56; c = [
      ...VS(0, 0, BL, s, true, true),
      stroke([[10, 40], [50, XT]], th), stroke([[14, 44], [52, BL]], s * 0.85),
    ]; break;
    case "l": a = 28; c = [...VS((28 - s) / 2, 0, BL, s, true, true)]; break;
    case "m": a = 84; c = [
      ...VS(0, 0, BL, s, true, true),
      stroke([...arcPts(27, 34, 17, 14, 180, 360, 8), [44, BL]], s * 0.9),
      stroke([...arcPts(63, 34, 17, 14, 180, 360, 8), [80, BL]], s * 0.9),
    ]; break;
    case "n": a = 58; c = [
      ...VS(0, XT, BL, s, true, true),
      stroke([...arcPts(28, 34, 18, 14, 180, 360, 8), [46, BL]], s * 0.9),
    ]; break;
    case "o": a = 56; c = [ell(28, 46, 16, 16), Hh(ell(28, 46, 16 - th, 16 - th))]; break;
    case "p": a = 58; c = [
      ...VS(0, XT, 92, s, true, false),
      ring(6, 50, 22, 16, 22 - th, 16 - th, -90, 90),
    ]; break;
    case "q": a = 58; c = [
      ring(52, 50, 22, 16, 22 - th, 16 - th, 90, 270),
      ...VS(45, XT, 92, s, true, false),
    ]; break;
    case "r": a = 38; c = [
      ...VS(0, XT, BL, s, true, true),
      stroke([...arcPts(19, 38, 13, 15, 180, 320, 8), [31, 54]], th),
    ]; break;
    case "s": a = 52; c = [stroke([
      ...arcPts(26, 30, 12, 11, 20, -230, 10),
      [23, 42], [29, 46], [33, 48],
      ...arcPts(26, 56, 14, 12, -30, 195, 10),
    ], s * 0.95)]; break;
    case "t": a = 36; c = [
      stroke([[18, 8], [18, 66], ...arcPts(10, 66, 8, 8, 0, 90, 8)], s * 0.9),
      rect(4, 26, 28, th),
    ]; break;
    case "u": a = 58; c = [
      rect(0, XT, s, 50), rect(50, XT, s, 50),
      stroke(arcPts(29, 52, 21, 16, 180, 0, 8), s),
    ]; break;
    case "v": a = 54; c = [
      stroke([[2, XT], [27, BL]], s * 0.9), stroke([[52, XT], [27, BL]], s * 0.8),
    ]; break;
    case "w": a = 78; c = [
      stroke([[2, XT], [19, BL]], s * 0.9), stroke([[36, XT], [19, BL]], s * 0.85),
      stroke([[36, XT], [59, BL]], s * 0.85), stroke([[76, XT], [59, BL]], s * 0.9),
    ]; break;
    case "x": a = 54; c = [
      stroke([[2, XT], [52, BL]], s * 0.85), stroke([[52, XT], [2, BL]], s * 0.85),
    ]; break;
    case "y": a = 54; c = [
      stroke([[2, XT], [27, 64]], s * 0.9), stroke([[52, XT], [27, 64]], s * 0.8),
      stroke([[27, 64], [20, 88]], s * 0.8),
    ]; break;
    case "z": a = 50; c = [
      rect(2, XT, 48, th), rect(2, BL - th, 48, th),
      stroke([[46, 24], [6, 66]], th),
    ]; break;
    case "0": a = 58; c = [ell(29, 35, 26, 35), Hh(ell(29, 35, 26 - s, 35 - th))]; break;
    case "1": a = 58; c = [
      ...VS(26, 0, BL, s, false, true),
      stroke([[10, 14], [28, 0]], th), rect(10, BL - th, 38, th),
    ]; break;
    case "2": a = 58; c = [stroke([
      ...arcPts(29, 20, 18, 16, 180, 330, 8), [10, BL], [50, BL],
    ], s * 0.9)]; break;
    case "3": a = 58; c = [stroke([
      ...arcPts(30, 20, 16, 14, 200, 345, 8), [38, 33],
      ...arcPts(30, 50, 18, 16, -15, 160, 8),
    ], s * 0.9)]; break;
    case "4": a = 58; c = [
      stroke([[40, 0], [6, 52]], th), rect(4, 48, 46, th),
      ...VS(34, 0, BL, s, false, true),
    ]; break;
    case "5": a = 58; c = [
      rect(8, 0, 44, th),
      stroke([[8, 2], [8, 34], ...arcPts(30, 50, 18, 17, 180, 520, 8)], s * 0.9),
    ]; break;
    case "6": a = 58; c = [
      ell(29, 50, 20, 18), Hh(ell(29, 50, 20 - th, 18 - th)),
      stroke([[44, 8], [38, 28], [30, 34]], s * 0.9),
    ]; break;
    case "7": a = 58; c = [rect(4, 0, 52, th), stroke([[48, 4], [16, BL]], s * 0.9)]; break;
    case "8": a = 58; c = [
      ell(29, 21, 18, 17), Hh(ell(29, 21, 18 - th, 17 - th)),
      ell(29, 51, 20, 19), Hh(ell(29, 51, 20 - th, 19 - th)),
    ]; break;
    case "9": a = 58; c = [
      ell(29, 20, 20, 18), Hh(ell(29, 20, 20 - th, 18 - th)),
      stroke([[14, 60], [20, 42], [28, 36]], s * 0.9),
    ]; break;
    case ".": a = 28; c = [ell(14, 66, 4.5, 4.5)]; break;
    case ",": a = 28; c = [
      ell(14, 64, 4.5, 5),
      quad([9, 64], [17, 64], [11, 80], [7, 76]),
    ]; break;
    case ":": a = 28; c = [ell(14, 38, 4.5, 4.5), ell(14, 62, 4.5, 4.5)]; break;
    case ";": a = 28; c = [
      ell(14, 38, 4.5, 4.5), ell(14, 64, 4.5, 5),
      quad([9, 64], [17, 64], [11, 80], [7, 76]),
    ]; break;
    case "'": a = 24; c = [quad([8, 0], [15, 0], [11, 16], [6, 14])]; break;
    case '"': a = 36; c = [
      quad([5, 0], [12, 0], [8, 16], [3, 14]),
      quad([21, 0], [28, 0], [24, 16], [19, 14]),
    ]; break;
    case "(": a = 30; c = [ring(34, 35, 24, 35, 24 - th, 35 - th, 110, 250)]; break;
    case ")": a = 30; c = [ring(-4, 35, 24, 35, 24 - th, 35 - th, -70, 70)]; break;
    case "-": a = 30; c = [rect(2, 44, 26, th)]; break;
    case "–": a = 40; c = [rect(2, 44, 36, th)]; break;
    case "—": a = 58; c = [rect(2, 44, 54, th)]; break;
    case "/": a = 30; c = [stroke([[22, 0], [8, BL]], th)]; break;
    case "%": a = 72; c = [
      ell(18, 18, 11, 11), Hh(ell(18, 18, 11 - th * 0.7, 11 - th * 0.7)),
      ell(54, 52, 11, 11), Hh(ell(54, 52, 11 - th * 0.7, 11 - th * 0.7)),
      stroke([[58, 4], [14, 66]], th),
    ]; break;
    case "$": a = 56; c = [
      stroke([...arcPts(28, 20, 14, 13, 20, -230, 10), [25, 35], [33, 39], [42.7, 42], ...arcPts(28, 50, 17, 16, -30, 195, 10)], s * 0.95),
      rect(25, -2, 5, 74),
    ]; break;
    case "·": a = 28; c = [ell(14, 42, 4.5, 4.5)]; break;
    case "!": a = 28; c = [rect(10, 0, 7, 52), ell(13, 64, 4.5, 4.5)]; break;
    case "?": a = 52; c = [
      stroke([...arcPts(26, 20, 16, 14, 160, 330, 8), [30, 34], [26, 42]], th),
      ell(26, 62, 4.5, 4.5),
    ]; break;
    case "+": a = 40; c = [rect(17, 16, 6, 38), rect(6, 33, 28, 6)]; break;
    case "=": a = 40; c = [rect(6, 30, 28, 6), rect(6, 46, 28, 6)]; break;
    case "Ü": a = 70; c = [
      rect(0, 0, s, 52), rect(62, 0, s, 52),
      stroke(arcPts(35, 50, 27, 20, 180, 360, 8), s),
      ell(24, -8, 4.5, 4.5), ell(48, -8, 4.5, 4.5),
    ]; break;
    case "Í": a = 32; c = [
      ...VS((32 - s) / 2, 0, BL, s, true, true),
      quad([9, -3], [19, -13], [25, -13], [15, -3]),
    ]; break;
    case " ": a = 28; c = []; break;
    default: break;
  }
  const g: Glyph = { a, c };
  glyphCache.set(key, g);
  return g;
}

// ---------- TEXT ENGINE ----------
// One render path for every size: glyph contours -> SS coords -> nonzero fill.
type FontName = "serif" | "sans";
interface TextOpts {
  font?: FontName; t?: number; color?: RGB; italic?: boolean;
  align?: "left" | "center" | "right"; tracking?: number;
}
function measure(str: string, size: number, o: TextOpts = {}): number {
  const t = o.t ?? (o.font === "serif" ? 10 : 6.5);
  const sf = o.font === "serif";
  const sc = size / 100;
  let w = 0;
  for (const ch of str) w += glyph(ch, t, sf).a * sc + (o.tracking ?? 0);
  return w;
}
function drawGlyphContours(contours: Ctr[], penX: number, baseY: number, scale: number, shear: number, c: RGB): void {
  if (!contours.length) return;
  const ss: Ctr[] = contours.map(p => p.map(([gx, gy]): Pt => [
    (penX + (gx + shear * (70 - gy)) * scale) * SS,
    (baseY + (gy - 70) * scale) * SS,
  ]));
  fillPolySS(ss, c);
}
function drawText(str: string, x: number, y: number, size: number, o: TextOpts = {}): void {
  const t = o.t ?? (o.font === "serif" ? 10 : 6.5);
  const sf = o.font === "serif";
  const color = o.color ?? [20, 20, 20];
  const shear = o.italic ? 0.16 : 0;
  const sc = size / 100;
  let px = x;
  if (o.align === "center") px = x - measure(str, size, o) / 2;
  else if (o.align === "right") px = x - measure(str, size, o);
  for (const ch of str) {
    const g = glyph(ch, t, sf);
    if (g.c.length) drawGlyphContours(g.c, px, y, sc, shear, color);
    else if (ch !== " ") {
      // tofu: thin outline rect so a missing glyph is visible in tests
      const wpx = g.a * sc, hpx = size * 0.7;
      fillRect(px, y - hpx, wpx, 1.5, color); fillRect(px, y, wpx, 1.5, color);
      fillRect(px, y - hpx, 1.5, hpx, color); fillRect(px + wpx - 1.5, y - hpx, 1.5, hpx, color);
    }
    px += g.a * sc + (o.tracking ?? 0);
  }
}
// greedy word wrap; returns lines that fit maxW
function wrap(str: string, size: number, maxW: number, o: TextOpts = {}): string[] {
  const words = str.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? cur + " " + w : w;
    if (measure(trial, size, o) <= maxW || !cur) cur = trial;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}
function drawTextBlock(str: string, x: number, y: number, size: number, lh: number, maxW: number, o: TextOpts = {}): number {
  const lines = wrap(str, size, maxW, o);
  lines.forEach((ln, i) => drawText(ln, x, y + i * lh, size, o));
  return lines.length;
}

// ---------- TEST STRIP (isolated glyph check, env TEST_STRIP=1) ----------
function testStrip(outDir: string): void {
  const INK: RGB = [20, 20, 20], RED: RGB = [185, 28, 28], PAPER: RGB = [247, 243, 232];
  fillBuf(...PAPER);
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const punct = ".,:;'/\"()-–—/%$·!?+=ÜÍ";
  let y = 30;
  drawText("GLYPH TEST STRIP — solid filled polygons, nonzero winding, one path all sizes", 16, y, 15, { font: "sans", t: 9, color: RED });
  y += 34;
  // 2x-zoom rows (rendered at double size so shapes can be inspected)
  for (const [label, size, font, t] of [
    ["SERIF BOLD 11px (shown 2x = 22)", 22, "serif", 10],
    ["SANS REG 11px (shown 2x = 22)", 22, "sans", 6.5],
    ["SERIF BOLD 17px (shown 2x = 34)", 34, "serif", 10],
    ["SANS REG 17px (shown 2x = 34)", 34, "sans", 6.5],
  ] as [string, number, FontName, number][]) {
    drawText(label, 16, y, 13, { font: "sans", t: 9, color: RED });
    y += 8;
    for (const part of [charset.slice(0, 36), charset.slice(36), punct]) {
      drawText(part, 16, y + size, size, { font, t, color: INK });
      y += size + 10;
    }
    y += 6;
  }
  // true-size rows
  drawText("TRUE SIZE — serif bold 26 / sans 12 / sans 11 (list size)", 16, y, 13, { font: "sans", t: 9, color: RED });
  y += 10;
  drawText("Climate summit runs into Saturday with no deal", 16, y + 26, 26, { font: "serif", t: 10, color: INK });
  y += 40;
  drawText("Kryvyi Rih: missile kills 2, incl. boy, 7 (Kyiv Independent)", 16, y + 12, 12, { font: "sans", t: 6.5, color: INK });
  y += 24;
  drawText("Cook Islands: relief ship ready, Xavier weakens (RNZ)", 16, y + 11, 11, { font: "sans", t: 6.5, color: INK });
  y += 24;
  drawText("Day of COP31, planned to close day 12", 16, y + 11, 11, { font: "sans", t: 6.5, color: INK });
  y += 24;
  drawText("Saturday 21 November 2026", 16, y + 60, 60, { font: "serif", t: 11, color: INK });
  y += 74;
  drawText("13  3  6.7  146  $58,983  136", 16, y + 30, 30, { font: "serif", t: 10, color: INK });
  writePNG(outDir + "/strip.png", downsample(), W, H);
  // diagnostic: problem glyphs at 70px, two columns, labelled (serif | sans)
  fillBuf(...PAPER);
  let dy = 40;
  drawText("DIAG 70px — serif bold (left) | sans regular (right)", 16, dy, 16, { font: "sans", t: 9, color: RED });
  dy += 16;
  const dg = ["S", "s", "a", "B", "U", "u", "e", "g", "2", "3", "5", "?", "D", "O", "Q", "R", "C", "G", "8", "9", "0"];
  for (let i = 0; i < dg.length; i++) {
    const col = i < 11 ? 0 : 1, row = i % 11;
    const bx = col === 0 ? 16 : 520, by = dy + row * 80 + 70;
    drawText(dg[i] + " =", bx, by, 22, { font: "sans", t: 9, color: RED });
    drawText(dg[i], bx + 70, by, 70, { font: "serif", t: 10, color: INK });
    drawText(dg[i], bx + 180, by, 70, { font: "sans", t: 6.5, color: INK });
  }
  writePNG(outDir + "/strip2.png", downsample(), W, H);
}

// ---------- PAGE ----------
const PAPER: RGB = [247, 243, 232];
const INK: RGB = [20, 20, 20];
const RED: RGB = [185, 28, 28];
const WHITE: RGB = [255, 253, 247];
const MUTED: RGB = [96, 90, 78];
const HEROTINT: RGB = [233, 238, 243];
const REGION: Record<string, RGB> = {
  Europe: [37, 99, 235], "Middle East": [192, 57, 43], Asia: [30, 122, 52],
  Africa: [217, 119, 6], Americas: [14, 116, 144], Oceania: [124, 58, 237], Global: [51, 65, 85],
};
const TAGC: Record<string, RGB> = { CONFIRMED: [22, 101, 52], OFFICIAL: [29, 78, 216], REPORTED: [180, 83, 9] };

function box(x: number, y: number, w: number, h: number, fill: RGB, border: RGB | null = INK, bw = 1): void {
  fillRect(x, y, w, h, fill);
  if (border) {
    fillRect(x, y, w, bw, border); fillRect(x, y + h - bw, w, bw, border);
    fillRect(x, y, bw, h, border); fillRect(x + w - bw, y, bw, h, border);
  }
}
function fitLines(text: string, size: number, maxW: number, maxLines: number, o: TextOpts = {}): string[] {
  const lines = wrap(text, size, maxW, o);
  if (lines.length > maxLines) console.error("OVERFLOW lines=" + lines.length + " max=" + maxLines + " :: " + text.slice(0, 70));
  return lines.slice(0, maxLines);
}
function checkW(text: string, size: number, maxW: number, o: TextOpts = {}, where = ""): void {
  const w = measure(text, size, o);
  if (w > maxW) console.error("OVERFLOW-W " + Math.round(w) + ">" + maxW + " " + where + " :: " + text.slice(0, 70));
}
function labelBar(x: number, y: number, w: number, h: number, num: number, label: string, tag: string, region: string): void {
  fillRect(x, y, w, h, REGION[region]);
  const ls = h > 16 ? 11 : 9, ts = h > 16 ? 8.5 : 8;
  drawText(num + "  " + label, x + 7, y + h - 5, ls, { font: "sans", t: 9, color: WHITE });
  const tw = measure(tag, ts, { font: "sans", t: 9 }) + 10;
  fillRect(x + w - tw - 5, y + 3, tw, h - 6, TAGC[tag]);
  drawText(tag, x + w - tw - 5 + 5, y + h - 5, ts, { font: "sans", t: 9, color: WHITE });
}

interface Panel { n: number; tag: string; region: string; loc: string; head: string; body: string; src: string; kind: string; }
const HEROES: Panel[] = [
  { n: 1, tag: "COP31: OVERTIME", region: "Global", loc: "ANTALYA, TÜRKIYE · CLIMATE",
    head: "Climate summit runs into Saturday with no deal",
    body: "COP31 missed its Friday close. A draft with no fossil-fuel mention split nearly 200 nations.",
    src: "AFP, Reuters", kind: "CONFIRMED" },
  { n: 2, tag: "SAUDI: MISSILES", region: "Middle East", loc: "RIYADH · WAR",
    head: "Houthi missiles aimed at Riyadh shot down",
    body: "Coalition says it intercepted 3 ballistic missiles just after 2 a.m.; two blasts heard.",
    src: "Arab News, Al Jazeera", kind: "OFFICIAL" },
  { n: 3, tag: "PERU: QUAKE 6.7", region: "Americas", loc: "JUNÍN, PERU · EARTHQUAKE",
    head: "Magnitude 6.7 quake shakes central Peru",
    body: "00:09 UTC, 108 km deep. Felt in Lima; no deaths or tsunami risk; 152 homes uninhabitable.",
    src: "USGS, IGP", kind: "OFFICIAL" },
];
const MIDS: Panel[] = [
  { n: 4, tag: "BAHRAIN: US BASES HIT", region: "Middle East", loc: "BAHRAIN · CONFLICT",
    head: "Iran hits two US bases in Bahrain",
    body: "IRGC hit al-Riffa, Awali; industrial fire, no injuries.",
    src: "Bahrain, UKMTO", kind: "OFFICIAL" },
  { n: 5, tag: "HORMUZ: TANKERS HIT", region: "Middle East", loc: "GULF OF OMAN · CONFLICT",
    head: "Tankers hit off Oman; third in Strait",
    body: "Two hit off Khasab, one crew missing; mine blamed.",
    src: "UKMTO", kind: "OFFICIAL" },
  { n: 6, tag: "BALTIC: SHIP ABLAZE", region: "Europe", loc: "GULF OF FINLAND · CONFLICT",
    head: "Drones set Sparta II ablaze off Finland",
    body: "Crew evacuated; Finland suspects Ukraine.",
    src: "France 24, Al Jazeera", kind: "OFFICIAL" },
  { n: 7, tag: "KYIV: MISSILES", region: "Europe", loc: "KYIV · WAR",
    head: "Ballistic missiles hit Kyiv at 5:47",
    body: "Two homes ablaze in Podil, city says.",
    src: "Kyiv Post", kind: "OFFICIAL" },
  { n: 8, tag: "SINALOA: CAPTURED", region: "Americas", loc: "GUASAVE, MEXICO · SECURITY",
    head: "Capture of cartel boss 'Chapo Isidro'",
    body: "Meza Flores held in Guasave; 11 killed.",
    src: "FBI, Euronews, AP", kind: "CONFIRMED" },
  { n: 9, tag: "EU–INDONESIA: DEAL", region: "Europe", loc: "BRUSSELS · TRADE",
    head: "EU and Indonesia sign free-trade deal",
    body: "After 10 years of talks; tariffs cut on 98.5% of lines.",
    src: "European Commission", kind: "OFFICIAL" },
  { n: 10, tag: "GAZA: STRIKE", region: "Middle East", loc: "GAZA CITY · WAR",
    head: "Israeli drone strike kills 3 in Gaza",
    body: "Car hit in Tel al-Hawa; three handing out food.",
    src: "Al Jazeera, ToI", kind: "REPORTED" },
  { n: 11, tag: "BITCOIN: TWO-YEAR LOW", region: "Global", loc: "MARKETS · CRYPTO",
    head: "Bitcoin falls to its lowest since 2024",
    body: "Two-year low at 04:13; back over $60,000 by 15:16.",
    src: "CoinGecko", kind: "REPORTED" },
  { n: 12, tag: "FRANCE: PROTESTS", region: "Europe", loc: "PARIS · PROTEST",
    head: "Sixth Saturday of protests in France",
    body: "82,500 march; 70,000 police and gendarmes on duty.",
    src: "France 24", kind: "OFFICIAL" },
  { n: 13, tag: "CRICKET: RAHUL 136", region: "Oceania", loc: "WELLINGTON · CRICKET",
    head: "Rahul hits 136 as India lead NZ by 118",
    body: "India 486-4 on day 3 in Wellington; Gill 98.",
    src: "Reuters", kind: "CONFIRMED" },
];
const LIST: { n: number; region: string; text: string }[] = [
  { n: 14, region: "Europe", text: "Kryvyi Rih: missile kills 2, incl. boy, 7 (Kyiv Independent)" },
  { n: 15, region: "Europe", text: "Lviv: strike kills 2, 10 injured (—)" },
  { n: 16, region: "Asia", text: "Davao: jet lands safely after engine fire; 146 safe (AP)" },
  { n: 17, region: "Asia", text: "Timor-Leste: M6.8 quake, felt in Darwin (USGS)" },
  { n: 18, region: "Europe", text: "Geneva: 128 nations agree AI-weapons draft (Al Jazeera)" },
  { n: 19, region: "Asia", text: "Taiwan: 21 jets patrol; 15 cross median line (Taipei)" },
  { n: 20, region: "Europe", text: "Ust-Luga: drones hit port; NATO jets up (Kyiv Post)" },
  { n: 21, region: "Americas", text: "Brazil: Bolsonaro, 71, in intensive care (Reuters)" },
  { n: 22, region: "Middle East", text: "Basra: power station fire kills 4+, 30 hurt (INA, Reuters)" },
  { n: 23, region: "Africa", text: "Pretoria: UN, AU honour Mlambo-Ngcuka (UN)" },
  { n: 24, region: "Americas", text: "Las Vegas: Russell fastest, 1:34.041 (Formula 1)" },
  { n: 25, region: "Europe", text: "Twickenham: England rout NZ 37-12, record (Reuters)" },
  { n: 26, region: "Oceania", text: "Cook Islands: relief ship ready as Xavier weakens (RNZ)" },
  { n: 27, region: "Europe", text: "Kyiv: Zelensky: Crimea bridge 'will not stay' (NBC)" },
  { n: 28, region: "Global", text: "Antalya: EU warns COP31 risks 'fossil summit' (AFP)" },
  { n: 29, region: "Global", text: "Antalya: Panama may block the climate deal (Al Jazeera)" },
  { n: 30, region: "Middle East", text: "Yemen: Houthis threaten Jeddah, Red Sea (Al Jazeera)" },
  { n: 31, region: "Americas", text: "Washington: Vance: Iran strikes Trump's call (Reuters)" },
  { n: 32, region: "Americas", text: "Texas: execution of man, 70, takes 63 minutes (ABC)" },
  { n: 33, region: "Americas", text: "Vancouver: Canada rests defence in climate trial (AFP)" },
  { n: 34, region: "Asia", text: "Pyongyang: Kim tours factories, no Trump meet (KCNA)" },
  { n: 35, region: "Asia", text: "Bangkok: six-point plan on arsenic in rivers (The Nation)" },
  { n: 36, region: "Oceania", text: "Melbourne: Cummins keeps Australian captaincy (ABC)" },
];

// ---------- hero illustrations (flat shapes, no portraits, no logos) ----------
function heroIllo(n: number, x: number, y: number, w: number, h: number): void {
  if (n === 1) {
    fillRect(x, y, w, h, [220, 232, 240]);
    // globe
    fillCircle(x + 46, y + 32, 25, [46, 111, 176]);
    fillEllipse(x + 40, y + 26, 9, 6, [46, 139, 87]);
    fillEllipse(x + 54, y + 38, 8, 5, [46, 139, 87]);
    fillEllipse(x + 46, y + 44, 6, 4, [46, 139, 87]);
    // calendar
    box(x + 88, y + 8, 72, 48, WHITE, INK, 1);
    fillRect(x + 88, y + 8, 72, 13, RED);
    drawText("NOV 2026", x + 124, y + 18, 9, { font: "sans", t: 9, color: WHITE, align: "center" });
    for (let r = 0; r < 2; r++) for (let c = 0; c < 7; c++) fillRect(x + 94 + c * 9, y + 28 + r * 11, 5, 5, [200, 205, 210]);
    fillRect(x + 94 + 5 * 9, y + 28, 5, 5, RED);
    // clock + day 13
    fillCircle(x + 196, y + 32, 19, WHITE);
    fillCircle(x + 196, y + 32, 19, INK); // ring drawn as filled then inner white
    fillCircle(x + 196, y + 32, 16, WHITE);
    line(x + 196, y + 32, x + 196, y + 20, 2, INK);
    line(x + 196, y + 32, x + 205, y + 36, 2, INK);
    drawText("DAY 13", x + 230, y + 30, 24, { font: "serif", t: 10, color: RED });
    drawText("OF COP31", x + 230, y + 46, 11, { font: "sans", t: 9, color: INK });
  } else if (n === 2) {
    fillRect(x, y, w, h, [15, 32, 56]);
    // skyline
    const bw = [26, 34, 22, 40, 28, 30];
    let bx = x + 8;
    for (let i = 0; i < bw.length; i++) {
      const bh = 26 + ((i * 13) % 22);
      fillRect(bx, y + h - bh, bw[i], bh, [30, 58, 95]);
      for (let wy = y + h - bh + 5; wy < y + h - 6; wy += 8)
        for (let wx = bx + 4; wx < bx + bw[i] - 4; wx += 8) fillRect(wx, wy, 3, 4, [250, 200, 90]);
      bx += bw[i] + 5;
    }
    // missile trails
    line(x + 210, y + 6, x + 150, y + 44, 2, [255, 120, 60]);
    line(x + 250, y + 12, x + 200, y + 48, 2, [255, 120, 60]);
    line(x + 290, y + 4, x + 250, y + 40, 2, [255, 120, 60]);
    fillCircle(x + 150, y + 44, 3, [255, 180, 80]);
    fillCircle(x + 200, y + 48, 3, [255, 180, 80]);
    fillCircle(x + 250, y + 40, 3, [255, 180, 80]);
    // badge
    fillRect(x + w - 92, y + 6, 86, 16, RED);
    drawText("3 DOWNED", x + w - 49, y + 18, 10, { font: "sans", t: 9, color: WHITE, align: "center" });
  } else {
    fillRect(x, y, w, h, [232, 220, 200]);
    // mountains
    fillPoly([[[x + 8, y + h], [x + 60, y + 12], [x + 112, y + h]]], [122, 104, 84]);
    fillPoly([[[x + 48, y + 22], [x + 60, y + 12], [x + 72, y + 22]]], WHITE);
    fillPoly([[[x + 90, y + h], [x + 150, y + 20], [x + 210, y + h]]], [96, 82, 66]);
    fillPoly([[[x + 140, y + 28], [x + 150, y + 20], [x + 160, y + 28]]], WHITE);
    // seismograph strip
    box(x + 216, y + 8, 104, 34, WHITE, INK, 1);
    const zx = x + 220, zy = y + 25;
    const pts: [number, number][] = [[zx, zy], [zx + 10, zy - 8], [zx + 16, zy + 6], [zx + 24, zy - 14], [zx + 30, zy + 10], [zx + 38, zy - 6], [zx + 46, zy + 12], [zx + 54, zy - 16], [zx + 62, zy + 8], [zx + 70, zy - 4], [zx + 78, zy + 6], [zx + 88, zy - 10], [zx + 96, zy]];
    for (let i = 0; i < pts.length - 1; i++) line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 2, RED);
    drawText("6.7", x + 216, y + 62, 20, { font: "serif", t: 10, color: RED });
  }
}
function midIllo(n: number, x: number, y: number, w: number, h: number): void {
  if (n === 4) {
    fillRect(x, y, w, h, [232, 220, 200]);
    fillRect(x + 12, y + 14, 30, h - 14, [120, 100, 70]);
    fillRect(x + 48, y + 8, 36, h - 8, [140, 118, 84]);
    fillPoly([[[x + 100, y + 26], [x + 112, y + 6], [x + 124, y + 26]]], [230, 110, 30]);
    drawText("2 BASES HIT", x + 128, y + 26, 11, { font: "sans", t: 9, color: RED });
  } else if (n === 5) {
    fillRect(x, y, w, h, [127, 179, 213]);
    fillRect(x + 20, y + 18, 90, 12, [40, 44, 52]);
    fillRect(x + 30, y + 6, 18, 12, [180, 60, 40]);
    fillRect(x + 52, y + 6, 18, 12, [60, 120, 80]);
    fillRect(x + 74, y + 6, 18, 12, [200, 160, 60]);
    fillPoly([[[x + 130, y + 18], [x + 138, y + 4], [x + 146, y + 18]]], [230, 110, 30]);
    drawText("2 HIT", x + 160, y + 26, 11, { font: "sans", t: 9, color: RED });
  } else if (n === 6) {
    fillRect(x, y, w, h, [127, 179, 213]);
    fillRect(x + 16, y + 20, 80, 10, [52, 56, 64]);
    fillRect(x + 60, y + 8, 12, 12, [52, 56, 64]);
    fillPoly([[[x + 108, y + 20], [x + 116, y + 6], [x + 124, y + 20]]], [230, 110, 30]);
    fillCircle(x + 128, y + 10, 5, [120, 120, 120]);
    fillCircle(x + 138, y + 6, 4, [140, 140, 140]);
  } else if (n === 7) {
    fillRect(x, y, w, h, [43, 43, 58]);
    line(x + 30, y + 30, x + 90, y + 6, 3, [255, 120, 60]);
    fillCircle(x + 92, y + 6, 4, [255, 200, 90]);
    fillPoly([[[x + 120, y + 4], [x + 128, y + 12], [x + 140, y + 8], [x + 134, y + 20], [x + 142, y + 28], [x + 128, y + 26], [x + 122, y + 30], [x + 118, y + 18]]], [255, 200, 90]);
    drawText("05:47", x + 150, y + 26, 12, { font: "sans", t: 9, color: WHITE });
  } else if (n === 8) {
    fillRect(x, y, w, h, [232, 220, 200]);
    fillCircle(x + 40, y + 18, 12, [200, 160, 60]);
    fillPoly([[[x + 40, y + 8], [x + 43, y + 15], [x + 50, y + 15], [x + 44, y + 19], [x + 47, y + 26], [x + 40, y + 22], [x + 33, y + 26], [x + 36, y + 19], [x + 30, y + 15], [x + 37, y + 15]]], [120, 90, 20]);
    drawText("11 DEAD", x + 70, y + 24, 12, { font: "sans", t: 9, color: RED });
  } else if (n === 9) {
    fillRect(x, y, w, h, WHITE);
    fillRect(x + 12, y + 6, 46, 24, [0, 51, 153]);
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; fillCircle(x + 35 + 8 * Math.cos(a), y + 18 + 8 * Math.sin(a), 1.6, [255, 204, 0]); }
    fillRect(x + 64, y + 6, 46, 12, [210, 30, 30]);
    fillRect(x + 64, y + 18, 46, 12, WHITE);
    drawText("98.5%", x + 130, y + 26, 13, { font: "serif", t: 10, color: RED });
  } else if (n === 10) {
    fillRect(x, y, w, h, [220, 232, 240]);
    fillRect(x + 88, y + 14, 22, 8, [40, 44, 52]);
    line(x + 70, y + 18, x + 128, y + 18, 2, [40, 44, 52]);
    fillCircle(x + 68, y + 18, 5, [90, 95, 105]);
    fillCircle(x + 130, y + 18, 5, [90, 95, 105]);
    line(x + 99, y + 22, x + 99, y + 30, 2, [40, 44, 52]);
    drawText("3 KILLED", x + 150, y + 24, 11, { font: "sans", t: 9, color: RED });
  } else if (n === 11) {
    fillRect(x, y, w, h, [245, 230, 200]);
    fillCircle(x + 34, y + 16, 13, [240, 180, 60]);
    drawText("B", x + 34, y + 22, 16, { font: "serif", t: 10, color: [120, 80, 10], align: "center" });
    line(x + 62, y + 6, x + 62, y + 22, 3, RED);
    fillPoly([[[x + 56, y + 22], [x + 68, y + 22], [x + 62, y + 28]]], RED);
    drawText("$58,983", x + 80, y + 24, 12, { font: "serif", t: 10, color: INK });
  } else if (n === 12) {
    fillRect(x, y, w, h, [232, 220, 200]);
    for (let i = 0; i < 5; i++) {
      fillCircle(x + 22 + i * 18, y + 14, 6, [90, 70, 50]);
      fillEllipse(x + 22 + i * 18, y + 24, 9, 6, [70, 90, 140]);
    }
    fillRect(x + 130, y + 4, 4, 18, [90, 70, 50]);
    fillRect(x + 122, y + 4, 30, 12, WHITE);
    drawText("82,500", x + 146, y + 24, 11, { font: "serif", t: 10, color: INK });
  } else {
    fillRect(x, y, w, h, [200, 230, 201]);
    fillPoly([[[x + 20, y + 28], [x + 30, y + 6], [x + 38, y + 10], [x + 28, y + 30]]], [150, 110, 60]);
    fillCircle(x + 52, y + 24, 6, [185, 28, 28]);
    drawText("136", x + 80, y + 26, 16, { font: "serif", t: 10, color: INK });
    drawText("IND 486-4", x + 120, y + 26, 10, { font: "sans", t: 9, color: INK });
  }
}
function drawHero(p: Panel, x: number, y: number, w: number, h: number): void {
  box(x, y, w, h, WHITE);
  labelBar(x, y, w, 18, p.n, p.tag, p.kind, p.region);
  heroIllo(p.n, x + 1, y + 19, w - 2, 64);
  drawText(p.loc, x + 10, y + 95, 10, { font: "sans", t: 9, color: INK, tracking: 0.4 });
  const hl = fitLines(p.head, 26, w - 20, 2, { font: "serif", t: 10 });
  hl.forEach((ln, i) => drawText(ln, x + 10, y + 125 + i * 29, 26, { font: "serif", t: 10, color: INK }));
  const bl = fitLines(p.body, 12, w - 20, 2, { font: "sans", t: 6.5 });
  bl.forEach((ln, i) => drawText(ln, x + 10, y + 169 + i * 14, 12, { font: "sans", t: 6.5, color: INK }));
  drawText(p.src, x + 10, y + h - 4, 9.5, { font: "sans", t: 6.5, color: MUTED });
}
function drawMid(p: Panel, x: number, y: number, w: number, h: number): void {
  box(x, y, w, h, WHITE);
  labelBar(x, y, w, 15, p.n, p.tag, p.kind, p.region);
  midIllo(p.n, x + 1, y + 16, w - 2, 30);
  drawText(p.loc, x + 8, y + 56, 9, { font: "sans", t: 9, color: INK, tracking: 0.3 });
  const hl = fitLines(p.head, 17, w - 16, 2, { font: "serif", t: 10 });
  hl.forEach((ln, i) => drawText(ln, x + 8, y + 74 + i * 18, 17, { font: "serif", t: 10, color: INK }));
  const bl = fitLines(p.body, 11, w - 16, 2, { font: "sans", t: 6.5 });
  bl.forEach((ln, i) => drawText(ln, x + 8, y + 105 + i * 12, 11, { font: "sans", t: 6.5, color: INK }));
  drawText(p.src, x + 8, y + h - 6, 9, { font: "sans", t: 6.5, color: MUTED });
}

// ---------- world map (dotted, pins 1-36) ----------
const LAND: [number, number][][] = [
  [[-168, 66], [-140, 70], [-125, 72], [-110, 68], [-95, 69], [-85, 66], [-80, 73], [-70, 62], [-65, 60], [-55, 52], [-60, 47], [-70, 44], [-75, 39], [-80, 32], [-81, 26], [-84, 30], [-90, 21], [-97, 16], [-94, 17], [-90, 14], [-83, 9], [-79, 9], [-86, 12], [-92, 15], [-97, 26], [-105, 20], [-110, 23], [-117, 33], [-125, 40], [-124, 48], [-130, 55], [-145, 60], [-155, 58], [-165, 60]],
  [[-55, 60], [-45, 60], [-40, 64], [-30, 68], [-22, 70], [-25, 76], [-35, 80], [-50, 80], [-58, 76], [-60, 70]],
  [[-79, 9], [-77, 4], [-80, -3], [-81, -6], [-77, -12], [-72, -18], [-70, -23], [-70, -30], [-73, -37], [-73, -44], [-71, -50], [-68, -52], [-66, -55], [-68, -50], [-62, -41], [-58, -34], [-52, -32], [-48, -28], [-41, -23], [-39, -17], [-35, -9], [-35, -6], [-40, -3], [-44, -2], [-50, 0], [-55, 6], [-60, 8], [-68, 11], [-75, 10]],
  [[-17, 15], [-17, 21], [-15, 27], [-10, 31], [-5, 35], [0, 36], [10, 37], [11, 34], [20, 32], [30, 31], [32, 31], [34, 28], [35, 23], [37, 18], [40, 15], [43, 12], [48, 11], [51, 12], [46, 5], [42, 0], [40, -5], [40, -12], [36, -18], [33, -26], [28, -33], [20, -35], [17, -29], [14, -22], [12, -18], [13, -12], [12, -6], [9, 4], [4, 6], [-8, 5], [-13, 8], [-17, 12]],
  [[-10, 36], [-9, 43], [-2, 44], [-1, 46], [-4, 48], [-2, 50], [2, 51], [5, 53], [8, 57], [10, 59], [18, 56], [21, 55], [24, 58], [28, 59], [30, 60], [28, 62], [25, 65], [20, 70], [25, 71], [30, 70], [40, 68], [50, 69], [60, 69], [70, 72], [80, 73], [90, 75], [100, 77], [110, 74], [120, 73], [130, 72], [140, 72], [150, 70], [160, 70], [170, 67], [178, 65], [170, 60], [162, 56], [158, 52], [150, 60], [142, 55], [142, 50], [140, 45], [135, 43], [130, 42], [127, 40], [122, 38], [120, 35], [122, 31], [118, 25], [110, 20], [108, 18], [105, 10], [103, 8], [100, 6], [98, 10], [95, 16], [92, 21], [90, 22], [86, 20], [82, 17], [80, 15], [77, 8], [75, 12], [72, 20], [68, 22], [66, 25], [62, 25], [58, 26], [56, 27], [52, 28], [50, 29], [48, 30], [44, 29], [42, 27], [40, 25], [38, 22], [35, 23], [34, 28], [36, 36], [30, 36], [27, 37], [23, 36], [22, 39], [19, 42], [15, 44], [12, 44], [10, 44], [8, 44], [3, 43], [0, 40], [-2, 37], [-6, 36], [-9, 36]],
  [[95, 5], [98, 3], [100, 0], [103, -2], [106, -6], [110, -7], [114, -8], [119, -9], [122, -10], [125, -9], [128, -8], [130, -4], [132, -2], [135, -3], [138, -5], [140, -8], [137, -6], [132, -4], [128, 0], [125, 2], [122, 4], [118, 5], [115, 4], [112, 3], [108, 2], [105, 0], [102, 2], [98, 4]],
  [[130, 31], [132, 33], [134, 34], [137, 35], [139, 36], [140, 38], [141, 41], [143, 43], [145, 44], [143, 42], [141, 39], [139, 37], [137, 35], [135, 34], [132, 33]],
  [[-5, 50], [-3, 53], [-5, 56], [-3, 58], [-1, 57], [0, 53], [1, 51]],
  [[114, -22], [113, -26], [115, -32], [118, -35], [124, -33], [129, -32], [132, -32], [135, -35], [138, -35], [140, -38], [145, -38], [150, -37], [153, -32], [153, -27], [150, -22], [146, -19], [142, -15], [142, -11], [137, -12], [135, -15], [132, -12], [130, -13], [126, -14], [122, -17], [118, -20]],
  [[167, -45], [170, -42], [173, -40], [175, -38], [177, -38], [175, -40], [172, -43], [168, -46]],
];
function inPoly(lon: number, lat: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const PIN_LONLAT: [number, number, number, string][] = [
  [1, 30.7, 36.9, "Global"], [2, 46.7, 24.7, "Middle East"], [3, -75.9, -11.2, "Americas"],
  [4, 50.6, 26.2, "Middle East"], [5, 56.2, 26.2, "Middle East"], [6, 24, 60, "Europe"],
  [7, 30.5, 50.4, "Europe"], [8, -108.5, 25.6, "Americas"], [9, 4.35, 50.85, "Europe"],
  [10, 34.5, 31.5, "Middle East"], [11, -0.1, 51.5, "Global"], [12, 2.35, 48.85, "Europe"],
  [13, 174.8, -41.3, "Oceania"], [14, 33.4, 47.9, "Europe"], [15, 24.0, 49.8, "Europe"],
  [16, 125.6, 7.07, "Asia"], [17, 127.0, -8.5, "Asia"], [18, 6.14, 46.2, "Europe"],
  [19, 121, 23.5, "Asia"], [20, 28.8, 59.7, "Europe"], [21, -47.9, -15.8, "Americas"],
  [22, 47.8, 30.5, "Middle East"], [23, 28.2, -25.7, "Africa"], [24, -115.1, 36.2, "Americas"],
  [25, -0.33, 51.45, "Europe"], [26, -159.8, -21.2, "Oceania"], [27, 30.5, 50.4, "Europe"],
  [28, 30.7, 36.9, "Global"], [29, 30.7, 36.9, "Global"], [30, 39.2, 21.5, "Middle East"],
  [31, -77, 38.9, "Americas"], [32, -99, 31, "Americas"], [33, -123.1, 49.3, "Americas"],
  [34, 125.75, 39.03, "Asia"], [35, 100.5, 13.75, "Asia"], [36, 145, -37.8, "Oceania"],
];
function drawMap(x: number, y: number, w: number, h: number): void {
  // equirectangular: lon -180..180 -> x..x+w ; lat 78..-58 -> y..y+h
  const px = (lon: number): number => x + (lon + 180) / 360 * w;
  const py = (lat: number): number => y + (78 - lat) / 136 * h;
  for (let gy = y + 3; gy < y + h - 2; gy += 5) {
    for (let gx = x + 3; gx < x + w - 2; gx += 5) {
      const lon = (gx - x) / w * 360 - 180;
      const lat = 78 - (gy - y) / h * 136;
      for (const poly of LAND) {
        if (inPoly(lon, lat, poly)) { fillCircle(gx, gy, 1.3, [183, 171, 142]); break; }
      }
    }
  }
  // pins: relax true positions so none overlap (deterministic, fixed iterations)
  const pins = PIN_LONLAT.map(([n, lon, lat, r]) => ({ n, x: px(lon), y: py(lat), ox: px(lon), oy: py(lat), r }));
  for (let it = 0; it < 80; it++) {
    for (let i = 0; i < pins.length; i++) {
      for (let j = i + 1; j < pins.length; j++) {
        const a = pins[i], b = pins[j];
        let dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d < 16) {
          dx /= d; dy /= d;
          const push = (16 - d) / 2;
          a.x -= dx * push; a.y -= dy * push;
          b.x += dx * push; b.y += dy * push;
        }
      }
    }
    for (const p of pins) {
      p.x += (p.ox - p.x) * 0.02; p.y += (p.oy - p.y) * 0.02;
      p.x = Math.max(x + 9, Math.min(x + w - 9, p.x));
      p.y = Math.max(y + 9, Math.min(y + h - 9, p.y));
    }
  }
  for (const p of pins) {
    fillCircle(p.x, p.y, 8.5, WHITE);
    fillCircle(p.x, p.y, 7.5, REGION[p.r]);
    drawText(String(p.n), p.x, p.y + 3.2, 9, { font: "sans", t: 9, color: WHITE, align: "center" });
  }
}

// ---------- PAGE ----------
function drawPage(): void {
  fillBuf(...PAPER);
  // 1. top kicker
  fillRect(0, 0, W, 2, RED);
  drawText("THE WORLD IN ONE DAY", 12, 15, 11, { font: "sans", t: 9, color: RED });
  drawText("36 STORIES · 7 REGIONS · EVERY ONE DATED", 1012, 15, 11, { font: "sans", t: 9, color: RED, align: "right" });
  fillRect(0, 21, W, 1, INK);
  // 2. masthead — classic Times serif, solid, readable at 300px
  drawText("Saturday 21 November 2026", 512, 88, 62, { font: "serif", t: 10, color: INK, align: "center" });
  fillRect(0, 99, W, 2, INK);
  // 3. sub-kicker (italic)
  drawText("Climate talks run into day 13 · Three missiles downed over Riyadh · M6.7 quake shakes central Peru", 512, 114, 15, { font: "serif", t: 7, color: INK, italic: true, align: "center" });
  fillRect(0, 119, W, 1, INK);
  // 4. stat strip
  const stats: [string, string][] = [
    ["13", "Day of COP31, planned to close day 12"],
    ["3", "missiles shot down over Riyadh"],
    ["6.7", "magnitude of Peru quake, 108 km deep"],
    ["146", "people safe after Davao jet emergency"],
    ["$58,983", "Bitcoin early Saturday, down 3.9% in a day"],
    ["136", "Rahul's score as India lead NZ by 118"],
  ];
  const colW = 1000 / 6;
  stats.forEach(([num, lab], i) => {
    const cx = 12 + i * colW;
    if (i > 0) fillRect(cx, 126, 1, 42, [190, 182, 164]);
    drawText(num, cx + colW / 2, 148, 28, { font: "serif", t: 10, color: INK, align: "center" });
    const ll = fitLines(lab, 10, colW - 12, 2, { font: "sans", t: 6.5 });
    ll.forEach((ln, j) => drawText(ln, cx + colW / 2, 160 + j * 12, 10, { font: "sans", t: 6.5, color: INK, align: "center" }));
  });
  fillRect(0, 174, W, 1, INK);
  // 5. region bar
  const regions: [string, number][] = [["Europe", 10], ["Middle East", 6], ["Asia", 5], ["Africa", 1], ["Americas", 7], ["Oceania", 3], ["Global", 4]];
  let rx = 12;
  for (const [name, cnt] of regions) {
    const rw = cnt / 36 * 1000;
    fillRect(rx, 176, rw, 16, REGION[name]);
    drawText(name + " " + cnt, rx + rw / 2, 188, 10.5, { font: "sans", t: 9, color: WHITE, align: "center" });
    rx += rw;
  }
  // 6. timeline
  fillRect(12, 194, 110, 24, INK);
  drawText("THE DAY IN UTC", 67, 210, 10, { font: "sans", t: 9, color: WHITE, align: "center" });
  const moments: [string, string][] = [
    ["00:09", "Peru M6.7 quake"], ["02:00", "Sinaloa raid"], ["03:45", "Killer-robot talks end"],
    ["05:47", "Kyiv missiles"], ["09:42", "Banda Sea M6.8"], ["13:30", "Bitcoin rebounds"], ["22:10", "COP31 pauses to Sunday"],
  ];
  moments.forEach(([tm, lab], i) => {
    const mx = 126 + i * (886 / 7);
    if (i > 0) fillRect(mx - 3, 196, 1, 20, [190, 182, 164]);
    drawText(tm, mx + 4, 207, 12, { font: "sans", t: 9, color: RED });
    drawText(lab, mx + 4, 217, 10, { font: "sans", t: 6.5, color: INK });
  });
  // 7. hero row
  const hw = 330, hg = 198, hy = 222;
  HEROES.forEach((p, i) => drawHero(p, 12 + i * (hw + 5), hy, hw, hg));
  // 8. mid grid
  const mw = 196, mh = 136;
  MIDS.forEach((p, i) => {
    const row = Math.floor(i / 5), col = i % 5;
    drawMid(p, 12 + col * (mw + 5), 424 + row * (mh + 4), mw, mh);
  });
  // 9. map + list
  box(12, 704, 330, 236, WHITE);
  fillRect(12, 704, 330, 18, INK);
  drawText("WHERE IT HAPPENED", 20, 717, 11, { font: "sans", t: 9, color: WHITE });
  drawText("pin numbers match the stories", 334, 717, 9, { font: "sans", t: 6.5, color: [200, 195, 185], align: "right" });
  drawMap(14, 724, 326, 214);
  box(354, 704, 658, 236, WHITE);
  fillRect(354, 704, 658, 18, INK);
  drawText("ALSO ON SATURDAY 21 NOVEMBER — 23 MORE STORIES", 362, 717, 11, { font: "sans", t: 9, color: WHITE });
  drawText("one line each · source in brackets", 1004, 717, 9, { font: "sans", t: 6.5, color: [200, 195, 185], align: "right" });
  LIST.forEach((it, i) => {
    const col = i < 12 ? 0 : 1, row = i % 12;
    const lx = 354 + col * 332 + 10, ly = 730 + row * 17;
    checkW(it.text, 11, 300, { font: "sans", t: 6.5 }, "list " + it.n);
    fillCircle(lx + 8, ly + 5, 8, REGION[it.region]);
    drawText(String(it.n), lx + 8, ly + 8.2, 9, { font: "sans", t: 9, color: WHITE, align: "center" });
    drawText(it.text, lx + 22, ly + 8.5, 11, { font: "sans", t: 6.5, color: INK });
  });
  // 10. date check
  box(12, 944, 1000, 46, WHITE, RED, 2);
  drawText("DATE CHECK — ", 20, 959, 11, { font: "sans", t: 9, color: RED });
  const dcPre = measure("DATE CHECK — ", 11, { font: "sans", t: 9 });
  const dc = "Left out as earlier news: Wall Street's fall into a correction (Fri 20 Nov) · Russian barrage on Kyiv's bridges (Fri) · missile that landed in Poland (Fri 20 Nov) · UK–EU deal (Fri) · Cyclone Akvan's landfall (Fri) · Denmark's expulsion of a Russian attache (20 Nov) · ICJ Myanmar ruling (19 Nov) · Trump–Xi–Putin Shenzhen summit (19–20 Nov). Not yet known when drawn: COP31's final vote (Sun 09:00) · BepiColombo Mercury orbit insertion.";
  const dcLines = wrap(dc, 11, 1000 - 20 - dcPre - 8, { font: "sans", t: 6.5 });
  // first line starts after the red label on the same baseline
  drawText(dcLines[0], 20 + dcPre, 959, 11, { font: "sans", t: 6.5, color: INK });
  dcLines.slice(1, 3).forEach((ln, i) => drawText(ln, 20, 959 + (i + 1) * 13, 11, { font: "sans", t: 6.5, color: INK }));
  if (dcLines.length > 3) console.error("OVERFLOW datecheck lines=" + dcLines.length);
  // 11. footer
  drawText("Every story here happened, or was first reported, on Saturday 21 November 2026. Officials' counts and claims are attributed.", 512, 1005, 11, { font: "serif", t: 7, color: INK, align: "center" });
  const leg = "CONFIRMED = 2+ outlets  ·  OFFICIAL = as stated by authorities  ·  REPORTED = one outlet  ·  Sources named beside each story  ·  Original drawings";
  const legW = measure(leg, 9.5, { font: "sans", t: 6.5 });
  const ck = 512 - legW / 2 - 22;
  line(ck, 1016, ck + 5, 1021, 1.6, INK);
  line(ck + 5, 1021, ck + 14, 1010, 1.6, INK);
  drawText(leg, 512, 1020, 9.5, { font: "sans", t: 6.5, color: MUTED, align: "center" });
}

// write a crop of the SS buffer at 3x (for 2x+ inspection), region in 1024-space
function writeCrop(outDir: string, name: string, x: number, y: number, w: number, h: number): void {
  const cw = w * SS, ch = h * SS;
  const rgb = new Uint8Array(cw * ch * 3);
  for (let yy = 0; yy < ch; yy++) {
    const sy = y * SS + yy;
    for (let xx = 0; xx < cw; xx++) {
      const sx = x * SS + xx;
      const si = (sy * SW + sx) * 3, di = (yy * cw + xx) * 3;
      rgb[di] = buf[si]; rgb[di + 1] = buf[si + 1]; rgb[di + 2] = buf[si + 2];
    }
  }
  writePNG(outDir + "/" + name + ".png", rgb, cw, ch);
}
// downsample to 300x300 for the legibility check
function write300(outDir: string): void {
  const rgb = downsample();
  const out = new Uint8Array(300 * 300 * 3);
  for (let y = 0; y < 300; y++) for (let x = 0; x < 300; x++) {
    const sx = Math.floor(x * W / 300), sy = Math.floor(y * H / 300);
    const si = (sy * W + sx) * 3, di = (y * 300 + x) * 3;
    out[di] = rgb[si]; out[di + 1] = rgb[si + 1]; out[di + 2] = rgb[si + 2];
  }
  writePNG(outDir + "/entry-300.png", out, 300, 300);
}

function main(): void {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "out";
  fs.mkdirSync(outDir, { recursive: true });
  if (process.env.DEBUG_GLYPH) {
    for (const ch of process.env.DEBUG_GLYPH) {
      const g = glyph(ch, 10, true);
      console.log(JSON.stringify({ ch, a: g.a, c: g.c }));
    }
    return;
  }
  if (process.env.DIAG1) {
    fillBuf(247, 243, 232);
    drawText(process.env.DIAG1, 20, 400, 200, { font: "serif", t: 10, color: [20, 20, 20] });
    drawText(process.env.DIAG1, 20, 700, 200, { font: "sans", t: 6.5, color: [20, 20, 20] });
    writePNG(outDir + "/diag1.png", downsample(), W, H);
    return;
  }
  if (process.env.TEST_STRIP === "1") { testStrip(outDir); return; }
  drawPage();
  writePNG(outDir + "/entry.png", downsample(), W, H);
  if (process.env.DEV300 === "1") write300(outDir);
  if (process.env.CROP) {
    for (const spec of process.env.CROP.split(";")) {
      const [name, xs, ys, ws, hs] = spec.split(",");
      writeCrop(outDir, name, +xs, +ys, +ws, +hs);
    }
  }
}
main();
