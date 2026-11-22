// news-image-20261121 v6 — "Saturday 21 November 2026: 36 dated stories"
// A broadsheet front page drawn entirely in code (Node 22/24 stdlib only).
// FONT FIX (v6): every glyph is a SOLID FILLED vector shape — classic Times-style
// serif for masthead/headlines, clean geometric sans for body. No outline/stroke
// glyphs, no hatch/scanline patterns, so no horizontal line can strike through
// any letter. Rendered at 2x supersampling, box-downsampled for anti-aliasing.
// Deterministic: no Date, no random, no network.
import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

// ---------------------------------------------------------------- PNG encoder
const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}
function encodePNG(w: number, h: number, rgb: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (1 + w * 3) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ canvas
// Supersampled 2x buffer: all drawing happens in 1024-space coords, scaled x2.
const W = 1024, H = 1024, SS = 2;
const buf = new Uint8Array(W * SS * H * SS * 3);
type RGB = [number, number, number];
const CREAM: RGB = [247, 243, 232];
const INK: RGB = [20, 20, 20];
const RED: RGB = [185, 28, 28];
const WHITE: RGB = [255, 255, 255];
const GREY: RGB = [90, 88, 80];
const LIGHTGREY: RGB = [232, 228, 218];
const BLUEGREY: RGB = [214, 222, 228];
const NAVY: RGB = [24, 32, 54];
const GOLD: RGB = [191, 146, 32];

function px(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= W * SS || y >= H * SS) return;
  const i = (y * W * SS + x) * 3;
  buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
}
function fillRect(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  const X0 = Math.max(0, Math.round(x0 * SS)), X1 = Math.min(W * SS, Math.round(x1 * SS));
  const Y0 = Math.max(0, Math.round(y0 * SS)), Y1 = Math.min(H * SS, Math.round(y1 * SS));
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) {
    const i = (y * W * SS + x) * 3;
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
  }
}
function hline(x0: number, x1: number, y: number, c: RGB, th = 1): void {
  fillRect(x0, y - th / 2, x1, y + th / 2, c);
}
function vline(x: number, y0: number, y1: number, c: RGB, th = 1): void {
  fillRect(x - th / 2, y0, x + th / 2, y1, c);
}
function rectStroke(x0: number, y0: number, x1: number, y1: number, c: RGB, th = 1): void {
  fillRect(x0, y0, x1, y0 + th, c); fillRect(x0, y1 - th, x1, y1, c);
  fillRect(x0, y0, x0 + th, y1, c); fillRect(x1 - th, y0, x1, y1, c);
}
// Even-odd scanline fill of polygons given in 1024-space coords.
type Pt = [number, number];
function fillPoly(pts: Pt[], c: RGB): void {
  if (pts.length < 3) return;
  const P = pts.map(([x, y]) => [x * SS, y * SS] as Pt);
  let yMin = Infinity, yMax = -Infinity;
  for (const [, y] of P) { if (y < yMin) yMin = y; if (y > yMax) yMax = y; }
  const Y0 = Math.max(0, Math.ceil(yMin)), Y1 = Math.min(H * SS - 1, Math.floor(yMax));
  for (let y = Y0; y <= Y1; y++) {
    const yc = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < P.length; i++) {
      const [x0, y0] = P[i], [x1, y1] = P[(i + 1) % P.length];
      if (y0 === y1) continue;
      const lo = Math.min(y0, y1), hi = Math.max(y0, y1);
      if (yc < lo || yc >= hi) continue;
      xs.push(x0 + (yc - y0) * (x1 - x0) / (y1 - y0));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const X0 = Math.max(0, Math.ceil(xs[k])), X1 = Math.min(W * SS - 1, Math.floor(xs[k + 1]));
      for (let x = X0; x <= X1; x++) {
        const i = (y * W * SS + x) * 3;
        buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
      }
    }
  }
}
function fillEllipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
  const pts: Pt[] = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  fillPoly(pts, c);
}
function fillCircle(cx: number, cy: number, r: number, c: RGB): void {
  fillEllipse(cx, cy, r, r, c);
}
// Thick line as a filled parallelogram.
function thickLine(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB): void {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * w / 2, ny = (dx / len) * w / 2;
  fillPoly([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]], c);
}

// ============================================================ FILLED VECTOR FONT
// Every glyph is a set of SOLID FILLED contours in em space (em = 100 units,
// baseline y = 0, cap height 70, x-height 50, descender -24). Nothing is drawn
// as a stroke/outline and no hatch pattern exists anywhere, so no horizontal
// line can ever cut through a letter. Two styles share one skeleton:
//   serif = true  -> classic Times-style newspaper serif (masthead, headlines)
//   serif = false -> clean geometric sans (body, labels, list)
// Contours are filled with the even-odd scanline rule, so rings (O, D, bowls)
// are an outer contour plus a reversed inner contour.
type Contour = Pt[];
const R = (x0: number, y0: number, x1: number, y1: number): Contour =>
  [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
function ell(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 26): Pt[] {
  const pts: Pt[] = [];
  const steps = Math.max(4, Math.round(n * Math.abs(a1 - a0) / (Math.PI * 2)));
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (a1 - a0) * (i / steps);
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}
function ring(cx: number, cy: number, rx: number, ry: number, t: number): Contour[] {
  // One merged contour (outer ellipse, then inner ellipse reversed): a ring
  // with a slit. Filled alone it leaves a clean white counter; two separate
  // contours would each fill solid and the letter would become a black blob.
  return [[
    ...ell(cx, cy, rx, ry, 0, Math.PI * 2),
    ...ell(cx, cy, Math.max(1, rx - t), Math.max(1, ry - t), 0, Math.PI * 2).reverse(),
  ]];
}
// Partial ring band from angle a0 to a1 (radians, y up).
function arc(cx: number, cy: number, rx: number, ry: number, t: number, a0: number, a1: number): Contour[] {
  const outer = ell(cx, cy, rx, ry, a0, a1);
  const inner = ell(cx, cy, Math.max(1, rx - t), Math.max(1, ry - t), a1, a0);
  return [[...outer, ...inner]];
}
// Bowl wall: vertical stem edge at x0 plus a half-ellipse wall to xR.
function bowl(x0: number, yB: number, yT: number, xR: number, t: number): Contour[] {
  const cy = (yB + yT) / 2, ry = (yT - yB) / 2, rx = xR - x0;
  const outer = ell(x0, cy, rx, ry, Math.PI / 2, -Math.PI / 2);
  const inner = ell(x0, cy, Math.max(1, rx - t), Math.max(1, ry - t), -Math.PI / 2, Math.PI / 2);
  return [[...outer, ...inner]];
}
// Vertical stem, optionally with flared serif feet (top + bottom).
function stem(x: number, y0: number, y1: number, w: number, serif: boolean): Contour[] {
  const cs: Contour[] = [R(x, y0, x + w, y1)];
  if (serif) {
    const s = 3.4, h = 5;
    cs.push([[x - s, y0], [x + w + s, y0], [x + w + 0.8, y0 + h], [x - 0.8, y0 + h]]);
    cs.push([[x - s, y1], [x + w + s, y1], [x + w + 0.8, y1 - h], [x - 0.8, y1 - h]]);
  }
  return cs;
}
// Horizontal bar, optionally with small serif ticks at the ends.
function bar(x0: number, x1: number, y: number, w: number, serif: boolean): Contour[] {
  const cs: Contour[] = [R(x0, y, x1, y + w)];
  if (serif) {
    cs.push(R(x0, y - 2.2, x0 + 2.4, y + w + 2.2));
    cs.push(R(x1 - 2.4, y - 2.2, x1, y + w + 2.2));
  }
  return cs;
}
// Diagonal thick stroke as a filled parallelogram.
function diag(x0: number, y0: number, x1: number, y1: number, w: number): Contour {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * w / 2, ny = (dx / len) * w / 2;
  return [[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]];
}
function dot(cx: number, cy: number, r: number): Contour {
  return ell(cx, cy, r, r, 0, Math.PI * 2);
}

interface Glyph { adv: number; cs: Contour[]; }
// sw = stem width, bw = horizontal stroke, cw = curve thickness.
function glyph(ch: string, serif: boolean): Glyph {
  const sw = serif ? 8.5 : 10, bw = serif ? 5 : 6.5, cw = serif ? 8 : 9.5;
  const S = (x: number, y0: number, y1: number, w = sw): Contour[] => stem(x, y0, y1, w, serif);
  const B = (x0: number, x1: number, y: number, w = bw): Contour[] => bar(x0, x1, y, w, serif);
  switch (ch) {
    case "A": return { adv: 72, cs: [diag(8, 0, 36, 70, sw), diag(64, 0, 36, 70, sw), R(21, 24, 51, 24 + bw),
      ...(serif ? [R(2, 0, 14, 4.5), R(58, 0, 70, 4.5)] : [])] };
    case "B": return { adv: 64, cs: [...S(4, 0, 70), ...bowl(12, 36, 70, 60, cw), ...bowl(12, 0, 38, 62, cw), R(12, 33, 44, 38)] };
    case "C": return { adv: 68, cs: arc(36, 35, 31, 35, cw, 0.96, 5.32) };
    case "D": return { adv: 70, cs: [...S(4, 0, 70), ...bowl(12, 0, 70, 64, cw)] };
    case "E": return { adv: 60, cs: [...S(4, 0, 70), ...B(4, 58, 70 - bw), ...B(4, 50, 33), ...B(4, 58, 0)] };
    case "F": return { adv: 56, cs: [...S(4, 0, 70), ...B(4, 54, 70 - bw), ...B(4, 48, 33)] };
    case "G": return { adv: 72, cs: [...arc(36, 35, 31, 35, cw, 0.96, 5.32), R(36, 24, 68, 30), R(62, 24, 68, 40)] };
    case "H": return { adv: 72, cs: [...S(4, 0, 70), ...S(60, 0, 70), ...B(12, 60, 32)] };
    case "I": return { adv: 32, cs: S(11, 0, 70) };
    case "J": return { adv: 54, cs: [...S(34, 14, 70, sw), ...arc(32, 16, 22, 16, cw, Math.PI, Math.PI * 2),
      ...(serif ? [R(30, 66, 48, 70)] : [])] };
    case "K": return { adv: 68, cs: [...S(4, 0, 70), diag(14, 38, 58, 70, sw * 0.9), diag(20, 34, 60, 0, sw * 0.9)] };
    case "L": return { adv: 58, cs: [...S(4, 0, 70), ...B(4, 56, 0)] };
    case "M": return { adv: 86, cs: [...S(4, 0, 70), ...S(74, 0, 70), diag(12, 70, 43, 18, sw * 0.9), diag(74, 70, 43, 18, sw * 0.9)] };
    case "N": return { adv: 74, cs: [...S(4, 0, 70), ...S(62, 0, 70), diag(12, 70, 62, 0, sw * 0.9)] };
    case "O": return { adv: 74, cs: ring(37, 35, 31, 35, cw) };
    case "P": return { adv: 62, cs: [...S(4, 0, 70), ...bowl(12, 34, 70, 58, cw)] };
    case "Q": return { adv: 74, cs: [...ring(37, 35, 31, 35, cw), diag(52, 14, 68, -4, sw * 0.9)] };
    case "R": return { adv: 66, cs: [...S(4, 0, 70), ...bowl(12, 34, 70, 58, cw), diag(18, 32, 60, 0, sw * 0.9)] };
    case "S": return { adv: 62, cs: [...arc(31, 50, 27, 19, cw, -0.35, 3.5), ...arc(31, 20, 27, 19, cw, 2.79, 6.63)] };
    case "T": return { adv: 62, cs: [...B(2, 60, 65), ...S(26, 0, 65)] };
    case "U": return { adv: 72, cs: [...S(4, 18, 70, sw), ...S(60, 18, 70, sw), ...arc(36, 18, 28, 18, cw, Math.PI, Math.PI * 2)] };
    case "V": return { adv: 68, cs: [diag(4, 70, 34, 0, sw), diag(64, 70, 34, 0, sw)] };
    case "W": return { adv: 94, cs: [diag(2, 70, 23, 0, sw), diag(44, 70, 23, 0, sw), diag(50, 70, 71, 0, sw), diag(92, 70, 71, 0, sw)] };
    case "X": return { adv: 66, cs: [diag(6, 70, 60, 0, sw), diag(60, 70, 6, 0, sw)] };
    case "Y": return { adv: 64, cs: [diag(4, 70, 32, 34, sw), diag(60, 70, 32, 34, sw), ...S(27, 0, 34, sw)] };
    case "Z": return { adv: 62, cs: [...B(2, 60, 65), diag(58, 65, 6, 5, sw * 0.9), ...B(2, 60, 0)] };
    default: return { adv: 26, cs: [] };
  }
}

function glyphLower(ch: string, serif: boolean): Glyph {
  const sw = serif ? 8.5 : 10, bw = serif ? 5 : 6.5, cw = serif ? 8 : 9.5;
  const S = (x: number, y0: number, y1: number, w = sw): Contour[] => stem(x, y0, y1, w, serif);
  const B = (x0: number, x1: number, y: number, w = bw): Contour[] => bar(x0, x1, y, w, serif);
  switch (ch) {
    case "a": return { adv: 56, cs: [...ring(28, 25, 22, 24, cw * 0.9), ...S(46, 0, 58, sw * 0.9),
      ...arc(40, 52, 12, 10, cw * 0.8, 0, Math.PI)] };
    case "b": return { adv: 58, cs: [...S(4, 0, 72), ...bowl(12, 0, 50, 54, cw)] };
    case "c": return { adv: 52, cs: arc(28, 25, 24, 24, cw * 0.9, 0.96, 5.32) };
    case "d": return { adv: 58, cs: [...bowl(4, 0, 50, 46, cw), ...S(46, 0, 72)] };
    case "e": return { adv: 54, cs: [...ring(27, 25, 23, 23, cw * 0.9), ...B(6, 48, 24)] };
    case "f": return { adv: 34, cs: [...S(13, 0, 62, sw), ...arc(17, 62, 11, 10, cw * 0.8, 0, Math.PI), ...B(4, 30, 42)] };
    case "g": return { adv: 56, cs: [...ring(28, 25, 22, 24, cw * 0.9), ...S(46, -22, 2, sw * 0.9),
      ...arc(38, -16, 10, 8, cw * 0.8, Math.PI, Math.PI * 2)] };
    case "h": return { adv: 58, cs: [...S(4, 0, 72), ...arc(29, 25, 17, 25, cw * 0.9, 0, Math.PI), ...S(42, 0, 28, sw)] };
    case "i": return { adv: 26, cs: [...S(9, 0, 50, sw), dot(13, 63, 5)] };
    case "j": return { adv: 28, cs: [...S(11, -20, 50, sw), ...arc(15, -14, 10, 8, cw * 0.8, Math.PI, Math.PI * 1.85), dot(15, 63, 5)] };
    case "k": return { adv: 54, cs: [...S(4, 0, 72), diag(12, 26, 46, 50, sw * 0.85), diag(16, 22, 48, 0, sw * 0.85)] };
    case "l": return { adv: 26, cs: S(9, 0, 72) };
    case "m": return { adv: 86, cs: [...S(4, 0, 50, sw), ...arc(21, 25, 17, 25, cw * 0.9, 0, Math.PI), ...S(34, 0, 26, sw),
      ...arc(51, 25, 17, 25, cw * 0.9, 0, Math.PI), ...S(60, 0, 26, sw)] };
    case "n": return { adv: 58, cs: [...S(4, 0, 50, sw), ...arc(29, 25, 17, 25, cw * 0.9, 0, Math.PI), ...S(42, 0, 26, sw)] };
    case "o": return { adv: 56, cs: ring(28, 25, 23, 24, cw * 0.9) };
    case "p": return { adv: 58, cs: [...S(4, -24, 50, sw), ...bowl(12, 0, 50, 54, cw)] };
    case "q": return { adv: 58, cs: [...bowl(4, 0, 50, 46, cw), ...S(46, -24, 50, sw)] };
    case "r": return { adv: 36, cs: [...S(4, 0, 50, sw), ...arc(18, 36, 13, 12, cw * 0.85, 0, 1.9)] };
    case "s": return { adv: 50, cs: [...arc(25, 38, 21, 14, cw * 0.85, -0.35, 3.5), ...arc(25, 14, 21, 14, cw * 0.85, 2.79, 6.63)] };
    case "t": return { adv: 34, cs: [...S(11, 0, 64, sw), ...B(4, 30, 40), ...arc(20, 4, 10, 5, cw * 0.8, Math.PI, Math.PI * 2)] };
    case "u": return { adv: 58, cs: [...S(4, 0, 50, sw), ...arc(29, 10, 17, 10, cw * 0.9, Math.PI, Math.PI * 2), ...S(42, 0, 50, sw)] };
    case "v": return { adv: 52, cs: [diag(4, 50, 26, 0, sw * 0.9), diag(48, 50, 26, 0, sw * 0.9)] };
    case "w": return { adv: 76, cs: [diag(2, 50, 19, 0, sw * 0.9), diag(36, 50, 19, 0, sw * 0.9), diag(40, 50, 57, 0, sw * 0.9), diag(74, 50, 57, 0, sw * 0.9)] };
    case "x": return { adv: 52, cs: [diag(5, 50, 47, 0, sw * 0.9), diag(47, 50, 5, 0, sw * 0.9)] };
    case "y": return { adv: 52, cs: [diag(4, 50, 26, 6, sw * 0.9), diag(48, 50, 26, 6, sw * 0.9), diag(26, 6, 14, -22, sw * 0.9)] };
    case "z": return { adv: 50, cs: [...B(4, 46, 45), diag(44, 45, 8, 5, sw * 0.85), ...B(4, 46, 0, 5)] };
    default: return { adv: 26, cs: [] };
  }
}
function glyphDigit(ch: string, serif: boolean): Glyph {
  const sw = serif ? 8.5 : 10, bw = serif ? 5 : 6.5, cw = serif ? 8 : 9.5;
  const S = (x: number, y0: number, y1: number, w = sw): Contour[] => stem(x, y0, y1, w, serif);
  const B = (x0: number, x1: number, y: number, w = bw): Contour[] => bar(x0, x1, y, w, serif);
  switch (ch) {
    case "0": return { adv: 56, cs: ring(28, 35, 24, 34, cw) };
    case "1": return { adv: 40, cs: [diag(10, 58, 24, 70, sw * 0.9), ...S(19, 0, 70, sw), ...B(6, 34, 0, 5)] };
    case "2": return { adv: 56, cs: [...arc(28, 50, 24, 20, cw, -0.2, 3.5), diag(46, 38, 10, 5, sw * 0.9), ...B(6, 50, 0, 5)] };
    case "3": return { adv: 56, cs: [...arc(28, 52, 23, 17, cw, -0.9, 3.5), ...arc(28, 18, 24, 17, cw, -1.1, 3.6)] };
    case "4": return { adv: 56, cs: [diag(40, 70, 10, 10, sw * 0.9), ...B(6, 50, 14), ...S(36, 0, 70, sw)] };
    case "5": return { adv: 56, cs: [...B(8, 48, 64), ...S(8, 36, 64, sw), ...arc(30, 18, 22, 18, cw, 2.6, 6.6)] };
    case "6": return { adv: 56, cs: [...ring(28, 19, 21, 18, cw), ...arc(28, 36, 22, 32, cw, 1.2, 5.0)] };
    case "7": return { adv: 56, cs: [...B(6, 50, 64), diag(48, 64, 16, 0, sw * 0.9)] };
    case "8": return { adv: 56, cs: [...ring(28, 52, 22, 17, cw), ...ring(28, 18, 24, 17, cw)] };
    case "9": return { adv: 56, cs: [...ring(28, 51, 21, 18, cw), ...arc(28, 34, 21, 31, cw, -1.35, 1.35)] };
    default: return { adv: 26, cs: [] };
  }
}
function glyphPunct(ch: string, serif: boolean): Glyph {
  const sw = serif ? 8.5 : 10, bw = serif ? 5 : 6.5, cw = serif ? 8 : 9.5;
  switch (ch) {
    case " ": return { adv: 26, cs: [] };
    case ".": return { adv: 26, cs: [R(9, 0, 17, 8)] };
    case ",": return { adv: 26, cs: [R(9, 0, 17, 8), diag(15, 6, 8, -12, 6)] };
    case ":": return { adv: 26, cs: [R(9, 0, 17, 8), R(9, 32, 17, 40)] };
    case ";": return { adv: 26, cs: [R(9, 32, 17, 40), R(9, 0, 17, 8), diag(15, 6, 8, -12, 6)] };
    case "!": return { adv: 26, cs: [R(9, 18, 17, 70), R(9, 0, 17, 8)] };
    case "?": return { adv: 30, cs: [...arc(14, 54, 13, 12, cw * 0.8, -0.5, 4.2), R(11, 28, 17, 38), R(9, 0, 17, 8)] };
    case "'": return { adv: 20, cs: [diag(12, 52, 18, 70, 5)] };
    case "’": return { adv: 20, cs: [diag(12, 52, 18, 70, 5)] };
    case "‘": return { adv: 20, cs: [diag(8, 52, 14, 70, 5)] };
    case '"': return { adv: 34, cs: [diag(8, 52, 14, 70, 5), diag(22, 52, 28, 70, 5)] };
    case "“": return { adv: 34, cs: [diag(8, 52, 14, 70, 5), diag(22, 52, 28, 70, 5)] };
    case "”": return { adv: 34, cs: [diag(8, 52, 14, 70, 5), diag(22, 52, 28, 70, 5)] };
    case "-": return { adv: 30, cs: [R(4, 24, 26, 30)] };
    case "–": return { adv: 38, cs: [R(4, 24, 34, 30)] };
    case "—": return { adv: 56, cs: [R(2, 24, 54, 30)] };
    case "(": return { adv: 30, cs: arc(26, 35, 16, 35, cw * 0.9, 2.1, 4.2) };
    case ")": return { adv: 30, cs: arc(4, 35, 16, 35, cw * 0.9, -1.05, 1.05) };
    case "/": return { adv: 44, cs: [diag(12, 0, 38, 70, sw * 0.8)] };
    case "%": return { adv: 78, cs: [...ring(18, 52, 13, 13, cw * 0.8), ...ring(60, 18, 13, 13, cw * 0.8), diag(66, 70, 12, 0, sw * 0.8)] };
    case "$": return { adv: 56, cs: [...arc(28, 52, 20, 15, cw * 0.85, -0.35, 3.5), ...arc(28, 18, 20, 15, cw * 0.85, 2.79, 6.63), R(24, -4, 32, 74)] };
    case "&": return { adv: 62, cs: [...ring(26, 48, 16, 14, cw * 0.8), ...ring(26, 18, 18, 15, cw * 0.8), diag(40, 60, 14, 0, sw * 0.8)] };
    case "+": return { adv: 56, cs: [R(4, 30, 52, 38), R(22, 12, 30, 56)] };
    case "=": return { adv: 56, cs: [R(4, 24, 52, 30), R(4, 42, 52, 48)] };
    case "·": return { adv: 28, cs: [R(10, 32, 18, 40)] };
    case "•": return { adv: 28, cs: [dot(14, 35, 9)] };
    case "✓": return { adv: 34, cs: [diag(2, 18, 12, 6, 7), diag(12, 6, 30, 34, 7)] };
    case "°": return { adv: 28, cs: ring(14, 58, 8, 8, 5) };
    case "Í": return { adv: 32, cs: [...stem(11, 0, 70, sw, serif), diag(10, 76, 20, 86, 5)] };
    case "Ü": return { adv: 72, cs: [...stem(4, 18, 70, sw, serif), ...stem(60, 18, 70, sw, serif),
      ...arc(36, 18, 28, 18, cw, Math.PI, Math.PI * 2), R(16, 76, 26, 84), R(46, 76, 56, 84)] };
    case "í": return { adv: 26, cs: [...stem(9, 0, 50, sw, serif), dot(13, 63, 5), diag(8, 70, 16, 80, 5)] };
    default: return { adv: 26, cs: [] };
  }
}
function getGlyph(ch: string, serif: boolean): Glyph {
  if (ch >= "A" && ch <= "Z") return glyph(ch, serif);
  if (ch >= "a" && ch <= "z") return glyphLower(ch, serif);
  if (ch >= "0" && ch <= "9") return glyphDigit(ch, serif);
  return glyphPunct(ch, serif);
}

// ---------------------------------------------------------------- text engine
function fillPolySS(pts: Pt[], c: RGB): void {
  if (pts.length < 3) return;
  let yMin = Infinity, yMax = -Infinity;
  for (const [, y] of pts) { if (y < yMin) yMin = y; if (y > yMax) yMax = y; }
  const Y0 = Math.max(0, Math.ceil(yMin)), Y1 = Math.min(H * SS - 1, Math.floor(yMax));
  for (let y = Y0; y <= Y1; y++) {
    const yc = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
      if (y0 === y1) continue;
      const lo = Math.min(y0, y1), hi = Math.max(y0, y1);
      if (yc < lo || yc >= hi) continue;
      xs.push(x0 + (yc - y0) * (x1 - x0) / (y1 - y0));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const X0 = Math.max(0, Math.ceil(xs[k])), X1 = Math.min(W * SS - 1, Math.floor(xs[k + 1]));
      for (let x = X0; x <= X1; x++) {
        const i = (y * W * SS + x) * 3;
        buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2];
      }
    }
  }
}
interface TextOpts { serif?: boolean; bold?: boolean; italic?: boolean; align?: "left" | "center" | "right"; tracking?: number; color?: RGB; }
function textWidth(s: string, size: number, o: TextOpts = {}): number {
  const serif = o.serif ?? false, tr = o.tracking ?? 0;
  let w = 0;
  for (const ch of s) w += getGlyph(ch, serif).adv * size / 100 + tr;
  return w - tr;
}
// Draw one line; (x, baseY) is the baseline position in 1024-space.
function drawText(x: number, baseY: number, s: string, size: number, o: TextOpts = {}): void {
  const serif = o.serif ?? false, bold = o.bold ?? false, italic = o.italic ?? false;
  const tr = o.tracking ?? 0, c = o.color ?? INK;
  const w = textWidth(s, size, o);
  let ox = x;
  if (o.align === "center") ox = x - w / 2;
  else if (o.align === "right") ox = x - w;
  const shifts = bold ? [0, size * 0.035] : [0];
  for (const sh of shifts) {
    let cx = ox + sh;
    for (const ch of s) {
      const g = getGlyph(ch, serif);
      for (const contour of g.cs) {
        const pts: Pt[] = contour.map(([gx, gy]) => {
          const gx2 = italic ? gx + 0.18 * gy : gx;
          return [(cx + gx2 * size / 100) * SS, (baseY - gy * size / 100) * SS];
        });
        fillPolySS(pts, c);
      }
      cx += g.adv * size / 100 + tr;
    }
  }
}
// Greedy word wrap; returns lines that fit maxW. Long words are hard-split.
function wrapText(s: string, maxW: number, size: number, o: TextOpts = {}): string[] {
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const wd of words) {
    const test = cur ? cur + " " + wd : wd;
    if (textWidth(test, size, o) <= maxW || !cur) cur = test;
    else { lines.push(cur); cur = wd; }
  }
  if (cur) lines.push(cur);
  return lines;
}
// Fit a headline into at most maxLines lines within maxW, shrinking size if needed.
function fitHeadline(s: string, maxW: number, size: number, maxLines: number, o: TextOpts = {}): { lines: string[]; size: number } {
  let sz = size;
  while (sz > 12) {
    const lines = wrapText(s, maxW, sz, o);
    if (lines.length <= maxLines) return { lines, size: sz };
    sz -= 1;
  }
  return { lines: wrapText(s, maxW, sz, o).slice(0, maxLines), size: sz };
}
function drawLines(lines: string[], x: number, baseY: number, size: number, lh: number, o: TextOpts = {}): void {
  lines.forEach((ln, i) => drawText(x, baseY + i * lh, ln, size, o));
}

// ------------------------------------------------------------------ data
// Ground truth: the 36 verified stories (BUILD-BRIEF v2). Never invent.
type Region = "Europe" | "Middle East" | "Asia" | "Africa" | "Americas" | "Oceania" | "Global";
const REGION_COLOR: Record<Region, RGB> = {
  Europe: [37, 99, 235], "Middle East": [185, 28, 28], Asia: [21, 128, 61],
  Africa: [180, 83, 9], Americas: [15, 118, 110], Oceania: [124, 58, 237], Global: [71, 85, 105],
};
interface Story { n: number; region: Region; label: string; loc: string; head: string; body: string; src: string; tag: string; }
const HEROES: Story[] = [
  { n: 1, region: "Global", label: "COP31: OVERTIME", loc: "ANTALYA, TÜRKIYE · CLIMATE",
    head: "Climate summit runs into Saturday with no deal",
    body: "COP31 missed its Friday close. A draft with no fossil fuels split nearly 200 nations.",
    src: "AFP, Reuters", tag: "CONFIRMED" },
  { n: 2, region: "Middle East", label: "SAUDI: MISSILES", loc: "RIYADH · WAR",
    head: "Houthi missiles aimed at Riyadh shot down",
    body: "Coalition intercepted 3 ballistic missiles just after 2 a.m.; two blasts heard. Two more downed over Jizan.",
    src: "Arab News, Al Jazeera", tag: "OFFICIAL" },
  { n: 3, region: "Americas", label: "PERU: QUAKE 6.7", loc: "JUNÍN, PERU · EARTHQUAKE",
    head: "Magnitude 6.7 quake shakes central Peru",
    body: "Felt in Lima; no deaths, damage or tsunami risk. 152 homes uninhabitable.",
    src: "USGS, IGP", tag: "OFFICIAL" },
];
const MIDS: Story[] = [
  { n: 4, region: "Middle East", label: "BAHRAIN: US BASES HIT", loc: "BAHRAIN · CONFLICT",
    head: "Iran hits two US bases in Bahrain",
    body: "Two bases hit, no injuries.",
    src: "Bahrain, UKMTO", tag: "OFFICIAL" },
  { n: 5, region: "Middle East", label: "HORMUZ: TANKERS HIT", loc: "GULF OF OMAN · CONFLICT",
    head: "Two tankers hit off Oman; third in Strait",
    body: "Two hit, one crew missing.",
    src: "UKMTO", tag: "OFFICIAL" },
  { n: 6, region: "Europe", label: "BALTIC: SHIP ABLAZE", loc: "GULF OF FINLAND · CONFLICT",
    head: "Drones set Russian ship Sparta II ablaze",
    body: "Crew evacuated, Ukraine blamed.",
    src: "France 24, Al Jazeera", tag: "OFFICIAL" },
  { n: 7, region: "Europe", label: "KYIV: MISSILES", loc: "KYIV · WAR",
    head: "Ballistic missiles hit Kyiv at 5:47",
    body: "Two homes ablaze in Podil.",
    src: "Kyiv Post", tag: "OFFICIAL" },
  { n: 8, region: "Americas", label: "SINALOA: CAPTURED", loc: "GUASAVE, MEXICO · SECURITY",
    head: "Troops capture cartel boss 'Chapo Isidro'",
    body: "'Chapo Isidro' held in Guasave.",
    src: "FBI, Euronews, AP", tag: "CONFIRMED" },
  { n: 9, region: "Europe", label: "EU–INDONESIA: DEAL", loc: "BRUSSELS · TRADE",
    head: "EU and Indonesia sign free-trade deal",
    body: "Deal ends 10 years of talks.",
    src: "European Commission", tag: "OFFICIAL" },
  { n: 10, region: "Middle East", label: "GAZA: STRIKE", loc: "GAZA CITY · WAR",
    head: "Israeli drone strike kills 3 in Gaza City",
    body: "Three killed handing out food.",
    src: "Al Jazeera, ToI", tag: "REPORTED" },
  { n: 11, region: "Global", label: "BITCOIN: TWO-YEAR LOW", loc: "MARKETS · CRYPTO",
    head: "Bitcoin falls to its lowest since 2024",
    body: "Back above $60,000 by 15:16.",
    src: "CoinGecko", tag: "REPORTED" },
  { n: 12, region: "Europe", label: "FRANCE: PROTESTS", loc: "PARIS · PROTEST",
    head: "Sixth Saturday of protests in France",
    body: "70,000 police were on duty.",
    src: "France 24", tag: "OFFICIAL" },
  { n: 13, region: "Oceania", label: "CRICKET: RAHUL 136", loc: "WELLINGTON · CRICKET",
    head: "Rahul hits 136 as India lead NZ by 118",
    body: "India 486-4 on day 3; Gill 98.",
    src: "Reuters", tag: "CONFIRMED" },
];
interface ListItem { n: number; region: Region; text: string; src: string; }
const LIST: ListItem[] = [
  { n: 14, region: "Europe", text: "Kryvyi Rih: missile kills 2, incl. boy, 7", src: "Kyiv Independent" },
  { n: 15, region: "Europe", text: "Lviv: strike kills 2, 10 injured", src: "—" },
  { n: 16, region: "Oceania", text: "Davao: jet lands safe after engine fire; 146 safe", src: "AP" },
  { n: 17, region: "Asia", text: "Timor-Leste: M6.8 quake, felt in Darwin", src: "USGS" },
  { n: 18, region: "Global", text: "Geneva: 128 nations agree AI-weapon draft", src: "Al Jazeera" },
  { n: 19, region: "Asia", text: "Taiwan: 21 jets patrol; 15 cross median line", src: "Taipei" },
  { n: 20, region: "Europe", text: "Ust-Luga: drones hit port; NATO jets scramble", src: "Kyiv Post" },
  { n: 21, region: "Americas", text: "Brazil: Bolsonaro in intensive care, 71", src: "Reuters" },
  { n: 22, region: "Middle East", text: "Basra: power station fire kills 4+, 30 hurt", src: "INA, Reuters" },
  { n: 23, region: "Africa", text: "Pretoria: UN, AU honour Mlambo-Ngcuka", src: "UN" },
  { n: 24, region: "Americas", text: "Las Vegas: Russell fastest, 1:34.041", src: "Formula 1" },
  { n: 25, region: "Europe", text: "Twickenham: England rout NZ 37-12", src: "Reuters" },
  { n: 26, region: "Oceania", text: "Cook Islands: relief ship ready; Xavier weakens", src: "RNZ" },
  { n: 27, region: "Europe", text: "Kyiv: Zelensky: Crimea bridge \u201Cwill not stay\u201D", src: "NBC" },
  { n: 28, region: "Europe", text: "Antalya: EU warns of \u201Cfossil summit\u201D", src: "AFP" },
  { n: 29, region: "Global", text: "Antalya: Panama may block climate deal", src: "Al Jazeera" },
  { n: 30, region: "Middle East", text: "Yemen: Houthis threaten Jeddah, Red Sea ports", src: "Al Jazeera" },
  { n: 31, region: "Americas", text: "Washington: Vance: Iran strikes Trump's call", src: "Reuters" },
  { n: 32, region: "Americas", text: "Texas: execution of man, 70, takes 63 min", src: "ABC" },
  { n: 33, region: "Americas", text: "Vancouver: Canada rests youth climate case", src: "AFP" },
  { n: 34, region: "Asia", text: "Pyongyang: Kim tours factories", src: "KCNA" },
  { n: 35, region: "Asia", text: "Bangkok: six-point arsenic plan", src: "The Nation" },
  { n: 36, region: "Oceania", text: "Melbourne: Cummins keeps captaincy", src: "ABC" },
];
// Pin positions [lat, lon] for the map, stories 1-36.
const PINS: Record<number, [number, number]> = {
  1: [36.9, 30.7], 2: [24.7, 46.7], 3: [-11.2, -75.9], 4: [26.0, 50.6], 5: [26.2, 56.2],
  6: [59.8, 24.5], 7: [50.45, 30.5], 8: [25.6, -108.5], 9: [50.85, 4.35], 10: [31.5, 34.47],
  11: [51.5, -0.1], 12: [48.85, 2.35], 13: [-41.3, 174.8], 14: [47.9, 33.4], 15: [49.84, 24.03],
  16: [7.07, 125.6], 17: [-8.5, 127.0], 18: [46.2, 6.14], 19: [23.7, 121.0], 20: [59.65, 28.3],
  21: [-15.8, -47.9], 22: [30.5, 47.8], 23: [-25.7, 28.2], 24: [36.17, -115.14], 25: [51.45, -0.34],
  26: [-21.2, -159.8], 27: [50.6, 30.9], 28: [37.2, 31.0], 29: [36.6, 30.4], 30: [21.5, 39.2],
  31: [38.9, -77.04], 32: [31.0, -100.0], 33: [49.28, -123.12], 34: [39.03, 125.75],
  35: [13.76, 100.5], 36: [-37.8, 145.0],
};
const REGION_OF: Record<number, Region> = {};
for (const s of [...HEROES, ...MIDS]) REGION_OF[s.n] = s.region;
for (const s of LIST) REGION_OF[s.n] = s.region;

// ------------------------------------------------------------------ panels
function tagChip(x: number, y: number, tag: string): void {
  const w = textWidth(tag, 9, { bold: true }) + 12;
  fillRect(x, y, x + w, y + 13, tag === "CONFIRMED" ? [21, 128, 61] : tag === "OFFICIAL" ? [37, 99, 235] : [180, 83, 9]);
  drawText(x + 6, y + 10, tag, 9, { bold: true, color: WHITE });
}
function labelBar(x: number, y: number, w: number, s: Story): void {
  fillRect(x, y, x + w, y + 18, REGION_COLOR[s.region]);
  drawText(x + 6, y + 13.5, String(s.n), 12, { bold: true, color: WHITE });
  const chipW = textWidth(s.tag, 9, { bold: true }) + 12;
  // Shrink the label until it clears the tag chip (mid panels are narrow).
  let labSize = 11;
  while (labSize > 8 && textWidth(s.label, labSize, { bold: true }) > w - 26 - chipW - 6) labSize -= 0.5;
  drawText(x + 20, y + 13.5, s.label, labSize, { bold: true, color: WHITE });
  tagChip(x + w - 4 - chipW, y + 2.5, s.tag);
}
function srcLine(x: number, y: number, s: Story, size = 10.5): void {
  drawText(x, y, s.src, size, { color: GREY });
}
// ---- hero illustrations (flat shapes, ~330 x 78) ----
function illoHero(x: number, y: number, w: number, h: number, n: number): void {
  if (n === 1) {
    fillRect(x, y, x + w, y + h, [214, 228, 238]);
    // globe
    fillCircle(x + 52, y + 40, 30, [59, 130, 200]);
    fillPoly([[x + 32, y + 30], [x + 48, y + 22], [x + 62, y + 30], [x + 56, y + 48], [x + 40, y + 52], [x + 30, y + 40]], [34, 139, 34]);
    fillPoly([[x + 58, y + 56], [x + 72, y + 52], [x + 76, y + 64], [x + 62, y + 68]], [34, 139, 34]);
    rectStroke(x + 22, y + 10, x + 82, y + 70, INK, 1.5);
    // calendar
    fillRect(x + 108, y + 8, x + 222, y + h - 8, WHITE);
    rectStroke(x + 108, y + 8, x + 222, y + h - 8, INK, 1.5);
    fillRect(x + 108, y + 8, x + 222, y + 24, RED);
    drawText(x + 165, y + 20, "NOV 2026", 11, { bold: true, color: WHITE, align: "center" });
    for (let r = 0; r < 3; r++) for (let c = 0; c < 7; c++) {
      const cx = x + 116 + c * 15, cy = y + 30 + r * 13;
      if (r === 2 && c === 4) { fillCircle(cx + 5, cy + 4, 7, RED); drawText(cx + 5, cy + 8, "21", 8, { bold: true, color: WHITE, align: "center" }); }
      else drawText(cx + 5, cy + 8, String(3 + r * 7 + c), 8, { color: GREY, align: "center" });
    }
    // clock
    fillCircle(x + 268, y + 40, 26, WHITE);
    rectStroke(x + 242, y + 14, x + 294, y + 66, INK, 1.5);
    fillCircle(x + 268, y + 40, 26, WHITE);
    thickLine(x + 268, y + 40, x + 268, y + 22, 3, INK);
    thickLine(x + 268, y + 40, x + 282, y + 46, 3, INK);
    fillCircle(x + 268, y + 40, 2.5, RED);
  } else if (n === 2) {
    fillRect(x, y, x + w, y + h, NAVY);
    // skyline
    const blds: [number, number, number][] = [[0, 46, 26], [30, 34, 20], [54, 52, 24], [82, 30, 18], [104, 44, 22], [130, 36, 20], [154, 50, 22], [180, 32, 20], [204, 46, 24], [232, 38, 20], [256, 50, 22], [282, 40, 20], [306, 48, 24]];
    for (const [bx, bh, bw2] of blds) fillRect(x + bx, y + h - bh, x + bx + bw2, y + h, [8, 12, 26]);
    for (let i = 0; i < 40; i++) {
      const wx = x + 6 + ((i * 37) % 310), wy = y + 12 + ((i * 53) % 46);
      fillRect(wx, wy, wx + 2.5, wy + 2.5, [250, 204, 120]);
    }
    // missile trails
    thickLine(x + 60, y + 8, x + 150, y + 62, 2.5, [255, 120, 60]);
    thickLine(x + 210, y + 4, x + 120, y + 58, 2.5, [255, 120, 60]);
    thickLine(x + 290, y + 14, x + 240, y + 56, 2.5, [255, 120, 60]);
    fillCircle(x + 60, y + 8, 5, [255, 80, 40]); fillCircle(x + 210, y + 4, 5, [255, 80, 40]); fillCircle(x + 290, y + 14, 5, [255, 80, 40]);
    fillRect(x + w - 92, y + 6, x + w - 8, y + 22, RED);
    drawText(x + w - 50, y + 18, "3 DOWNED", 11, { bold: true, color: WHITE, align: "center" });
  } else {
    fillRect(x, y, x + w, y + h, [232, 222, 200]);
    // mountains
    fillPoly([[x, y + h], [x + 70, y + 14], [x + 140, y + h]], [120, 96, 66]);
    fillPoly([[x + 100, y + h], [x + 190, y + 6], [x + 280, y + h]], [96, 76, 52]);
    fillPoly([[x + 58, y + 26], [x + 70, y + 14], [x + 82, y + 26], [x + 70, y + 34]], WHITE);
    fillPoly([[x + 178, y + 18], [x + 190, y + 6], [x + 202, y + 18], [x + 190, y + 26]], WHITE);
    // seismograph
    fillRect(x, y + 46, x + w, y + h - 8, WHITE);
    rectStroke(x, y + 46, x + w, y + h - 8, INK, 1);
    const pts: Pt[] = [];
    const trace = [0, 2, -3, 8, -14, 20, -26, 12, -6, 3, -2, 0, 1, -1, 0];
    for (let i = 0; i < trace.length; i++) pts.push([x + 8 + i * 21, y + 60 - trace[i]]);
    for (let i = 0; i + 1 < pts.length; i++) thickLine(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 2, RED);
    drawText(x + 8, y + 20, "108 KM DEEP · 00:09 UTC", 11, { bold: true, color: INK });
    drawText(x + w - 8, y + 38, "6.7", 34, { serif: true, bold: true, color: RED, align: "right" });
  }
}
// ---- mid illustrations (~196 x 46) ----
function illoMid(x: number, y: number, w: number, h: number, n: number): void {
  const cx = x + w / 2;
  if (n === 4) {
    fillRect(x, y, x + w, y + h, [226, 214, 196]);
    fillRect(x + 14, y + 18, x + 60, y + h - 6, [120, 90, 60]);
    fillRect(x + 66, y + 26, x + 104, y + h - 6, [140, 110, 76]);
    fillPoly([[x + 120, y + h - 6], [x + 138, y + 12], [x + 156, y + h - 6]], [255, 120, 40]);
    fillPoly([[x + 128, y + h - 6], [x + 138, y + 22], [x + 148, y + h - 6]], [255, 200, 40]);
    drawText(cx + 30, y + 16, "2 BASES HIT", 11, { bold: true, color: RED, align: "center" });
  } else if (n === 5) {
    fillRect(x, y, x + w, y + h, [196, 216, 228]);
    fillRect(x + 30, y + 22, x + 150, y + 34, [40, 50, 66]);
    fillRect(x + 86, y + 8, x + 94, y + 22, [40, 50, 66]);
    fillPoly([[x + 150, y + 22], [x + 168, y + 30], [x + 150, y + 34]], [40, 50, 66]);
    for (let i = 0; i < 4; i++) thickLine(x + 6 + i * 46, y + h - 8, x + 26 + i * 46, y + h - 8, 2, [59, 130, 200]);
    fillPoly([[x + 60, y + 10], [x + 72, y + 20], [x + 60, y + 24]], [255, 120, 40]);
    drawText(cx, y + 12, "2 HIT · 1 MISSING", 10, { bold: true, color: RED, align: "center" });
  } else if (n === 6) {
    fillRect(x, y, x + w, y + h, [206, 214, 224]);
    fillRect(x + 46, y + 24, x + 150, y + 36, [30, 34, 44]);
    fillRect(x + 92, y + 10, x + 100, y + 24, [30, 34, 44]);
    fillPoly([[x + 66, y + 10], [x + 78, y + 22], [x + 66, y + 26]], [255, 120, 40]);
    fillPoly([[x + 84, y + 6], [x + 96, y + 20], [x + 84, y + 24]], [255, 200, 40]);
    fillCircle(x + 116, y + 10, 5, [90, 90, 90]); fillCircle(x + 128, y + 6, 6, [110, 110, 110]);
    for (let i = 0; i < 3; i++) thickLine(x + 10 + i * 56, y + h - 8, x + 34 + i * 56, y + h - 8, 2, [59, 130, 200]);
  } else if (n === 7) {
    fillRect(x, y, x + w, y + h, [232, 220, 206]);
    for (const [bx, bh] of [[8, 26], [34, 34], [62, 22], [140, 30], [168, 24]] as const) fillRect(x + bx, y + h - bh, x + bx + 22, y + h, [90, 80, 70]);
    thickLine(x + 30, y + 6, x + 90, y + 34, 2.5, [255, 80, 40]);
    thickLine(x + 170, y + 4, x + 120, y + 30, 2.5, [255, 80, 40]);
    fillCircle(x + 30, y + 6, 4.5, [255, 80, 40]); fillCircle(x + 170, y + 4, 4.5, [255, 80, 40]);
    drawText(cx, y + 12, "05:47", 12, { bold: true, color: RED, align: "center" });
  } else if (n === 8) {
    fillRect(x, y, x + w, y + h, [240, 230, 200]);
    fillPoly([[cx, y + 6], [cx + 6, y + 18], [cx + 18, y + 18], [cx + 9, y + 26], [cx + 13, y + 38], [cx, y + 30], [cx - 13, y + 38], [cx - 9, y + 26], [cx - 18, y + 18], [cx - 6, y + 18]], GOLD);
    drawText(cx, y + h - 2, "11 DEAD IN CLASHES", 10, { bold: true, color: RED, align: "center" });
  } else if (n === 9) {
    fillRect(x, y, x + w, y + h, [220, 228, 238]);
    fillCircle(cx - 34, y + 18, 14, [0, 51, 153]);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; fillCircle(cx - 34 + 8 * Math.cos(a), y + 18 + 8 * Math.sin(a), 1.6, [255, 215, 0]); }
    fillRect(cx + 8, y + 4, cx + 44, y + 18, [255, 0, 0]);
    fillRect(cx + 8, y + 18, cx + 44, y + 32, WHITE);
    drawText(cx, y + h - 2, "98.5%", 13, { serif: true, bold: true, color: [21, 128, 61], align: "center" });
  } else if (n === 10) {
    fillRect(x, y, x + w, y + h, [228, 224, 214]);
    fillRect(x + 70, y + 10, x + 126, y + 18, [60, 60, 66]);
    fillCircle(x + 80, y + 14, 3, [40, 40, 44]); fillCircle(x + 116, y + 14, 3, [40, 40, 44]);
    thickLine(x + 98, y + 18, x + 98, y + 34, 2, INK);
    fillPoly([[x + 60, y + 30], [x + 98, y + 38], [x + 136, y + 30], [x + 98, y + 42]], [120, 100, 80]);
    drawText(cx, y + h - 2, "3 KILLED", 11, { bold: true, color: RED, align: "center" });
  } else if (n === 11) {
    fillRect(x, y, x + w, y + h, [246, 236, 200]);
    fillCircle(cx - 52, y + h / 2, 15, GOLD);
    drawText(cx - 52, y + h / 2 + 7, "B", 20, { serif: true, bold: true, color: [120, 80, 0], align: "center" });
    drawText(cx + 8, y + 18, "$58,983", 15, { serif: true, bold: true, align: "center" });
    thickLine(cx + 30, y + 26, cx + 52, y + 38, 2.5, RED);
    fillPoly([[cx + 46, y + 38], [cx + 58, y + 38], [cx + 52, y + 30]], RED);
    drawText(cx + 8, y + h - 2, "2-YEAR LOW", 10, { bold: true, color: RED, align: "center" });
  } else if (n === 12) {
    fillRect(x, y, x + w, y + h, [226, 226, 232]);
    for (let r = 0; r < 2; r++) for (let i = 0; i < 9; i++) {
      fillCircle(x + 16 + i * 20, y + 12 + r * 12, 4.5, [40, 44, 60]);
      fillRect(x + 12 + i * 20, y + 18 + r * 12, x + 20 + i * 20, y + 26 + r * 12, [40, 44, 60]);
    }
    fillRect(cx + 18, y + 4, cx + 92, y + 34, [250, 250, 248]);
    drawText(cx + 55, y + 18, "82,500", 13, { serif: true, bold: true, align: "center" });
    drawText(cx + 55, y + 31, "MARCHED", 9, { bold: true, align: "center" });
  } else {
    fillRect(x, y, x + w, y + h, [224, 236, 214]);
    thickLine(x + 40, y + 10, x + 66, y + 36, 5, [139, 90, 43]);
    fillCircle(x + 120, y + 14, 6, [185, 28, 28]);
    fillCircle(x + 138, y + 34, 4, [90, 60, 30]);
    drawText(cx, y + h - 2, "136 · RAHUL", 12, { serif: true, bold: true, color: RED, align: "center" });
  }
}

// ------------------------------------------------------------------ map
// Stylised continents as filled polygons (lon/lat), equirectangular.
const CONTINENTS: [number, number][][] = [
  // North America
  [[-168, 66], [-140, 70], [-125, 72], [-110, 68], [-95, 69], [-85, 66], [-80, 73], [-65, 62], [-55, 52], [-60, 47], [-70, 42], [-75, 35], [-80, 26], [-85, 30], [-90, 21], [-97, 16], [-105, 20], [-112, 28], [-120, 34], [-125, 42], [-125, 49], [-135, 58], [-155, 58], [-165, 60]],
  // Greenland
  [[-58, 64], [-45, 60], [-30, 68], [-22, 70], [-30, 76], [-55, 76], [-60, 70]],
  // South America
  [[-80, 9], [-72, 12], [-62, 9], [-52, 5], [-50, 0], [-40, -5], [-35, -9], [-40, -20], [-48, -28], [-55, -35], [-62, -41], [-68, -50], [-70, -54], [-73, -44], [-73, -30], [-70, -18], [-77, -12], [-81, -5], [-80, 2]],
  // Africa
  [[-17, 15], [-17, 21], [-10, 31], [0, 36], [10, 37], [20, 32], [30, 31], [35, 28], [43, 12], [51, 11], [48, 0], [40, -10], [35, -18], [32, -26], [28, -33], [20, -35], [15, -27], [12, -18], [9, -1], [9, 4], [-8, 5], [-13, 8]],
  // Eurasia
  [[-10, 36], [-9, 43], [-2, 48], [-5, 50], [0, 51], [5, 53], [8, 57], [10, 59], [18, 56], [21, 55], [24, 58], [28, 60], [30, 62], [30, 70], [40, 68], [50, 69], [60, 69], [70, 72], [80, 73], [100, 76], [120, 73], [140, 72], [160, 69], [178, 66], [170, 60], [162, 56], [158, 52], [150, 59], [142, 55], [140, 48], [135, 43], [130, 42], [127, 40], [122, 38], [120, 32], [122, 28], [115, 22], [108, 18], [105, 9], [100, 8], [98, 12], [95, 16], [92, 21], [88, 22], [85, 19], [80, 13], [77, 8], [73, 16], [70, 20], [66, 25], [60, 25], [57, 26], [52, 26], [50, 29], [48, 30], [44, 29], [40, 31], [36, 36], [30, 36], [26, 38], [23, 40], [19, 42], [12, 44], [8, 44], [3, 42], [0, 39], [-2, 37], [-6, 36]],
  // UK
  [[-5, 50], [-3, 53], [-5, 56], [-3, 58], [-1, 57], [0, 53], [1, 51]],
  // Japan
  [[130, 31], [133, 34], [137, 35], [140, 38], [141, 41], [143, 43], [145, 44], [142, 42], [140, 39], [137, 37], [133, 35], [130, 33]],
  // SE Asia islands
  [[95, 5], [100, 0], [104, -2], [110, -6], [114, -8], [118, -9], [120, -10], [115, -5], [108, -2], [102, 2], [97, 6]],
  // Australia
  [[114, -22], [114, -30], [115, -34], [120, -34], [124, -33], [129, -32], [132, -32], [136, -35], [140, -38], [145, -38], [150, -37], [153, -32], [153, -27], [150, -23], [146, -19], [142, -15], [142, -11], [137, -12], [135, -15], [132, -12], [130, -13], [126, -14], [122, -17], [118, -20]],
  // New Zealand
  [[167, -45], [170, -42], [173, -40], [175, -38], [178, -38], [175, -40], [172, -43], [168, -46]],
];
function drawMap(x: number, y: number, w: number, h: number): void {
  fillRect(x, y, x + w, y + h, [226, 234, 240]);
  rectStroke(x, y, x + w, y + h, INK, 1.5);
  const lon0 = -170, lon1 = 190, lat0 = 78, lat1 = -58;
  const pxOf = (lon: number) => x + ((lon - lon0) / (lon1 - lon0)) * w;
  const pyOf = (lat: number) => y + ((lat0 - lat) / (lat0 - lat1)) * h;
  // graticule dots
  for (let gx = x + 8; gx < x + w - 4; gx += 12)
    for (let gy = y + 8; gy < y + h - 4; gy += 12) fillCircle(gx, gy, 0.7, [190, 196, 204]);
  for (const cont of CONTINENTS) {
    fillPoly(cont.map(([lo, la]) => [pxOf(lo), pyOf(la)] as Pt), [232, 220, 192]);
  }
  // pins 1-36
  for (let n = 1; n <= 36; n++) {
    const [la, lo] = PINS[n];
    const cx = pxOf(lo), cy = pyOf(la);
    const col = REGION_COLOR[REGION_OF[n]];
    fillCircle(cx, cy, 7.5, col);
    fillCircle(cx, cy, 7.5, col);
    rectStroke(cx - 7.5, cy - 7.5, cx + 7.5, cy + 7.5, WHITE, 1);
    drawText(cx, cy + 3.2, String(n), 8.5, { bold: true, color: WHITE, align: "center" });
  }
}

// ------------------------------------------------------------------ layout
function drawHeroPanel(x: number, y: number, w: number, h: number, s: Story): void {
  fillRect(x, y, x + w, y + h, WHITE);
  rectStroke(x, y, x + w, y + h, INK, 1.5);
  labelBar(x, y, w, s);
  illoHero(x + 4, y + 20, w - 8, 70, s.n);
  drawText(x + 6, y + 102, s.loc, 11, { bold: true, color: GREY });
  const { lines } = fitHeadline(s.head, w - 12, 27, 2, { serif: true, bold: true });
  drawLines(lines, x + 6, y + 130, 27, 28, { serif: true, bold: true });
  const body = wrapText(s.body, w - 12, 13, {});
  drawLines(body.slice(0, 2), x + 6, y + 174, 13, 15, {});
  srcLine(x + 6, y + h - 6, s, 10.5);
}
function drawMidPanel(x: number, y: number, w: number, h: number, s: Story): void {
  fillRect(x, y, x + w, y + h, WHITE);
  rectStroke(x, y, x + w, y + h, INK, 1.25);
  labelBar(x, y, w, s);
  illoMid(x + 3, y + 18, w - 6, 42, s.n);
  drawText(x + 5, y + 70, s.loc, 9, { bold: true, color: GREY });
  const { lines } = fitHeadline(s.head, w - 10, 17, 2, { serif: true, bold: true });
  drawLines(lines, x + 5, y + 86, 17, 18, { serif: true, bold: true });
  const body = wrapText(s.body, w - 10, 12, {});
  drawText(x + 5, y + 117, body[0] ?? "", 12, {});
  srcLine(x + 5, y + h - 4, s, 10);
}

function main(): void {
  fillRect(0, 0, W, H, CREAM);
  // ---- top kicker
  drawText(8, 15, "THE WORLD IN ONE DAY", 13, { bold: true, color: RED, tracking: 0.5 });
  drawText(1016, 15, "36 STORIES · 7 REGIONS · EVERY ONE DATED", 13, { bold: true, color: RED, align: "right", tracking: 0.5 });
  hline(8, 1016, 21, INK, 2);
  // ---- masthead: solid filled classic serif, largest text on the page
  const mast = "Saturday 21 November 2026";
  let mastSize = 84;
  while (textWidth(mast, mastSize, { serif: true, bold: true }) > 1000 && mastSize > 40) mastSize -= 1;
  drawText(512, 88, mast, mastSize, { serif: true, bold: true, align: "center" });
  hline(8, 1016, 108, INK, 1.5);
  // ---- sub-kicker (italic serif)
  drawText(512, 122, "Climate talks run into day 13 · Three missiles downed over Riyadh · M6.7 quake shakes central Peru",
    16.5, { serif: true, italic: true, align: "center" });
  hline(8, 1016, 128, INK, 1);
  // ---- stat strip
  const stats: [string, string][] = [
    ["13", "Day of COP31, planned to close day 12"],
    ["3", "missiles shot down over Riyadh"],
    ["6.7", "magnitude of Peru quake, 108 km deep"],
    ["146", "people safe after Davao jet emergency"],
    ["$58,983", "Bitcoin early Saturday, down 3.9% in a day"],
    ["136", "Rahul's score as India lead NZ by 118"],
  ];
  const colW = 1008 / 6;
  stats.forEach(([num, lab], i) => {
    const cx = 8 + i * colW;
    if (i > 0) vline(cx, 132, 174, GREY, 0.75);
    drawText(cx + 10, 150, num, 29, { serif: true, bold: true });
    const ll = wrapText(lab, colW - 16, 10.5, {});
    drawLines(ll.slice(0, 2), cx + 10, 162, 10.5, 11.5, { color: GREY });
  });
  hline(8, 1016, 178, INK, 1);
  // ---- region bar
  const regions: [Region, number][] = [
    ["Europe", 10], ["Middle East", 6], ["Asia", 5], ["Africa", 1],
    ["Americas", 7], ["Oceania", 3], ["Global", 4],
  ];
  let rx = 8;
  for (const [r, cnt] of regions) {
    const segW = (cnt / 36) * 1008;
    fillRect(rx, 180, rx + segW, 196, REGION_COLOR[r]);
    drawText(rx + segW / 2, 192, `${r} ${cnt}`, 10.5, { bold: true, color: WHITE, align: "center" });
    rx += segW;
  }
  // ---- timeline
  fillRect(8, 200, 116, 220, INK);
  drawText(62, 214, "THE DAY IN UTC", 11, { bold: true, color: WHITE, align: "center" });
  const moments: [string, string][] = [
    ["00:09", "Peru M6.7 quake"], ["02:00", "Sinaloa raid"], ["03:45", "Robot talks end"],
    ["05:47", "Kyiv missiles"], ["09:42", "Banda Sea M6.8"], ["13:30", "Bitcoin rebounds"], ["22:10", "COP31 pauses"],
  ];
  const mW = (1008 - 112) / 7;
  moments.forEach(([t, lab], i) => {
    const mx = 120 + i * mW;
    drawText(mx + 4, 209, t, 12, { serif: true, bold: true, color: RED });
    drawText(mx + 4, 219, lab, 10, {});
    if (i < 6) vline(mx + mW - 3, 202, 220, GREY, 0.75);
  });
  hline(8, 1016, 222, INK, 1);
  // ---- hero row
  HEROES.forEach((s, i) => drawHeroPanel(8 + i * 339, 226, 330, 210, s));
  // ---- mid grid (2 rows x 5)
  MIDS.forEach((s, i) => {
    const row = Math.floor(i / 5), col = i % 5;
    drawMidPanel(8 + col * 203, 440 + row * 136, 196, 132, s);
  });
  // ---- map + list
  drawText(8, 720, "WHERE IT HAPPENED", 12, { bold: true });
  drawMap(8, 724, 330, 214);
  drawText(347, 720, "ALSO ON SATURDAY 21 NOVEMBER — 23 MORE STORIES", 12, { bold: true });
  drawText(1016, 720, "one line each · source in brackets", 10, { color: GREY, align: "right" });
  const colA = LIST.slice(0, 12), colB = LIST.slice(12);
  [colA, colB].forEach((col, ci) => {
    const lx = 347 + ci * 335;
    col.forEach((it, ri) => {
      const y = 740 + ri * 16.5;
      fillCircle(lx + 5, y - 3.5, 6.5, REGION_COLOR[it.region]);
      drawText(lx + 5, y - 0.3, String(it.n), 8, { bold: true, color: WHITE, align: "center" });
      drawText(lx + 15, y, `${it.text} (${it.src})`, 10.5, {});
    });
  });
  // ---- DATE CHECK
  fillRect(8, 944, 1016, 990, [253, 240, 235]);
  rectStroke(8, 944, 1016, 990, RED, 2);
  fillRect(8, 944, 108, 962, RED);
  drawText(58, 957, "DATE CHECK", 11.5, { bold: true, color: WHITE, align: "center" });
  const dc = "Left out as earlier news: Wall Street's fall into a correction (Fri 20 Nov) · Russian barrage on Kyiv's bridges (Fri) · missile that landed in Poland (Fri 20 Nov) · UK–EU deal (Fri) · Cyclone Akvan's landfall (Fri) · Denmark's expulsion of a Russian attaché (20 Nov) · ICJ Myanmar ruling (19 Nov) · Trump–Xi–Putin Shenzhen summit (19–20 Nov). Not yet known when drawn: COP31's final vote (Sun 09:00) · BepiColombo Mercury orbit insertion.";
  drawLines(wrapText(dc, 1008 - 118, 11, {}).slice(0, 3), 116, 958, 11, 13, {});
  // ---- footer
  drawText(512, 1003, "Every story here happened, or was first reported, on Saturday 21 November 2026. Officials' counts and claims are attributed.",
    11.5, { bold: true, align: "center" });
  drawText(512, 1018, "✓ CONFIRMED = 2+ outlets · O OFFICIAL = as stated by authorities · R REPORTED = one outlet · Sources named beside each story · Original drawings",
    10.5, { color: GREY, align: "center" });
  // ---- downsample 2x -> 1x and write PNG
  const rgb = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) {
      const i = ((y * SS + dy) * W * SS + (x * SS + dx)) * 3;
      r += buf[i]; g += buf[i + 1]; b += buf[i + 2];
    }
    const o = (y * W + x) * 3;
    rgb[o] = Math.round(r / 4); rgb[o + 1] = Math.round(g / 4); rgb[o + 2] = Math.round(b / 4);
  }
  const png = encodePNG(W, H, rgb);
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "out";
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "entry.png"), png);
}

main();
