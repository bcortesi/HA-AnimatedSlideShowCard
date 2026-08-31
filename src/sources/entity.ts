/**
 * A `camera` or `image` entity as the photo source.
 *
 * This is the compatibility path for integrations that expose a rotating photo
 * as a single entity — `remy/ha_immich_picture` among them — as well as for
 * plain cameras.
 *
 * Such an entity is a moving target rather than a list: it holds one photo at a
 * time and swaps it on its own schedule. So the playlist holds a single slide
 * standing for the entity, and `urlFor` returns whatever it is showing right
 * now. The card's own timing still drives the Ken Burns motion; if the entity
 * has not rotated by the time the next slide is due, the same photo is shown
 * again with fresh motion.
 */

import type { HomeAssistant } from "../ha";
import type { EntitySourceConfig, Slide, SlideSource } from "../types";

export class EntitySource implements SlideSource {
  readonly refreshInterval = 0;

  constructor(
    private hass: HomeAssistant,
    private readonly config: EntitySourceConfig,
  ) {}

  setHass(hass: HomeAssistant): void {
    this.hass = hass;
  }

  async load(): Promise<Slide[]> {
    const entityId = this.config.entity;
    if (!entityId) throw new Error("`entity` is required for an entity source.");
    if (!this.hass.states[entityId]) throw new Error(`Unknown entity: ${entityId}`);

    return [{ id: entityId, title: entityId }];
  }

  async urlFor(slide: Slide): Promise<string> {
    const state = this.hass.states[slide.id];
    if (!state) throw new Error(`Unknown entity: ${slide.id}`);

    const picture = state.attributes.entity_picture;
    if (!picture) {
      throw new Error(`${slide.id} has no entity_picture to display.`);
    }

    // Already carries its own access token; using it verbatim is required.
    return picture;
  }
}
