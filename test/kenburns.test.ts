import { describe, expect, it } from "vitest";
import {
  DEFAULT_KEN_BURNS_OPTIONS,
  KenBurnsDirector,
  type KenBurnsMove,
  angleDistance,
  clampPan,
  createMove,
  maxPan,
  transformToCss,
} from "../src/kenburns";

/** Deterministic pseudo-random source, so failures are reproducible. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // xorshift32
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

/**
 * The invariant everything else exists to protect: at every interpolated frame
 * of a move, the layer must still cover the frame. Screen-space displacement is
 * `offset% x S`, and the slack on each side is `(S - 1) / 2 x 100%`.
 */
function coversFrameAt(move: KenBurnsMove, t: number): boolean {
  const scale = move.from.scale + (move.to.scale - move.from.scale) * t;
  const x = move.from.x + (move.to.x - move.from.x) * t;
  const y = move.from.y + (move.to.y - move.from.y) * t;

  const slack = (100 * (scale - 1)) / 2;
  // A hair of tolerance for floating point, far below a device pixel.
  const epsilon = 1e-9;
  return Math.abs(x) * scale <= slack + epsilon && Math.abs(y) * scale <= slack + epsilon;
}

/**
 * Sweep a move and return the first offending sample, or null. Returning the
 * worst offender rather than asserting per sample keeps the suite fast (one
 * assertion per move instead of hundreds) while still reporting exactly where
 * a regression breaks.
 */
function firstUncoveredSample(move: KenBurnsMove, steps: number): number | null {
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    if (!coversFrameAt(move, t)) return t;
  }
  return null;
}

describe("maxPan", () => {
  it("is zero at or below scale 1, where there is no slack", () => {
    expect(maxPan(1)).toBe(0);
    expect(maxPan(0.9)).toBe(0);
  });

  it("matches the derived formula", () => {
    // S = 1.10 -> 100 * 0.10 / 2.20 = 4.5454...%
    expect(maxPan(1.1)).toBeCloseTo(4.5455, 4);
    expect(maxPan(1.28)).toBeCloseTo(10.9375, 4);
  });

  it("increases monotonically with scale", () => {
    let previous = maxPan(1);
    for (let s = 1.01; s <= 2; s += 0.01) {
      const current = maxPan(s);
      expect(current).toBeGreaterThan(previous);
      previous = current;
    }
  });

  it("handles non-finite input without producing NaN offsets", () => {
    expect(maxPan(Number.NaN)).toBe(0);
    expect(maxPan(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("clampPan", () => {
  it("leaves an in-range offset untouched", () => {
    const result = clampPan(1, 1, 1.5);
    expect(result).toEqual({ x: 1, y: 1 });
  });

  it("scales an out-of-range offset back to the limit, preserving direction", () => {
    const scale = 1.1;
    const result = clampPan(100, 0, scale);
    expect(result.x).toBeCloseTo(maxPan(scale), 10);
    expect(result.y).toBe(0);
  });

  it("preserves the angle of a diagonal offset", () => {
    const result = clampPan(30, 40, 1.2);
    expect(Math.hypot(result.x, result.y)).toBeCloseTo(maxPan(1.2), 10);
    expect(result.y / result.x).toBeCloseTo(40 / 30, 10);
  });

  it("collapses to the origin when no panning is possible", () => {
    expect(clampPan(10, 10, 1)).toEqual({ x: 0, y: 0 });
  });
});

describe("angleDistance", () => {
  it("is zero for identical angles", () => {
    expect(angleDistance(1.2, 1.2)).toBeCloseTo(0, 10);
  });

  it("takes the short way around the circle", () => {
    expect(angleDistance(0.1, 2 * Math.PI - 0.1)).toBeCloseTo(0.2, 10);
  });

  it("never exceeds PI", () => {
    const rnd = seededRandom(7);
    for (let i = 0; i < 500; i++) {
      const d = angleDistance(rnd() * 20 - 10, rnd() * 20 - 10);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
  });
});

describe("createMove", () => {
  it("never exposes a frame edge, at any point of any move", () => {
    // The headline invariant, swept densely across many random moves.
    for (let seed = 1; seed <= 200; seed++) {
      const rnd = seededRandom(seed);
      const history: KenBurnsMove[] = [];

      for (let n = 0; n < 10; n++) {
        const move = createMove(DEFAULT_KEN_BURNS_OPTIONS, history, rnd);
        history.push(move);
        expect(firstUncoveredSample(move, 100)).toBeNull();
      }
    }
  });

  it("holds the invariant for aggressive option ranges too", () => {
    const options = {
      ...DEFAULT_KEN_BURNS_OPTIONS,
      zoomBase: 1.02,
      zoomMax: 2.5,
      minDelta: 0.4,
      maxDelta: 1.2,
      panMin: 1,
      panMax: 1,
    };

    for (let seed = 1; seed <= 100; seed++) {
      const rnd = seededRandom(seed * 31);
      const move = createMove(options, [], rnd);
      expect(firstUncoveredSample(move, 50)).toBeNull();
    }
  });

  it("respects the zoom ceiling", () => {
    const rnd = seededRandom(99);
    for (let i = 0; i < 200; i++) {
      const move = createMove(DEFAULT_KEN_BURNS_OPTIONS, [], rnd);
      const top = Math.max(move.from.scale, move.to.scale);
      expect(top).toBeLessThanOrEqual(DEFAULT_KEN_BURNS_OPTIONS.zoomMax + 1e-9);
      expect(Math.min(move.from.scale, move.to.scale)).toBeGreaterThanOrEqual(
        DEFAULT_KEN_BURNS_OPTIONS.zoomBase - 1e-9,
      );
    }
  });

  it("always actually moves: endpoints differ in both scale and offset", () => {
    const rnd = seededRandom(4242);
    for (let i = 0; i < 100; i++) {
      const move = createMove(DEFAULT_KEN_BURNS_OPTIONS, [], rnd);
      expect(move.from.scale).not.toBeCloseTo(move.to.scale, 6);
      expect(Math.hypot(move.to.x - move.from.x, move.to.y - move.from.y)).toBeGreaterThan(0);
    }
  });

  it("pans symmetrically about the centre", () => {
    const rnd = seededRandom(11);
    const move = createMove(DEFAULT_KEN_BURNS_OPTIONS, [], rnd);
    expect(move.from.x).toBeCloseTo(-move.to.x, 10);
    expect(move.from.y).toBeCloseTo(-move.to.y, 10);
  });

  it("keeps the pan axis away from the previous one", () => {
    const rnd = seededRandom(2024);
    const history: KenBurnsMove[] = [];
    let checked = 0;

    for (let i = 0; i < 100; i++) {
      const move = createMove(DEFAULT_KEN_BURNS_OPTIONS, history, rnd);
      const previous = history[history.length - 1];
      if (previous) {
        // Rejection sampling gives up after a bounded number of attempts, so
        // this is a strong tendency rather than a hard guarantee. Assert on the
        // aggregate instead of demanding every single sample clears the bar.
        if (angleDistance(move.angle, previous.angle) >= DEFAULT_KEN_BURNS_OPTIONS.minAngleSeparation) {
          checked++;
        }
      }
      history.push(move);
      if (history.length > 4) history.shift();
    }

    expect(checked).toBeGreaterThan(90);
  });

  it("does not zoom the same direction three times running", () => {
    const rnd = seededRandom(5);
    const director = new KenBurnsDirector(DEFAULT_KEN_BURNS_OPTIONS, rnd);
    const directions: boolean[] = [];

    for (let i = 0; i < 300; i++) directions.push(director.next().zoomIn);

    for (let i = 2; i < directions.length; i++) {
      const threeInARow =
        directions[i] === directions[i - 1] && directions[i - 1] === directions[i - 2];
      expect(threeInARow).toBe(false);
    }
  });
});

describe("transformToCss", () => {
  it("emits scale before translate, matching the documented geometry", () => {
    const css = transformToCss({ scale: 1.1, x: -4.5, y: 2.25 });
    expect(css).toBe("scale(1.1000) translate(-4.500%, 2.250%)");
  });

  it("produces a value with no NaN in it", () => {
    const rnd = seededRandom(8);
    for (let i = 0; i < 50; i++) {
      const move = createMove(DEFAULT_KEN_BURNS_OPTIONS, [], rnd);
      expect(transformToCss(move.from)).not.toContain("NaN");
      expect(transformToCss(move.to)).not.toContain("NaN");
    }
  });
});

describe("KenBurnsDirector", () => {
  it("is deterministic for a given seed", () => {
    const a = new KenBurnsDirector(DEFAULT_KEN_BURNS_OPTIONS, seededRandom(123));
    const b = new KenBurnsDirector(DEFAULT_KEN_BURNS_OPTIONS, seededRandom(123));
    for (let i = 0; i < 20; i++) {
      expect(a.next()).toEqual(b.next());
    }
  });

  it("bounds its history so a long-running display cannot leak memory", () => {
    const director = new KenBurnsDirector(DEFAULT_KEN_BURNS_OPTIONS, seededRandom(1));
    for (let i = 0; i < 10_000; i++) director.next();
    // @ts-expect-error reaching into private state deliberately
    expect(director.history.length).toBeLessThanOrEqual(4);
  });
});
