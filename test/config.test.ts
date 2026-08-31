import { describe, expect, it } from "vitest";
import {
  VALID_SOURCE_TYPES,
  describeMotion,
  frameStyleFor,
  kenBurnsOptionsFrom,
  validateConfig,
} from "../src/config";
import { DEFAULT_KEN_BURNS_OPTIONS, createMove } from "../src/kenburns";
import type { SlideshowCardConfig } from "../src/types";

const base = (over: Partial<SlideshowCardConfig> = {}): SlideshowCardConfig => ({
  type: "custom:animated-slideshow-card",
  source: { type: "immich" },
  ...over,
});

describe("validateConfig / source", () => {
  it("accepts the minimal Immich config", () => {
    expect(() => validateConfig(base())).not.toThrow();
  });

  it("rejects a missing source", () => {
    expect(() => validateConfig({ type: "x" } as SlideshowCardConfig)).toThrow(
      /`source` is required/,
    );
  });

  it("rejects a source type that is really an instance name", () => {
    // The mistake this exists to catch: `type` names the kind of source, but a
    // user reasonably reads it as "which Immich server", and their service is
    // called something like "photo home".
    const config = base({ source: { type: "photo.home" } as never });

    expect(() => validateConfig(config)).toThrow(/Unknown `source.type`: "photo.home"/);
    // The message must say what to do, not just what is wrong.
    expect(() => validateConfig(config)).toThrow(/type: immich/);
  });

  it("lists the valid types in the error", () => {
    const config = base({ source: { type: "nope" } as never });
    for (const valid of VALID_SOURCE_TYPES) {
      expect(() => validateConfig(config)).toThrow(new RegExp(valid));
    }
  });

  it("requires the field each source type depends on", () => {
    expect(() => validateConfig(base({ source: { type: "entity" } as never }))).toThrow(
      /`source.entity` is required/,
    );
    expect(() => validateConfig(base({ source: { type: "media_source" } as never }))).toThrow(
      /`source.path` is required/,
    );
    expect(() => validateConfig(base({ source: { type: "urls", urls: [] } }))).toThrow(
      /at least one URL/,
    );
  });
});

describe("validateConfig / timing and zoom", () => {
  it("rejects a non-positive duration", () => {
    expect(() => validateConfig(base({ duration: 0 }))).toThrow(/greater than 0/);
    expect(() => validateConfig(base({ duration: -5 }))).toThrow(/greater than 0/);
  });

  it("rejects a crossfade longer than the slide", () => {
    expect(() => validateConfig(base({ duration: 5, crossfade: 8 }))).toThrow(/cannot exceed/);
  });

  it("allows a crossfade equal to the duration", () => {
    expect(() => validateConfig(base({ duration: 5, crossfade: 5 }))).not.toThrow();
  });

  it("rejects a zoom range that cannot produce a move", () => {
    expect(() => validateConfig(base({ zoom: { zoomBase: 1.2, zoomMax: 1.1 } }))).toThrow(
      /must be greater than/,
    );
    expect(() => validateConfig(base({ zoom: { zoomBase: 0.9 } }))).toThrow(/below 1.0/);
  });
});

describe("frameStyleFor", () => {
  it("defaults to 16:9 rather than a height that can collapse to zero", () => {
    // The bug this pins: `height: 100%` in a masonry dashboard resolves to 0,
    // making the whole card — including its error message — invisible.
    expect(frameStyleFor(undefined)).toBe("aspect-ratio: 16 / 9;");
    expect(frameStyleFor(undefined)).not.toContain("height");
  });

  it("only uses a percentage height for `fill`, which a panel sizes", () => {
    expect(frameStyleFor("fill")).toBe("height: 100%;");
  });

  it("honours an explicit ratio", () => {
    expect(frameStyleFor("4:3")).toBe("aspect-ratio: 4 / 3;");
    expect(frameStyleFor("21:9")).toBe("aspect-ratio: 21 / 9;");
  });

  it("accepts a slash as the separator too", () => {
    expect(frameStyleFor("16/10")).toBe("aspect-ratio: 16 / 10;");
  });

  it("falls back to the default for anything unparseable", () => {
    for (const bad of ["", "abc", "16:", ":9", "0:0", "-16:9", "16:0"]) {
      expect(frameStyleFor(bad)).toBe("aspect-ratio: 16 / 9;");
    }
  });
});

describe("kenBurnsOptionsFrom", () => {
  it("uses the defaults when nothing is configured", () => {
    expect(kenBurnsOptionsFrom(base())).toEqual(DEFAULT_KEN_BURNS_OPTIONS);
  });

  it("maps every snake_case knob onto the engine options", () => {
    const options = kenBurnsOptionsFrom(
      base({
        zoom: { base: 1.2, max: 1.9, min_delta: 0.05, max_delta: 0.4 },
        pan: { min: 0.3, max: 0.8, min_angle: 90 },
      }),
    );

    expect(options.zoomBase).toBe(1.2);
    expect(options.zoomMax).toBe(1.9);
    expect(options.minDelta).toBe(0.05);
    expect(options.maxDelta).toBe(0.4);
    expect(options.panMin).toBe(0.3);
    expect(options.panMax).toBe(0.8);
    expect(options.minAngleSeparation).toBeCloseTo(Math.PI / 2, 10);
  });

  it("still honours the deprecated camelCase aliases", () => {
    const options = kenBurnsOptionsFrom(base({ zoom: { zoomBase: 1.3, zoomMax: 1.7 } }));
    expect(options.zoomBase).toBe(1.3);
    expect(options.zoomMax).toBe(1.7);
  });

  it("prefers the new names when both are given", () => {
    const options = kenBurnsOptionsFrom(base({ zoom: { base: 1.25, zoomBase: 1.05 } }));
    expect(options.zoomBase).toBe(1.25);
  });

  it("produces options that generate safe moves", () => {
    // Guards the whole config surface against a combination that would let a
    // move expose a frame edge.
    const options = kenBurnsOptionsFrom(
      base({ zoom: { base: 1.05, max: 2.4, min_delta: 0.5, max_delta: 1.2 }, pan: { min: 1, max: 1 } }),
    );

    for (let i = 0; i < 200; i++) {
      const move = createMove(options, []);
      for (let step = 0; step <= 40; step++) {
        const t = step / 40;
        const scale = move.from.scale + (move.to.scale - move.from.scale) * t;
        const x = move.from.x + (move.to.x - move.from.x) * t;
        const y = move.from.y + (move.to.y - move.from.y) * t;
        const slack = (100 * (scale - 1)) / 2;
        expect(Math.abs(x) * scale).toBeLessThanOrEqual(slack + 1e-9);
        expect(Math.abs(y) * scale).toBeLessThanOrEqual(slack + 1e-9);
      }
    }
  });
});

describe("describeMotion", () => {
  it("reports the pan ceiling the base overscan allows", () => {
    // maxPan(1.12) = 100 * 0.12 / 2.24
    const m = describeMotion(base({ zoom: { base: 1.12 } }), 28);
    expect(m.panCeilingPercent).toBeCloseTo(5.357, 3);
  });

  it("shows why the original defaults looked static", () => {
    // The old defaults: base 1.10 over a 28s move is ~0.32%/s, about 6px/s on
    // a 1920px display once the pan fraction is applied — visually still.
    const old = describeMotion(base({ zoom: { base: 1.1 }, pan: { max: 1 } }), 28);
    const now = describeMotion(base({}), 28);
    expect(now.panPercentPerSecond).toBeGreaterThan(old.panPercentPerSecond);
  });

  it("does not divide by zero for a zero-length move", () => {
    const m = describeMotion(base({}), 0);
    expect(m.panPercentPerSecond).toBe(0);
    expect(m.zoomPercentPerSecond).toBe(0);
  });
});
