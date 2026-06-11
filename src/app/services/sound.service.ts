import { Injectable } from '@angular/core';

/** Short synthesized beeps via Web Audio — no assets, fails silently if unavailable */
@Injectable({ providedIn: 'root' })
export class SoundService {
  /** Rest timer done: triple square-wave pulse — audible through headphones on locked screen */
  playRestBeep(): void {
    const notes: { freq: number; at: number }[] = [];
    for (let i = 0; i < 3; i++) {
      notes.push({ freq: 880, at: i * 0.55 }, { freq: 1320, at: i * 0.55 + 0.2 });
    }
    this.play(notes, 0.25, 'square', 0.8);
  }

  /** Personal record: ascending major arpeggio, distinct from the rest beep */
  playPrBeep(): void {
    this.play([
      { freq: 523.25, at: 0 },
      { freq: 659.25, at: 0.12 },
      { freq: 783.99, at: 0.24 },
    ], 0.3);
  }

  private play(notes: { freq: number; at: number }[], decay: number, type: OscillatorType = 'sine', maxGain = 0.3): void {
    try {
      const ctx = new AudioContext();
      for (const { freq, at } of notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        const when = ctx.currentTime + at;
        gain.gain.setValueAtTime(maxGain, when);
        gain.gain.exponentialRampToValueAtTime(0.001, when + decay);
        osc.start(when);
        osc.stop(when + decay + 0.05);
      }
    } catch { /* AudioContext unavailable */ }
  }
}
