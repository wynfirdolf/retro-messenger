/* global rm */
// Every sound can come from the user's `sounds` folder (mp3 / wav / ogg, see the guide in that folder).
// When there is no usable file the app plays the built-in sound it synthesizes here.
const Sounds = (() => {
  let ctx = null;
  const ac = () => (ctx ||= new AudioContext());
  function tone(freq, at, dur, type = 'sine', gain = 0.16) {
    const a = ac();
    const t = a.currentTime + at;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  const arp = (notes, step, dur, gain = 0.12) => notes.forEach((f, i) => tone(f, i * step, dur, 'sine', gain));

  // Built-in sounds: each returns how long it lasts, in seconds.
  const builtin = {
    message() { tone(784, 0, 0.16, 'triangle'); tone(1175, 0.1, 0.34, 'triangle'); return 0.5; },
    nudge() { for (let i = 0; i < 10; i++) tone(i % 2 ? 130 : 175, i * 0.045, 0.055, 'square', 0.07); return 0.5; },
    login() { arp([523, 659, 784, 1047], 0.085, 0.3); return 0.6; },
    logoff() { arp([1047, 784, 659, 523], 0.085, 0.3); return 0.6; },
    startup() { arp([392, 523, 659, 784, 1047], 0.1, 0.4, 0.1); return 0.95; },
    shutdown() { arp([784, 659, 523, 392], 0.12, 0.4, 0.1); return 0.9; },
  };

  const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));

  // Plays a user file, cut off after `max` seconds. Rejects if the file can't be decoded.
  async function playFile(info) {
    const a = ac();
    if (a.state === 'suspended') await a.resume();
    const bytes = info.bytes;
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const buf = await a.decodeAudioData(copy);
    const src = a.createBufferSource();
    const g = a.createGain();
    src.buffer = buf;
    src.connect(g).connect(a.destination);
    const len = Math.min(buf.duration, info.max);
    const t0 = a.currentTime;
    g.gain.setValueAtTime(1, t0);
    if (buf.duration > info.max) g.gain.linearRampToValueAtTime(0.0001, t0 + len); // short fade instead of a click
    src.start(t0);
    src.stop(t0 + len + 0.02);
    await new Promise((r) => { src.onended = r; });
  }

  // Resolves when the sound has finished (the app waits for this before it quits).
  async function play(name) {
    let info = null;
    try { info = await rm.getSound(name); } catch { /* use the built-in sound */ }
    if (info) {
      try { await playFile(info); return; } catch { /* undecodable file: fall back below */ }
    }
    try { const s = builtin[name]?.(); if (s) await wait(s); } catch { /* no audio device */ }
  }

  return {
    play,
    // Old call sites.
    online: () => play('login'),
    message: () => play('message'),
    nudge: () => play('nudge'),
  };
})();
