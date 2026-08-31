/**
 * Slideshow timing and orchestration.
 *
 * Owns the loop that ties a source to the playlist, the preloader and the
 * renderer. Deliberately independent of both Home Assistant and Lit, so the
 * standalone tuning harness in `dev/` drives exactly the same code that the
 * card does.
 *
 * Everything here is written for a display that runs unattended for weeks:
 * failures skip rather than stop, retries back off, and every timer is
 * cancellable.
 */

import { Playlist, type PlaylistOrder } from "./playlist";
import { Preloader } from "./preloader";
import { DEFAULT_RENDERER_OPTIONS, type RendererOptions, SlideRenderer } from "./renderer";
import type { Slide, SlideSource } from "./types";

export interface ControllerOptions extends RendererOptions {
  order: PlaylistOrder;
  /** Seconds between asset-list refreshes. 0 disables. */
  refreshInterval: number;
}

export const DEFAULT_CONTROLLER_OPTIONS: ControllerOptions = {
  ...DEFAULT_RENDERER_OPTIONS,
  order: "shuffle",
  refreshInterval: 3600,
};

export type ControllerStatus = "idle" | "loading" | "playing" | "empty" | "error";

export interface ControllerEvents {
  onStatusChange?: (status: ControllerStatus, detail?: string) => void;
  onSlideChange?: (slide: Slide) => void;
}

/** Consecutive resolve/load failures before a slide is given up on. */
const MAX_SLIDE_ATTEMPTS = 3;
/**
 * How many shown slides to remember, so "previous" is meaningful.
 *
 * The playlist is shuffled, so stepping back cannot be derived — the order only
 * exists in what has already been shown. Bounded because this is a display that
 * runs for weeks.
 */
const HISTORY_LIMIT = 50;
/** Backoff bounds for a failing asset-list fetch, in milliseconds. */
const RELOAD_BACKOFF_MIN = 5_000;
const RELOAD_BACKOFF_MAX = 5 * 60_000;

export class SlideshowController {
  private readonly playlist: Playlist<Slide>;
  private readonly preloader = new Preloader();
  private renderer: SlideRenderer;

  private slideTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  private running = false;
  private paused = false;
  private destroyed = false;
  private reloadFailures = 0;
  private status: ControllerStatus = "idle";
  /** Guards against overlapping advances when a manual next() races the timer. */
  private advancing = false;

  /** Slides already shown, and where in them we are. Drives previous/next. */
  private history: Slide[] = [];
  private cursor = -1;
  private _currentImage?: HTMLImageElement;

  constructor(
    host: HTMLElement,
    private source: SlideSource,
    private options: ControllerOptions = DEFAULT_CONTROLLER_OPTIONS,
    private readonly events: ControllerEvents = {},
  ) {
    this.playlist = new Playlist<Slide>([], options.order);
    this.renderer = new SlideRenderer(host, options);
  }

  async start(): Promise<void> {
    if (this.running || this.destroyed) return;
    this.running = true;
    await this.reload();
  }

  setSource(source: SlideSource): void {
    this.source = source;
    this.preloader.clear();
    void this.reload();
  }

  setOptions(options: ControllerOptions): void {
    this.options = options;
    this.playlist.setOrder(options.order);
    this.renderer.setOptions(options);
    this.scheduleRefresh();
  }

  /** Pause motion and hold the current slide. Cheap enough to call often. */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.renderer.pause();
    this.clearTimer("slide");
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.renderer.resume();
    if (this.running) this.scheduleNext();
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Skip to the next slide immediately. */
  next(): void {
    if (!this.running || this.destroyed) return;
    this.clearTimer("slide");
    void this.advance();
  }

  /** Step back to the previously shown slide, if there is one. */
  previous(): void {
    if (!this.running || this.destroyed) return;
    this.clearTimer("slide");
    void this.retreat();
  }

  /** The image currently on screen, for the fullscreen viewer to borrow. */
  get currentImage(): HTMLImageElement | undefined {
    return this._currentImage;
  }

  get currentSlide(): Slide | undefined {
    return this.history[this.cursor];
  }

  get canGoBack(): boolean {
    return this.cursor > 0;
  }

  destroy(): void {
    this.destroyed = true;
    this.running = false;
    this.clearTimer("slide");
    this.clearTimer("refresh");
    this.clearTimer("retry");
    this.renderer.destroy();
    this.preloader.clear();
    this.history = [];
    this.cursor = -1;
    this._currentImage = undefined;
  }

  /** Re-fetch the asset list, then keep playing. */
  private async reload(): Promise<void> {
    if (this.destroyed) return;
    this.clearTimer("retry");

    const firstLoad = this.playlist.isEmpty;
    if (firstLoad) this.setStatus("loading");

    try {
      const slides = await this.source.load();
      if (this.destroyed) return;

      this.reloadFailures = 0;
      this.playlist.replace(slides);

      if (this.playlist.isEmpty) {
        this.setStatus("empty");
      } else if (firstLoad) {
        // Only drive the first slide from here; a periodic refresh must not
        // interrupt whatever is currently on screen.
        await this.advance();
      }

      this.scheduleRefresh();
    } catch (error) {
      if (this.destroyed) return;
      this.reloadFailures++;

      // Keep showing whatever is on screen; only surface an error if there is
      // nothing to show at all.
      if (this.playlist.isEmpty) {
        this.setStatus("error", error instanceof Error ? error.message : String(error));
      }
      this.scheduleReloadRetry();
    }
  }

  /** Resolve, decode and present the next slide. */
  private async advance(): Promise<void> {
    if (!this.running || this.destroyed || this.advancing) return;
    this.advancing = true;

    try {
      // If the viewer stepped back, going forward should retrace that path
      // rather than jumping to an unrelated photo.
      if (this.cursor < this.history.length - 1) {
        this.cursor++;
        if (await this.tryShow(this.history[this.cursor])) return;
        // The remembered slide no longer loads; fall through to a fresh one.
      }

      for (let attempt = 0; attempt < MAX_SLIDE_ATTEMPTS; attempt++) {
        const slide = this.playlist.next();
        if (!slide) {
          this.setStatus("empty");
          return;
        }

        if (await this.tryShow(slide)) {
          this.remember(slide);
          return;
        }
        // A single unreadable photo must never stop the slideshow; try the next
        // one. This covers an expired signature, a deleted asset, and a
        // transient network blip alike.
      }

      // Every attempt failed: the problem is broader than one photo, so back off
      // rather than spinning through the whole library.
      if (!this.destroyed) this.scheduleReloadRetry();
    } finally {
      this.advancing = false;
      if (this.running && !this.paused && !this.destroyed) this.scheduleNext();
    }
  }

  /** Step back through what has already been shown. */
  private async retreat(): Promise<void> {
    if (!this.running || this.destroyed || this.advancing || this.cursor <= 0) return;
    this.advancing = true;

    try {
      this.cursor--;
      await this.tryShow(this.history[this.cursor]);
    } finally {
      this.advancing = false;
      if (this.running && !this.paused && !this.destroyed) this.scheduleNext();
    }
  }

  /** Resolve, decode and present one slide. Returns false if it cannot be shown. */
  private async tryShow(slide: Slide): Promise<boolean> {
    try {
      const url = await this.source.urlFor(slide);
      if (this.destroyed) return false;

      const image = await this.preloader.get(url);
      if (this.destroyed) return false;

      this.renderer.present(image);
      this._currentImage = image;
      this.setStatus("playing");
      this.events.onSlideChange?.(slide);
      this.warmUpcoming();
      return true;
    } catch {
      return false;
    }
  }

  private remember(slide: Slide): void {
    // A newly drawn slide branches from wherever the cursor sits, so anything
    // ahead of it is no longer the future.
    this.history.length = this.cursor + 1;
    this.history.push(slide);
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.cursor = this.history.length - 1;
  }

  /** Warm the next slides so their bitmaps are ready before they are needed. */
  private warmUpcoming(): void {
    for (const slide of this.playlist.peek(2)) {
      void this.source
        .urlFor(slide)
        .then((url) => this.preloader.warm(url))
        .catch(() => {
          /* warming is best-effort */
        });
    }
  }

  private scheduleNext(): void {
    this.clearTimer("slide");
    if (!this.running || this.paused || this.destroyed) return;
    this.slideTimer = setTimeout(() => void this.advance(), this.options.duration * 1000);
  }

  private scheduleRefresh(): void {
    this.clearTimer("refresh");
    const seconds = this.options.refreshInterval || this.source.refreshInterval;
    if (!seconds || this.destroyed) return;
    this.refreshTimer = setTimeout(() => void this.reload(), seconds * 1000);
  }

  private scheduleReloadRetry(): void {
    this.clearTimer("retry");
    if (this.destroyed) return;

    // Exponential backoff, capped: a wall panel that loses its server for a
    // night should not hammer it, nor take an hour to notice its return.
    const delay = Math.min(
      RELOAD_BACKOFF_MAX,
      RELOAD_BACKOFF_MIN * 2 ** Math.min(this.reloadFailures, 6),
    );
    this.retryTimer = setTimeout(() => void this.reload(), delay);
  }

  private clearTimer(which: "slide" | "refresh" | "retry"): void {
    const timer =
      which === "slide" ? this.slideTimer : which === "refresh" ? this.refreshTimer : this.retryTimer;
    if (timer) clearTimeout(timer);
    if (which === "slide") this.slideTimer = null;
    else if (which === "refresh") this.refreshTimer = null;
    else this.retryTimer = null;
  }

  private setStatus(status: ControllerStatus, detail?: string): void {
    if (this.status === status) return;
    this.status = status;
    this.events.onStatusChange?.(status, detail);
  }
}
