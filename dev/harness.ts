/**
 * Standalone tuning harness.
 *
 * Tuning animation aesthetics through a Home Assistant reload cycle is a
 * 60-second feedback loop. This makes it instantaneous, and it exercises the
 * real controller, renderer and Ken Burns generator rather than a mock of them,
 * so what looks right here looks right in the card.
 *
 * Run with `npm run dev`.
 */

import { describeMotion, kenBurnsOptionsFrom } from "../src/config";
import { DEFAULT_CONTROLLER_OPTIONS, SlideshowController } from "../src/controller";
import { RENDERER_STYLES } from "../src/renderer";
import { UrlsSource } from "../src/sources/urls";
import type { PlaylistOrder } from "../src/playlist";
import type { SlideFit, SlideshowCardConfig } from "../src/types";
import { SAMPLE_PHOTOS as PHOTOS } from "./sample-images";

const style = document.createElement("style");
style.textContent = RENDERER_STYLES;
// The stage deliberately shows through: the harness paints magenta behind it so
// an exposed frame edge is impossible to miss. In the card itself the stage
// stays black, which is the correct letterbox colour.
style.textContent += `\n#stage .asc-stage { background: transparent; }\n`;
document.head.appendChild(style);

const stage = document.getElementById("stage") as HTMLElement;
const source = new UrlsSource({ type: "urls", urls: PHOTOS });

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const inputs = {
  duration: el<HTMLInputElement>("duration"),
  crossfade: el<HTMLInputElement>("crossfade"),
  zoomBase: el<HTMLInputElement>("zoomBase"),
  zoomMax: el<HTMLInputElement>("zoomMax"),
  minDelta: el<HTMLInputElement>("minDelta"),
  maxDelta: el<HTMLInputElement>("maxDelta"),
  panMin: el<HTMLInputElement>("panMin"),
  panMax: el<HTMLInputElement>("panMax"),
  fit: el<HTMLSelectElement>("fit"),
  order: el<HTMLSelectElement>("order"),
};

const outputs = {
  duration: el<HTMLOutputElement>("durationOut"),
  crossfade: el<HTMLOutputElement>("crossfadeOut"),
  zoomBase: el<HTMLOutputElement>("zoomBaseOut"),
  zoomMax: el<HTMLOutputElement>("zoomMaxOut"),
  minDelta: el<HTMLOutputElement>("minDeltaOut"),
  maxDelta: el<HTMLOutputElement>("maxDeltaOut"),
  panMin: el<HTMLOutputElement>("panMinOut"),
  panMax: el<HTMLOutputElement>("panMaxOut"),
  status: el<HTMLSpanElement>("status"),
  slide: el<HTMLSpanElement>("slide"),
  panCeiling: el<HTMLSpanElement>("panCeiling"),
  panRate: el<HTMLSpanElement>("panRate"),
  zoomRate: el<HTMLSpanElement>("zoomRate"),
  panPx: el<HTMLSpanElement>("panPx"),
  yaml: el<HTMLPreElement>("yaml"),
};

/** The card config these controls describe — the harness's single source of truth. */
function currentCardConfig(): SlideshowCardConfig {
  const base = Number(inputs.zoomBase.value);

  return {
    type: "custom:animated-slideshow-card",
    source: { type: "immich" },
    duration: Number(inputs.duration.value),
    crossfade: Number(inputs.crossfade.value),
    fit: inputs.fit.value as SlideFit,
    order: inputs.order.value as PlaylistOrder,
    zoom: {
      base,
      // Keep max above base, or there is no move to generate.
      max: Math.max(Number(inputs.zoomMax.value), base + 0.02),
      min_delta: Number(inputs.minDelta.value),
      max_delta: Math.max(Number(inputs.maxDelta.value), Number(inputs.minDelta.value)),
    },
    pan: {
      min: Number(inputs.panMin.value),
      max: Math.max(Number(inputs.panMax.value), Number(inputs.panMin.value)),
    },
  };
}

function currentOptions() {
  const config = currentCardConfig();
  return {
    ...DEFAULT_CONTROLLER_OPTIONS,
    duration: config.duration!,
    crossfade: config.crossfade!,
    fit: config.fit!,
    order: config.order!,
    refreshInterval: 0,
    kenBurns: kenBurnsOptionsFrom(config),
  };
}

function syncOutputs(): void {
  outputs.duration.textContent = inputs.duration.value;
  outputs.crossfade.textContent = inputs.crossfade.value;
  outputs.zoomBase.textContent = Number(inputs.zoomBase.value).toFixed(2);
  outputs.zoomMax.textContent = Number(inputs.zoomMax.value).toFixed(2);
  outputs.minDelta.textContent = Number(inputs.minDelta.value).toFixed(2);
  outputs.maxDelta.textContent = Number(inputs.maxDelta.value).toFixed(2);
  outputs.panMin.textContent = Number(inputs.panMin.value).toFixed(2);
  outputs.panMax.textContent = Number(inputs.panMax.value).toFixed(2);

  const config = currentCardConfig();
  const motionSeconds = config.duration! + config.crossfade!;
  const m = describeMotion(config, motionSeconds);

  outputs.panCeiling.textContent = `${m.panCeilingPercent.toFixed(2)}%`;
  outputs.panRate.textContent = `${m.panPercentPerSecond.toFixed(3)}%/s`;
  outputs.zoomRate.textContent = `${m.zoomPercentPerSecond.toFixed(3)}%/s`;

  // The number that actually tells you whether it will read as movement.
  const px = (m.panPercentPerSecond / 100) * 1920;
  outputs.panPx.textContent = `≈ ${px.toFixed(1)} px/s of pan on a 1920px-wide display`;

  outputs.yaml.textContent = [
    "type: custom:animated-slideshow-card",
    "source:",
    "  type: immich",
    `duration: ${config.duration}`,
    `crossfade: ${config.crossfade}`,
    `fit: ${config.fit}`,
    `order: ${config.order}`,
    "zoom:",
    `  base: ${config.zoom!.base}`,
    `  max: ${config.zoom!.max}`,
    `  min_delta: ${config.zoom!.min_delta}`,
    `  max_delta: ${config.zoom!.max_delta}`,
    "pan:",
    `  min: ${config.pan!.min}`,
    `  max: ${config.pan!.max}`,
  ].join("\n");
}

const controller = new SlideshowController(stage, source, currentOptions(), {
  onStatusChange: (status, detail) => {
    outputs.status.textContent = detail ? `${status} — ${detail}` : status;
  },
  onSlideChange: (slide) => {
    outputs.slide.textContent = slide.title ?? slide.id;
  },
});

for (const input of Object.values(inputs)) {
  input.addEventListener("input", () => {
    syncOutputs();
    controller.setOptions(currentOptions());
  });
}

el<HTMLButtonElement>("next").addEventListener("click", () => controller.next());

const toggle = el<HTMLButtonElement>("toggle");
toggle.addEventListener("click", () => {
  if (controller.isPaused) {
    controller.resume();
    toggle.textContent = "Pause";
  } else {
    controller.pause();
    toggle.textContent = "Resume";
  }
});

syncOutputs();
void controller.start();
