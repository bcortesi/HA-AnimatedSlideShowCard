import { describe, expect, it } from "vitest";
import { VALID_SOURCE_TYPES, frameStyleFor, validateConfig } from "../src/config";
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
