/* ══════════════════════════════════════════════════════════════
   ENP BACCARAT — Web Audio synthesized sound kit
   No assets: chips, cards, zaps, chimes, thunder, frost shimmer.
   ══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  let ctx = null;
  let master = null;
  let muted = false;
  let unlocked = false;

  function ensure() {
    if (!ctx) {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function unlock() {
    const c = ensure();
    if (!c) return;
    if (unlocked) return;
    unlocked = true;
    // Silent blip to unlock audio on iOS
    const o = c.createOscillator();
    const g = c.createGain();
    g.gain.value = 0.0001;
    o.connect(g); g.connect(master);
    o.start(); o.stop(c.currentTime + 0.02);
	for (const fn of unlockQueue) fn();
    unlockQueue.length = 0;
  }

  const unlockQueue = [];

  function now() { return ctx ? ctx.currentTime : 0; }

  function tone(opt) {
    if (muted) return;
    const c = ensure();
    if (!c) return;
    const t0 = now() + (opt.delay || 0);
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = opt.type || 'sine';
    osc.frequency.setValueAtTime(opt.freq, t0);
    if (opt.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opt.to), t0 + (opt.dur || 0.15));
    const peak = Math.max(0.0002, opt.gain == null ? 0.12 : opt.gain);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + (opt.dur || 0.15));
    let node = osc;
    if (opt.filter) {
      const f = c.createBiquadFilter();
      f.type = opt.filter.type || 'lowpass';
      f.frequency.value = opt.filter.freq || 1200;
      node.connect(f); f.connect(gain);
    } else {
      node.connect(gain);
    }
    gain.connect(master);
    osc.start(t0);
    osc.stop(t0 + (opt.dur || 0.15) + 0.03);
  }

  let noiseBuf = null;
  function getNoise(c) {
    if (noiseBuf && noiseBuf.sampleRate === c.sampleRate) return noiseBuf;
    const len = Math.floor(c.sampleRate * 1.2);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    noiseBuf = buf;
    return buf;
  }

  function noise(opt) {
    if (muted) return;
    const c = ensure();
    if (!c) return;
    const t0 = now() + (opt.delay || 0);
    const dur = opt.dur || 0.2;
    const src = c.createBufferSource();
    src.buffer = getNoise(c);
    const f = c.createBiquadFilter();
    f.type = opt.type || 'bandpass';
    f.frequency.setValueAtTime(opt.freq || 1800, t0);
    if (opt.to) f.frequency.exponentialRampToValueAtTime(Math.max(40, opt.to), t0 + dur);
    f.Q.value = opt.q == null ? 0.9 : opt.q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, opt.gain == null ? 0.08 : opt.gain), t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  const Sound = {
    setMuted(v) { muted = !!v; },
    isMuted() { return muted; },
    unlock,

    click() { tone({ freq: 520, to: 380, dur: 0.05, type: 'triangle', gain: 0.05 }); },

    chip() {
      tone({ freq: 1180, to: 720, dur: 0.06, type: 'triangle', gain: 0.075 });
      noise({ freq: 3400, dur: 0.05, gain: 0.03, type: 'highpass' });
    },

    card() {
      noise({ freq: 2600, to: 700, dur: 0.14, gain: 0.055, type: 'bandpass', q: 0.7 });
        },

    flip() {
      noise({ freq: 2200, to: 900, dur: 0.09, gain: 0.045 });
      tone({ freq: 640, to: 900, dur: 0.07, type: 'sine', gain: 0.035 });
    },

    win() {
      const seq = [523.25, 659.25, 783.99, 1046.5];
      seq.forEach((f, i) => tone({ freq: f, dur: 0.32, type: 'triangle', gain: 0.09, delay: i * 0.075 }));
      tone({ freq: 261.63, dur: 0.5, type: 'sine', gain: 0.06, delay: 0.12 });
    },

    bigWin() {
      const seq = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98];
      seq.forEach((f, i) => tone({ freq: f, dur: 0.42, type: 'triangle', gain: 0.095, delay: i * 0.07 }));
      noise({ freq: 5200, to: 1800, dur: 0.5, gain: 0.03, delay: 0.05 });
    },

    lose() {
      tone({ freq: 220, to: 130, dur: 0.38, type: 'sine', gain: 0.075 });
      tone({ freq: 164.8, to: 98, dur: 0.42, type: 'triangle', gain: 0.05, delay: 0.05 });
    },

    push() {
      tone({ freq: 392, to: 392, dur: 0.18, type: 'sine', gain: 0.06 });
      tone({ freq: 523.25, dur: 0.22, type: 'sine', gain: 0.045, delay: 0.08 });
    },

    /** Lightning strike: crack + rolling thunder. */
    lightning() {
      noise({ freq: 5200, to: 900, dur: 0.28, gain: 0.16, type: 'highpass', q: 0.5 });
      tone({ freq: 90, to: 40, dur: 1.1, type: 'sawtooth', gain: 0.10, delay: 0.02, filter: { type: 'lowpass', freq: 320 } });
      noise({ freq: 900, to: 120, dur: 1.3, gain: 0.075, type: 'lowpass', delay: 0.08 });
      tone({ freq: 1760, to: 880, dur: 0.18, type: 'square', gain: 0.035 });
    },

    zap(pitch) {
      const base = 900 + (pitch || 0) * 130;
      tone({ freq: base, to: base * 2.2, dur: 0.11, type: 'square', gain: 0.045 });
      noise({ freq: 4200, dur: 0.09, gain: 0.03, type: 'highpass' });
    },

    /** Sakura chime + soft petal rustle. */
    sakura() {
      const seq = [783.99, 1046.5, 1174.66, 1567.98];
      seq.forEach((f, i) => tone({ freq: f, dur: 0.55, type: 'sine', gain: 0.06, delay: i * 0.09 }));
      noise({ freq: 3200, to: 5200, dur: 0.5, gain: 0.022, type: 'bandpass', q: 1.2 });
    },

    /** Icy shimmer: glassy high tones. */
    frost() {
      const seq = [1318.5, 1567.98, 2093, 2637];
      seq.forEach((f, i) => tone({ freq: f, dur: 0.6, type: 'sine', gain: 0.05, delay: i * 0.08 }));
      noise({ freq: 6400, to: 8800, dur: 0.55, gain: 0.02, type: 'highpass' });
    },

    speed() {
      tone({ freq: 1200, to: 2400, dur: 0.07, type: 'square', gain: 0.03 });
      noise({ freq: 3000, to: 6000, dur: 0.08, gain: 0.025, type: 'highpass' });
    }
  };

  global.Sound = Sound;
})(window);
