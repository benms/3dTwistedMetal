import { clamp, distance } from './math';
import type { GameEvent, Vehicle } from './types';

export class GameAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private engineGain?: GainNode;
  private engine?: OscillatorNode;
  private noise?: AudioBuffer;
  private voices = 0;
  muted = false;

  async unlock(): Promise<void> {
    try {
      if (!this.context) {
        const ctx = new AudioContext();
        this.context = ctx;
        this.master = ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.23;
        this.master.connect(ctx.destination);
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 420;
        filter.connect(this.master);
        this.engineGain = ctx.createGain();
        this.engineGain.gain.value = 0;
        this.engineGain.connect(filter);
        this.engine = ctx.createOscillator();
        this.engine.type = 'sawtooth';
        this.engine.frequency.value = 40;
        this.engine.connect(this.engineGain);
        this.engine.start();
        this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.context.state === 'suspended') await this.context.resume();
    } catch {
      /* Audio is optional; gameplay remains available if the device refuses it. */
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.context && this.master)
      this.master.gain.setTargetAtTime(muted ? 0 : 0.23, this.context.currentTime, 0.025);
  }

  update(car: Vehicle, playing: boolean): void {
    const ctx = this.context;
    if (!ctx || !this.engine || !this.engineGain) return;
    const speed = Math.hypot(car.vx, car.vz);
    this.engine.frequency.setTargetAtTime(
      38 + speed * 3.1 + (car.control.boost ? 15 : 0),
      ctx.currentTime,
      0.08,
    );
    this.engineGain.gain.setTargetAtTime(
      playing && !car.dead ? 0.065 + speed / 400 : 0,
      ctx.currentTime,
      0.08,
    );
  }

  event(e: GameEvent, listener: Vehicle): void {
    const ctx = this.context;
    if (
      !ctx ||
      !this.master ||
      this.muted ||
      ctx.state !== 'running' ||
      this.voices >= 20 ||
      e.type === 'kill'
    )
      return;
    const volume = clamp(1 - distance(e, listener) / 90, 0, 1);
    if (volume < 0.02) return;
    const duration =
      e.type === 'explosion' ? 0.75 : e.type === 'rocket' ? 0.3 : e.type === 'pickup' ? 0.3 : 0.09;
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = e.type === 'pickup' ? 'lowpass' : 'bandpass';
    filter.frequency.value = e.type === 'explosion' ? 180 : e.type === 'hit' ? 800 : 1400;
    filter.Q.value = 0.6;
    filter.connect(gain);
    gain.connect(this.master);
    const amplitude = volume * (e.type === 'explosion' ? 1 : e.type === 'gun' ? 0.2 : 0.4);
    gain.gain.setValueAtTime(amplitude, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    let source: AudioScheduledSourceNode;
    if (e.type === 'pickup') {
      const tone = ctx.createOscillator();
      tone.type = 'sine';
      tone.frequency.setValueAtTime(620, ctx.currentTime);
      tone.frequency.exponentialRampToValueAtTime(1240, ctx.currentTime + duration);
      source = tone;
    } else {
      const noise = ctx.createBufferSource();
      noise.buffer = this.noise!;
      source = noise;
    }
    source.connect(filter);
    source.start();
    source.stop(ctx.currentTime + duration);
    this.voices++;
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
      this.voices--;
    };
  }
}
