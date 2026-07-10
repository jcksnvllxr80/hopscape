// Hopscape — tiny synthesized sound effects (WebAudio, no audio files needed)
(() => {
  let ctx = null;
  let master = null;
  let muted = false;
  try { muted = localStorage.getItem('hs_muted') === '1'; } catch (e) {}

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.22;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(opts) {
    if (muted || !ensure()) return;
    const freq = opts.freq || 440;
    const end = opts.end || freq;
    const dur = opts.dur || 0.1;
    const t0 = ctx.currentTime + (opts.delay || 0);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = opts.type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (end !== freq) o.frequency.exponentialRampToValueAtTime(Math.max(1, end), t0 + dur);
    g.gain.setValueAtTime(opts.vol || 0.4, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g);
    g.connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  function noise(opts) {
    if (muted || !ensure()) return;
    const dur = opts.dur || 0.3;
    const t0 = ctx.currentTime + (opts.delay || 0);
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = opts.freq || 800;
    const g = ctx.createGain();
    g.gain.value = opts.vol || 0.5;
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t0);
  }

  window.Sfx = {
    unlock: ensure, // call on first user gesture so the browser lets audio play
    isMuted: () => muted,
    toggleMute() {
      muted = !muted;
      try { localStorage.setItem('hs_muted', muted ? '1' : '0'); } catch (e) {}
      return muted;
    },
    hop()    { tone({ freq: 320 + Math.random() * 60, end: 490, type: 'square', dur: 0.07, vol: 0.3 }); },
    bump()   { tone({ freq: 135, end: 90, type: 'triangle', dur: 0.09, vol: 0.5 }); },
    coin()   { tone({ freq: 990, type: 'sine', dur: 0.07, vol: 0.4 });
               tone({ freq: 1320, type: 'sine', dur: 0.13, vol: 0.4, delay: 0.07 }); },
    select() { tone({ freq: 620, end: 780, type: 'square', dur: 0.08, vol: 0.25 }); },
    start()  { [523, 659, 784].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.12, vol: 0.32, delay: i * 0.09 })); },
    splash() { noise({ dur: 0.45, vol: 0.6, freq: 900 });
               tone({ freq: 300, end: 70, type: 'sawtooth', dur: 0.5, vol: 0.22 }); },
    whoosh() { noise({ dur: 0.3, vol: 0.45, freq: 1600 });
               tone({ freq: 260, end: 720, type: 'sine', dur: 0.3, vol: 0.3 }); },
    plane()  { noise({ dur: 2.2, vol: 0.5, freq: 2400 });
               tone({ freq: 170, end: 80, type: 'sawtooth', dur: 2.2, vol: 0.16 });
               tone({ freq: 340, end: 160, type: 'sawtooth', dur: 2.2, vol: 0.08 }); },
    screech(){ tone({ freq: 1650, end: 750, type: 'sawtooth', dur: 0.38, vol: 0.2 });
               tone({ freq: 1750, end: 850, type: 'sawtooth', dur: 0.32, vol: 0.16, delay: 0.45 }); },
    fall()   { tone({ freq: 640, end: 110, type: 'sine', dur: 0.65, vol: 0.42 }); },
    rumble() { noise({ dur: 1.6, vol: 0.5, freq: 200 });
               tone({ freq: 55, end: 75, type: 'sawtooth', dur: 1.6, vol: 0.2 }); },
    launch() { noise({ dur: 1.7, vol: 0.85, freq: 1000 });
               tone({ freq: 85, end: 320, type: 'sawtooth', dur: 1.5, vol: 0.25 }); },
    crash()  { noise({ dur: 0.4, vol: 0.7, freq: 650 });
               tone({ freq: 210, end: 55, type: 'square', dur: 0.35, vol: 0.3 }); },
    boost()  { tone({ freq: 440, end: 880, type: 'square', dur: 0.09, vol: 0.28 });
               tone({ freq: 660, end: 1320, type: 'square', dur: 0.12, vol: 0.28, delay: 0.08 }); },
    over()   { [392, 330, 262, 196].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.16, vol: 0.32, delay: i * 0.13 })); },
    best()   { [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: 'square', dur: 0.1, vol: 0.22, delay: 0.5 + i * 0.09 })); },
  };
})();
