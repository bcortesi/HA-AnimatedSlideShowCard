# Animated Slideshow Card — Implementation Plan

A Lovelace custom card that displays photos from Immich (starting with **Favorites**) with a
high-quality Ken Burns effect: slow continuous zoom + pan, crossfaded so motion never stops.

---

## 1. Verdict on reusing `remy/ha_immich_picture`

**Recommendation: don't build on it. Use Home Assistant's official Immich integration instead.**

`ha_immich_picture` is a *backend custom integration* (Python, `custom_components/immich_picture/`)
that exposes a `camera` entity cycling through photos. It contains no frontend code, so there is
nothing to reuse directly for a card. More importantly, its data model is wrong for our purpose:

| Need | `ha_immich_picture` | Official `immich` integration |
|---|---|---|
| Get the **whole list** of favorites up front | No — serves one current image | Yes — `media_source/browse_media` returns all assets |
| Preload the *next* image (required for seamless crossfade) | Not possible | Yes |
| Control slide timing from the card | No — the integration owns the interval | Yes |
| Extra install for the user | Yes (HACS custom integration + API key) | No — built into HA core since **2025.6** |
| Choose image resolution | No | Yes (`thumbnail` / `preview` / `fullsize`) |

The official integration is a Platinum-quality core integration and **exposes `favorites` as a
first-class collection** — verified in `homeassistant/components/immich/media_source.py`, where the
first-level collections are `("albums", "favorites|favorites", "people", "tags")`.

**However**, `ha_immich_picture` still gets reused — as one of the card's *pluggable sources*.
The card will support a `camera`/`image` entity source, which works with `ha_immich_picture`, with
any other photo integration, and with generic cameras, at almost zero extra cost.

---

## 2. Verified technical foundation

All of the following was read from Home Assistant `dev` source, not assumed.

### 2.1 Listing the Favorites

WebSocket call, available to any custom card via `hass.callWS`:

```js
await hass.callWS({
  type: "media_source/browse_media",
  media_content_id: `media-source://immich/${uniqueId}|favorites|favorites`,
});
```

The instance `uniqueId` is discovered by browsing the root `media-source://immich` first, so the
user never has to type it.

Each child comes back as:

```js
{
  media_content_id: "media-source://immich/<uid>|favorites|favorites|<assetId>|<filename>|<mime>",
  media_class: "image" | "video",
  media_content_type: "image/jpeg",
  title: "IMG_1234.jpg",
  thumbnail: "/immich/<uid>/<assetId>/thumbnail/image/jpeg",
}
```

The identifier format is `unique_id|collection|collection_id|asset_id|file_name|mime_type`.
Note that `favorites` fetches *all* favorites in one call (`async_get_all_favorites()`), so the card
must cache the list and refresh it only periodically.

### 2.2 Getting a displayable image URL

Immich images are served by `ImmichMediaView` at `/immich/{uid}/{asset_id}/{size}/{mime}`. This is a
`HomeAssistantView` with `requires_auth = True`, so a bare `<img src>` will **401** — the browser
cannot send an `Authorization` header on an image request. Two working paths:

**(a) `media_source/resolve_media`** — returns a URL *already signed* for 24h
(`CONTENT_AUTH_EXPIRY_TIME = 3600 * 24`), because it runs the result through
`async_process_play_media_url`. Simplest, works for every media source, but always yields `fullsize`.

**(b) `auth/sign_path`** — lets us build our own path and pick the size:

```js
const { path } = await hass.callWS({
  type: "auth/sign_path",
  path: `/immich/${uid}/${assetId}/preview/image/jpeg`,
  expires: 3600,
});
```

`size` is passed straight through to Immich and accepts `fullsize`, `preview`, or `thumbnail`
(verified in `aioimmich`). **`preview` is the right default for a slideshow** — dramatically less
bandwidth and decode time than `fullsize`, still sharp on a 4K panel. Note that `preview` always
comes back as JPEG, so the mime segment must be `image/jpeg` regardless of the asset's original mime.

**Gotcha:** the signature covers the path *and* the query params (everything except `width`/`height`).
Never append a cache-buster to a signed URL — it will fail auth.

**Plan:** use (b) for Immich (size control), fall back to (a) for generic media sources.

### 2.3 Confirmed context

- ✅ The official Immich integration **is already configured** on the target HA instance, so the
  frontend-only architecture below is viable as written — no backend install needed.
- ✅ **Primary target is a wall tablet / kiosk display.** This drives several decisions: see §10.
- Video assets in Favorites are skipped in v1 (filter on `media_class === "image"`).
- No EXIF date/location captions in v1 — `browse_media` only returns the filename. Richer captions
  would need a companion integration; deferred.

---

## 3. Architecture

Frontend-only. **No Python, no custom integration.** Installed as a HACS *Lovelace* repository.

```
┌─────────────────────────────────────────────────────┐
│ animated-slideshow-card  (LitElement)               │
│                                                     │
│  Source ──► Playlist ──► Preloader ──► KenBurns     │
│  (fetch     (shuffle,    (decode()     (WAAPI       │
│   asset      no repeats,  ahead,        transform + │
│   list)      refresh)     cap memory)   crossfade)  │
└─────────────────────────────────────────────────────┘
          │ hass.callWS
          ▼
  media_source/browse_media · auth/sign_path
          │
          ▼
  core `immich` integration ──► Immich server
```

### Source interface

```ts
interface SlideSource {
  load(hass: HomeAssistant): Promise<Slide[]>;                 // list of assets
  urlFor(slide: Slide, hass: HomeAssistant): Promise<string>;  // signed, just-in-time
  readonly refreshInterval: number;
}
```

Implementations, in priority order:

1. **`immich`** — favorites (default), or album / person / tag. *Primary.*
2. **`media_source`** — any media-source path (e.g. `media-source://media_source/local/photos`).
   Nearly free: the same browse/resolve code, no Immich needed.
3. **`entity`** — a `camera` or `image` entity; follows `entity_picture` changes.
   **This is the `ha_immich_picture` compatibility path.**
4. **`urls`** — a static list, for development and testing.

---

## 4. Ken Burns engine — the actual design

This is the part that determines whether the card looks beautiful or cheap. It is pure,
framework-free, and testable in isolation.

### 4.1 DOM

Container `overflow: hidden`, two absolutely-positioned layers. Each layer holds an
`<img style="width:100%; height:100%; object-fit:cover">`. Animate **only `transform` and
`opacity`** (GPU-composited); never `filter`, `width`, or `background-position`.

### 4.2 Pan geometry (must be exact, or edges show)

With `transform: scale(S) translate(tx%, ty%)` and `transform-origin: center`, the translate is
applied in the element's local coordinates and *then* scaled. On-screen displacement is
`tx% × W × S`, while the available overflow on each side is `(S − 1) × W / 2`. Therefore:

```
|tx| ≤ p_max(S) = (S − 1) / (2S)
```

Since the scale changes across the animation, **clamp both endpoints using `min(S₁, S₂)`** —
otherwise a mid-animation frame can expose a background edge.

Consequence: a zoom ending at exactly `S = 1.0` has `p_max = 0` and cannot pan at all. So the card
uses a **base overscan** rather than starting at 1.0:

- `zoom.base = 1.10` — always at least 10% overscan, giving `p_max ≈ 4.5%`
- `zoom.max = 1.28`
- zoom-in: `S₁ = base`, `S₂ = base + Δ` · zoom-out: reversed · `Δ` random in `[0.06, 0.18]`

### 4.3 Motion generation

Per slide, randomise:

- **Zoom direction** — in or out, 50/50.
- **Pan axis** — a random angle θ, with endpoints at opposite ends of that axis:
  `(x₁,y₁) = −r·p_max·(cosθ, sinθ)` and `(x₂,y₂) = +r·p_max·(cosθ, sinθ)`, with `r ∈ [0.5, 1.0]`.
  This always produces a clean directional sweep rather than random jitter.
- **Anti-repetition** — reject a θ within ~40° of the previous slide's, and don't use the same zoom
  direction three times running.

### 4.4 Timing

- `duration` (default **20s**) — the interval between slide starts.
- `crossfade` (default **2.5s**).
- Each layer animates its transform for `duration + crossfade`, so the outgoing image is **still
  moving while it fades out**. A slideshow where motion freezes during the fade is the single most
  common tell of a cheap implementation.
- Transform easing: **`linear`** (constant velocity; the overlap hides the start/stop).
  Opacity easing: `ease-in-out`.

Use the Web Animations API, not CSS keyframes — the parameters are random per slide, and WAAPI gives
`pause()` / `play()` for free.

### 4.5 Portrait photos — `fit` modes

`object-fit: cover` crops a portrait photo brutally in a 16:9 card. Two modes:

- **`cover`** (default) — classic Ken Burns, fills the frame.
- **`blurred`** — foreground `object-fit: contain` inset to ~92% of the box (that 8% headroom is
  exactly what the zoom consumes, so the photo never clips), over a blurred, slowly-panning copy of
  the same image (`filter: blur(32px) brightness(0.55) saturate(1.2)`, `scale(1.15)`). Gorgeous for
  mixed-orientation libraries — which Favorites always is.

### 4.6 Preloading

Before a slide is scheduled: sign its URL, create the `Image`, and `await img.decode()`. Only then
start its animation. Keep 2–3 decoded images ahead, and evict beyond that so a wall panel running
for weeks doesn't grow unbounded.

---

## 5. Configuration schema (draft)

```yaml
type: custom:animated-slideshow-card
source:
  type: immich          # immich | media_source | entity | urls
  collection: favorites # favorites | album | person | tag
  # album: "Holidays 2025"
  image_size: preview   # preview | fullsize | thumbnail
duration: 20            # seconds per slide
crossfade: 2.5
order: shuffle          # shuffle | random | sequential
fit: cover              # cover | blurred
zoom:
  base: 1.10
  max: 1.28
aspect_ratio: "16:9"    # or `fill` for a panel / sections layout
refresh_interval: 3600  # re-fetch the asset list, seconds
show_filename: false
pause_when_hidden: true
tap_action: { action: none }
```

---

## 6. Repository layout

```
src/
  animated-slideshow-card.ts   # LitElement: lifecycle, hass, rendering
  editor.ts                    # visual config editor
  kenburns.ts                  # PURE motion generator + pan math
  playlist.ts                  # PURE shuffle / no-repeat queue
  preloader.ts                 # decode-ahead + eviction
  sources/{immich,media-source,entity,urls}.ts
  types.ts  const.ts
test/
  kenburns.test.ts             # clamp invariant: no edge is ever exposed
  playlist.test.ts             # a full cycle completes before any repeat
dev/
  demo.html                    # standalone harness, mock hass, live sliders
dist/animated-slideshow-card.js
hacs.json · rollup.config.mjs · package.json · tsconfig.json
.github/workflows/{build,release}.yml
README.md
```

**Stack:** TypeScript + Lit + Rollup, bundled to a single `dist/animated-slideshow-card.js`. This is
the conventional HACS frontend-card setup, so users get the standard install path.

**`dev/demo.html` is not optional.** Tuning Ken Burns aesthetics through a Home Assistant reload
cycle is agonising. A standalone page with a mock `hass`, a handful of sample photos, and live
sliders for duration / zoom / crossfade turns a 60-second feedback loop into a 1-second one.

---

## 7. Milestones

| # | Milestone | Deliverable | Est. | Status |
|---|---|---|---|---|
| **M0** | Scaffold | Repo, build, `hacs.json`, CI, `dev/` tuning harness | 0.5d | ✅ done |
| **M1** | Ken Burns engine | `kenburns.ts` + tests, tuned entirely in the harness. **No HA involved.** | 1d | ✅ done |
| **M2** | Immich source | Instance discovery, favorites browse, `auth/sign_path`, preloader → working card in HA | 1d | ✅ code complete, **untested against a real HA** |
| **M3** | **Kiosk hardening** | `fill` panel mode, pause-when-hidden, `blurred` fit, unattended-run robustness (see §10) | 1d | 🟡 mostly done; reconnect handling outstanding |
| **M4** | Config & sources | Visual editor; `media_source` / `entity` / `urls` sources | 1d | 🟡 sources done, editor not started |
| **M5** | Ship | README with screenshots/GIF, HACS release workflow, submit to HACS default | 0.5d | 🟡 README + workflows done |

M1 before M2 is deliberate: the visual quality is the whole point, and it can be perfected without
any Immich or HA dependency at all.

M3 before M4 is the **kiosk reordering**: an always-on wall display needs to survive weeks of
unattended running long before it needs a pretty visual config editor. The card will be usable from
YAML throughout M0–M3.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Large Favorites (5k+) make `browse_media` slow | Cache the list; refresh on `refresh_interval`; show the first slide as soon as the list lands |
| Signed URL expiry on a panel left running for days | Sign just-in-time per slide (1h expiry), not once up front |
| `hass` setter fires on *every* state change | Never restart the slideshow from the `hass` setter; react only to config changes and the specific watched entity |
| Animation leaks / battery drain on wall tablets | `disconnectedCallback` cancels timers and animations; pause on hidden tab and when off-screen |
| Weak GPU tablets stutter | `transform`/`opacity` only; `will-change`; `preview` size not `fullsize`; cap concurrent layers at 2 |
| Official integration lacks Favorites on older HA | Document a 2025.6+ minimum; fall back to the `entity` source (works with `ha_immich_picture`) |
| Video assets in Favorites | Filter to `media_class === "image"` in v1 |

---

## 9. Explicitly out of scope for v1

EXIF date/location captions · video playback · weather/clock overlays (use a stack card) ·
face-aware smart cropping · writing back to Immich.

---

## 10. Kiosk / wall-tablet specifics

The primary target is an always-on wall display, which is a meaningfully different problem from a
card on a dashboard someone glances at. Concretely:

**Defaults change.** Ship kiosk-friendly values: `aspect_ratio: fill` (fill the panel, no card
chrome, no rounded corners or shadow), `duration: 25`, `crossfade: 3` — slower and more cinematic
reads better on a wall than on a desk.

**Survive weeks of unattended running.** This is the main engineering risk and gets explicit
attention in M3:

- Sign URLs just-in-time per slide; never hold a URL longer than its expiry.
- Re-fetch the asset list on `refresh_interval` so newly-favourited photos appear without a reload.
- Recover from transient failures instead of dying: a failed image load skips to the next slide,
  and the asset-list fetch retries with backoff rather than leaving a permanently blank screen.
- Reconnect cleanly after the HA WebSocket drops (tablet sleeps, HA restarts, network blips) —
  the card must resume rather than freeze on the last frame.
- No unbounded growth: cap the preload queue, release decoded images, cancel animations in
  `disconnectedCallback`.

**Weak GPUs are the norm.** Old Fire tablets and cheap Android panels are the typical hardware.
`preview` (not `fullsize`) is the default image size, only `transform`/`opacity` are animated, and
concurrent layers are capped at 2. If M1 tuning shows stutter, the fallback is to reduce the zoom
range before reducing the frame rate.

**Burn-in.** Continuously moving photos are inherently good for this, but any static overlay is not
— so `show_filename` stays off by default, and any future overlay must drift or periodically hide.

**Screen wake/dim is out of scope** — that belongs to the tablet's own kiosk software
(Fully Kiosk, WallPanel, or the HA companion app), not to this card.

---

## 11. References

- HA Immich integration — https://www.home-assistant.io/integrations/immich/
- `immich/media_source.py` (favorites collection, identifier format, `ImmichMediaView`) — home-assistant/core `dev`
- `http/auth.py` (`SIGN_QUERY_PARAM = "authSig"`; the signature covers path + params)
- `media_player/browse_media.py` (`async_process_play_media_url`, `CONTENT_AUTH_EXPIRY_TIME = 86400`)
- `aioimmich/assets/__init__.py` (`async_view_asset` sizes: `fullsize` | `preview` | `thumbnail`)
- `remy/ha_immich_picture` — https://github.com/remy/ha_immich_picture
- Prior art: `mulder82/immich-slideshow`, `rygwdn/lovelace-wallpanel`, `zsarnett/slideshow-card`
