/**
 * Browser-side image quality audit. All remote files pass through the existing
 * Vercel HTTPS image proxy; processed images remain in IndexedDB (no external CDN).
 *
 * This is NOT AI background segmentation. It only whitens a continuous, flat,
 * high-contrast border and otherwise retains the original product photo.
 */
export type PackshotCandidate = { url: string; source: string; priority: number };
export type PackshotResult = {
  file: File;
  source: string;
  quality: "white" | "cleaned" | "fallback";
  checked: number;
};

const ENDPOINT = "/api/hygiene-product-lookup";
const MAX_BYTES = 6 * 1024 * 1024;

class EmptyPackshotError extends Error {}

const imageExtensions = (type: string) => type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
const sq = (a: number, b: number) => (a - b) ** 2;
const pixelDiff = (data: Uint8ClampedArray, offset: number, rgb: number[]) =>
  sq(data[offset], rgb[0]) + sq(data[offset + 1], rgb[1]) + sq(data[offset + 2], rgb[2]);
const nearWhite = (data: Uint8ClampedArray, offset: number) =>
  data[offset] >= 237 && data[offset + 1] >= 237 && data[offset + 2] >= 237;
const canvasToBlob = (canvas: HTMLCanvasElement) => new Promise<Blob | null>((resolve) =>
  canvas.toBlob(resolve, "image/webp", 0.92));

type Inspection = {
  canvas: HTMLCanvasElement;
  bitmap: ImageBitmap;
  score: number;
  whiteness: number;
  uniform: boolean;
  background: number[];
  source: PackshotCandidate;
  original: Blob;
};

async function inspect(candidate: PackshotCandidate, blob: Blob): Promise<Inspection> {
  const bitmap = await createImageBitmap(blob);
  try {
    const w = Math.max(1, Math.min(160, bitmap.width));
    const h = Math.max(1, Math.round(bitmap.height * w / bitmap.width));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = Math.min(160, h);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Nešlo analyzovat fotografii.");
    context.drawImage(bitmap, 0, 0, w, canvas.height);
    const pixels = context.getImageData(0, 0, w, canvas.height).data;
    const corners = [
      0, (w - 1) * 4,
      (canvas.height - 1) * w * 4,
      ((canvas.height - 1) * w + (w - 1)) * 4,
    ];
    const avg = [0, 1, 2].map(channel =>
      corners.reduce((sum, index) => sum + pixels[index + channel], 0) / 4);
    const cornersUniform = corners.every(index => pixelDiff(pixels, index, avg) < 34 * 34);
    let clean = 0, white = 0, edges = 0;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < w; x++) {
        // Sample the outer 14% of the image, avoiding the subject in the center.
        if (x >= w * .14 && x < w * .86 && y >= canvas.height * .14 && y < canvas.height * .86) continue;
        const i = (y * w + x) * 4;
        edges++;
        if (pixels[i + 3] < 25 || nearWhite(pixels, i)) white++;
        if (pixels[i + 3] < 25 || pixelDiff(pixels, i, avg) < 34 * 34) clean++;
      }
    }
    const whiteness = edges ? white / edges : 0;
    const uniformity = edges ? clean / edges : 0;
    const center = ((Math.floor(canvas.height / 2) * w) + Math.floor(w / 2)) * 4;
    const centerContrast = Math.sqrt(pixelDiff(pixels, center, avg));
    // Reject blank white/transparent uploads. A good packshot has a visible
    // foreground object: enough non-white, non-transparent pixels, not just
    // a near-white rectangle with high resolution.
    let subject = 0;
    const total = w * canvas.height;
    for (let i = 0; i < total; i++) {
      const offset = i * 4;
      if (pixels[offset + 3] > 45
        && (pixels[offset] < 227 || pixels[offset + 1] < 227 || pixels[offset + 2] < 227))
        subject++;
    }
    const subjectRatio = subject / Math.max(1, total);
    if (whiteness > .86 && subjectRatio < .006)
      throw new EmptyPackshotError("Bílý obrázek neobsahuje rozpoznatelný produkt.");
    if (cornersUniform && whiteness < .8 && centerContrast < 20)
      throw new EmptyPackshotError("Jednolitý obrázek neobsahuje produkt.");
    const uniform = cornersUniform && uniformity > .77 && centerContrast > 48 && whiteness < .8;
    const resolution = Math.min(1, Math.min(bitmap.width, bitmap.height) / 650);
    const shape = bitmap.width / Math.max(1, bitmap.height);
    const aspectBonus = shape > .45 && shape < 1.8 ? 12 : -18;
    const score = whiteness * 150 + (uniform ? 92 : 0) + resolution * 38
      + aspectBonus + Math.min(30, candidate.priority) * .5
      - (Math.min(bitmap.width, bitmap.height) < 100 ? 36 : 0);
    return { canvas, bitmap, score, whiteness, uniform, background: avg, source: candidate, original: blob };
  } catch (error) {
    bitmap.close();
    throw error;
  }
}

function whitenUniformBackdrop(canvas: HTMLCanvasElement, background: number[]) {
  const width = canvas.width, height = canvas.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  const image = context.getImageData(0, 0, width, height);
  const data = image.data, seen = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0, tail = 0;
  function visit(x: number, y: number) {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const pos = y * width + x;
    if (seen[pos]) return;
    seen[pos] = 1;
    const index = pos * 4;
    if (data[index + 3] < 20 || pixelDiff(data, index, background) < 38 * 38)
      queue[tail++] = pos;
  }
  for (let x = 0; x < width; x++) { visit(x, 0); visit(x, height - 1); }
  for (let y = 0; y < height; y++) { visit(0, y); visit(width - 1, y); }
  while (head < tail) {
    const position = queue[head++];
    const x = position % width, y = Math.floor(position / width);
    if (x > 0) visit(x - 1, y);
    if (x + 1 < width) visit(x + 1, y);
    if (y > 0) visit(x, y - 1);
    if (y + 1 < height) visit(x, y + 1);
  }
  // Never erase the entire photograph or assume a busy background is cleanable.
  const ratio = tail / Math.max(1, width * height);
  if (ratio < .10 || ratio > .82) return false;
  for (let i = 0; i < tail; i++) {
    const offset = queue[i] * 4;
    data[offset] = data[offset + 1] = data[offset + 2] = data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return true;
}

async function convertSelected(result: Inspection): Promise<PackshotResult> {
  const target = document.createElement("canvas");
  const factor = Math.min(1, 950 / Math.max(result.bitmap.width, result.bitmap.height));
  target.width = Math.max(1, Math.round(result.bitmap.width * factor));
  target.height = Math.max(1, Math.round(result.bitmap.height * factor));
  const context = target.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Nešlo upravit fotografii.");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, target.width, target.height);
  context.drawImage(result.bitmap, 0, 0, target.width, target.height);
  const changed = result.uniform && whitenUniformBackdrop(target, result.background);
  const converted = await canvasToBlob(target);
  const fileBlob = converted && converted.size > 0 && converted.size < MAX_BYTES
    ? converted : result.original;
  const type = fileBlob.type === "image/webp" ? "image/webp" : result.original.type;
  const file = new File([fileBlob], "produkt-bile-pozadi." + imageExtensions(type), { type });
  return { file, source: result.source.source,
    quality: result.whiteness >= .82 ? "white" : changed ? "cleaned" : "fallback", checked: 1 };
}

/** Evaluate multiple candidates, preferring clean studio photos to rank/thumbnail order. */
export async function findBestProductPackshot(candidates: PackshotCandidate[]): Promise<PackshotResult | null> {
  const unique = [...new Map(candidates
    .filter((candidate) => candidate.url.startsWith("https://"))
    .map((candidate) => [candidate.url, candidate])).values()].slice(0, 8);
  let best: Inspection | null = null;
  // Some legitimate product thumbnails decode in <img> but cannot be opened
  // by createImageBitmap in all browsers. Preserve the original as a fallback.
  let fallback: { blob: Blob; source: string } | null = null;
  let checked = 0;
  for (let start = 0; start < unique.length; start += 3) {
    const batch = await Promise.all(unique.slice(start, start + 3).map(async (candidate) => {
      try {
        const response = await fetch(ENDPOINT + "?mode=image&url=" + encodeURIComponent(candidate.url), {
          signal: AbortSignal.timeout(6500),
        });
        if (!response.ok) return null;
        const blob = await response.blob();
        if (!["image/jpeg", "image/png", "image/webp"].includes(blob.type)
          || blob.size < 30 || blob.size > MAX_BYTES) return null;
        try { return await inspect(candidate, blob); }
        catch (error) {
          if (error instanceof EmptyPackshotError) return null;
          // A real image can fail decoding on older browsers: keep it only
          // as a last-resort fallback, never as a preferred white packshot.
          fallback ??= { blob, source: candidate.source };
          return null;
        }
      } catch { return null; }
    }));
    for (const photo of batch) {
      if (!photo) continue;
      checked++;
      if (!best || photo.score > best.score) {
        best?.bitmap.close();
        best = photo;
      } else photo.bitmap.close();
    }
  }
  if (!best) {
    if (!fallback) return null;
    const original = fallback as { blob: Blob; source: string };
    const file = new File([original.blob], "produkt-fotografie." + imageExtensions(original.blob.type),
      { type: original.blob.type });
    return { file, source: original.source, quality: "fallback", checked: Math.max(1, checked) };
  }
  try {
    const selected = await convertSelected(best);
    return { ...selected, checked };
  } finally {
    best.bitmap.close();
  }
}
