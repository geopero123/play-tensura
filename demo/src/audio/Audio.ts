/**
 * Fully procedural WebAudio engine: synthesized SFX, layered ambience and a
 * small sequencer that crossfades between exploration / combat / boss music.
 * No external assets are needed, so everything is original and license-free.
 */
import { clamp, rand, pick } from '../core/Math';

type Ctx = AudioContext;

export type MusicState = 'none' | 'title' | 'explore' | 'combat' | 'boss' | 'boss3' | 'victory';

export class AudioEngine {
  ctx!: Ctx;
  master!: GainNode;
  sfx!: GainNode;
  music!: GainNode;
  amb!: GainNode;
  ready = false;
  private noiseBuf!: AudioBuffer;
  private musicState: MusicState = 'none';
  private layers: Record<string, GainNode> = {};
  private seqTimer = 0;
  private nextNoteTime = 0;
  private step = 0;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private waterGain!: GainNode;
  private stormGain!: GainNode;
  private birdTimer = 0;
  private lastFoot = 0;
  private convolver!: ConvolverNode;
  private reverbGain!: GainNode;
  volumes = { master: 0.8, music: 0.7, sfx: 0.9 };
  private musicTarget = 1;

  init() {
    if (this.ready) return;
    const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = this.volumes.master;
    // soft limiter
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 20;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.master.connect(comp).connect(c.destination);
    this.sfx = c.createGain(); this.sfx.gain.value = this.volumes.sfx; this.sfx.connect(this.master);
    this.music = c.createGain(); this.music.gain.value = this.volumes.music; this.music.connect(this.master);
    this.amb = c.createGain(); this.amb.gain.value = 0.9; this.amb.connect(this.master);
    // reverb send
    this.convolver = c.createConvolver();
    this.convolver.buffer = this.makeImpulse(2.2, 2.5);
    this.reverbGain = c.createGain(); this.reverbGain.gain.value = 0.28;
    this.convolver.connect(this.reverbGain).connect(this.master);

    // noise buffer
    const len = c.sampleRate * 2;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this.setupAmbience();
    this.ready = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolumes(master: number, music: number, sfx: number) {
    this.volumes = { master, music, sfx };
    if (!this.ready) return;
    this.master.gain.setTargetAtTime(master, this.ctx.currentTime, 0.05);
    this.music.gain.setTargetAtTime(music * this.musicTarget, this.ctx.currentTime, 0.05);
    this.sfx.gain.setTargetAtTime(sfx, this.ctx.currentTime, 0.05);
  }

  private makeImpulse(seconds: number, decay: number) {
    const c = this.ctx;
    const rate = c.sampleRate;
    const len = rate * seconds;
    const buf = c.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  // ---------- primitives ----------
  private noise(dur: number, opts: { freq?: number; q?: number; type?: BiquadFilterType; gain?: number; attack?: number; decay?: number; freqEnd?: number; reverb?: number; pan?: number } = {}) {
    if (!this.ready) return;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = rand(0.9, 1.1);
    const f = c.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.value = opts.freq ?? 1000;
    if (opts.freqEnd !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freqEnd), c.currentTime + dur);
    f.Q.value = opts.q ?? 0.8;
    const g = c.createGain();
    const t = c.currentTime;
    const a = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.5, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + (opts.decay ?? dur));
    src.connect(f).connect(g);
    const pan = c.createStereoPanner();
    pan.pan.value = opts.pan ?? 0;
    g.connect(pan).connect(this.sfx);
    if (opts.reverb) { const rg = c.createGain(); rg.gain.value = opts.reverb; g.connect(rg).connect(this.convolver); }
    src.start(t);
    src.stop(t + a + (opts.decay ?? dur) + 0.05);
  }

  private tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; freqEnd?: number; attack?: number; detune?: number; reverb?: number; delay?: number; dest?: AudioNode; vibrato?: number } = {}) {
    if (!this.ready) return;
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = opts.type ?? 'sine';
    const t = c.currentTime + (opts.delay ?? 0);
    o.frequency.setValueAtTime(freq, t);
    if (opts.freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freqEnd), t + dur);
    if (opts.detune) o.detune.value = opts.detune;
    if (opts.vibrato) {
      const lfo = c.createOscillator(); lfo.frequency.value = 6;
      const lg = c.createGain(); lg.gain.value = opts.vibrato;
      lfo.connect(lg).connect(o.frequency); lfo.start(t); lfo.stop(t + dur + 0.1);
    }
    const g = c.createGain();
    const a = opts.attack ?? 0.01;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.2, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(opts.dest ?? this.sfx);
    if (opts.reverb) { const rg = c.createGain(); rg.gain.value = opts.reverb; g.connect(rg).connect(this.convolver); }
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ---------- named SFX ----------
  play(name: string, opts: { volume?: number; pan?: number } = {}) {
    if (!this.ready) return;
    const v = opts.volume ?? 1;
    const pan = opts.pan ?? 0;
    switch (name) {
      case 'footstep': {
        const t = performance.now();
        if (t - this.lastFoot < 60) return;
        this.lastFoot = t;
        this.noise(0.08, { freq: rand(300, 500), q: 1.2, gain: 0.12 * v, decay: 0.07, type: 'lowpass' });
        break;
      }
      case 'jump': this.noise(0.18, { freq: 600, freqEnd: 1800, gain: 0.18 * v, decay: 0.16 }); this.tone(220, 0.15, { type: 'sine', freqEnd: 480, gain: 0.08 * v }); break;
      case 'land': this.noise(0.2, { freq: 260, type: 'lowpass', gain: 0.35 * v, decay: 0.18, q: 1 }); break;
      case 'dash': this.noise(0.3, { freq: 2400, freqEnd: 400, gain: 0.28 * v, decay: 0.28, q: 0.6, reverb: 0.3 }); this.tone(900, 0.2, { type: 'sawtooth', freqEnd: 200, gain: 0.05 * v }); break;
      case 'slash': this.noise(0.16, { freq: rand(2800, 3600), freqEnd: 900, gain: 0.3 * v, decay: 0.14, q: 0.9 }); this.tone(1800, 0.08, { type: 'triangle', freqEnd: 600, gain: 0.05 * v }); break;
      case 'slashHeavy': this.noise(0.3, { freq: 1800, freqEnd: 300, gain: 0.45 * v, decay: 0.28, q: 0.7 }); this.tone(320, 0.25, { type: 'sawtooth', freqEnd: 60, gain: 0.12 * v }); break;
      case 'hit': this.noise(0.12, { freq: 900, freqEnd: 200, gain: 0.5 * v, decay: 0.1, q: 0.5, type: 'lowpass', pan }); this.tone(180, 0.09, { type: 'square', freqEnd: 60, gain: 0.15 * v }); break;
      case 'hitHeavy': this.noise(0.25, { freq: 500, freqEnd: 80, gain: 0.7 * v, decay: 0.22, type: 'lowpass', reverb: 0.4, pan }); this.tone(110, 0.22, { type: 'square', freqEnd: 40, gain: 0.25 * v }); break;
      case 'crit': this.play('hitHeavy', { volume: v }); this.tone(1200, 0.25, { type: 'sine', freqEnd: 2400, gain: 0.12 * v, reverb: 0.5 }); this.tone(1800, 0.3, { type: 'sine', freqEnd: 3600, gain: 0.08 * v, delay: 0.03 }); break;
      case 'hurt': this.noise(0.18, { freq: 700, freqEnd: 150, gain: 0.4 * v, decay: 0.16, type: 'lowpass' }); this.tone(400, 0.2, { type: 'sawtooth', freqEnd: 150, gain: 0.1 * v }); break;
      case 'cast': this.tone(440, 0.5, { type: 'sine', freqEnd: 1320, gain: 0.12 * v, reverb: 0.6 }); this.noise(0.5, { freq: 1500, freqEnd: 5000, gain: 0.08 * v, decay: 0.45, q: 2, reverb: 0.5 }); break;
      case 'chargeUp': this.tone(110, 1.2, { type: 'sawtooth', freqEnd: 880, gain: 0.12 * v, reverb: 0.5, attack: 0.3 }); this.noise(1.2, { freq: 400, freqEnd: 6000, gain: 0.15 * v, decay: 1.1, q: 3, attack: 0.2 }); break;
      case 'water': this.noise(0.35, { freq: 2200, freqEnd: 900, gain: 0.35 * v, decay: 0.32, q: 0.6, reverb: 0.4 }); this.tone(880, 0.25, { type: 'sine', freqEnd: 1760, gain: 0.08 * v }); this.tone(1320, 0.3, { type: 'sine', freqEnd: 2600, gain: 0.05 * v, delay: 0.04 }); break;
      case 'waterHit': this.noise(0.3, { freq: 1200, freqEnd: 300, gain: 0.4 * v, decay: 0.28, q: 0.8, pan }); break;
      case 'fire': this.noise(0.6, { freq: 700, freqEnd: 1800, gain: 0.35 * v, decay: 0.55, q: 0.5, type: 'bandpass', reverb: 0.3 }); this.tone(90, 0.5, { type: 'sawtooth', freqEnd: 50, gain: 0.15 * v }); break;
      case 'fireHit': this.noise(0.35, { freq: 400, freqEnd: 100, gain: 0.5 * v, decay: 0.32, type: 'lowpass', reverb: 0.4, pan }); this.noise(0.4, { freq: 3000, gain: 0.1 * v, decay: 0.35, q: 1 }); break;
      case 'wind': this.noise(0.4, { freq: 1200, freqEnd: 3500, gain: 0.3 * v, decay: 0.35, q: 1.2, reverb: 0.4, pan }); break;
      case 'windHit': this.noise(0.15, { freq: 3500, freqEnd: 1200, gain: 0.35 * v, decay: 0.13, q: 0.8, pan }); break;
      case 'lightningCharge': this.tone(60, 1.0, { type: 'sawtooth', freqEnd: 240, gain: 0.15 * v, reverb: 0.6 }); this.noise(1.0, { freq: 200, freqEnd: 3000, gain: 0.12 * v, decay: 0.95, q: 4, attack: 0.15 }); break;
      case 'lightning': this.noise(0.9, { freq: 6000, freqEnd: 120, gain: 0.9 * v, decay: 0.85, q: 0.4, reverb: 0.8 }); this.tone(70, 0.8, { type: 'square', freqEnd: 30, gain: 0.3 * v }); this.noise(1.6, { freq: 150, type: 'lowpass', gain: 0.5 * v, decay: 1.5, attack: 0.05, reverb: 0.6 }); break;
      case 'absorb': this.tone(220, 0.9, { type: 'sawtooth', freqEnd: 55, gain: 0.15 * v, reverb: 0.7 }); this.noise(0.9, { freq: 2000, freqEnd: 200, gain: 0.25 * v, decay: 0.85, q: 1.5, reverb: 0.5 }); break;
      case 'absorbDone': this.tone(660, 0.4, { type: 'sine', gain: 0.15 * v, reverb: 0.6 }); this.tone(880, 0.5, { type: 'sine', gain: 0.15 * v, delay: 0.08, reverb: 0.6 }); this.tone(1320, 0.7, { type: 'sine', gain: 0.12 * v, delay: 0.16, reverb: 0.7 }); break;
      case 'meteorCharge': this.tone(40, 2.2, { type: 'sawtooth', freqEnd: 160, gain: 0.25 * v, reverb: 0.8, attack: 0.5 }); this.noise(2.2, { freq: 300, freqEnd: 5000, gain: 0.2 * v, decay: 2.1, q: 2, attack: 0.4, reverb: 0.5 }); break;
      case 'meteorFall': this.noise(1.2, { freq: 400, freqEnd: 2500, gain: 0.5 * v, decay: 1.1, q: 0.6, attack: 0.3 }); break;
      case 'explosion': this.noise(1.4, { freq: 300, freqEnd: 40, gain: 1.0 * v, decay: 1.3, type: 'lowpass', reverb: 0.9 }); this.tone(50, 1.2, { type: 'sine', freqEnd: 20, gain: 0.5 * v }); this.noise(0.5, { freq: 4000, freqEnd: 800, gain: 0.4 * v, decay: 0.45, q: 0.5 }); break;
      case 'shockwave': this.noise(0.6, { freq: 600, freqEnd: 60, gain: 0.55 * v, decay: 0.55, type: 'lowpass', reverb: 0.5 }); break;
      case 'perfectDodge': this.tone(1760, 0.5, { type: 'sine', freqEnd: 880, gain: 0.15 * v, reverb: 0.8 }); this.noise(0.5, { freq: 5000, freqEnd: 1000, gain: 0.2 * v, decay: 0.45, q: 1.5 }); break;
      case 'ui': this.tone(1200, 0.06, { type: 'sine', gain: 0.08 * v }); break;
      case 'uiHover': this.tone(1600, 0.04, { type: 'sine', gain: 0.04 * v }); break;
      case 'uiConfirm': this.tone(880, 0.15, { type: 'sine', gain: 0.1 * v, reverb: 0.5 }); this.tone(1320, 0.25, { type: 'sine', gain: 0.1 * v, delay: 0.06, reverb: 0.5 }); break;
      case 'uiBack': this.tone(660, 0.12, { type: 'sine', freqEnd: 440, gain: 0.08 * v }); break;
      case 'levelup': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.6, { type: 'triangle', gain: 0.12 * v, delay: i * 0.09, reverb: 0.7 })); break;
      case 'acquire': [392, 523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.9, { type: 'sine', gain: 0.1 * v, delay: i * 0.07, reverb: 0.8 })); this.noise(1.2, { freq: 3000, freqEnd: 8000, gain: 0.08 * v, decay: 1.1, q: 2, reverb: 0.6 }); break;
      case 'evolve': [220, 330, 440, 554, 659, 880, 1108, 1318].forEach((f, i) => this.tone(f, 1.4, { type: 'sawtooth', gain: 0.05 * v, delay: i * 0.08, reverb: 0.9, detune: 5 })); this.tone(55, 2.0, { type: 'sine', freqEnd: 110, gain: 0.25 * v, reverb: 0.8 }); break;
      case 'analyze': this.tone(1000, 0.08, { type: 'square', gain: 0.03 * v }); this.tone(1500, 0.08, { type: 'square', gain: 0.03 * v, delay: 0.1 }); break;
      case 'system': this.tone(660, 0.3, { type: 'sine', gain: 0.08 * v, reverb: 0.7 }); this.tone(990, 0.4, { type: 'sine', gain: 0.06 * v, delay: 0.12, reverb: 0.7 }); break;
      case 'howl': this.tone(300, 1.6, { type: 'sawtooth', freqEnd: 520, gain: 0.18 * v, reverb: 0.9, vibrato: 12, attack: 0.3 }); this.tone(150, 1.6, { type: 'sawtooth', freqEnd: 260, gain: 0.12 * v, reverb: 0.9, attack: 0.3 }); this.noise(1.6, { freq: 800, freqEnd: 1600, gain: 0.12 * v, decay: 1.5, q: 2, attack: 0.3 }); break;
      case 'growl': this.tone(90, 0.5, { type: 'sawtooth', freqEnd: 70, gain: 0.15 * v, vibrato: 20 }); this.noise(0.5, { freq: 300, gain: 0.15 * v, decay: 0.45, q: 1 }); break;
      case 'goblin': this.tone(rand(280, 360), 0.22, { type: 'square', freqEnd: 200, gain: 0.08 * v, vibrato: 15 }); this.noise(0.2, { freq: 1500, gain: 0.08 * v, decay: 0.18 }); break;
      case 'slime': this.noise(0.2, { freq: 500, freqEnd: 1400, gain: 0.15 * v, decay: 0.18, q: 2, type: 'bandpass' }); this.tone(300, 0.18, { type: 'sine', freqEnd: 600, gain: 0.06 * v }); break;
      case 'wisp': this.tone(rand(900, 1300), 0.4, { type: 'sine', freqEnd: 1800, gain: 0.06 * v, reverb: 0.8, vibrato: 30 }); break;
      case 'bolt': this.tone(600, 0.3, { type: 'sawtooth', freqEnd: 200, gain: 0.08 * v }); this.noise(0.25, { freq: 2500, freqEnd: 500, gain: 0.15 * v, decay: 0.22 }); break;
      case 'death': this.noise(0.6, { freq: 800, freqEnd: 100, gain: 0.35 * v, decay: 0.55, type: 'lowpass', reverb: 0.5, pan }); this.tone(200, 0.5, { type: 'sawtooth', freqEnd: 40, gain: 0.1 * v }); break;
      case 'pickup': this.tone(1046, 0.15, { type: 'sine', gain: 0.1 * v }); this.tone(1568, 0.3, { type: 'sine', gain: 0.1 * v, delay: 0.07, reverb: 0.5 }); break;
      case 'phase': this.noise(1.2, { freq: 100, freqEnd: 2000, gain: 0.4 * v, decay: 1.1, q: 1.5, attack: 0.3, reverb: 0.8 }); this.tone(40, 1.5, { type: 'sine', freqEnd: 80, gain: 0.4 * v, reverb: 0.8 }); break;
      case 'launch': this.noise(0.3, { freq: 600, freqEnd: 3000, gain: 0.35 * v, decay: 0.28, q: 0.8 }); this.tone(150, 0.3, { type: 'sine', freqEnd: 900, gain: 0.12 * v }); break;
      case 'slam': this.noise(0.4, { freq: 300, freqEnd: 50, gain: 0.8 * v, decay: 0.38, type: 'lowpass', reverb: 0.5 }); this.tone(60, 0.35, { type: 'sine', freqEnd: 25, gain: 0.35 * v }); break;
      case 'talk': this.tone(rand(500, 700), 0.05, { type: 'triangle', gain: 0.05 * v }); break;
      case 'crystal': this.tone(1568, 1.2, { type: 'sine', gain: 0.08 * v, reverb: 0.9, vibrato: 4 }); this.tone(2093, 1.4, { type: 'sine', gain: 0.05 * v, delay: 0.1, reverb: 0.9 }); break;
    }
  }

  // ---------- ambience ----------
  private setupAmbience() {
    const c = this.ctx;
    // wind
    const w = c.createBufferSource(); w.buffer = this.noiseBuf; w.loop = true;
    this.windFilter = c.createBiquadFilter(); this.windFilter.type = 'lowpass'; this.windFilter.frequency.value = 420; this.windFilter.Q.value = 0.7;
    this.windGain = c.createGain(); this.windGain.gain.value = 0.08;
    w.connect(this.windFilter).connect(this.windGain).connect(this.amb);
    w.start();
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07;
    const lg = c.createGain(); lg.gain.value = 180;
    lfo.connect(lg).connect(this.windFilter.frequency); lfo.start();
    // water
    const ws = c.createBufferSource(); ws.buffer = this.noiseBuf; ws.loop = true; ws.playbackRate.value = 0.8;
    const wf = c.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 1800; wf.Q.value = 0.5;
    this.waterGain = c.createGain(); this.waterGain.gain.value = 0;
    ws.connect(wf).connect(this.waterGain).connect(this.amb); ws.start();
    // storm rumble
    const ss = c.createBufferSource(); ss.buffer = this.noiseBuf; ss.loop = true; ss.playbackRate.value = 0.4;
    const sf = c.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 120;
    this.stormGain = c.createGain(); this.stormGain.gain.value = 0;
    ss.connect(sf).connect(this.stormGain).connect(this.amb); ss.start();
  }

  /** wind 0..1, water 0..1, storm 0..1 */
  setAmbience(wind: number, water: number, storm: number) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.05 + wind * 0.25, t, 0.5);
    this.windFilter.frequency.setTargetAtTime(380 + wind * 900, t, 0.5);
    this.waterGain.gain.setTargetAtTime(water * 0.35, t, 0.4);
    this.stormGain.gain.setTargetAtTime(storm * 0.9, t, 0.6);
  }

  // ---------- music ----------
  private chordProgressions: Record<string, number[][]> = {
    // frequencies as MIDI note numbers
    title: [[57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65], [52, 55, 59, 62]],
    explore: [[57, 60, 64, 67], [62, 65, 69, 72], [55, 59, 62, 66], [60, 64, 67, 71]],
    combat: [[45, 52, 57, 60], [48, 55, 60, 63], [43, 50, 55, 58], [50, 53, 57, 60]],
    boss: [[40, 47, 52, 55], [41, 48, 53, 56], [38, 45, 50, 53], [43, 46, 50, 53]],
    boss3: [[40, 47, 52, 55], [46, 49, 53, 56], [44, 51, 56, 59], [43, 46, 50, 53]],
    victory: [[60, 64, 67, 72], [65, 69, 72, 77], [67, 71, 74, 79], [60, 64, 67, 72]],
  };
  private midi(n: number) { return 440 * Math.pow(2, (n - 69) / 12); }

  setMusic(state: MusicState) {
    if (state === this.musicState) return;
    this.musicState = state;
    this.step = 0;
    if (this.ready) this.nextNoteTime = this.ctx.currentTime + 0.1;
  }
  get currentMusic() { return this.musicState; }

  /** Duck music temporarily (0..1) */
  duckMusic(target: number, seconds = 0.4) {
    if (!this.ready) return;
    this.musicTarget = target;
    this.music.gain.setTargetAtTime(this.volumes.music * target, this.ctx.currentTime, seconds);
  }

  update(dt: number) {
    if (!this.ready || this.musicState === 'none') return;
    const c = this.ctx;
    const st = this.musicState;
    const bpm = st === 'combat' ? 138 : st === 'boss' ? 150 : st === 'boss3' ? 168 : st === 'victory' ? 110 : 76;
    const stepDur = 60 / bpm / 2; // 8th notes
    while (this.nextNoteTime < c.currentTime + 0.25) {
      this.scheduleStep(this.step, this.nextNoteTime, stepDur, st);
      this.nextNoteTime += stepDur;
      this.step++;
    }
    // birds in explore
    this.birdTimer -= dt;
    if (this.birdTimer <= 0 && (st === 'explore' || st === 'title')) {
      this.birdTimer = rand(2, 7);
      const base = rand(2000, 3200);
      for (let i = 0; i < 3 + Math.floor(rand(0, 4)); i++) {
        this.tone(base * rand(0.9, 1.15), 0.09, { type: 'sine', freqEnd: base * rand(1.1, 1.5), gain: 0.02, delay: i * rand(0.08, 0.16), reverb: 0.5 });
      }
    }
  }

  private scheduleStep(step: number, t: number, dur: number, st: MusicState) {
    const prog = this.chordProgressions[st] ?? this.chordProgressions.explore;
    const bar = Math.floor(step / 16) % prog.length;
    const chord = prog[bar];
    const s16 = step % 16;
    const dest = this.music;
    if (st === 'explore' || st === 'title') {
      // pad: each bar sustained chord, soft triangles
      if (s16 === 0) chord.forEach((n, i) => this.tone(this.midi(n), dur * 16.5, { type: 'triangle', gain: 0.05, attack: 0.9, dest, reverb: 0.9, detune: i * 3 }));
      // arpeggio: sparkling sine plucks
      if (s16 % 2 === 0) {
        const n = chord[(s16 / 2) % chord.length] + 12;
        this.tone(this.midi(n), dur * 1.8, { type: 'sine', gain: 0.045, attack: 0.005, dest, reverb: 0.8 });
      }
      if (s16 === 8 && Math.random() < 0.6) this.tone(this.midi(chord[2] + 24), dur * 3, { type: 'sine', gain: 0.03, attack: 0.05, dest, reverb: 0.9 });
    } else if (st === 'combat') {
      // driving bass pulse
      if (s16 % 2 === 0) this.tone(this.midi(chord[0] - 12), dur * 0.9, { type: 'sawtooth', gain: 0.07, attack: 0.005, dest });
      if (s16 % 4 === 2) this.tone(this.midi(chord[0]), dur * 0.5, { type: 'square', gain: 0.03, dest });
      // arps
      const n = chord[s16 % chord.length] + 12 + (s16 >= 8 ? 12 : 0);
      this.tone(this.midi(n), dur * 1.2, { type: 'sawtooth', gain: 0.03, attack: 0.005, dest, reverb: 0.4 });
      // drums via noise
      if (s16 % 4 === 0) this.kick(t);
      if (s16 % 8 === 4) this.snare(t);
      if (s16 % 2 === 1) this.hat(t, 0.03);
      if (s16 === 0) chord.forEach((c, i) => this.tone(this.midi(c + 12), dur * 8, { type: 'triangle', gain: 0.02, attack: 0.3, dest, reverb: 0.7, detune: i * 4 }));
    } else if (st === 'boss' || st === 'boss3') {
      const intense = st === 'boss3';
      if (s16 % 2 === 0) this.tone(this.midi(chord[0] - 12), dur * 0.95, { type: 'sawtooth', gain: 0.09, attack: 0.004, dest, detune: -8 });
      if (s16 % 2 === 0) this.tone(this.midi(chord[0] - 12) * 1.005, dur * 0.95, { type: 'sawtooth', gain: 0.05, attack: 0.004, dest });
      const pattern = intense ? [0, 1, 2, 3, 2, 1, 3, 0] : [0, 2, 1, 3];
      const n = chord[pattern[s16 % pattern.length]] + 24;
      this.tone(this.midi(n), dur * 1.1, { type: 'square', gain: 0.025, attack: 0.004, dest, reverb: 0.5 });
      if (intense && s16 % 2 === 1) this.tone(this.midi(n + 7), dur * 0.8, { type: 'sawtooth', gain: 0.02, dest });
      if (s16 % 4 === 0) this.kick(t, 0.5);
      if (intense && s16 % 4 === 2) this.kick(t, 0.35);
      if (s16 % 8 === 4) this.snare(t, 0.35);
      if (intense && s16 % 8 === 7) this.snare(t, 0.2);
      this.hat(t, s16 % 2 === 0 ? 0.035 : 0.02);
      // choir-like pads
      if (s16 === 0) chord.forEach((c, i) => { this.tone(this.midi(c + 12), dur * 16, { type: 'sawtooth', gain: 0.018, attack: 0.6, dest, reverb: 0.9, detune: i * 6 - 9 }); this.tone(this.midi(c + 12), dur * 16, { type: 'sawtooth', gain: 0.018, attack: 0.6, dest, reverb: 0.9, detune: -i * 6 + 9 }); });
    } else if (st === 'victory') {
      if (s16 === 0) chord.forEach((n, i) => this.tone(this.midi(n), dur * 16, { type: 'triangle', gain: 0.06, attack: 0.4, dest, reverb: 0.9, detune: i * 3 }));
      if (s16 % 2 === 0) this.tone(this.midi(chord[(s16 / 2) % chord.length] + 12), dur * 2, { type: 'sine', gain: 0.05, dest, reverb: 0.8 });
    }
  }

  private kick(t: number, g = 0.4) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const gn = c.createGain();
    gn.gain.setValueAtTime(g, t);
    gn.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(gn).connect(this.music);
    o.start(t); o.stop(t + 0.3);
  }
  private snare(t: number, g = 0.25) {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1800;
    const gn = c.createGain();
    gn.gain.setValueAtTime(g, t);
    gn.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    s.connect(f).connect(gn).connect(this.music);
    s.start(t); s.stop(t + 0.2);
  }
  private hat(t: number, g = 0.03) {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
    const gn = c.createGain();
    gn.gain.setValueAtTime(g, t);
    gn.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    s.connect(f).connect(gn).connect(this.music);
    s.start(t); s.stop(t + 0.06);
  }
}

export const audio = new AudioEngine();
export const sfx = (name: string, volume = 1, pan = 0) => audio.play(name, { volume: clamp(volume, 0, 2), pan });
export { pick };
