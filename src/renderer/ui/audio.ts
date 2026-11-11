// A soft "lub-dub" for each beat, so the sitting can be heard as well as seen.
export class Heartbeat {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  enabled = true;
  volume = 0.5;

  private ensure(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  /** Play one beat `delay` seconds from now. */
  beat(delay = 0): void {
    if (!this.enabled) return;
    const ctx = this.ensure();
    const t = ctx.currentTime + Math.max(0, delay);
    this.gain!.gain.value = this.volume;
    this.thump(t, 58, 0.9);
    this.thump(t + 0.16, 52, 0.55);
  }

  private thump(t: number, freq: number, level: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 1.6, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.05);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(level, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(env).connect(this.gain!);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
  }
}
