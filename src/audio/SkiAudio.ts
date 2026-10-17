/**
 * Synthesised ambience: wind rush that grows with speed (and weather wind) and the scrape of
 * edges on snow when skidding. Starts on the first user gesture (browser autoplay rules).
 */
export class SkiAudio {
  private ctx: AudioContext | null = null;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private scrapeGain!: GainNode;
  private scrapeFilter!: BiquadFilterNode;
  muted = false;

  constructor() {
    const start = () => {
      if (this.ctx) return;
      try {
        this.init();
      } catch {
        /* audio unavailable */
      }
    };
    window.addEventListener('pointerdown', start, { once: true });
    window.addEventListener('keydown', start, { once: true });
  }

  private init() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    // brown-ish noise is softer than white noise for wind
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.5;
    }
    const src = (buffer: AudioBuffer) => {
      const s = ctx.createBufferSource();
      s.buffer = buffer;
      s.loop = true;
      s.start();
      return s;
    };

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    src(noise).connect(this.windFilter).connect(this.windGain).connect(ctx.destination);

    const white = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const w = white.getChannelData(0);
    for (let i = 0; i < w.length; i++) w[i] = Math.random() * 2 - 1;
    this.scrapeFilter = ctx.createBiquadFilter();
    this.scrapeFilter.type = 'bandpass';
    this.scrapeFilter.Q.value = 0.8;
    this.scrapeGain = ctx.createGain();
    this.scrapeGain.gain.value = 0;
    src(white).connect(this.scrapeFilter).connect(this.scrapeGain).connect(ctx.destination);
  }

  /**
   * @param speed skier speed m/s (0 when not skiing)
   * @param skid sideways skid m/s
   * @param ambientWind weather wind m/s
   * @param icy harder snow = higher pitched scrape
   */
  update(speed: number, skid: number, ambientWind: number, icy: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const m = this.muted ? 0 : 1;
    const rush = Math.min(1, (speed * speed) / 600 + ambientWind / 30);
    this.windGain.gain.setTargetAtTime(rush * 0.35 * m, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(300 + rush * 1800, t, 0.2);
    const scrape = speed > 1 ? Math.min(1, skid / 6) : 0;
    this.scrapeGain.gain.setTargetAtTime(scrape * 0.12 * m, t, 0.08);
    this.scrapeFilter.frequency.setTargetAtTime(icy ? 4200 : 2200, t, 0.2);
  }
}
