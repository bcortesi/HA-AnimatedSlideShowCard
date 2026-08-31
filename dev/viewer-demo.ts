/**
 * Viewer harness.
 *
 * The fullscreen viewer cannot be exercised from the Ken Burns harness, which
 * has no card element. This mounts the viewer directly against a stub so the
 * open/navigate/close behaviour can be driven and inspected without Home
 * Assistant — including the parts that are awkward to verify by eye, like
 * whether a backdrop click is distinguished from a click on the photo.
 */

import { FullscreenViewer, VIEWER_STYLES } from "../src/viewer";
import { SAMPLE_PHOTOS } from "./sample-images";

const style = document.createElement("style");
style.textContent = VIEWER_STYLES;
document.head.appendChild(style);

const host = document.getElementById("host") as HTMLElement;
const log = document.getElementById("log") as HTMLElement;
const viewer = new FullscreenViewer(host);

let index = 0;
const say = (message: string) => {
  log.textContent = `${message}\n${log.textContent ?? ""}`.split("\n").slice(0, 12).join("\n");
};

function imageFor(i: number): HTMLImageElement {
  const image = new Image();
  image.src = SAMPLE_PHOTOS[((i % SAMPLE_PHOTOS.length) + SAMPLE_PHOTOS.length) % SAMPLE_PHOTOS.length];
  return image;
}

const callbacks = {
  onPrevious: () => {
    index--;
    say(`previous -> ${index}`);
    viewer.update(imageFor(index), `Image ${index + 1}`, index > 0);
  },
  onNext: () => {
    index++;
    say(`next -> ${index}`);
    viewer.update(imageFor(index), `Image ${index + 1}`, index > 0);
  },
  onClose: () => {
    say("close");
    viewer.close();
  },
};

document.getElementById("open")!.addEventListener("click", () => {
  say("open");
  viewer.open(imageFor(index), `Image ${index + 1}`, callbacks);
});

(window as unknown as Record<string, unknown>).__viewer = viewer;
(window as unknown as Record<string, unknown>).__state = () => ({ index });
