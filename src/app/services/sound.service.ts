import { Injectable } from '@angular/core';

/** Short synthesized beeps via Web Audio — no assets, fails silently if unavailable */
@Injectable({ providedIn: 'root' })
export class SoundService {
  /** Rest timer done: two-note chime */
  playRestBeep(): void {
    this.play([
      { freq: 880, at: 0 },
      { freq: 1320, at: 0.25 },
    ], 0.2);
  }

  /** Personal record: ascending major arpeggio, distinct from the rest beep */
  playPrBeep(): void {
    this.play([
      { freq: 523.25, at: 0 },
      { freq: 659.25, at: 0.12 },
      { freq: 783.99, at: 0.24 },
    ], 0.3);
  }

  private play(notes: { freq: number; at: number }[], decay: number): void {
    try {
      const ctx = new AudioContext();
      for (const { freq, at } of notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        const when = ctx.currentTime + at;
        gain.gain.setValueAtTime(0.3, when);
        gain.gain.exponentialRampToValueAtTime(0.001, when + decay);
        osc.start(when);
        osc.stop(when + decay + 0.05);
      }
    } catch { /* AudioContext unavailable */ }
  }
}
