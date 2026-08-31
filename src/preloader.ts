/**
 * Image preloading.
 *
 * A slide must be fully decoded before its animation starts, otherwise the
 * crossfade begins on a blank layer and the first frames of the Ken Burns move
 * are lost to a visible pop. `HTMLImageElement.decode()` is what makes this
 * deterministic: it resolves only once the bitmap is ready to paint.
 */

export interface PreloadedImage {
  url: string;
  image: HTMLImageElement;
}

/**
 * Fetch and decode an image.
 *
 * `decode()` is not universally reliable — some browsers reject it for images
 * that would nonetheless render fine — so a load/error race is kept as the
 * fallback rather than letting a spurious rejection drop a photo.
 */
export function loadImage(url: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const image = new Image();
    image.decoding = "async";
    // Immich URLs are same-origin (served by Home Assistant), so no crossOrigin.

    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      cleanup();
      image.src = "";
      reject(new DOMException("Aborted", "AbortError"));
    };

    image.onload = () => {
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      cleanup();
      reject(new Error(`Failed to load image: ${url}`));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    image.src = url;

    // Prefer decode() when it works, but never let it be the only path.
    void image
      .decode()
      .then(() => {
        if (signal?.aborted) return;
        cleanup();
        resolve(image);
      })
      .catch(() => {
        /* fall back to onload/onerror above */
      });
  });
}

/**
 * A bounded look-ahead cache.
 *
 * Bounded because the target is a wall tablet that runs for weeks: an unbounded
 * cache of full-resolution bitmaps is a slow out-of-memory crash.
 */
export class Preloader {
  private cache = new Map<string, HTMLImageElement>();
  private inFlight = new Map<string, Promise<HTMLImageElement>>();

  constructor(private readonly capacity = 4) {}

  /** Start loading a URL without waiting for it. */
  warm(url: string): void {
    if (this.cache.has(url) || this.inFlight.has(url)) return;
    void this.get(url).catch(() => {
      /* a failed warm-up is not fatal; the slide will retry or be skipped */
    });
  }

  /** Get a decoded image, loading it if necessary. */
  async get(url: string): Promise<HTMLImageElement> {
    const cached = this.cache.get(url);
    if (cached) {
      // Refresh recency for the LRU eviction below.
      this.cache.delete(url);
      this.cache.set(url, cached);
      return cached;
    }

    const existing = this.inFlight.get(url);
    if (existing) return existing;

    const pending = loadImage(url)
      .then((image) => {
        this.cache.set(url, image);
        this.evict();
        return image;
      })
      .finally(() => {
        this.inFlight.delete(url);
      });

    this.inFlight.set(url, pending);
    return pending;
  }

  clear(): void {
    this.cache.clear();
    this.inFlight.clear();
  }

  private evict(): void {
    while (this.cache.size > this.capacity) {
      const oldest = this.cache.keys().next();
      if (oldest.done) break;
      this.cache.delete(oldest.value);
    }
  }
}
