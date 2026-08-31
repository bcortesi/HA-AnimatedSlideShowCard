/**
 * A fixed list of URLs.
 *
 * Exists mainly so the standalone tuning harness in `dev/` can drive the real
 * controller without Home Assistant, but it is a legitimate card source too.
 */

import type { Slide, SlideSource, UrlsSourceConfig } from "../types";

export class UrlsSource implements SlideSource {
  readonly refreshInterval = 0;

  constructor(private readonly config: UrlsSourceConfig) {}

  async load(): Promise<Slide[]> {
    const urls = this.config.urls ?? [];
    if (urls.length === 0) throw new Error("`urls` is empty.");
    return urls.map((url, index) => ({ id: url, title: titleFor(url, index) }));
  }

  async urlFor(slide: Slide): Promise<string> {
    return slide.id;
  }
}

/**
 * A caption worth showing.
 *
 * A data URI has no filename, and its "last path segment" is the entire
 * payload — which would spill megabytes of base64 into the caption. Query
 * strings are stripped for the same reason: signed URLs carry long signatures.
 */
function titleFor(url: string, index: number): string {
  if (url.startsWith("data:")) return `Image ${index + 1}`;

  const withoutQuery = url.split("?")[0];
  const name = withoutQuery.split("/").filter(Boolean).pop();
  return name && name.length <= 80 ? name : `Image ${index + 1}`;
}
