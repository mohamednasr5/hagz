/**
 * audio-fx.js - Sports Stadium Web Audio & Motion FX System
 * Zero-dependency procedural audio synthesizer for match ambiance,
 * clicks, referee whistle, confirmation chimes, and alerts.
 */

class SoundFXManager {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  getContext() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /**
   * Crisp UI click / slot tap
   */
  playClick() {
    if (!this.enabled) return;
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1400, ctx.currentTime + 0.04);

      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.05);
    } catch (e) {}
  }

  /**
   * Dialog / Modal opening swoosh
   */
  playModalOpen() {
    if (!this.enabled) return;
    try {
      const ctx = this.getContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(320, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(640, ctx.currentTime + 0.12);

      gain.gain.setValueAtTime(0.14, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.14);
    } catch (e) {}
  }

  /**
   * Referee Stadium Whistle (Double chirp) - Match Start / Confirmed Booking
   */
  playWhistle() {
    if (!this.enabled) return;
    try {
      const ctx = this.getContext();
      if (!ctx) return;

      const chirp = (startTime, duration, freq) => {
        const osc = ctx.createOscillator();
        const mod = ctx.createOscillator();
        const modGain = ctx.createGain();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, startTime);

        // Subtle trill effect
        mod.type = 'sine';
        mod.frequency.setValueAtTime(35, startTime);
        modGain.gain.setValueAtTime(120, startTime);

        mod.connect(osc.frequency);

        gain.gain.setValueAtTime(0.18, startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

        osc.connect(gain);
        gain.connect(ctx.destination);

        mod.start(startTime);
        osc.start(startTime);
        mod.stop(startTime + duration);
        osc.stop(startTime + duration);
      };

      const now = ctx.currentTime;
      chirp(now, 0.12, 2600);
      chirp(now + 0.14, 0.28, 2800);
    } catch (e) {}
  }

  /**
   * Celebration / Success Chime on booking submitted or approved
   */
  playSuccess() {
    if (!this.enabled) return;
    try {
      const ctx = this.getContext();
      if (!ctx) return;

      const notes = [
        { f: 523.25, t: 0.00, d: 0.12 }, // C5
        { f: 659.25, t: 0.10, d: 0.12 }, // E5
        { f: 783.99, t: 0.20, d: 0.16 }, // G5
        { f: 1046.50, t: 0.32, d: 0.35 } // C6
      ];

      notes.forEach(({ f, t, d }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(f, ctx.currentTime + t);

        gain.gain.setValueAtTime(0.16, ctx.currentTime + t);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + d);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime + t);
        osc.stop(ctx.currentTime + t + d);
      });
    } catch (e) {}
  }

  /**
   * Error / Warning Low Dual Buzzer
   */
  playError() {
    if (!this.enabled) return;
    try {
      const ctx = this.getContext();
      if (!ctx) return;

      [220, 260].forEach((freq) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, ctx.currentTime);

        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start();
        osc.stop(ctx.currentTime + 0.25);
      });
    } catch (e) {}
  }
}

export const soundFX = new SoundFXManager();

/**
 * Visual Interactive Ripple Generator
 */
export function createClickRipple(e) {
  const target = e.currentTarget || e.target;
  if (!target || !target.getBoundingClientRect) return;

  const rect = target.getBoundingClientRect();
  const circle = document.createElement('span');
  const diameter = Math.max(rect.width, rect.height);
  const radius = diameter / 2;

  circle.style.width = circle.style.height = `${diameter}px`;
  circle.style.left = `${(e.clientX || rect.left + radius) - rect.left - radius}px`;
  circle.style.top = `${(e.clientY || rect.top + radius) - rect.top - radius}px`;
  circle.classList.add('fx-click-ripple');

  const existingRipple = target.querySelector('.fx-click-ripple');
  if (existingRipple) existingRipple.remove();

  target.appendChild(circle);
  setTimeout(() => circle.remove(), 600);
}
