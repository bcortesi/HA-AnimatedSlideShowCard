import { describe, expect, it } from "vitest";
import { ImmichSource, immichImagePath, parseImmichIdentifier } from "../src/sources/immich";
import type { BrowseMediaResult, HomeAssistant } from "../src/ha";

const UID = "1a2b3c";
const ASSET = "aaaa-bbbb-cccc";
const ID = `media-source://immich/${UID}|favorites|favorites|${ASSET}|IMG_0001.jpg|image/jpeg`;

describe("parseImmichIdentifier", () => {
  it("splits a full asset identifier", () => {
    expect(parseImmichIdentifier(ID)).toEqual({
      uniqueId: UID,
      collection: "favorites",
      collectionId: "favorites",
      assetId: ASSET,
      fileName: "IMG_0001.jpg",
      mimeType: "image/jpeg",
    });
  });

  it("rejects identifiers from other media sources", () => {
    expect(parseImmichIdentifier("media-source://media_source/local/a.jpg")).toBeNull();
  });

  it("rejects a collection-level identifier that has no asset", () => {
    expect(parseImmichIdentifier(`media-source://immich/${UID}|favorites|favorites`)).toBeNull();
  });

  it("rejects a malformed identifier rather than producing a broken path", () => {
    expect(parseImmichIdentifier("")).toBeNull();
    expect(parseImmichIdentifier(`media-source://immich/|favorites|favorites|||`)).toBeNull();
  });
});

describe("immichImagePath", () => {
  const parsed = parseImmichIdentifier(ID)!;

  it("keeps the original mime for fullsize", () => {
    expect(immichImagePath(parsed, "fullsize")).toBe(
      `/immich/${UID}/${ASSET}/fullsize/image/jpeg`,
    );
  });

  it("forces JPEG for preview and thumbnail", () => {
    // Immich re-encodes these sizes to JPEG whatever the original was, and this
    // path segment is what sets the response content type. Echoing the original
    // mime here serves a JPEG labelled as something else.
    const heic = parseImmichIdentifier(
      `media-source://immich/${UID}|favorites|favorites|${ASSET}|IMG.heic|image/heic`,
    )!;

    expect(immichImagePath(heic, "preview")).toBe(`/immich/${UID}/${ASSET}/preview/image/jpeg`);
    expect(immichImagePath(heic, "thumbnail")).toBe(
      `/immich/${UID}/${ASSET}/thumbnail/image/jpeg`,
    );
    expect(immichImagePath(heic, "fullsize")).toBe(`/immich/${UID}/${ASSET}/fullsize/image/heic`);
  });
});

/** A hass stub that records calls and replays canned browse responses. */
function makeHass(responses: Record<string, Partial<BrowseMediaResult>>) {
  const calls: Record<string, unknown>[] = [];

  const hass = {
    states: {},
    async callWS<T>(message: Record<string, unknown>): Promise<T> {
      calls.push(message);

      if (message.type === "auth/sign_path") {
        return { path: `${message.path}?authSig=signed` } as T;
      }
      if (message.type === "media_source/browse_media") {
        const id = String(message.media_content_id);
        const response = responses[id];
        if (!response) throw new Error(`unexpected browse: ${id}`);
        return { children: [], ...response } as T;
      }
      if (message.type === "media_source/resolve_media") {
        return { url: "/resolved/fallback.jpg", mime_type: "image/jpeg" } as T;
      }
      throw new Error(`unexpected ws call: ${String(message.type)}`);
    },
  } as unknown as HomeAssistant;

  return { hass, calls };
}

function asset(index: number, mediaClass = "image") {
  return {
    title: `IMG_000${index}.jpg`,
    media_class: mediaClass,
    media_content_type: "image/jpeg",
    media_content_id: `media-source://immich/${UID}|favorites|favorites|asset-${index}|IMG_000${index}.jpg|image/jpeg`,
    can_play: false,
    can_expand: false,
  };
}

describe("ImmichSource.load", () => {
  it("discovers the instance and lists favorites without any configured id", () => {
    const { hass } = makeHass({
      "media-source://immich": {
        children: [
          {
            title: "Immich",
            media_class: "directory",
            media_content_type: "image",
            media_content_id: `media-source://immich/${UID}`,
            can_play: false,
            can_expand: true,
          },
        ],
      },
      [`media-source://immich/${UID}|favorites|favorites`]: {
        children: [asset(1), asset(2)],
      },
    });

    const source = new ImmichSource(hass, { type: "immich" });
    return expect(source.load()).resolves.toEqual([
      { id: asset(1).media_content_id, title: "IMG_0001.jpg" },
      { id: asset(2).media_content_id, title: "IMG_0002.jpg" },
    ]);
  });

  it("filters out videos, which cannot be Ken Burns'd", async () => {
    const { hass } = makeHass({
      "media-source://immich": {
        children: [
          {
            title: "Immich",
            media_class: "directory",
            media_content_type: "image",
            media_content_id: `media-source://immich/${UID}`,
            can_play: false,
            can_expand: true,
          },
        ],
      },
      [`media-source://immich/${UID}|favorites|favorites`]: {
        children: [asset(1), asset(2, "video"), asset(3)],
      },
    });

    const slides = await new ImmichSource(hass, { type: "immich" }).load();
    expect(slides).toHaveLength(2);
    expect(slides.map((s) => s.id)).not.toContain(asset(2).media_content_id);
  });

  it("explains itself when Immich is not configured", async () => {
    const { hass } = makeHass({ "media-source://immich": { children: [] } });
    await expect(new ImmichSource(hass, { type: "immich" }).load()).rejects.toThrow(
      /No Immich instance found/,
    );
  });

  it("names the available albums when the configured one is missing", async () => {
    const { hass } = makeHass({
      "media-source://immich": {
        children: [
          {
            title: "Immich",
            media_class: "directory",
            media_content_type: "image",
            media_content_id: `media-source://immich/${UID}`,
            can_play: false,
            can_expand: true,
          },
        ],
      },
      [`media-source://immich/${UID}|albums`]: {
        children: [
          {
            title: "Holidays",
            media_class: "directory",
            media_content_type: "image",
            media_content_id: `media-source://immich/${UID}|albums|album-1`,
            can_play: false,
            can_expand: true,
          },
        ],
      },
    });

    const source = new ImmichSource(hass, { type: "immich", collection: "album", name: "Nope" });
    await expect(source.load()).rejects.toThrow(/Available: Holidays/);
  });

  it("requires a name for collections that need one", async () => {
    const { hass } = makeHass({
      "media-source://immich": {
        children: [
          {
            title: "Immich",
            media_class: "directory",
            media_content_type: "image",
            media_content_id: `media-source://immich/${UID}`,
            can_play: false,
            can_expand: true,
          },
        ],
      },
    });

    await expect(
      new ImmichSource(hass, { type: "immich", collection: "album" }).load(),
    ).rejects.toThrow(/`name` is required/);
  });
});

describe("ImmichSource.urlFor", () => {
  const setup = (config = {}) => {
    const { hass, calls } = makeHass({});
    const source = new ImmichSource(hass, { type: "immich", ...config });
    return { source, calls };
  };

  it("signs a preview path by default", async () => {
    const { source } = setup();
    const url = await source.urlFor({ id: ID });
    expect(url).toBe(`/immich/${UID}/${ASSET}/preview/image/jpeg?authSig=signed`);
  });

  it("honours a configured image size", async () => {
    const { source } = setup({ image_size: "fullsize" });
    const url = await source.urlFor({ id: ID });
    expect(url).toContain("/fullsize/");
  });

  it("caches the signed URL, so preloading and display agree on one URL", async () => {
    // If warm() and get() produced different URLs the preloaded bitmap would be
    // a cache miss and every photo would be fetched twice.
    const { source, calls } = setup();
    const first = await source.urlFor({ id: ID });
    const second = await source.urlFor({ id: ID });

    expect(second).toBe(first);
    expect(calls.filter((c) => c.type === "auth/sign_path")).toHaveLength(1);
  });

  it("falls back to resolve_media for an unparseable identifier", async () => {
    const { source, calls } = setup();
    const url = await source.urlFor({ id: "media-source://media_source/local/x.jpg" });

    expect(url).toBe("/resolved/fallback.jpg");
    expect(calls.some((c) => c.type === "media_source/resolve_media")).toBe(true);
  });
});
