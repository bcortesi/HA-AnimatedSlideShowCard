# Animated Slideshow Card

A Home Assistant Lovelace card that displays your Immich photos with a Ken Burns
effect — slow, continuous zoom and pan, crossfaded so the motion never stops.

Built for always-on wall displays: it pauses when it cannot be seen, recovers on
its own from network and server failures, and keeps its memory bounded so it can
run for weeks unattended.

> **Status: in development.** The engine, sources and card are implemented and
> tested; the visual config editor is not built yet, so configure it in YAML.

## Requirements

- Home Assistant **2025.6 or newer**
- The **[Immich integration](https://www.home-assistant.io/integrations/immich/)**
  configured under *Settings → Devices & Services*

No custom backend integration is needed. The card talks to the core Immich
integration's media source, so there is no second API key to manage and no
credentials in your dashboard config.

## Installation

### HACS (recommended)

1. HACS → Frontend → ⋮ → **Custom repositories**
2. Add `https://github.com/bcortesi/HA-AnimatedSlideShowCard` as a **Lovelace** repository
3. Install **Animated Slideshow Card**

### Manual

Download `animated-slideshow-card.js` from the
[latest release](https://github.com/bcortesi/HA-AnimatedSlideShowCard/releases),
drop it in `config/www/`, then add it under
*Settings → Dashboards → Resources* as a JavaScript module:

```
/local/animated-slideshow-card.js
```

## Usage

The minimum — your Immich favourites, shuffled:

```yaml
type: custom:animated-slideshow-card
source:
  type: immich
```

A full-screen wall panel:

```yaml
type: custom:animated-slideshow-card
source:
  type: immich
  collection: favorites
duration: 25
crossfade: 3
fit: blurred
aspect_ratio: fill
```

A specific album:

```yaml
type: custom:animated-slideshow-card
source:
  type: immich
  collection: album
  name: Holidays 2025
```

## Options

| Option | Default | Description |
|---|---|---|
| `source` | *required* | See [Sources](#sources) below. |
| `duration` | `25` | Seconds per slide. |
| `crossfade` | `3` | Seconds of overlap between slides. Cannot exceed `duration`. |
| `order` | `shuffle` | `shuffle`, `random` or `sequential`. |
| `fit` | `cover` | `cover` fills the frame; `blurred` letterboxes over a blurred backdrop. |
| `zoom.zoomBase` | `1.10` | Base overscan. Must exceed 1.0 or the image cannot pan — see [How the motion works](#how-the-motion-works). |
| `zoom.zoomMax` | `1.28` | Maximum scale. |
| `aspect_ratio` | `16:9` | Any `W:H`, or `fill` to fill a panel with no card chrome. |
| `refresh_interval` | `3600` | Seconds between asset-list refreshes. |
| `show_filename` | `false` | Caption each photo. Off by default: a static overlay risks burn-in. |
| `pause_when_hidden` | `true` | Stop animating when off-screen or in a background tab. |

### Sources

**Immich** — the core integration's media source.

```yaml
source:
  type: immich
  collection: favorites   # favorites | album | person | tag
  name: Holidays 2025     # required for album, person and tag
  image_size: preview     # preview | fullsize | thumbnail
```

`preview` is the default and the right choice for a slideshow: far less
bandwidth and decode time than `fullsize`, still sharp on a 4K panel.

**Any media source** — a local folder, for instance:

```yaml
source:
  type: media_source
  path: media-source://media_source/local/photos
```

**A camera or image entity** — works with
[`remy/ha_immich_picture`](https://github.com/remy/ha_immich_picture) and with
plain cameras:

```yaml
source:
  type: entity
  entity: camera.immich_picture
```

**A fixed list of URLs**, mainly for testing:

```yaml
source:
  type: urls
  urls:
    - /local/photos/one.jpg
```

## How the motion works

Each slide gets a randomised move: a zoom direction, a scale range and a pan
axis, with anti-repetition so consecutive slides do not drift the same way.

The geometry that keeps this from showing background edges is worth stating,
because it is where naive implementations break. A layer transformed with
`scale(S) translate(tx%, ty%)` is displaced by `tx% × W × S` on screen while the
scale only exposes `(S − 1) × W / 2` of slack per side, so:

```
|tx| ≤ (S − 1) / 2S
```

`maxPan` grows with `S`, so clamping both endpoints to the limit of the *smaller*
scale keeps every interpolated frame safe too. One consequence: a move ending at
exactly `S = 1.0` has zero pan room, which is why moves are built on a base
overscan (`zoom.zoomBase`) rather than starting from 1.0.

Two details that separate this from a cheap slideshow:

- **Motion continues through the crossfade.** Each layer animates for
  `duration + crossfade`, so the outgoing photo is still moving as it fades.
- **Every photo is decoded before its slide begins**, so the fade never starts
  on a blank layer.

## Development

```bash
npm install
npm run dev    # standalone Ken Burns tuning harness — no Home Assistant needed
npm test       # unit tests
npm run build  # bundle to dist/animated-slideshow-card.js
```

`npm run dev` opens a harness that drives the real controller with locally
generated sample images, over a magenta background so an exposed frame edge is
impossible to miss. Tuning animation feel through a Home Assistant reload cycle
is miserable; this makes it instant, and it works offline.

## Credits

Thanks to [`remy/ha_immich_picture`](https://github.com/remy/ha_immich_picture)
for showing what an Immich slideshow in Home Assistant should feel like. This
card takes a different route — frontend-only, on the core Immich integration —
but supports that project's camera entity as a source.

## License

MIT
