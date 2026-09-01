/**
 * Working out when a photo was taken.
 *
 * Home Assistant's Immich media source sends no date whatsoever — the only
 * per-asset fields that reach the browser are the asset id, the original file
 * name and the mime type. So the date has to be recovered here, in two layers:
 *
 *   1. The file name. Free, instant, and correct for most phone cameras, which
 *      stamp the date into the name (IMG_20240315_..., PXL_..., and friends).
 *   2. EXIF from the image bytes. Covers everything the file name cannot —
 *      notably iPhone photos, which are just IMG_1234 — at the cost of one
 *      extra fetch per photo. That fetch usually comes from the browser cache,
 *      since the same URL was just loaded as an image, and the result is
 *      remembered so a photo is only ever inspected once.
 *
 * Both layers can fail, and then nothing is shown rather than a guess.
 */

/** dd/mm/yyyy, as asked for. */
export function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getFullYear()}`;
}

/**
 * Reject values that parsed cleanly but cannot be a photo date, which is what
 * stops a filename like `IMG_12345678` from becoming a confident wrong answer.
 */
function plausible(year: number, month: number, day: number): boolean {
  if (year < 1970 || year > new Date().getFullYear() + 1) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  // Reject a day that does not exist in that month, e.g. 31/02.
  const date = new Date(year, month - 1, day);
  return date.getMonth() === month - 1 && date.getDate() === day;
}

function build(year: number, month: number, day: number, hour = 0, minute = 0): Date | null {
  if (!plausible(year, month, day)) return null;
  return new Date(year, month - 1, day, hour, minute);
}

/**
 * Patterns, most specific first.
 *
 * Anchored on a 4-digit year starting 19 or 20 so that arbitrary digit runs do
 * not masquerade as dates.
 */
const FILENAME_PATTERNS: { re: RegExp; parse: (m: RegExpMatchArray) => Date | null }[] = [
  {
    // IMG_20240315_143022 · PXL_20240315_143022123 · 20240315_143022 · VID_...
    re: /(?:^|[^0-9])((?:19|20)\d{2})(\d{2})(\d{2})[_-](\d{2})(\d{2})/,
    parse: (m) => build(+m[1], +m[2], +m[3], +m[4], +m[5]),
  },
  {
    // Screenshot 2024-03-15 at 14.30.22 · 2024-03-15_14-30-22 · 2024.03.15 14.30
    re: /((?:19|20)\d{2})[-._]?(\d{2})[-._]?(\d{2})[ T_-]+(?:at[ _])?(\d{2})[.:-](\d{2})/i,
    parse: (m) => build(+m[1], +m[2], +m[3], +m[4], +m[5]),
  },
  {
    // IMG-20240315-WA0001 (WhatsApp) · signal-2024-03-15
    re: /(?:^|[^0-9])((?:19|20)\d{2})[-._]?(\d{2})[-._]?(\d{2})(?:[^0-9]|$)/,
    parse: (m) => build(+m[1], +m[2], +m[3]),
  },
];

/** Pull a date out of a file name, or null when it does not carry one. */
export function dateFromFilename(name?: string | null): Date | null {
  if (!name) return null;

  // Drop the extension so a name like `photo.2024.jpg` cannot confuse matters.
  const stem = name.replace(/\.[a-z0-9]{1,5}$/i, "");

  for (const { re, parse } of FILENAME_PATTERNS) {
    const match = stem.match(re);
    if (match) {
      const date = parse(match);
      if (date) return date;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * EXIF
 * ------------------------------------------------------------------ */

const TAG_DATE_TIME = 0x0132;
const TAG_EXIF_IFD_POINTER = 0x8769;
const TAG_DATE_TIME_ORIGINAL = 0x9003;
const TAG_DATE_TIME_DIGITIZED = 0x9004;

/** "2024:03:15 14:30:22" — EXIF's own format. */
function parseExifDateString(value: string): Date | null {
  const match = value.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/);
  if (!match) return null;
  return build(+match[1], +match[2], +match[3], +match[4], +match[5]);
}

function readAscii(view: DataView, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    if (offset + i >= view.byteLength) break;
    const code = view.getUint8(offset + i);
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
}

/**
 * Read the date out of a JPEG's EXIF block.
 *
 * Hand-rolled rather than pulling in an EXIF library: only three tags matter,
 * and a dependency would cost more bundle than the parser does. Every read is
 * bounds-checked, because this runs against whatever bytes a server returned.
 */
export function dateFromExif(buffer: ArrayBuffer): Date | null {
  try {
    const view = new DataView(buffer);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null; // not JPEG

    let offset = 2;
    while (offset + 4 < view.byteLength) {
      const marker = view.getUint16(offset);
      if ((marker & 0xff00) !== 0xff00) return null; // desynchronised
      const size = view.getUint16(offset + 2);

      if (marker === 0xffe1) {
        // APP1: expect "Exif\0\0" then a TIFF header.
        const exifStart = offset + 4;
        if (readAscii(view, exifStart, 4) !== "Exif") return null;
        return readTiff(view, exifStart + 6);
      }

      if (marker === 0xffda) return null; // start of scan: no EXIF present
      if (size < 2) return null;
      offset += 2 + size;
    }
  } catch {
    // A truncated or malformed file must never break the slideshow.
  }
  return null;
}

function readTiff(view: DataView, tiffStart: number): Date | null {
  if (tiffStart + 8 > view.byteLength) return null;

  const byteOrder = view.getUint16(tiffStart);
  let little: boolean;
  if (byteOrder === 0x4949) little = true; // "II"
  else if (byteOrder === 0x4d4d) little = false; // "MM"
  else return null;

  if (view.getUint16(tiffStart + 2, little) !== 0x002a) return null;

  const ifd0 = tiffStart + view.getUint32(tiffStart + 4, little);
  const found = readIfd(view, tiffStart, ifd0, little);

  // DateTimeOriginal is when the shutter fired; DateTime is when the file was
  // last written, so it is only a fallback.
  return found.original ?? found.digitized ?? found.modified ?? null;
}

interface FoundDates {
  original?: Date;
  digitized?: Date;
  modified?: Date;
}

function readIfd(
  view: DataView,
  tiffStart: number,
  ifdOffset: number,
  little: boolean,
  depth = 0,
): FoundDates {
  const found: FoundDates = {};
  if (depth > 2 || ifdOffset + 2 > view.byteLength) return found;

  const count = view.getUint16(ifdOffset, little);
  // A wild count means we are not looking at a real IFD.
  if (count > 512) return found;

  for (let i = 0; i < count; i++) {
    const entry = ifdOffset + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;

    const tag = view.getUint16(entry, little);
    const componentCount = view.getUint32(entry + 4, little);

    if (tag === TAG_EXIF_IFD_POINTER) {
      const sub = tiffStart + view.getUint32(entry + 8, little);
      const nested = readIfd(view, tiffStart, sub, little, depth + 1);
      found.original ??= nested.original;
      found.digitized ??= nested.digitized;
      found.modified ??= nested.modified;
      continue;
    }

    if (
      tag !== TAG_DATE_TIME &&
      tag !== TAG_DATE_TIME_ORIGINAL &&
      tag !== TAG_DATE_TIME_DIGITIZED
    ) {
      continue;
    }

    // An EXIF date is 20 ASCII bytes, so it never fits inline in the entry.
    const valueOffset = tiffStart + view.getUint32(entry + 8, little);
    const text = readAscii(view, valueOffset, Math.min(componentCount, 32));
    const date = parseExifDateString(text);
    if (!date) continue;

    if (tag === TAG_DATE_TIME_ORIGINAL) found.original ??= date;
    else if (tag === TAG_DATE_TIME_DIGITIZED) found.digitized ??= date;
    else found.modified ??= date;
  }

  return found;
}

/* ------------------------------------------------------------------ *
 * Resolver
 * ------------------------------------------------------------------ */

/** Skip the EXIF fetch for anything implausibly large. */
const MAX_EXIF_FETCH_BYTES = 25 * 1024 * 1024;
const CACHE_LIMIT = 500;

/**
 * Resolves and remembers photo dates.
 *
 * Cached by asset id: a photo's date never changes, and a wall display revisits
 * the same photos for weeks, so each one should cost at most one lookup.
 * `null` is cached too — a photo with no recoverable date must not be re-fetched
 * every time it comes round.
 */
export class PhotoDateResolver {
  private cache = new Map<string, Date | null>();

  constructor(private readonly useExif = true) {}

  /** The date if already known, without any fetching. */
  cached(key: string): Date | null | undefined {
    return this.cache.get(key);
  }

  async resolve(key: string, filename: string | undefined, url: string): Promise<Date | null> {
    const known = this.cache.get(key);
    if (known !== undefined) return known;

    const fromName = dateFromFilename(filename);
    if (fromName) {
      this.remember(key, fromName);
      return fromName;
    }

    if (!this.useExif) {
      this.remember(key, null);
      return null;
    }

    const fromExif = await this.fetchExifDate(url);
    this.remember(key, fromExif);
    return fromExif;
  }

  private async fetchExifDate(url: string): Promise<Date | null> {
    try {
      const response = await fetch(url);
      if (!response.ok) return null;

      const length = Number(response.headers.get("content-length") ?? 0);
      if (length > MAX_EXIF_FETCH_BYTES) return null;

      return dateFromExif(await response.arrayBuffer());
    } catch {
      return null;
    }
  }

  private remember(key: string, value: Date | null): void {
    if (this.cache.size >= CACHE_LIMIT) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(key, value);
  }
}
