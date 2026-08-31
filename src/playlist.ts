/**
 * Slide ordering.
 *
 * Pure and storage-free, so the traversal rules can be tested without any
 * network or DOM involvement.
 */

export type PlaylistOrder = "shuffle" | "random" | "sequential";

export type Random = () => number;

/** Fisher-Yates, on a copy. */
export function shuffled<T>(items: readonly T[], rnd: Random = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * An endless sequence over a set of items.
 *
 * `shuffle` is the default and the only mode that guarantees every photo is
 * seen once before any repeats: it walks a shuffled permutation, reshuffles at
 * the end, and re-rolls if the new cycle would start with the item that just
 * played. `random` picks independently each time (repeats are possible);
 * `sequential` preserves source order.
 */
export class Playlist<T> {
  private items: T[] = [];
  private cycle: T[] = [];
  private position = 0;
  private lastServed: T | undefined;

  constructor(
    items: readonly T[] = [],
    private order: PlaylistOrder = "shuffle",
    private readonly rnd: Random = Math.random,
  ) {
    this.replace(items);
  }

  get length(): number {
    return this.items.length;
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  /**
   * Switch traversal mode. Unlike `replace`, this is a deliberate config change
   * rather than a background refresh, so it restarts the ordering cleanly.
   */
  setOrder(order: PlaylistOrder): void {
    if (order === this.order) return;
    this.order = order;
    this.rebuildCycle(true);
  }

  /**
   * Swap in a new set of items, as happens when the asset list is refreshed.
   * Deliberately preserves progress for `sequential`, so an hourly refresh does
   * not jump an unattended display back to the first photo.
   */
  replace(items: readonly T[]): void {
    this.items = items.slice();
    this.rebuildCycle(this.order !== "sequential");
  }

  /** The next item, or undefined when there is nothing to show. */
  next(): T | undefined {
    if (this.isEmpty) return undefined;

    if (this.order === "random") {
      const item = this.items[Math.floor(this.rnd() * this.items.length)];
      this.lastServed = item;
      return item;
    }

    if (this.position >= this.cycle.length) {
      this.rebuildCycle(true);
    }

    const item = this.cycle[this.position++];
    this.lastServed = item;
    return item;
  }

  /**
   * Look ahead without consuming, for preloading. Only meaningful for the
   * ordered modes; `random` cannot be predicted, so it returns nothing.
   */
  peek(count: number): T[] {
    if (this.isEmpty || this.order === "random") return [];

    const out: T[] = [];
    for (let i = 0; i < count; i++) {
      const index = this.position + i;
      if (index < this.cycle.length) {
        out.push(this.cycle[index]);
      } else if (this.items.length > 0) {
        // Beyond the current cycle the next permutation is not decided yet;
        // stop rather than guess.
        break;
      }
    }
    return out;
  }

  private rebuildCycle(resetPosition: boolean): void {
    if (this.order === "sequential") {
      this.cycle = this.items.slice();
      if (resetPosition || this.position >= this.cycle.length) this.position = 0;
      return;
    }

    if (this.items.length <= 1) {
      this.cycle = this.items.slice();
      this.position = 0;
      return;
    }

    // Avoid an immediate repeat across the cycle boundary.
    let candidate = shuffled(this.items, this.rnd);
    for (let attempt = 0; attempt < 5; attempt++) {
      if (this.lastServed === undefined || candidate[0] !== this.lastServed) break;
      candidate = shuffled(this.items, this.rnd);
    }

    this.cycle = candidate;
    this.position = 0;
  }
}
