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

import { DEFAULT_CONTROLLER_OPTIONS, SlideshowController } from "../src/controller";
import { DEFAULT_KEN_BURNS_OPTIONS } from "../src/kenburns";
import { RENDERER_STYLES } from "../src/renderer";
import { UrlsSource } from "../src/sources/urls";
import type { PlaylistOrder } from "../src/playlist";
import type { SlideFit } from "../src/types";
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
  fit: el<HTMLSelectElement>("fit"),
  order: el<HTMLSelectElement>("order"),
};

const outputs = {
  duration: el<HTMLOutputElement>("durationOut"),
  crossfade: el<HTMLOutputElement>("crossfadeOut"),
  zoomBase: el<HTMLOutputElement>("zoomBaseOut"),
  zoomMax: el<HTMLOutputElement>("zoomMaxOut"),
  status: el<HTMLSpanElement>("status"),
  slide: el<HTMLSpanElement>("slide"),
};

function currentOptions() {
  const zoomBase = Number(inputs.zoomBase.value);
  // Keep max above base; otherwise there is no move to generate.
  const zoomMax = Math.max(Number(inputs.zoomMax.value), zoomBase + 0.02);

  return {
    ...DEFAULT_CONTROLLER_OPTIONS,
    duration: Number(inputs.duration.value),
    crossfade: Number(inputs.crossfade.value),
    fit: inputs.fit.value as SlideFit,
    order: inputs.order.value as PlaylistOrder,
    refreshInterval: 0,
    kenBurns: { ...DEFAULT_KEN_BURNS_OPTIONS, zoomBase, zoomMax },
  };
}

function syncOutputs(): void {
  outputs.duration.textContent = inputs.duration.value;
  outputs.crossfade.textContent = inputs.crossfade.value;
  outputs.zoomBase.textContent = Number(inputs.zoomBase.value).toFixed(2);
  outputs.zoomMax.textContent = Number(inputs.zoomMax.value).toFixed(2);
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
