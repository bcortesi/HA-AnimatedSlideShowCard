/**
 * The visible layer of the slideshow: stacked images, Ken Burns motion, and the
 * crossfade between them.
 *
 * Uses the Web Animations API rather than CSS keyframes because every slide's
 * motion is randomised, and because WAAPI gives `pause()` / `play()` for free —
 * which is what lets an off-screen or hidden panel stop burning GPU.
 */

import {
  DEFAULT_KEN_BURNS_OPTIONS,
  KenBurnsDirector,
  type KenBurnsOptions,
  transformToCss,
} from "./kenburns";
import type { SlideFit } from "./types";

export interface RendererOptions {
  /** Seconds a slide is the primary image, excluding its fade-out. */
  duration: number;
  /** Seconds of overlap between consecutive slides. */
  crossfade: number;
  fit: SlideFit;
  kenBurns: KenBurnsOptions;
}

export const DEFAULT_RENDERER_OPTIONS: RendererOptions = {
  duration: 25,
  crossfade: 3,
  fit: "cover",
  kenBurns: DEFAULT_KEN_BURNS_OPTIONS,
};

/** How much of the layer the contained foreground occupies in `blurred` mode. */
const CONTAIN_INSET = 0.92;
/** Zoom applied to the contained foreground; the 8% inset absorbs it exactly. */
const CONTAIN_ZOOM = 1.08;

interface Layer {
  element: HTMLDivElement;
  animations: Animation[];
}

export const RENDERER_STYLES = `
  .asc-stage {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #000;
  }
  .asc-layer {
    position: absolute;
    inset: 0;
    opacity: 0;
    will-change: transform, opacity;
    transform-origin: center center;
    backface-visibility: hidden;
  }
  .asc-layer img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .asc-backdrop {
    position: absolute;
    inset: 0;
    filter: blur(32px) brightness(0.55) saturate(1.2);
    transform: scale(1.15);
    will-change: transform;
  }
  .asc-foreground {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    will-change: transform;
  }
  .asc-foreground img {
    width: ${CONTAIN_INSET * 100}%;
    height: ${CONTAIN_INSET * 100}%;
    object-fit: contain;
  }
`;

export class SlideRenderer {
  private readonly stage: HTMLDivElement;
  private readonly director: KenBurnsDirector;
  private layers: Layer[] = [];
  private paused = false;
  private destroyed = false;

  constructor(
    private readonly host: HTMLElement,
    private options: RendererOptions = DEFAULT_RENDERER_OPTIONS,
  ) {
    this.stage = document.createElement("div");
    this.stage.className = "asc-stage";
    this.host.appendChild(this.stage);
    this.director = new KenBurnsDirector(this.options.kenBurns);
  }

  setOptions(options: RendererOptions): void {
    this.options = options;
    this.director.setOptions(options.kenBurns);
  }

  /**
   * Bring an already-decoded image on screen.
   *
   * The incoming layer's motion runs for `duration + crossfade`, so the
   * outgoing image is still moving while it fades out. Freezing motion during
   * the fade is the single most recognisable tell of a cheap slideshow.
   */
  present(image: HTMLImageElement): void {
    if (this.destroyed) return;

    const move = this.director.next();
    const motionMs = (this.options.duration + this.options.crossfade) * 1000;
    const fadeMs = this.options.crossfade * 1000;

    const layer = this.buildLayer(image);
    this.stage.appendChild(layer.element);

    const fadeIn = layer.element.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: fadeMs,
      easing: "ease-in-out",
      fill: "forwards",
    });
    layer.animations.push(fadeIn);

    // Constant-velocity motion: the crossfade overlap hides the start and stop,
    // so easing here would only make the seam visible.
    const motionTarget =
      this.options.fit === "blurred"
        ? (layer.element.querySelector(".asc-backdrop") as HTMLElement | null)
        : layer.element;

    if (motionTarget) {
      layer.animations.push(
        motionTarget.animate(
          [{ transform: transformToCss(move.from) }, { transform: transformToCss(move.to) }],
          { duration: motionMs, easing: "linear", fill: "forwards" },
        ),
      );
    }

    if (this.options.fit === "blurred") {
      const foreground = layer.element.querySelector(".asc-foreground") as HTMLElement | null;
      if (foreground) {
        // Scale only. The contained image has no overflow to pan into, so a
        // translate here would letterbox rather than move the subject.
        const from = move.zoomIn ? 1 : CONTAIN_ZOOM;
        const to = move.zoomIn ? CONTAIN_ZOOM : 1;
        layer.animations.push(
          foreground.animate([{ transform: `scale(${from})` }, { transform: `scale(${to})` }], {
            duration: motionMs,
            easing: "linear",
            fill: "forwards",
          }),
        );
      }
    }

    // Retire everything that was already on screen.
    const outgoing = this.layers;
    this.layers = [layer];
    for (const old of outgoing) this.retire(old, fadeMs);

    if (this.paused) this.pause();
  }

  pause(): void {
    this.paused = true;
    for (const layer of this.layers) {
      for (const animation of layer.animations) {
        if (animation.playState === "running") animation.pause();
      }
    }
  }

  resume(): void {
    this.paused = false;
    for (const layer of this.layers) {
      for (const animation of layer.animations) {
        if (animation.playState === "paused") animation.play();
      }
    }
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Cancel everything and detach. Must be called from `disconnectedCallback`. */
  destroy(): void {
    this.destroyed = true;
    for (const layer of this.layers) {
      for (const animation of layer.animations) animation.cancel();
      layer.element.remove();
    }
    this.layers = [];
    this.stage.remove();
  }

  private buildLayer(image: HTMLImageElement): Layer {
    const element = document.createElement("div");
    element.className = "asc-layer";

    if (this.options.fit === "blurred") {
      const backdrop = document.createElement("div");
      backdrop.className = "asc-backdrop";
      backdrop.appendChild(cloneFor(image));

      const foreground = document.createElement("div");
      foreground.className = "asc-foreground";
      foreground.appendChild(cloneFor(image));

      element.append(backdrop, foreground);
    } else {
      element.appendChild(cloneFor(image));
    }

    return { element, animations: [] };
  }

  private retire(layer: Layer, fadeMs: number): void {
    const fadeOut = layer.element.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: fadeMs,
      easing: "ease-in-out",
      fill: "forwards",
    });
    layer.animations.push(fadeOut);
    if (this.paused) fadeOut.pause();

    const remove = () => {
      for (const animation of layer.animations) animation.cancel();
      layer.element.remove();
    };
    fadeOut.onfinish = remove;
    // `onfinish` never fires if the animation is cancelled during teardown,
    // so removal is also driven from destroy().
    fadeOut.oncancel = remove;
  }
}

/**
 * Reuse the decoded bitmap. Setting the same `src` hits the browser cache, so
 * the clone paints immediately rather than re-decoding.
 */
function cloneFor(image: HTMLImageElement): HTMLImageElement {
  const clone = new Image();
  clone.decoding = "sync";
  clone.src = image.src;
  clone.alt = "";
  return clone;
}
