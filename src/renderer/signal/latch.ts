// The SDK marks a signal "stable" packet by packet, and the flag flickers: in
// the bundled sample the breathing rate was stable in only 5 packets. A stage
// gate that reads only the latest packet can therefore stall a good sitting.
// A latch remembers the last stable moment and stays ready for a while after.

/** How long a signal counts as ready after it was last reported stable (s). */
export const READY_LATCH_S = 15;

export class ReadyLatch {
  private lastStable = -Infinity;

  /** Record a packet's flag at time t (seconds). */
  update(stable: boolean, t: number): void {
    if (stable) this.lastStable = t;
  }

  /** Ready if the signal was stable within the latch window before t. */
  ready(t: number): boolean {
    return t - this.lastStable <= READY_LATCH_S;
  }

  reset(): void { this.lastStable = -Infinity; }
}
