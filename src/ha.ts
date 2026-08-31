/**
 * The slice of the Home Assistant frontend API this card actually uses.
 *
 * Declared locally rather than pulled from `custom-card-helpers`: that package
 * lags core, and the surface needed here is small enough that a local
 * definition is more honest than a dependency.
 */

export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown> & {
    entity_picture?: string;
    friendly_name?: string;
  };
  last_changed: string;
  last_updated: string;
}

export interface HomeAssistant {
  states: Record<string, HassEntity>;
  callWS<T>(message: Record<string, unknown>): Promise<T>;
  /** Present when the user is authenticated; used for `auth/sign_path`. */
  auth?: { data?: { access_token?: string } };
}

/** A node in a media-source tree, as returned by `media_source/browse_media`. */
export interface BrowseMediaChild {
  title: string;
  media_class: string;
  media_content_type: string;
  media_content_id: string;
  can_play: boolean;
  can_expand: boolean;
  thumbnail?: string | null;
}

export interface BrowseMediaResult extends BrowseMediaChild {
  children?: BrowseMediaChild[];
}

export function browseMedia(
  hass: HomeAssistant,
  mediaContentId: string,
): Promise<BrowseMediaResult> {
  return hass.callWS<BrowseMediaResult>({
    type: "media_source/browse_media",
    media_content_id: mediaContentId,
  });
}

export function resolveMedia(
  hass: HomeAssistant,
  mediaContentId: string,
  expiresSeconds = 3600,
): Promise<{ url: string; mime_type: string }> {
  return hass.callWS({
    type: "media_source/resolve_media",
    media_content_id: mediaContentId,
    expires: expiresSeconds,
  });
}

/**
 * Sign a Home Assistant path so it can be used as a plain `<img src>`.
 *
 * Needed because the views serving these images require authentication, and an
 * image request cannot carry an `Authorization` header.
 *
 * Note that the signature covers the path *and* its query parameters (all
 * except `width` and `height`), so the returned URL must be used verbatim —
 * appending a cache-buster invalidates it.
 */
export async function signPath(
  hass: HomeAssistant,
  path: string,
  expiresSeconds = 3600,
): Promise<string> {
  const result = await hass.callWS<{ path: string }>({
    type: "auth/sign_path",
    path,
    expires: expiresSeconds,
  });
  return result.path;
}
