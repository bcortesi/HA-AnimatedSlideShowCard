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
| `zoom.base` | `1.18` | Overscan floor — **also caps how far the photo can pan**. See [Tuning the motion](#tuning-the-motion). |
| `zoom.max` | `1.55` | Hard ceiling on scale. |
| `zoom.min_delta` | `0.12` | Smallest scale change within one slide. |
| `zoom.max_delta` | `0.32` | Largest scale change within one slide. |
| `pan.min` | `0.7` | Shortest pan, as a fraction of the room `zoom.base` allows. |
| `pan.max` | `1.0` | Longest pan, as a fraction of that room. |
| `pan.min_angle` | `40` | Degrees a pan direction must differ from the previous slide's. |
| `aspect_ratio` | `"16:9"` | Any `"W:H"` — `"1:1"` for a square card — or `fill` to fill a panel with no card chrome. **Quote it.** |
| `refresh_interval` | `3600` | Seconds between asset-list refreshes. |
| `show_filename` | `false` | Caption each photo. Off by default: a static overlay risks burn-in. |
| `pause_when_hidden` | `true` | Stop animating when off-screen or in a background tab. |
| `tap_action` | `fullscreen` | `fullscreen` opens the viewer on tap; `none` disables it. |

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

## Card shape and size

There is no `height` option. Height comes from the width the dashboard gives the
card, plus `aspect_ratio`:

```yaml
aspect_ratio: "1:1"    # square
aspect_ratio: "4:3"    # classic photo
aspect_ratio: "16:9"   # default
aspect_ratio: fill     # fill the space, no card chrome — for panel views
```

**Quote the value.** Unquoted `1:1` is a plain scalar to some YAML parsers and
sexagesimal `61` to others, which would give you a very wide sliver of a card.
Quoting removes the ambiguity. A bare number is accepted too and means `N:1`, so
`aspect_ratio: 1` is also square.

In a **sections** view, `grid_options` sets the card's width in columns; leave
`rows` unset so `aspect_ratio` decides the height, or set `rows` and use
`aspect_ratio: fill` to fill whatever box the grid gives you.

## Fullscreen viewer

Tap or click the card to open the current photo fullscreen. The viewer shows the
picture **whole and still** — no crop, no motion — because the reason to tap a
photo is to look at it properly.

- **Close** — the ✕ button, tapping anywhere off the photo, or `Esc`
- **Navigate** — the ‹ › buttons, or the ← → arrow keys
- The slideshow pauses while the viewer is open and resumes on close, on
  whatever photo you navigated to

Set `tap_action: none` to turn it off.

Two implementation notes, since both are easy to get wrong:

It is built on `<dialog showModal()>` rather than a `position: fixed` overlay. A
Lovelace card sits deep inside a dashboard whose ancestors may carry transforms
or `overflow: hidden`, either of which silently traps a fixed-position element
inside the card. A modal dialog renders in the browser's top layer and escapes
all of it, and brings Escape-to-close and a focus trap along with it.

Stepping back is served from a history of what has already been shown, not from
the playlist — with `order: shuffle` the previous photo is not derivable, it only
exists in the past. That history is capped at 50 entries.

## Tuning the motion

If the movement looks static, the cause is almost always `zoom.base` rather
than `duration`. Panning can only use the slack that overscan creates, so the
furthest a photo can travel is:

```
pan ceiling = (base − 1) / (2 × base)
```

At `base: 1.10` that is **4.5% of the frame**. A move runs from one edge of that
range to the other, so with the default pan fraction a photo travels about 6.8%
over a 28-second slide — roughly **4.7 pixels per second** on a 1920px display,
which reads as static from across a room. Raising `base` is the lever, and it
buys travel at the cost of cropping more of each photo.

| `zoom.base` | Pan ceiling | Typical pan on a 1920px display | Crop |
|---|---|---|---|
| 1.05 | 2.4% | 2.5 px/s | barely any |
| 1.10 | 4.5% | 4.7 px/s | slight |
| 1.18 *(default)* | 7.6% | 8.9 px/s | 15% |
| 1.25 | 10.0% | 12.3 px/s | 20% |
| 1.40 | 14.3% | 17.6 px/s | 29% |

Rates assume the default 25s slide with a 3s crossfade, so a 28-second move.

Three starting points:

```yaml
# Subtle — a photo frame that does not draw the eye
zoom: { base: 1.06, max: 1.20, min_delta: 0.05, max_delta: 0.12 }
pan:  { min: 0.4, max: 0.8 }
duration: 30

# Default — visible motion, modest crop
zoom: { base: 1.18, max: 1.55, min_delta: 0.12, max_delta: 0.32 }
pan:  { min: 0.7, max: 1.0 }
duration: 25

# Cinematic — obvious, documentary-style movement
zoom: { base: 1.25, max: 1.70, min_delta: 0.18, max_delta: 0.40 }
pan:  { min: 0.8, max: 1.0 }
duration: 18
```

Shortening `duration` also speeds everything up, since the move always spans
`duration + crossfade`.

`npm run dev` gives you all of these as live sliders, with a readout of the
resulting pan rate in **pixels per second** and the matching YAML to paste into
your dashboard.

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
overscan (`zoom.base`) rather than starting from 1.0.

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
