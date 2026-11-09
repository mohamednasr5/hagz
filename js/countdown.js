/**
 * countdown.js - Real-time Countdown Timer Engine
 * Computes remaining time from booking endTimestamp against Egypt time.
 * Recovers correctly after refreshes, updates every second, handles expiration.
 */

import { getEgyptNow } from './utils.js';

class CountdownManager {
  constructor() {
    this.activeTimers = new Map();
    this.intervalId = null;
    this.initLoop();
  }

  initLoop() {
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => this.tick(), 1000);
  }

  /**
   * Registers a target to count down
   * @param {string} id - unique identifier (e.g., booking id)
   * @param {number} startTimestamp - start unix timestamp (ms)
   * @param {number} endTimestamp - end unix timestamp (ms)
   * @param {Function} onTick - callback({ hours, minutes, seconds, progress, isExpired })
   * @param {Function} onExpire - callback called once on expiration
   */
  register(id, startTimestamp, endTimestamp, onTick, onExpire) {
    this.activeTimers.set(id, {
      startTimestamp: Number(startTimestamp),
      endTimestamp: Number(endTimestamp),
      onTick,
      onExpire,
      expiredTriggered: false
    });

    // Run immediate tick for instant UI response
    this.tickItem(id, this.activeTimers.get(id));
  }

  unregister(id) {
    this.activeTimers.delete(id);
  }

  tick() {
    for (const [id, timer] of this.activeTimers.entries()) {
      this.tickItem(id, timer);
    }
  }

  tickItem(id, timer) {
    const nowMs = Date.now();
    const remainingMs = timer.endTimestamp - nowMs;
    const totalDurationMs = Math.max(1, timer.endTimestamp - timer.startTimestamp);

    if (remainingMs <= 0) {
      const progress = 100;
      if (timer.onTick) {
        timer.onTick({
          hours: '00',
          minutes: '00',
          seconds: '00',
          progress,
          isExpired: true,
          label: 'انتهى وقت الحجز'
        });
      }

      if (!timer.expiredTriggered) {
        timer.expiredTriggered = true;
        this.playSoftAlertTone();
        if (timer.onExpire) timer.onExpire();
      }
      return;
    }

    const totalSeconds = Math.floor(remainingMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const elapsedMs = Math.max(0, nowMs - timer.startTimestamp);
    const progress = Math.min(100, Math.max(0, (elapsedMs / totalDurationMs) * 100));

    if (timer.onTick) {
      timer.onTick({
        hours: String(hours).padStart(2, '0'),
        minutes: String(minutes).padStart(2, '0'),
        seconds: String(seconds).padStart(2, '0'),
        progress: progress.toFixed(1),
        isExpired: false,
        label: `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      });
    }
  }

  /**
   * Generates a subtle, non-intrusive sound tone using Web Audio API on expiry
   */
  playSoftAlertTone() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.3); // A5

      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch (e) {
      // Audio context might be restricted before user interaction, silent fallback
    }
  }
}

export const countdownEngine = new CountdownManager();
