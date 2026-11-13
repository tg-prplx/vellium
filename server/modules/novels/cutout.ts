/** Remove a sprite's flat backdrop without a neural model. The backdrop colour
 * is measured from the border, then grown inward step by step so gradients and
 * vignettes still count as backdrop. A result that does not look like one
 * figure on a backdrop is reported as `ok: false` and never applied. Pure
 * function: no I/O. Distances are Euclidean in RGB (0-441). */
// Tuned on Anima renders over saturated backdrops (see layers.ts spriteBackdrop):
// figure colours sit far from the backdrop, so enclosed gaps can be cleared
// at a looser tolerance than the border-connected flood.
export const CUTOUT = { border: 4, borderTolerance: 40, borderOutliers: 0.15, step: 12, global: 70, holeTolerance: 30, holeArea: 0.00005, minCoverage: 0.1, maxCoverage: 0.9,
  // A washed-out backdrop (Anima drew "blue background" as pale grey-blue) sits
  // close to pale hair and clothes: grow less and leave enclosed gaps alone.
  saturatedChroma: 60, paleGlobal: 35 };

export interface CutoutResult { rgba: Uint8Array; ok: boolean; coverage: number }

const dist = (p: Uint8Array, i: number, r: number, g: number, b: number) => Math.hypot(p[i] - r, p[i + 1] - g, p[i + 2] - b);
function median(values: number[]) { const sorted = [...values].sort((a, b) => a - b); return sorted[sorted.length >> 1] ?? 0; }

export function cutoutBackground(source: Uint8Array, width: number, height: number, limits = CUTOUT): CutoutResult {
  const n = width * height, fail = (coverage = 0): CutoutResult => ({ rgba: source, ok: false, coverage });
  if (width < 16 || height < 16 || source.length !== n * 4) return fail();
  const band = Math.min(limits.border, width >> 2, height >> 2);
  const border: number[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (x < band || y < band || x >= width - band || y >= height - band) border.push(y * width + x);
  const [r, g, b] = [0, 1, 2].map((c) => median(border.map((i) => source[i * 4 + c])));
  if (border.filter((i) => dist(source, i * 4, r, g, b) > limits.borderTolerance).length > border.length * limits.borderOutliers) return fail();
  const saturated = Math.max(r, g, b) - Math.min(r, g, b) >= limits.saturatedChroma;
  const global = saturated ? limits.global : limits.paleGlobal;

  // 1 = backdrop. Grow from the border through small colour steps.
  const mask = new Uint8Array(n), queue = new Int32Array(n);
  const neighbours = (i: number) => { const x = i % width, y = (i - x) / width; return [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1]; };
  let head = 0, tail = 0;
  for (const i of border) if (dist(source, i * 4, r, g, b) < global) { mask[i] = 1; queue[tail++] = i; }
  while (head < tail) {
    const i = queue[head++];
    for (const j of neighbours(i)) {
      if (j < 0 || mask[j]) continue;
      if (dist(source, j * 4, source[i * 4], source[i * 4 + 1], source[i * 4 + 2]) < limits.step && dist(source, j * 4, r, g, b) < global) { mask[j] = 1; queue[tail++] = j; }
    }
  }
  // Enclosed gaps (between an arm and the body) never touch the border.
  const seen = new Uint8Array(n), minHole = Math.max(4, Math.round(n * limits.holeArea));
  for (let start = 0; saturated && start < n; start++) {
    if (mask[start] || seen[start] || dist(source, start * 4, r, g, b) >= limits.holeTolerance) continue;
    head = 0; tail = 0; queue[tail++] = start; seen[start] = 1;
    while (head < tail) {
      for (const j of neighbours(queue[head++])) {
        if (j < 0 || mask[j] || seen[j] || dist(source, j * 4, r, g, b) >= limits.holeTolerance) continue;
        seen[j] = 1; queue[tail++] = j;
      }
    }
    if (tail >= minHole) for (let k = 0; k < tail; k++) mask[queue[k]] = 1;
  }
  // Trim one pixel of contour, where backdrop colour bleeds into the figure.
  const solid = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (!mask[i] && neighbours(i).every((j) => j >= 0 && !mask[j])) solid[i] = 1;
  const out = new Uint8Array(source);
  let opaque = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    let sum = 0, count = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < width && yy < height) { sum += solid[yy * width + xx]; count++; }
    }
    const alpha = Math.round((sum / count) * source[i * 4 + 3]);
    out[i * 4 + 3] = alpha;
    if (alpha > 127) opaque++;
    if (alpha > 0 && alpha < 255) {
      // Pull soft edge colour toward the figure so no grey fringe remains.
      let rr = 0, gg = 0, bb = 0, m = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy, j = yy * width + xx;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height || !solid[j]) continue;
        rr += source[j * 4]; gg += source[j * 4 + 1]; bb += source[j * 4 + 2]; m++;
      }
      if (m) { out[i * 4] = Math.round(rr / m); out[i * 4 + 1] = Math.round(gg / m); out[i * 4 + 2] = Math.round(bb / m); }
    }
  }
  const coverage = opaque / n;
  if (coverage < limits.minCoverage || coverage > limits.maxCoverage) return fail(coverage);
  return { rgba: out, ok: true, coverage };
}
