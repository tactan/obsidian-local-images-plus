/**
 * Minimal helpers for per-note numbering and safe WebP conversion.
 * No Obsidian API calls: callers supply existing attachment filenames.
 */
const counters = new Map<string, number>();
const TOKEN = /\$\{(\w+)(?::(\d+))?\}/g;

export function hasCounterVariable(template: string): boolean {
  return /\$\{counter(?::\d+)?\}/.test(template);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^$()|[\]{}\\]/g, "\\$&");
}

export function highestExistingCounter(
  template: string,
  sanitizedNoteName: string,
  existingNames: string[]
): number {
  if (!hasCounterVariable(template)) return 0;
  let pattern = "";
  let previous = 0;
  let hasCapture = false;
  TOKEN.lastIndex = 0;
  let token: RegExpExecArray | null;
  while ((token = TOKEN.exec(template)) !== null) {
    const at = token.index;
    pattern += escapeRegex(template.slice(previous, at));
    const name = token[1];
    if (name === "counter") {
      pattern += hasCapture ? "\\d+" : "(\\d+)";
      hasCapture = true;
    } else if (name === "notename") {
      pattern += escapeRegex(sanitizedNoteName);
    } else if (["md5", "originalname", "date", "unique"].includes(name)) {
      pattern += ".+?";
    } else {
      pattern += escapeRegex(token[0]);
    }
    previous = at + token[0].length;
  }
  pattern += escapeRegex(template.slice(previous));
  if (!hasCapture) return 0;
  const re = new RegExp("^" + pattern + "$", "i");
  let highest = 0;
  for (const item of existingNames) {
    const base = String(item).split(/[\\/]/).pop() || "";
    const dot = base.lastIndexOf(".");
    const withoutExt = (dot >= 0 ? base.slice(0, dot) : base)
      .replace(/\s+\(\d+\)$/, "");
    const found = re.exec(withoutExt);
    if (!found) continue;
    const n = Number(found[1]);
    if (Number.isSafeInteger(n) && n > highest) highest = n;
  }
  return highest;
}

export function nextCounterForNote(
  notePath: string,
  template: string,
  sanitizedNoteName: string,
  existingNames: string[]
): number {
  if (!hasCounterVariable(template)) return 0;
  const key = notePath + "\0" + template;
  const old = counters.get(key);
  const next =
    (old === undefined
      ? highestExistingCounter(template, sanitizedNoteName, existingNames)
      : old) + 1;
  counters.set(key, next);
  return next;
}

const INPUT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  avif: "image/avif",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  ico: "image/x-icon",
};

export function isWebpConvertible(extension: string, exclusions: string = "gif"): boolean {
  const ext = String(extension).toLowerCase().replace(/^\./, "");
  const excluded = exclusions.toLowerCase().split(/[|,\s]+/).filter(Boolean);
  return Object.prototype.hasOwnProperty.call(INPUT_MIME, ext) &&
    !excluded.includes(ext) &&
    !(ext === "jpg" && excluded.includes("jpeg")) &&
    !(ext === "jpeg" && excluded.includes("jpg")) &&
    !(ext === "tif" && excluded.includes("tiff")) &&
    !(ext === "tiff" && excluded.includes("tif"));
}

function validWebp(bytes: ArrayBuffer): boolean {
  const b = new Uint8Array(bytes);
  return b.length >= 12 &&
    b[0] === 82 && b[1] === 73 && b[2] === 70 && b[3] === 70 &&
    b[8] === 87 && b[9] === 69 && b[10] === 66 && b[11] === 80;
}

/**
 * Convert only browser-decodable static images. On failure, return null:
 * the caller must then retain the original bytes and extension.
 */
export async function convertImageToWebp(
  bytes: ArrayBuffer,
  extension: string,
  quality: number = 80,
  exclusions: string = "gif"
): Promise<ArrayBuffer | null> {
  const ext = String(extension).toLowerCase().replace(/^\./, "");
  if (!isWebpConvertible(ext, exclusions)) return null;
  const mime = INPUT_MIME[ext];
  return new Promise<ArrayBuffer | null>((resolve) => {
    let url = "";
    let done = false;
    const finish = (value: ArrayBuffer | null = null) => {
      if (done) return;
      done = true;
      if (url) URL.revokeObjectURL(url);
      resolve(value);
    };
    try {
      url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime }));
      const img = new Image();
      img.onerror = () => finish();
      img.onload = () => {
        try {
          const width = img.naturalWidth || img.width;
          const height = img.naturalHeight || img.height;
          // Avoid WebP's dimension limit and excessive canvas allocations.
          if (!width || !height || width > 16383 || height > 16383 ||
              width * height > 64000000) {
            finish();
            return;
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          if (!context) {
            finish();
            return;
          }
          // Keep transparency rather than filling with white.
          context.drawImage(img, 0, 0);
          const q = Number.isFinite(quality)
            ? Math.max(0.1, Math.min(1, quality / 100))
            : 0.8;
          canvas.toBlob((blob) => {
            if (!blob || blob.type !== "image/webp" || !blob.size) {
              finish();
              return;
            }
            blob.arrayBuffer()
              .then((result) => finish(validWebp(result) ? result : null))
              .catch(() => finish());
          }, "image/webp", q);
        } catch (_) {
          finish();
        }
      };
      img.src = url;
    } catch (_) {
      finish();
    }
  });
}
