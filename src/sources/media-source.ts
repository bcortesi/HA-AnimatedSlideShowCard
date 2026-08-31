/**
 * Any Home Assistant media source, e.g. a local `config/media` folder.
 *
 * Nearly free to support: it is the same browse/resolve pair the Immich source
 * uses, minus the Immich-specific path building.
 */

import { type HomeAssistant, browseMedia, resolveMedia } from "../ha";
import type { MediaSourceConfig, Slide, SlideSource } from "../types";

export class MediaSourceSource implements SlideSource {
  readonly refreshInterval = 3600;

  constructor(
    private hass: HomeAssistant,
    private readonly config: MediaSourceConfig,
  ) {}

  setHass(hass: HomeAssistant): void {
    this.hass = hass;
  }

  async load(): Promise<Slide[]> {
    if (!this.config.path) throw new Error("`path` is required for a media_source source.");

    const result = await browseMedia(this.hass, this.config.path);
    const images = (result.children ?? []).filter(
      (child) => child.media_class === "image" && !child.can_expand,
    );

    return images.map((child) => ({ id: child.media_content_id, title: child.title }));
  }

  async urlFor(slide: Slide): Promise<string> {
    const resolved = await resolveMedia(this.hass, slide.id);
    return resolved.url;
  }
}
