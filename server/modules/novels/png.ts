import { deflateSync, inflateSync } from "zlib";

/** Minimal PNG codec for ComfyUI output: 8-bit RGB/RGBA, grey and grey+alpha,
 * non-interlaced. Anything else returns null and the caller keeps the original
 * file. Built on node:zlib so no native or third-party module is needed. */
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_PIXELS = 4096 * 4096;
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
function crc32(buffer: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface RgbaImage { width: number; height: number; rgba: Uint8Array }

export function decodePng(file: Buffer): RgbaImage | null {
  if (file.length < 33 || !file.subarray(0, 8).equals(SIGNATURE)) return null;
  let pos = 8, width = 0, height = 0, channels = 0;
  const idat: Buffer[] = [];
  while (pos + 8 <= file.length) {
    const length = file.readUInt32BE(pos), type = file.toString("latin1", pos + 4, pos + 8);
    const data = file.subarray(pos + 8, pos + 8 + length);
    if (data.length !== length) return null;
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      const depth = data[8], color = data[9], interlace = data[12];
      channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[color] || 0;
      if (depth !== 8 || interlace !== 0 || !channels || !width || !height || width * height > MAX_PIXELS) return null;
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + length;
  }
  if (!channels || !idat.length) return null;
  const stride = width * channels;
  let raw: Buffer;
  try { raw = inflateSync(Buffer.concat(idat), { maxOutputLength: (stride + 1) * height + 1 }); } catch { return null; }
  if (raw.length < (stride + 1) * height) return null;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride, prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[row + x - channels] : 0, b = y ? pixels[prev + x] : 0, c = x >= channels && y ? pixels[prev + x - channels] : 0;
      let value = raw[src + x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else if (filter !== 0) return null;
      pixels[row + x] = value & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i++, j += channels) {
    if (channels >= 3) { rgba[i * 4] = pixels[j]; rgba[i * 4 + 1] = pixels[j + 1]; rgba[i * 4 + 2] = pixels[j + 2]; }
    else rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = pixels[j];
    rgba[i * 4 + 3] = channels === 4 ? pixels[j + 3] : channels === 2 ? pixels[j + 1] : 255;
  }
  return { width, height, rgba };
}

function chunk(type: string, data: Buffer) {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, "latin1");
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}
export function encodePng({ width, height, rgba }: RgbaImage): Buffer {
  const stride = width * 4, raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}
