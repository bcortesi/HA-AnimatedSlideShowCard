/**
 * Config validation and layout sizing.
 *
 * Pure, so both can be unit tested. They were originally inline in the card
 * element, where a sizing mistake was invisible to tests and — worse —
 * invisible on screen: a card with no height hides its own error message.
 */

import { DEFAULT_KEN_BURNS_OPTIONS, type KenBurnsOptions, maxPan } from "./kenburns";
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
  validateMotion(config);
}

function validateMotion(config: SlideshowCardConfig): void {
  const { base, max, minDelta, maxDelta, panMin, panMax, minAngleDegrees } =
    readMotion(config);

  if (base < 1) {
    throw new Error("`zoom.base` cannot be below 1.0 — there would be nothing to pan into.");
  }
  if (base > 3) {
    throw new Error("`zoom.base` above 3.0 crops away almost the whole photo.");
  }
  if (max <= base) {
    throw new Error(`\`zoom.max\` (${max}) must be greater than \`zoom.base\` (${base}).`);
  }
  if (minDelta < 0) {
    throw new Error("`zoom.min_delta` cannot be negative.");
  }
  if (maxDelta < minDelta) {
    throw new Error("`zoom.max_delta` cannot be smaller than `zoom.min_delta`.");
  }
  if (panMin < 0 || panMax > 1) {
    throw new Error("`pan.min` and `pan.max` are fractions and must lie between 0 and 1.");
  }
  if (panMax < panMin) {
    throw new Error("`pan.max` cannot be smaller than `pan.min`.");
  }
  if (minAngleDegrees < 0 || minAngleDegrees > 180) {
    throw new Error("`pan.min_angle` must be between 0 and 180 degrees.");
  }
}

interface MotionNumbers {
  base: number;
  max: number;
  minDelta: number;
  maxDelta: number;
  panMin: number;
  panMax: number;
  minAngleDegrees: number;
}

/** Read the motion settings, applying defaults and the deprecated aliases. */
function readMotion(config: SlideshowCardConfig): MotionNumbers {
  const zoom = config.zoom ?? {};
  const pan = config.pan ?? {};

  return {
    base: zoom.base ?? zoom.zoomBase ?? DEFAULT_KEN_BURNS_OPTIONS.zoomBase,
    max: zoom.max ?? zoom.zoomMax ?? DEFAULT_KEN_BURNS_OPTIONS.zoomMax,
    minDelta: zoom.min_delta ?? DEFAULT_KEN_BURNS_OPTIONS.minDelta,
    maxDelta: zoom.max_delta ?? DEFAULT_KEN_BURNS_OPTIONS.maxDelta,
    panMin: pan.min ?? DEFAULT_KEN_BURNS_OPTIONS.panMin,
    panMax: pan.max ?? DEFAULT_KEN_BURNS_OPTIONS.panMax,
    minAngleDegrees:
      pan.min_angle ?? (DEFAULT_KEN_BURNS_OPTIONS.minAngleSeparation * 180) / Math.PI,
  };
}

/** Build the engine's options from a card config. */
export function kenBurnsOptionsFrom(config: SlideshowCardConfig): KenBurnsOptions {
  const m = readMotion(config);
  return {
    zoomBase: m.base,
    zoomMax: m.max,
    minDelta: m.minDelta,
    maxDelta: m.maxDelta,
    panMin: m.panMin,
    panMax: m.panMax,
    minAngleSeparation: (m.minAngleDegrees * Math.PI) / 180,
  };
}

/**
 * Describe the motion a config actually produces, in percent of frame per
 * second. Used by the tuning harness, and useful for explaining why a given
 * setting looks static.
 */
export function describeMotion(
  config: SlideshowCardConfig,
  motionSeconds: number,
): { panCeilingPercent: number; panPercentPerSecond: number; zoomPercentPerSecond: number } {
  const m = readMotion(config);
  const ceiling = maxPan(m.base);
  // Average, not best case: a move runs from -A to +A with the pan fraction
  // drawn uniformly from [min, max], so reporting the maximum would overstate
  // what the display typically does.
  const travel = ceiling * 2 * ((m.panMin + m.panMax) / 2);
  const zoomTravel = ((m.minDelta + m.maxDelta) / 2) * 100;

  return {
    panCeilingPercent: ceiling,
    panPercentPerSecond: motionSeconds > 0 ? travel / motionSeconds : 0,
    zoomPercentPerSecond: motionSeconds > 0 ? zoomTravel / motionSeconds : 0,
  };
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
