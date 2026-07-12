import { deflateSync } from "node:zlib";

/**
 * Dependenzfreier PNG-Generator für Seed-Platzhalterfotos: sanfte
 * Farbverläufe pro Raumtyp (keine echten Objektfotos nötig). Liefert
 * zusätzlich aHash/Weißanteil, damit die Duplikat-/Grundriss-Heuristik in
 * den Seeds ohne ffmpeg funktioniert.
 */

export interface SeedImage {
  buffer: Buffer;
  width: number;
  height: number;
  perceptualHash: string;
  whiteRatio: number;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, payload: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export type PixelFn = (x: number, y: number) => [number, number, number];

export function encodePng(width: number, height: number, pixel: PixelFn): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bittiefe
  ihdr[9] = 2; // Truecolor RGB
  const raw = Buffer.alloc(height * (1 + width * 3));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0; // Filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
    }
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function signals(width: number, height: number, pixel: PixelFn) {
  // 8×8-Downsample (Mittelwert der Zellen) → aHash + Weißanteil,
  // konsistent zur ffmpeg-Variante in src/ffmpeg.ts.
  const gray: number[] = [];
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 8; gx++) {
      let sum = 0;
      let count = 0;
      const x0 = Math.floor((gx * width) / 8);
      const x1 = Math.floor(((gx + 1) * width) / 8);
      const y0 = Math.floor((gy * height) / 8);
      const y1 = Math.floor(((gy + 1) * height) / 8);
      for (let y = y0; y < y1; y += 8) {
        for (let x = x0; x < x1; x += 8) {
          const [r, g, b] = pixel(x, y);
          sum += 0.299 * r + 0.587 * g + 0.114 * b;
          count++;
        }
      }
      gray.push(sum / Math.max(1, count));
    }
  }
  const mean = gray.reduce((a, b) => a + b, 0) / 64;
  let bits = 0n;
  let white = 0;
  gray.forEach((value, index) => {
    if (value >= mean) bits |= 1n << BigInt(index);
    if (value >= 210) white++;
  });
  return {
    perceptualHash: bits.toString(16).padStart(16, "0"),
    whiteRatio: white / 64,
  };
}

/**
 * Raumfoto: Verlauf zwischen zwei Farben mit seed-abhängiger Richtung und
 * „Fenster“-Highlight. Die Richtung sorgt für unterschiedliche aHashes —
 * nur Bilder mit gleichem Seed+Farben gelten als Duplikate.
 */
export function roomImage(
  colorA: [number, number, number],
  colorB: [number, number, number],
  seed = 0,
  width = 1600,
  height = 1066
): SeedImage {
  const angle = (((seed * 47) % 360) * Math.PI) / 180;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  // Projektion auf volle 0–1-Spanne normalisieren, sonst kippt der
  // Helligkeitsbereich (und damit die Grundriss-/Duplikat-Heuristik).
  const projMin = Math.min(0, dx) + Math.min(0, dy);
  const projMax = Math.max(0, dx) + Math.max(0, dy);
  const wx = width * (0.25 + 0.5 * ((seed * 13) % 10) / 10);
  const wy = height * (0.2 + 0.4 * ((seed * 7) % 10) / 10);
  const pixel: PixelFn = (x, y) => {
    const proj = (x / width) * dx + (y / height) * dy;
    const t = (proj - projMin) / (projMax - projMin);
    const wobble = 0.06 * Math.sin((x / width) * Math.PI * (2 + (seed % 3)));
    const mix = Math.min(1, Math.max(0, t + wobble));
    let r = colorA[0] + (colorB[0] - colorA[0]) * mix;
    let g = colorA[1] + (colorB[1] - colorA[1]) * mix;
    let b = colorA[2] + (colorB[2] - colorA[2]) * mix;
    const dist = Math.hypot((x - wx) / width, (y - wy) / height);
    if (dist < 0.16) {
      const boost = (0.16 - dist) / 0.16;
      r += (255 - r) * boost * 0.8;
      g += (255 - g) * boost * 0.8;
      b += (255 - b) * boost * 0.8;
    }
    return [Math.round(r), Math.round(g), Math.round(b)];
  };
  return { buffer: encodePng(width, height, pixel), width, height, ...signals(width, height, pixel) };
}

/** Grundriss: weißer Hintergrund mit dunklen Linien (hoher Weißanteil). */
export function floorplanImage(width = 1400, height = 1000): SeedImage {
  const pixel: PixelFn = (x, y) => {
    const onGrid =
      x % 200 < 4 ||
      y % 160 < 4 ||
      (y > height * 0.3 && y < height * 0.3 + 6 && x > width * 0.2) ||
      (x > width * 0.55 && x < width * 0.55 + 6 && y > height * 0.25);
    return onGrid ? [40, 44, 52] : [250, 250, 248];
  };
  return { buffer: encodePng(width, height, pixel), width, height, ...signals(width, height, pixel) };
}

/** Kleines Bild für Low-Res-Demo. */
export function lowResImage(
  color: [number, number, number],
  width = 480,
  height = 360
): SeedImage {
  const pixel: PixelFn = (x, y) => {
    const t = y / height;
    return [
      Math.round(color[0] * (1 - t * 0.4)),
      Math.round(color[1] * (1 - t * 0.4)),
      Math.round(color[2] * (1 - t * 0.4)),
    ];
  };
  return { buffer: encodePng(width, height, pixel), width, height, ...signals(width, height, pixel) };
}
