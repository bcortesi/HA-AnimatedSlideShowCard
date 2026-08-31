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

export interface SlideshowCardConfig {
  type: string;
  source: SourceConfig;
  duration?: number;
  crossfade?: number;
  order?: PlaylistOrder;
  fit?: SlideFit;
  zoom?: Partial<Pick<KenBurnsOptions, "zoomBase" | "zoomMax">>;
  aspect_ratio?: string;
  refresh_interval?: number;
  show_filename?: boolean;
  pause_when_hidden?: boolean;
}
