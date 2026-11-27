/* ══════════════════════════════════════════════════════════════
   ENP BLACKJACK — Web Audio (synthesised, no files)
   chip · card · flip · win · blackjack · lose · push · click
   ══════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  let ctx = null;
  let master = null;
  let enabled = true;

  function ensure() {
    if (!enabled) return null;
    if (!ctx) {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, dur, type, gain, when, glide) {
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + (when || 0);
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(30, glide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.12, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function noise(dur, gain, filterFreq, when) {
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + (when || 0);
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = filterFreq || 2200;
    bp.Q.value = 0.9;
    const g = c.createGain();
    g.gain.value = gain || 0.08;
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(t0);
  }

  const Sound = {
    setEnabled(on) { enabled = !!on; if (on) ensure(); },
    isEnabled() { return enabled; },
    unlock() { ensure(); },
    click() { tone(520, 0.05, 'triangle', 0.05); },
    chip() {
      tone(1180, 0.045, 'square', 0.035);
      tone(760, 0.06, 'sine', 0.06, 0.008);
      noise(0.05, 0.035, 3400);
    },
    card() { noise(0.12, 0.09, 1900); tone(220, 0.06, 'sine', 0.05); },
    flip() { noise(0.14, 0.11, 2600); tone(360, 0.05, 'triangle', 0.04, 0.02); },
    deal() { noise(0.09, 0.07, 2100); },
    win() {
      [523.25, 659.25, 783.99].forEach((f, i) => tone(f, 0.24, 'triangle', 0.1, i * 0.075));
      tone(1046.5, 0.4, 'sine', 0.055, 0.24);
    },
    blackjack() {
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, 0.34, 'triangle', 0.105, i * 0.08));
      tone(1568, 0.5, 'sine', 0.05, 0.42);
      noise(0.4, 0.03, 5200, 0.3);
    },
    lose() { tone(190, 0.32, 'sine', 0.09, 0, 120); tone(140, 0.4, 'sine', 0.06, 0.06, 90); },
    push() { tone(392, 0.16, 'triangle', 0.06); tone(392, 0.2, 'triangle', 0.05, 0.14); },
    bust() { tone(240, 0.22, 'sawtooth', 0.06, 0, 130); noise(0.18, 0.05, 900, 0.02); },
    insurance() { tone(660, 0.09, 'sine', 0.06); tone(880, 0.12, 'sine', 0.05, 0.08); },
    shuffle() {
      for (let i = 0; i < 7; i++) noise(0.08, 0.05, 2400 + i * 260, i * 0.055);
    },
    tick() { tone(880, 0.04, 'sine', 0.03); }
  };

  root.ENPSound = Sound;
})(window);
