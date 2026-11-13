import { describe, expect, it } from "vitest";
import { deflateSync } from "zlib";
import { cutoutBackground } from "./cutout.js";
import { decodePng, encodePng } from "./png.js";

// Synthetic images only: a figure drawn as an outlined rectangle on a backdrop.
type Rgb = [number, number, number];
function image(width: number, height: number, paint: (x: number, y: number) => Rgb) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const [r, g, b] = paint(x, y); rgba.set([r, g, b, 255], (y * width + x) * 4); }
  return rgba;
}
const alpha = (rgba: Uint8Array, width: number, x: number, y: number) => rgba[(y * width + x) * 4 + 3];
const GREEN: Rgb = [190, 225, 35], PALE: Rgb = [214, 225, 234], OUTLINE: Rgb = [20, 20, 25];
/** Figure: dark outline around [x0,x1]x[y0,y1] filled with `fill`. */
const figure = (backdrop: (x: number, y: number) => Rgb, fill: Rgb, box = [24, 16, 72, 92]) => (x: number, y: number): Rgb => {
  const [x0, y0, x1, y1] = box;
  if (x < x0 || x > x1 || y < y0 || y > y1) return backdrop(x, y);
  return x === x0 || x === x1 || y === y0 || y === y1 || x === x0 + 1 || x === x1 - 1 ? OUTLINE : fill;
};

describe("sprite cut-out", () => {
  it("removes a flat chroma backdrop and keeps a pale figure intact", () => {
    const src = image(96, 100, figure(() => GREEN, [215, 215, 220]));
    const cut = cutoutBackground(src, 96, 100);
    expect(cut.ok).toBe(true);
    expect(alpha(cut.rgba, 96, 3, 3)).toBe(0);
    expect(alpha(cut.rgba, 96, 48, 50)).toBe(255);
    expect(cut.coverage).toBeGreaterThan(0.25);
  });
  it("follows a gradient and a vignette in the backdrop", () => {
    const src = image(96, 100, figure((x, y) => [GREEN[0] - (x + y) / 6, GREEN[1] - y / 5, GREEN[2] + x / 8].map(Math.round) as Rgb, [120, 60, 60]));
    const cut = cutoutBackground(src, 96, 100);
    expect(cut.ok).toBe(true);
    expect([alpha(cut.rgba, 96, 2, 98), alpha(cut.rgba, 96, 93, 2), alpha(cut.rgba, 96, 48, 50)]).toEqual([0, 0, 255]);
  });
  it("clears an enclosed gap of backdrop colour inside the figure", () => {
    const src = image(96, 100, (x, y) => x >= 40 && x <= 56 && y >= 40 && y <= 60 ? GREEN : figure(() => GREEN, [120, 60, 60])(x, y));
    const cut = cutoutBackground(src, 96, 100);
    expect(cut.ok).toBe(true);
    expect(alpha(cut.rgba, 96, 48, 50)).toBe(0);
    expect(alpha(cut.rgba, 96, 30, 30)).toBe(255);
  });
  it("never eats a figure close to a washed-out backdrop", () => {
    // Pale grey-blue backdrop with a near-identical enclosed area: cautious mode keeps it.
    const src = image(96, 100, (x, y) => x >= 40 && x <= 56 && y >= 40 && y <= 60 ? [205, 214, 222] : figure(() => PALE, [205, 214, 222])(x, y));
    const cut = cutoutBackground(src, 96, 100);
    expect(cut.ok).toBe(true);
    expect(alpha(cut.rgba, 96, 48, 50)).toBe(255);
    expect(alpha(cut.rgba, 96, 3, 3)).toBe(0);
  });
  it("refuses a noisy border or a figure that fills the frame", () => {
    const noisy = image(96, 100, (x, y) => ((x * 7919 + y * 104729) % 97) > 48 ? [10, 200, 30] : [230, 20, 200]);
    expect(cutoutBackground(noisy, 96, 100).ok).toBe(false);
    const full = image(96, 100, figure(() => GREEN, [120, 60, 60], [2, 2, 93, 97]));
    expect(cutoutBackground(full, 96, 100).ok).toBe(false);
    expect(cutoutBackground(new Uint8Array(10), 2, 2).ok).toBe(false);
  });
});

describe("png codec", () => {
  it("round-trips RGBA", () => {
    const rgba = image(17, 9, (x, y) => [x * 15, y * 28, (x * y) % 256]);
    rgba[3] = 7;
    const back = decodePng(encodePng({ width: 17, height: 9, rgba }))!;
    expect(back.width).toBe(17); expect(Buffer.from(back.rgba).equals(Buffer.from(rgba))).toBe(true);
  });
  it("decodes RGB rows written with every filter type", () => {
    const width = 5, height = 5, px = (x: number, y: number) => [(x * 40 + y) % 256, (y * 50) % 256, (x * y * 9) % 256];
    const raw: number[] = [];
    const at = (x: number, y: number, c: number) => (x < 0 || y < 0 ? 0 : px(x, y)[c]);
    for (let y = 0; y < height; y++) {
      const filter = y; raw.push(filter);
      for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) {
        const v = px(x, y)[c], a = at(x - 1, y, c), b = at(x, y - 1, c), cc = at(x - 1, y - 1, c);
        const p = a + b - cc, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - cc);
        const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : cc][filter];
        raw.push((v - pred + 256) & 0xff);
      }
    }
    // Build an RGB PNG by hand (colour type 2): ComfyUI's SaveImage writes RGB.
    const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
    const file = buildPng(header, deflateSync(Buffer.from(raw)));
    const decoded = decodePng(file)!;
    expect(decoded.width).toBe(width);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) expect(Array.from(decoded.rgba.slice((y * width + x) * 4, (y * width + x) * 4 + 4))).toEqual([...px(x, y), 255]);
  });
  it("rejects files it cannot handle", () => {
    expect(decodePng(Buffer.from("not a png"))).toBeNull();
    const header = Buffer.alloc(13); header.writeUInt32BE(4, 0); header.writeUInt32BE(4, 4); header[8] = 16; header[9] = 2;
    expect(decodePng(buildPng(header, deflateSync(Buffer.alloc(40))))).toBeNull();
  });
});

function buildPng(header: Buffer, idat: Buffer) {
  // CRCs are not checked by the decoder; zero is enough for these fixtures.
  const chunk = (type: string, data: Buffer) => { const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, "latin1"); return Buffer.concat([head, data, Buffer.alloc(4)]); };
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}
