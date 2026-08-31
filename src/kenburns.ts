/**
 * Ken Burns motion generator.
 *
 * Pure and DOM-free on purpose: the geometry here is the difference between a
 * slideshow that looks cinematic and one that flashes background edges at every
 * slide boundary, so it must be unit-testable in isolation.
 *
 * ## The geometry
 *
 * A layer is transformed with `scale(S) translate(tx%, ty%)` about its centre.
 * CSS applies the functions right-to-left: the element is translated in its own
 * local coordinates and the result is then scaled. So a translate of `tx%`
 * displaces the layer by `tx% x W x S` on screen, while scaling by S only
 * exposes `(S - 1) x W / 2` of slack on each side. Staying inside the frame
 * therefore requires:
 *
 *     |tx| <= maxPan(S) = (S - 1) / (2S)
 *
 * `maxPan` is monotonically increasing in S (its derivative is `1 / 2S^2 > 0`),
 * which gives a useful guarantee: if both endpoints are clamped to
 * `maxPan(min(S1, S2))`, then every interpolated frame in between is also
 * inside the frame, because the interpolated offset never exceeds the endpoint
 * offsets while the interpolated scale never drops below `min(S1, S2)`.
 *
 * A consequence worth stating, because it is the trap in every naive
 * implementation: a move that ends at exactly `S = 1.0` has `maxPan = 0` and
 * cannot pan at all. That is why moves are built on a base overscan (`zoomBase`,
 * default 1.10) rather than starting from 1.0.
 */

/** A single transform state: scale plus a translation in percent. */
export interface Transform {
  scale: number;
  /** Horizontal translation, in percent of the layer's own width. */
  x: number;
  /** Vertical translation, in percent of the layer's own height. */
  y: number;
}

/** A generated slide movement, from one transform to another. */
export interface KenBurnsMove {
  from: Transform;
  to: Transform;
  /** Pan axis in radians, retained so the next move can avoid repeating it. */
  angle: number;
  /** True when the move zooms in, false when it zooms out. */
  zoomIn: boolean;
}

export interface KenBurnsOptions {
  /** Base overscan. Always >= this, so there is room to pan. */
  zoomBase: number;
  /** Hard ceiling on scale. */
  zoomMax: number;
  /** Minimum scale change across a move. */
  minDelta: number;
  /** Maximum scale change across a move. */
  maxDelta: number;
  /** Lower bound on pan distance, as a fraction of the available room. */
  panMin: number;
  /** Upper bound on pan distance, as a fraction of the available room. */
  panMax: number;
  /** Minimum angular separation from the previous move, in radians. */
  minAngleSeparation: number;
}

/**
 * Defaults tuned for motion that reads as deliberate on a wall display.
 *
 * The first version was too timid. At `zoomBase` 1.10 the pan ceiling is 4.5%
 * of the frame, and with a pan fraction averaging 0.75 a photo travels about
 * 6.8% over a 28-second move — roughly 4.7 px/s on a 1920px display, which
 * reads as static from across a room.
 *
 * These raise the base to 1.18, giving a 7.6% ceiling and ~13% of travel, or
 * about 8.9 px/s: visible without being distracting. The cost is the crop —
 * `zoomBase` is overscan, so 1.18 means 15% of each photo is outside the frame.
 * That trade is the whole tuning problem, and it is why `zoom.base` is the
 * first knob to reach for rather than `duration`.
 */
export const DEFAULT_KEN_BURNS_OPTIONS: KenBurnsOptions = {
  zoomBase: 1.18,
  zoomMax: 1.55,
  minDelta: 0.12,
  maxDelta: 0.32,
  panMin: 0.7,
  panMax: 1.0,
  minAngleSeparation: (40 * Math.PI) / 180,
};

/** A source of randomness, injectable so tests can be deterministic. */
export type Random = () => number;

/**
 * Maximum safe translation for a given scale, in percent of the layer's size.
 * Returns 0 for any scale <= 1, where there is no slack to pan into.
 */
export function maxPan(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 1) return 0;
  return (100 * (scale - 1)) / (2 * scale);
}

/** Clamp a translation into the safe region for `scale`, preserving direction. */
export function clampPan(x: number, y: number, scale: number): { x: number; y: number } {
  const limit = maxPan(scale);
  if (limit === 0) return { x: 0, y: 0 };

  const magnitude = Math.hypot(x, y);
  if (magnitude <= limit || magnitude === 0) return { x, y };

  const factor = limit / magnitude;
  return { x: x * factor, y: y * factor };
}

/** Shortest signed angular distance between two angles, in [0, PI]. */
export function angleDistance(a: number, b: number): number {
  const twoPi = 2 * Math.PI;
  const diff = (((a - b) % twoPi) + twoPi + Math.PI) % twoPi;
  return Math.abs(diff - Math.PI);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Build the next move.
 *
 * `previous` steers two anti-repetition rules: the pan axis is kept away from
 * the previous axis, and the zoom direction is forced to alternate after two
 * consecutive moves in the same direction. Both exist because true randomness
 * reads as sloppiness on a wall display watched for hours.
 */
export function createMove(
  options: KenBurnsOptions,
  history: readonly KenBurnsMove[] = [],
  rnd: Random = Math.random,
): KenBurnsMove {
  const zoomBase = Math.max(1.001, options.zoomBase);
  const zoomMax = Math.max(zoomBase + 0.001, options.zoomMax);

  // Zoom direction, alternating after two in a row.
  const last = history[history.length - 1];
  const beforeLast = history[history.length - 2];
  const forced =
    last && beforeLast && last.zoomIn === beforeLast.zoomIn ? !last.zoomIn : undefined;
  const zoomIn = forced ?? rnd() < 0.5;

  // Scale endpoints, capped so the larger end never exceeds zoomMax.
  const headroom = zoomMax - zoomBase;
  const delta = clamp(
    options.minDelta + rnd() * Math.max(0, options.maxDelta - options.minDelta),
    0,
    headroom,
  );
  const low = zoomBase;
  const high = zoomBase + delta;
  const fromScale = zoomIn ? low : high;
  const toScale = zoomIn ? high : low;

  // Both endpoints share the tighter of the two limits, which keeps every
  // interpolated frame inside the frame. See the module comment.
  const limit = maxPan(Math.min(fromScale, toScale));
  const reach = clamp(options.panMin + rnd() * (options.panMax - options.panMin), 0, 1);
  const amplitude = limit * reach;

  // Pan axis, rejected and resampled while it sits too close to the last one.
  let angle = rnd() * 2 * Math.PI;
  if (last) {
    for (let attempt = 0; attempt < 8; attempt++) {
      if (angleDistance(angle, last.angle) >= options.minAngleSeparation) break;
      angle = rnd() * 2 * Math.PI;
    }
  }

  const dx = Math.cos(angle) * amplitude;
  const dy = Math.sin(angle) * amplitude;

  return {
    from: { scale: fromScale, x: -dx, y: -dy },
    to: { scale: toScale, x: dx, y: dy },
    angle,
    zoomIn,
  };
}

/** Render a transform as a CSS `transform` value. */
export function transformToCss(t: Transform): string {
  return `scale(${t.scale.toFixed(4)}) translate(${t.x.toFixed(3)}%, ${t.y.toFixed(3)}%)`;
}

/**
 * Stateful convenience wrapper: remembers recent moves so the anti-repetition
 * rules apply without the caller threading history through by hand.
 */
export class KenBurnsDirector {
  private history: KenBurnsMove[] = [];

  constructor(
    private options: KenBurnsOptions = DEFAULT_KEN_BURNS_OPTIONS,
    private readonly rnd: Random = Math.random,
  ) {}

  setOptions(options: KenBurnsOptions): void {
    this.options = options;
  }

  next(): KenBurnsMove {
    const move = createMove(this.options, this.history, this.rnd);
    this.history.push(move);
    if (this.history.length > 4) this.history.shift();
    return move;
  }

  reset(): void {
    this.history = [];
  }
}
