/**
 * Immich source, built on Home Assistant's core `immich` integration.
 *
 * The integration exposes a media source whose first-level collections are
 * `albums`, `favorites`, `people` and `tags`, with identifiers of the form:
 *
 *     <config_entry_unique_id>|<collection>|<collection_id>|<asset_id>|<file_name>|<mime_type>
 *
 * Favorites is special: it has no sub-collections, so `favorites|favorites`
 * addresses the assets directly.
 *
 * Images are served by the integration's own authenticated view at
 * `/immich/{uid}/{asset_id}/{size}/{mime}`. Building that path by hand rather
 * than using `media_source/resolve_media` is what lets the card ask for
 * `preview` instead of `fullsize` — a large bandwidth and decode saving on the
 * cheap tablets this card targets.
 */

import { type HomeAssistant, browseMedia, resolveMedia, signPath } from "../ha";
import type { ImageSize, ImmichSourceConfig, Slide, SlideSource } from "../types";

const IMMICH_PREFIX = "media-source://immich/";

/** Signed URLs are requested for an hour and re-signed well before expiry. */
const SIGN_EXPIRY_SECONDS = 3600;
const SIGN_REFRESH_MARGIN_MS = 5 * 60_000;

interface ParsedIdentifier {
  uniqueId: string;
  collection: string;
  collectionId: string;
  assetId: string;
  fileName: string;
  mimeType: string;
}

export function parseImmichIdentifier(mediaContentId: string): ParsedIdentifier | null {
  if (!mediaContentId.startsWith(IMMICH_PREFIX)) return null;
  const parts = mediaContentId.slice(IMMICH_PREFIX.length).split("|");
  if (parts.length < 6) return null;

  const [uniqueId, collection, collectionId, assetId, fileName, mimeType] = parts;
  if (!uniqueId || !assetId) return null;

  return { uniqueId, collection, collectionId, assetId, fileName, mimeType };
}

/**
 * Build the image path for an asset.
 *
 * `preview` and `thumbnail` are always re-encoded to JPEG by Immich regardless
 * of the original format, so the mime segment — which is what sets the response
 * content type — must say JPEG for those sizes. Only `fullsize` returns the
 * original mime.
 */
export function immichImagePath(id: ParsedIdentifier, size: ImageSize): string {
  const mime = size === "fullsize" ? id.mimeType || "image/jpeg" : "image/jpeg";
  return `/immich/${id.uniqueId}/${id.assetId}/${size}/${mime}`;
}

interface CachedUrl {
  url: string;
  expiresAt: number;
}

export class ImmichSource implements SlideSource {
  readonly refreshInterval = 3600;

  private urlCache = new Map<string, CachedUrl>();

  constructor(
    private hass: HomeAssistant,
    private readonly config: ImmichSourceConfig,
  ) {}

  /** Home Assistant hands the card a new `hass` object constantly; keep current. */
  setHass(hass: HomeAssistant): void {
    this.hass = hass;
  }

  async load(): Promise<Slide[]> {
    const contentId = await this.resolveCollectionId();
    const result = await browseMedia(this.hass, contentId);

    const children = result.children ?? [];
    const images = children.filter(
      (child) => child.media_class === "image" && !child.can_expand,
    );

    if (images.length === 0 && children.length > 0) {
      throw new Error(
        `No photos in this Immich collection (found ${children.length} non-image items).`,
      );
    }

    return images.map((child) => ({
      id: child.media_content_id,
      title: child.title,
    }));
  }

  async urlFor(slide: Slide): Promise<string> {
    const cached = this.urlCache.get(slide.id);
    if (cached && cached.expiresAt - SIGN_REFRESH_MARGIN_MS > Date.now()) {
      return cached.url;
    }

    const url = await this.buildUrl(slide);

    // Bound the cache so a library of thousands cannot grow it without limit.
    if (this.urlCache.size > 64) this.urlCache.clear();
    this.urlCache.set(slide.id, {
      url,
      expiresAt: Date.now() + SIGN_EXPIRY_SECONDS * 1000,
    });

    return url;
  }

  private async buildUrl(slide: Slide): Promise<string> {
    const parsed = parseImmichIdentifier(slide.id);
    const size = this.config.image_size ?? "preview";

    if (parsed) {
      try {
        return await signPath(this.hass, immichImagePath(parsed, size), SIGN_EXPIRY_SECONDS);
      } catch {
        // Fall through: resolve_media returns a pre-signed fullsize URL, which
        // is heavier but always works.
      }
    }

    const resolved = await resolveMedia(this.hass, slide.id, SIGN_EXPIRY_SECONDS);
    return resolved.url;
  }

  /** Find the media-source content id for the configured collection. */
  private async resolveCollectionId(): Promise<string> {
    const uniqueId = await this.findInstanceId();
    const collection = this.config.collection ?? "favorites";

    if (collection === "favorites") {
      return `${IMMICH_PREFIX}${uniqueId}|favorites|favorites`;
    }

    const folder = { album: "albums", person: "people", tag: "tags" }[collection];
    const name = this.config.name?.trim();
    if (!name) {
      throw new Error(`\`name\` is required when collection is "${collection}".`);
    }

    const listing = await browseMedia(this.hass, `${IMMICH_PREFIX}${uniqueId}|${folder}`);
    const match = (listing.children ?? []).find(
      (child) => child.title.toLowerCase() === name.toLowerCase(),
    );

    if (!match) {
      const available = (listing.children ?? []).map((c) => c.title).join(", ");
      throw new Error(
        `No ${collection} named "${name}" in Immich.${available ? ` Available: ${available}` : ""}`,
      );
    }

    return match.media_content_id;
  }

  /**
   * Discover the Immich config entry, so the user never has to find and paste
   * an opaque unique id into their dashboard YAML.
   */
  private async findInstanceId(): Promise<string> {
    const root = await browseMedia(this.hass, "media-source://immich");
    const instances = root.children ?? [];

    if (instances.length === 0) {
      throw new Error(
        "No Immich instance found. Add the Immich integration in Settings > Devices & Services.",
      );
    }

    const id = instances[0].media_content_id.slice(IMMICH_PREFIX.length);
    return id.split("|")[0];
  }
}
