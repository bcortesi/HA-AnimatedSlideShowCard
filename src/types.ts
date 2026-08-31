import type { KenBurnsOptions } from "./kenburns";
import type { PlaylistOrder } from "./playlist";

/** One photo in the slideshow. */
export interface Slide {
  /** Stable identity, used for de-duplication across refreshes. */
  id: string;
  /** Human-readable label, shown only when `show_filename` is on. */
  title?: string;
}

/**
 * Where slides come from.
 *
 * URLs are resolved lazily, one slide at a time, rather than up front: Immich
 * URLs are signed with an expiry, and a wall panel may run for weeks, so a URL
 * resolved at load time would be long dead by the time its slide came around.
 */
export interface SlideSource {
  /** How often to re-fetch the slide list, in seconds. 0 disables refreshing. */
  readonly refreshInterval: number;
  /** Fetch the full slide list. */
  load(): Promise<Slide[]>;
  /** Resolve a displayable, authenticated URL for one slide. */
  urlFor(slide: Slide): Promise<string>;
}

export type SlideFit = "cover" | "blurred";

/** What tapping the card does. */
export type TapAction = "fullscreen" | "none";

export type ImmichCollection = "favorites" | "album" | "person" | "tag";

export type ImageSize = "thumbnail" | "preview" | "fullsize";

export interface ImmichSourceConfig {
  type: "immich";
  collection?: ImmichCollection;
  /** Album / person / tag name, when the collection needs one. */
  name?: string;
  image_size?: ImageSize;
}

export interface MediaSourceConfig {
  type: "media_source";
  path: string;
}

export interface EntitySourceConfig {
  type: "entity";
  entity: string;
}

export interface UrlsSourceConfig {
  type: "urls";
  urls: string[];
}

export type SourceConfig =
  | ImmichSourceConfig
  | MediaSourceConfig
  | EntitySourceConfig
  | UrlsSourceConfig;

/**
 * Zoom shape of the Ken Burns move.
 *
 * `base` does double duty and is the knob that matters most: it is the overscan
 * floor, and because panning can only use the slack that overscan creates, it
 * also caps how far a photo can travel — at most `(base - 1) / 2·base` of the
 * frame. Raising it buys visible movement at the cost of cropping more of the
 * photo.
 */
export interface ZoomConfig {
  /** Overscan floor. Also sets the pan ceiling. Default 1.12. */
  base?: number;
  /** Hard ceiling on scale. Default 1.45. */
  max?: number;
  /** Smallest scale change within one slide. Default 0.10. */
  min_delta?: number;
  /** Largest scale change within one slide. Default 0.28. */
  max_delta?: number;

  /** @deprecated Use `base`. */
  zoomBase?: number;
  /** @deprecated Use `max`. */
  zoomMax?: number;
}

export interface PanConfig {
  /** Shortest pan, as a fraction of the room `zoom.base` allows. Default 0.6. */
  min?: number;
  /** Longest pan, as a fraction of that room. Default 1.0. */
  max?: number;
  /** Degrees a pan direction must differ from the previous one. Default 40. */
  min_angle?: number;
}

export interface SlideshowCardConfig {
  type: string;
  source: SourceConfig;
  duration?: number;
  crossfade?: number;
  order?: PlaylistOrder;
  fit?: SlideFit;
  zoom?: ZoomConfig;
  pan?: PanConfig;
  aspect_ratio?: string;
  refresh_interval?: number;
  show_filename?: boolean;
  pause_when_hidden?: boolean;
  /** Tapping opens the fullscreen viewer by default. */
  tap_action?: TapAction;
}

export type { KenBurnsOptions };
