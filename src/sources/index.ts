import type { HomeAssistant } from "../ha";
import type { SlideSource, SourceConfig } from "../types";
import { EntitySource } from "./entity";
import { ImmichSource } from "./immich";
import { MediaSourceSource } from "./media-source";
import { UrlsSource } from "./urls";

export { EntitySource, ImmichSource, MediaSourceSource, UrlsSource };

/** Sources that track the live `hass` object. */
export interface HassAwareSource extends SlideSource {
  setHass(hass: HomeAssistant): void;
}

export function isHassAware(source: SlideSource): source is HassAwareSource {
  return typeof (source as HassAwareSource).setHass === "function";
}

export function createSource(hass: HomeAssistant, config: SourceConfig): SlideSource {
  switch (config.type) {
    case "immich":
      return new ImmichSource(hass, config);
    case "media_source":
      return new MediaSourceSource(hass, config);
    case "entity":
      return new EntitySource(hass, config);
    case "urls":
      return new UrlsSource(config);
    default: {
      const unknown = config as { type?: string };
      throw new Error(`Unknown source type: ${unknown.type ?? "(missing)"}`);
    }
  }
}
