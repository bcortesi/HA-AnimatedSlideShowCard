/**
 * animated-slideshow-card
 *
 * A Lovelace card that shows photos from Immich (or any Home Assistant media
 * source) with a Ken Burns effect.
 *
 * The card element itself stays thin on purpose: it owns Home Assistant
 * lifecycle concerns — config validation, the `hass` object, visibility, sizing
 * — and delegates everything visual to `SlideshowController`, which knows
 * nothing about Home Assistant and can therefore be developed and tuned in the
 * standalone harness under `dev/`.
 */

import {
  LitElement,
  css,
  html,
  nothing,
  unsafeCSS,
  type PropertyValues,
  type TemplateResult,
} from "lit";
import { DEFAULT_CONTROLLER_OPTIONS, SlideshowController, type ControllerOptions, type ControllerStatus } from "./controller";
import type { HomeAssistant } from "./ha";
import { DEFAULT_KEN_BURNS_OPTIONS } from "./kenburns";
import { RENDERER_STYLES } from "./renderer";
import { createSource, isHassAware } from "./sources";
import type { Slide, SlideshowCardConfig, SlideSource } from "./types";

const CARD_VERSION = "0.1.0";

/* eslint-disable no-console */
console.info(
  `%c ANIMATED-SLIDESHOW-CARD %c ${CARD_VERSION} `,
  "color: white; background: #03a9f4; font-weight: 700;",
  "color: #03a9f4; background: white; font-weight: 700;",
);

export class AnimatedSlideshowCard extends LitElement {
  static override properties = {
    _status: { state: true },
    _statusDetail: { state: true },
    _caption: { state: true },
  };

  private _hass?: HomeAssistant;
  private config?: SlideshowCardConfig;
  private source?: SlideSource;
  private controller?: SlideshowController;

  private observer?: IntersectionObserver;
  private onVisibilityChange = () => this.syncPlayback();
  private onScreen = true;

  private _status: ControllerStatus = "idle";
  private _statusDetail?: string;
  private _caption?: string;

  static override styles = css`
    :host {
      display: block;
    }
    ha-card {
      overflow: hidden;
      height: 100%;
      padding: 0;
    }
    /* Kiosk mode: fill the panel with no card chrome at all. */
    :host([bare]) ha-card {
      background: #000;
      border: none;
      border-radius: 0;
      box-shadow: none;
    }
    .frame {
      position: relative;
      width: 100%;
      height: 100%;
      background: #000;
    }
    .overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      text-align: center;
      color: var(--secondary-text-color, #9e9e9e);
      font-size: 0.95rem;
      line-height: 1.5;
      pointer-events: none;
    }
    .overlay.error {
      color: var(--error-color, #db4437);
    }
    .caption {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      padding: 28px 20px 14px;
      color: #fff;
      font-size: 0.85rem;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
      background: linear-gradient(transparent, rgba(0, 0, 0, 0.55));
      pointer-events: none;
    }
    ${unsafeCSS(RENDERER_STYLES)}
  `;

  setConfig(config: SlideshowCardConfig): void {
    if (!config.source || typeof config.source !== "object") {
      throw new Error("`source` is required. Example: source: { type: immich }");
    }
    if (!config.source.type) {
      throw new Error("`source.type` is required (immich, media_source, entity or urls).");
    }
    if (config.duration !== undefined && config.duration <= 0) {
      throw new Error("`duration` must be greater than 0.");
    }
    if (config.crossfade !== undefined && config.crossfade < 0) {
      throw new Error("`crossfade` cannot be negative.");
    }
    if (
      config.duration !== undefined &&
      config.crossfade !== undefined &&
      config.crossfade > config.duration
    ) {
      throw new Error("`crossfade` cannot exceed `duration`.");
    }

    const previous = this.config;
    this.config = config;

    this.toggleAttribute("bare", config.aspect_ratio === "fill");

    // A config edit can change the source entirely; rebuild rather than patch.
    if (previous && JSON.stringify(previous.source) !== JSON.stringify(config.source)) {
      this.source = undefined;
    }
    this.restart();
  }

  set hass(hass: HomeAssistant) {
    const first = !this._hass;
    this._hass = hass;

    // This setter fires on every state change in the whole system. Restarting
    // here would make the slideshow stutter permanently, so it only ever
    // forwards the new object to a live source.
    if (this.source && isHassAware(this.source)) this.source.setHass(hass);
    if (first) this.restart();
  }

  get hass(): HomeAssistant | undefined {
    return this._hass;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.restart();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.observer?.disconnect();
    this.observer = undefined;
    this.teardown();
  }

  override firstUpdated(changed: PropertyValues): void {
    super.firstUpdated(changed);
    this.observeVisibility();
    this.restart();
  }

  override render(): TemplateResult {
    const style = this.frameStyle();
    return html`
      <ha-card>
        <div class="frame" style=${style}></div>
        ${this.renderOverlay()} ${this.renderCaption()}
      </ha-card>
    `;
  }

  getCardSize(): number {
    return 6;
  }

  static getStubConfig(): SlideshowCardConfig {
    return {
      type: "custom:animated-slideshow-card",
      source: { type: "immich", collection: "favorites" },
    };
  }

  private renderOverlay(): TemplateResult | typeof nothing {
    if (this._status === "playing" || this._status === "idle") return nothing;

    const messages: Record<string, string> = {
      loading: "Loading photos…",
      empty: "No photos found in this collection.",
      error: this._statusDetail ?? "Could not load photos.",
    };

    const message = messages[this._status];
    if (!message) return nothing;

    return html`<div class="overlay ${this._status === "error" ? "error" : ""}">${message}</div>`;
  }

  private renderCaption(): TemplateResult | typeof nothing {
    if (!this.config?.show_filename || !this._caption) return nothing;
    return html`<div class="caption">${this._caption}</div>`;
  }

  private frameStyle(): string {
    const ratio = this.config?.aspect_ratio;
    if (!ratio || ratio === "fill") return "height: 100%;";

    const [w, h] = ratio.split(":").map(Number);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return `aspect-ratio: ${w} / ${h};`;
    }
    return "aspect-ratio: 16 / 9;";
  }

  /** (Re)build the controller once config, hass and the DOM are all present. */
  private restart(): void {
    if (!this.config || !this._hass || !this.isConnected) return;

    const frame = this.renderRoot?.querySelector(".frame") as HTMLElement | null;
    if (!frame) return; // firstUpdated will call back

    this.teardown();

    let source: SlideSource;
    try {
      source = this.source ?? createSource(this._hass, this.config.source);
    } catch (error) {
      this.setStatus("error", error instanceof Error ? error.message : String(error));
      return;
    }
    this.source = source;

    this.controller = new SlideshowController(frame, source, this.controllerOptions(), {
      onStatusChange: (status, detail) => this.setStatus(status, detail),
      onSlideChange: (slide: Slide) => {
        this._caption = slide.title;
      },
    });

    void this.controller.start();
    this.syncPlayback();
  }

  private controllerOptions(): ControllerOptions {
    const config = this.config!;
    return {
      ...DEFAULT_CONTROLLER_OPTIONS,
      duration: config.duration ?? DEFAULT_CONTROLLER_OPTIONS.duration,
      crossfade: config.crossfade ?? DEFAULT_CONTROLLER_OPTIONS.crossfade,
      fit: config.fit ?? "cover",
      order: config.order ?? "shuffle",
      refreshInterval: config.refresh_interval ?? DEFAULT_CONTROLLER_OPTIONS.refreshInterval,
      kenBurns: {
        ...DEFAULT_KEN_BURNS_OPTIONS,
        zoomBase: config.zoom?.zoomBase ?? DEFAULT_KEN_BURNS_OPTIONS.zoomBase,
        zoomMax: config.zoom?.zoomMax ?? DEFAULT_KEN_BURNS_OPTIONS.zoomMax,
      },
    };
  }

  private teardown(): void {
    this.controller?.destroy();
    this.controller = undefined;
  }

  /**
   * Stop animating whenever the card cannot be seen.
   *
   * On an always-on wall tablet this is the difference between a warm device
   * pinned at high GPU load and one that idles: a dashboard with several tabs
   * would otherwise keep every hidden slideshow compositing forever.
   */
  private observeVisibility(): void {
    if (this.observer || typeof IntersectionObserver === "undefined") return;

    this.observer = new IntersectionObserver(
      (entries) => {
        this.onScreen = entries.some((entry) => entry.isIntersecting);
        this.syncPlayback();
      },
      { threshold: 0.01 },
    );
    this.observer.observe(this);
  }

  private syncPlayback(): void {
    if (!this.controller) return;
    if (this.config?.pause_when_hidden === false) {
      this.controller.resume();
      return;
    }

    const visible = this.onScreen && document.visibilityState !== "hidden";
    if (visible) this.controller.resume();
    else this.controller.pause();
  }

  private setStatus(status: ControllerStatus, detail?: string): void {
    this._status = status;
    this._statusDetail = detail;
  }
}

customElements.define("animated-slideshow-card", AnimatedSlideshowCard);

interface CustomCardEntry {
  type: string;
  name: string;
  description: string;
  preview?: boolean;
  documentationURL?: string;
}

const cards: CustomCardEntry[] = ((window as unknown as { customCards?: CustomCardEntry[] })
  .customCards ??= []);

cards.push({
  type: "animated-slideshow-card",
  name: "Animated Slideshow Card",
  description: "Immich photos with a Ken Burns effect.",
  preview: false,
  documentationURL: "https://github.com/bcortesi/HA-AnimatedSlideShowCard",
});
