import { describe, expect, it } from "vitest";
import { Playlist, shuffled } from "../src/playlist";

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

const PHOTOS = ["a", "b", "c", "d", "e"];

describe("shuffled", () => {
  it("is a permutation, leaving the input untouched", () => {
    const input = [...PHOTOS];
    const out = shuffled(input, seededRandom(1));
    expect(out).not.toBe(input);
    expect(input).toEqual(PHOTOS);
    expect([...out].sort()).toEqual([...PHOTOS].sort());
  });

  it("handles empty and single-item inputs", () => {
    expect(shuffled([], seededRandom(1))).toEqual([]);
    expect(shuffled(["only"], seededRandom(1))).toEqual(["only"]);
  });
});

describe("Playlist / shuffle", () => {
  it("shows every photo once before repeating any", () => {
    const playlist = new Playlist(PHOTOS, "shuffle", seededRandom(42));
    const cycle = PHOTOS.map(() => playlist.next());
    expect([...cycle].sort()).toEqual([...PHOTOS].sort());
  });

  it("does not repeat a photo across the cycle boundary", () => {
    // The visible failure this prevents: the same photo twice in a row when the
    // playlist wraps.
    for (let seed = 1; seed <= 50; seed++) {
      const playlist = new Playlist(PHOTOS, "shuffle", seededRandom(seed));
      const seen: (string | undefined)[] = [];
      for (let i = 0; i < PHOTOS.length * 4; i++) seen.push(playlist.next());

      for (let i = 1; i < seen.length; i++) {
        expect(seen[i]).not.toBe(seen[i - 1]);
      }
    }
  });

  it("keeps cycling indefinitely", () => {
    const playlist = new Playlist(PHOTOS, "shuffle", seededRandom(3));
    for (let i = 0; i < 1000; i++) {
      expect(playlist.next()).toBeDefined();
    }
  });
});

describe("Playlist / sequential", () => {
  it("preserves source order and wraps", () => {
    const playlist = new Playlist(PHOTOS, "sequential", seededRandom(1));
    const seen = [...PHOTOS, ...PHOTOS].map(() => playlist.next());
    expect(seen).toEqual([...PHOTOS, ...PHOTOS]);
  });
});

describe("Playlist / random", () => {
  it("returns items from the set and does not look ahead", () => {
    const playlist = new Playlist(PHOTOS, "random", seededRandom(9));
    for (let i = 0; i < 100; i++) {
      expect(PHOTOS).toContain(playlist.next());
    }
    expect(playlist.peek(3)).toEqual([]);
  });
});

describe("Playlist / empty", () => {
  it("reports empty and yields undefined rather than throwing", () => {
    const playlist = new Playlist<string>([], "shuffle", seededRandom(1));
    expect(playlist.isEmpty).toBe(true);
    expect(playlist.length).toBe(0);
    expect(playlist.next()).toBeUndefined();
    expect(playlist.peek(2)).toEqual([]);
  });

  it("starts working once items arrive", () => {
    const playlist = new Playlist<string>([], "shuffle", seededRandom(1));
    expect(playlist.next()).toBeUndefined();
    playlist.replace(PHOTOS);
    expect(PHOTOS).toContain(playlist.next());
  });
});

describe("Playlist / peek", () => {
  it("looks ahead without consuming", () => {
    const playlist = new Playlist(PHOTOS, "sequential", seededRandom(1));
    const upcoming = playlist.peek(3);
    expect(upcoming).toEqual(["a", "b", "c"]);
    expect(playlist.next()).toBe("a");
  });

  it("stops at the cycle boundary rather than guessing the next permutation", () => {
    const playlist = new Playlist(PHOTOS, "shuffle", seededRandom(1));
    for (let i = 0; i < 4; i++) playlist.next();
    expect(playlist.peek(5).length).toBeLessThanOrEqual(1);
  });
});

describe("Playlist / replace", () => {
  it("adopts a refreshed asset list", () => {
    const playlist = new Playlist(PHOTOS, "shuffle", seededRandom(1));
    playlist.next();
    playlist.replace(["x", "y"]);
    expect(playlist.length).toBe(2);
    expect(["x", "y"]).toContain(playlist.next());
  });

  it("does not rewind a sequential display on refresh", () => {
    // A wall panel refreshes its asset list hourly; that must not jump the
    // slideshow back to photo one.
    const playlist = new Playlist(PHOTOS, "sequential", seededRandom(1));
    expect(playlist.next()).toBe("a");
    expect(playlist.next()).toBe("b");
    playlist.replace(PHOTOS);
    expect(playlist.next()).toBe("c");
  });

  it("survives being emptied", () => {
    const playlist = new Playlist(PHOTOS, "shuffle", seededRandom(1));
    playlist.next();
    playlist.replace([]);
    expect(playlist.isEmpty).toBe(true);
    expect(playlist.next()).toBeUndefined();
  });
});

describe("Playlist / setOrder", () => {
  it("switches traversal mode at runtime", () => {
    const playlist = new Playlist(PHOTOS, "shuffle", seededRandom(1));
    playlist.next();
    playlist.setOrder("sequential");
    expect(playlist.next()).toBe("a");
  });
});
