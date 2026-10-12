// Small synthesized sound effects (no audio files). The context starts on the first user gesture.

export class Sfx {
  constructor() {
    this.ctx = null;
    try {
      this.muted = localStorage.getItem('crossy-muted') === '1';
    } catch {
      this.muted = false;
    }
  }

  unlock() {
    try {
      if (!this.ctx) this.ctx = new AudioContext();
      else if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch { /* audio unavailable */ }
  }

  toggleMute() {
    this.muted = !this.muted;
    try {
      localStorage.setItem('crossy-muted', this.muted ? '1' : '0');
    } catch { /* storage unavailable */ }
    return this.muted;
  }

  tone(type, f0, f1, dur, vol, delay = 0) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise(dur, vol, cutoff) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(filter).connect(g).connect(ctx.destination);
    src.start();
  }

  hop() { this.tone('square', 420, 700, 0.07, 0.04); }
  blocked() { this.tone('square', 170, 120, 0.06, 0.04); }
  coin() {
    this.tone('sine', 988, 988, 0.08, 0.12);
    this.tone('sine', 1319, 1319, 0.2, 0.12, 0.08);
  }
  bell() { this.tone('triangle', 1250, 1240, 0.12, 0.07); }
  squash() {
    this.tone('sine', 190, 45, 0.2, 0.35);
    this.noise(0.12, 0.25, 500);
  }
  splash() { this.noise(0.5, 0.35, 1100); }
  train() {
    this.noise(1.0, 0.3, 320);
    this.tone('sawtooth', 330, 320, 0.5, 0.05);
  }
  eagle() { this.tone('sawtooth', 2100, 900, 0.55, 0.06); }
}
