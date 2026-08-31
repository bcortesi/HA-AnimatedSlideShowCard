/**
 * Config validation and layout sizing.
 *
 * Pure, so both can be unit tested. They were originally inline in the card
 * element, where a sizing mistake was invisible to tests and — worse —
 * invisible on screen: a card with no height hides its own error message.
 */

import type { SlideshowCardConfig, SourceConfig } from "./types";

export const VALID_SOURCE_TYPES = ["immich", "media_source", "entity", "urls"] as const;

/** Fallback used when no aspect ratio is configured, or one cannot be parsed. */
const DEFAULT_ASPECT_RATIO = "aspect-ratio: 16 / 9;";

/**
 * Validate a card config, throwing a message the user can act on.
 *
 * Home Assistant surfaces anything thrown here directly in the card editor, so
 * these messages are the main diagnostic channel — they should name the bad
 * value and list what is accepted, not just say "invalid".
 */
export function validateConfig(config: SlideshowCardConfig): void {
  if (!config.source || typeof config.source !== "object") {
    throw new Error("`source` is required. Example:\n\nsource:\n  type: immich");
  }

  const source = config.source as SourceConfig & { type?: string };
  if (!source.type) {
    throw new Error(
      `\`source.type\` is required. Valid values: ${VALID_SOURCE_TYPES.join(", ")}.`,
    );
  }

  if (!(VALID_SOURCE_TYPES as readonly string[]).includes(source.type)) {
    throw new Error(
      `Unknown \`source.type\`: "${source.type}". ` +
        `Valid values: ${VALID_SOURCE_TYPES.join(", ")}.\n\n` +
        "`type` selects the kind of source, not which server — the Immich " +
        "instance is discovered automatically. For Immich favourites use:\n\n" +
        "source:\n  type: immich",
    );
  }

  if (source.type === "entity" && !("entity" in source && source.entity)) {
    throw new Error("`source.entity` is required when `source.type` is `entity`.");
  }
  if (source.type === "media_source" && !("path" in source && source.path)) {
    throw new Error("`source.path` is required when `source.type` is `media_source`.");
  }
  if (source.type === "urls" && !("urls" in source && source.urls?.length)) {
    throw new Error("`source.urls` must list at least one URL.");
  }

  if (config.duration !== undefined && !(config.duration > 0)) {
    throw new Error("`duration` must be greater than 0.");
  }
  if (config.crossfade !== undefined && !(config.crossfade >= 0)) {
    throw new Error("`crossfade` cannot be negative.");
  }
  if (
    config.duration !== undefined &&
    config.crossfade !== undefined &&
    config.crossfade > config.duration
  ) {
    throw new Error("`crossfade` cannot exceed `duration`.");
  }
  if (config.zoom?.zoomBase !== undefined && config.zoom.zoomBase < 1) {
    throw new Error("`zoom.zoomBase` cannot be below 1.0.");
  }
  if (
    config.zoom?.zoomBase !== undefined &&
    config.zoom?.zoomMax !== undefined &&
    config.zoom.zoomMax <= config.zoom.zoomBase
  ) {
    throw new Error("`zoom.zoomMax` must be greater than `zoom.zoomBase`.");
  }
}

/**
 * The inline style that gives the card its height.
 *
 * A card in a masonry dashboard has no height of its own, so `height: 100%`
 * resolves to zero and the whole card — photos, errors and all — collapses to
 * nothing. Only `fill`, which is meant for a panel that supplies a height, may
 * size that way; everything else gets an explicit aspect ratio.
 */
export function frameStyleFor(aspectRatio?: string): string {
  if (aspectRatio === "fill") return "height: 100%;";
  if (!aspectRatio) return DEFAULT_ASPECT_RATIO;

  const [w, h] = aspectRatio.split(/[:/]/).map((part) => Number(part.trim()));
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return `aspect-ratio: ${w} / ${h};`;
  }
  return DEFAULT_ASPECT_RATIO;
}
