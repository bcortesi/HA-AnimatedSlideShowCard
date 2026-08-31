/**
 * Locally generated sample photos for the tuning harness.
 *
 * Deliberately not fetched from a photo service: the harness must work offline,
 * load instantly, and look identical on every run, so that a change in how the
 * motion looks is always a change you made rather than a different photo.
 *
 * Each sample is built to make motion legible and mistakes obvious:
 *   - a grid, so pan and zoom are visible even on a flat colour
 *   - corner and edge markers, so an exposed frame edge is unmistakable
 *   - a mix of landscape, portrait and square, since the `fit` modes only
 *     differ when the photo and the frame disagree on orientation
 */

interface SampleSpec {
  label: string;
  width: number;
  height: number;
  hue: number;
}

const SAMPLES: SampleSpec[] = [
  { label: "1 · landscape", width: 1600, height: 900, hue: 205 },
  { label: "2 · portrait", width: 900, height: 1600, hue: 15 },
  { label: "3 · landscape", width: 1920, height: 1080, hue: 145 },
  { label: "4 · square", width: 1200, height: 1200, hue: 275 },
  { label: "5 · portrait", width: 1000, height: 1500, hue: 45 },
  { label: "6 · wide", width: 2000, height: 900, hue: 330 },
];

function buildSvg({ label, width, height, hue }: SampleSpec): string {
  const step = Math.round(Math.min(width, height) / 12);
  const inset = Math.round(Math.min(width, height) * 0.02);
  const fontSize = Math.round(Math.min(width, height) * 0.09);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hue} 65% 42%)"/>
      <stop offset="100%" stop-color="hsl(${(hue + 45) % 360} 70% 18%)"/>
    </linearGradient>
    <pattern id="grid" width="${step}" height="${step}" patternUnits="userSpaceOnUse">
      <path d="M ${step} 0 L 0 0 0 ${step}" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="2"/>
    </pattern>
  </defs>

  <rect width="100%" height="100%" fill="url(#g)"/>
  <rect width="100%" height="100%" fill="url(#grid)"/>

  <!-- Edge band: if any of this is cropped away the move is still safe; if
       magenta appears beyond it, the move exposed the frame. -->
  <rect x="${inset}" y="${inset}" width="${width - inset * 2}" height="${height - inset * 2}"
        fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="${Math.max(3, inset / 3)}"/>

  <circle cx="${inset * 3}" cy="${inset * 3}" r="${inset * 1.4}" fill="#fff"/>
  <circle cx="${width - inset * 3}" cy="${inset * 3}" r="${inset * 1.4}" fill="#fff"/>
  <circle cx="${inset * 3}" cy="${height - inset * 3}" r="${inset * 1.4}" fill="#fff"/>
  <circle cx="${width - inset * 3}" cy="${height - inset * 3}" r="${inset * 1.4}" fill="#fff"/>

  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
        font-family="system-ui, sans-serif" font-size="${fontSize}" font-weight="700"
        fill="rgba(255,255,255,0.92)">${label}</text>
  <text x="50%" y="${height / 2 + fontSize}" text-anchor="middle" dominant-baseline="central"
        font-family="system-ui, sans-serif" font-size="${fontSize * 0.4}"
        fill="rgba(255,255,255,0.65)">${width} x ${height}</text>
</svg>`;
}

function toDataUri(svg: string): string {
  // encodeURIComponent rather than base64: it keeps the payload readable in
  // devtools, which matters when debugging why a sample will not decode.
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const SAMPLE_PHOTOS: string[] = SAMPLES.map((spec) => toDataUri(buildSvg(spec)));
