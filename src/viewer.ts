/**
 * Fullscreen photo viewer.
 *
 * Opened by tapping the card. Shows the current photo whole and still — the
 * point of tapping is to look at the picture, so this deliberately drops both
 * the Ken Burns motion and the `cover` crop and fits the entire frame instead.
 *
 * Built on `<dialog showModal()>` rather than a fixed-position overlay. A
 * Lovelace card lives deep inside a dashboard whose ancestors may carry
 * transforms or `overflow: hidden`, either of which silently traps a
 * `position: fixed` element inside the card. A modal dialog renders in the
 * browser's top layer, so it escapes all of that — and brings Escape-to-close,
 * a focus trap and inertness of the page behind it for free.
 */

export interface ViewerCallbacks {
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}

export const VIEWER_STYLES = `
  dialog.asc-viewer {
    /* Undo the UA's centred, size-constrained box. */
    position: fixed;
    inset: 0;
    width: 100vw;
    height: 100dvh;
    max-width: none;
    max-height: none;
    margin: 0;
    padding: 0;
    border: none;
    /* Solid, not translucent: the dashboard bleeding through behind a photo
       looks cheap and costs contrast, which is what a photo viewer is for. */
    background: #000;
    overflow: hidden;
  }
  dialog.asc-viewer::backdrop {
    background: #000;
  }
  .asc-viewer-surface {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .asc-viewer-surface img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    /* The photo is the one place a click must NOT dismiss. */
    cursor: default;
  }
  .asc-viewer-button {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 56px;
    padding: 0;
    border: none;
    border-radius: 50%;
    /* Light, not dark: these sit on a solid black field, where a translucent
       black control is simply invisible. */
    background: rgba(255, 255, 255, 0.14);
    color: #fff;
    cursor: pointer;
    transition: background 0.15s ease, opacity 0.15s ease;
    /* Comfortably tappable on a wall tablet without swamping the photo. */
    -webkit-tap-highlight-color: transparent;
  }
  .asc-viewer-button:hover,
  .asc-viewer-button:focus-visible {
    background: rgba(255, 255, 255, 0.3);
    outline: none;
  }
  .asc-viewer-button[disabled] {
    opacity: 0.25;
    cursor: default;
  }
  .asc-viewer-button svg {
    width: 28px;
    height: 28px;
    fill: currentColor;
  }
  .asc-viewer-close {
    top: max(16px, env(safe-area-inset-top));
    right: max(16px, env(safe-area-inset-right));
  }
  .asc-viewer-prev {
    left: max(16px, env(safe-area-inset-left));
    top: 50%;
    transform: translateY(-50%);
  }
  .asc-viewer-next {
    right: max(16px, env(safe-area-inset-right));
    top: 50%;
    transform: translateY(-50%);
  }
  .asc-viewer-date {
    position: absolute;
    right: max(20px, env(safe-area-inset-right));
    bottom: max(18px, env(safe-area-inset-bottom));
    color: rgba(255, 255, 255, 0.9);
    font-size: 0.95rem;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
    pointer-events: none;
  }
  .asc-viewer-caption {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 40px 24px 20px;
    text-align: center;
    color: rgba(255, 255, 255, 0.85);
    font-size: 0.85rem;
    background: linear-gradient(transparent, rgba(0, 0, 0, 0.6));
    pointer-events: none;
  }
`;

const ICONS = {
  close: "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  previous: "M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z",
  next: "M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z",
};

function button(className: string, label: string, path: string): HTMLButtonElement {
  const el = document.createElement("button");
  el.className = `asc-viewer-button ${className}`;
  el.type = "button";
  el.setAttribute("aria-label", label);
  el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
  return el;
}

export class FullscreenViewer {
  private dialog?: HTMLDialogElement;
  private image?: HTMLImageElement;
  private caption?: HTMLDivElement;
  private dateBadge?: HTMLDivElement;
  private prevButton?: HTMLButtonElement;
  private callbacks?: ViewerCallbacks;

  constructor(private readonly root: ShadowRoot | HTMLElement) {}

  get isOpen(): boolean {
    return this.dialog?.open ?? false;
  }

  open(
    image: HTMLImageElement,
    title: string | undefined,
    callbacks: ViewerCallbacks,
    date?: string,
  ): void {
    this.callbacks = callbacks;
    const dialog = this.dialog ?? this.build();

    this.update(image, title, true, date);
    if (!dialog.open) dialog.showModal();
  }

  /** Swap in a new photo while the viewer stays open. */
  update(image: HTMLImageElement, title?: string, canGoBack = true, date?: string): void {
    if (this.image) {
      this.image.src = image.src;
      this.image.alt = title ?? "";
    }
    if (this.caption) {
      this.caption.textContent = title ?? "";
      this.caption.style.display = title ? "" : "none";
    }
    if (this.prevButton) this.prevButton.disabled = !canGoBack;
    this.setDate(date);
  }

  /**
   * The date arrives later than the photo, because recovering it may need a
   * fetch, so it is set separately rather than only at open time.
   */
  setDate(date?: string): void {
    if (!this.dateBadge) return;
    this.dateBadge.textContent = date ?? "";
    this.dateBadge.style.display = date ? "" : "none";
  }

  close(): void {
    if (this.dialog?.open) this.dialog.close();
  }

  /** Remove the dialog entirely. Called from the card's disconnectedCallback. */
  destroy(): void {
    this.dialog?.close();
    this.dialog?.remove();
    this.dialog = undefined;
    this.image = undefined;
    this.caption = undefined;
    this.dateBadge = undefined;
    this.prevButton = undefined;
    this.callbacks = undefined;
  }

  private build(): HTMLDialogElement {
    const dialog = document.createElement("dialog");
    dialog.className = "asc-viewer";

    const surface = document.createElement("div");
    surface.className = "asc-viewer-surface";

    const image = document.createElement("img");
    image.decoding = "async";
    surface.appendChild(image);

    const caption = document.createElement("div");
    caption.className = "asc-viewer-caption";

    const dateBadge = document.createElement("div");
    dateBadge.className = "asc-viewer-date";
    dateBadge.style.display = "none";

    const close = button("asc-viewer-close", "Close", ICONS.close);
    const previous = button("asc-viewer-prev", "Previous photo", ICONS.previous);
    const next = button("asc-viewer-next", "Next photo", ICONS.next);

    close.addEventListener("click", (event) => {
      event.stopPropagation();
      this.callbacks?.onClose();
    });
    previous.addEventListener("click", (event) => {
      event.stopPropagation();
      this.callbacks?.onPrevious();
    });
    next.addEventListener("click", (event) => {
      event.stopPropagation();
      this.callbacks?.onNext();
    });

    // Clicking away closes; clicking the photo itself does not. Comparing the
    // target to the dialog is what distinguishes the backdrop from the content,
    // since the dialog element covers the whole viewport.
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog || event.target === surface) {
        this.callbacks?.onClose();
      }
    });

    // Escape already closes a modal dialog; the arrow keys are the natural
    // companions once someone is stepping through photos.
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        this.callbacks?.onPrevious();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        this.callbacks?.onNext();
      }
    });

    // Fires for Escape and for close() alike, so the card always learns that
    // the viewer went away and can resume the slideshow.
    dialog.addEventListener("close", () => this.callbacks?.onClose());

    dialog.append(surface, caption, dateBadge, close, previous, next);
    this.root.appendChild(dialog);

    this.dialog = dialog;
    this.image = image;
    this.caption = caption;
    this.dateBadge = dateBadge;
    this.prevButton = previous;
    return dialog;
  }
}
