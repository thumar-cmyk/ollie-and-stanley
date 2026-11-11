/*
 * Ollie & Stanley audio: everything is synthesized with WebAudio (no files).
 *  - music: a slow, original I-vi-IV-V lullaby loop (soft pads, music-box notes, bass)
 *  - effects: taps, doors, crashes, and formant-synthesized cat voices
 * iOS: audio can only start after a user gesture (call unlock() from a tap).
 * navigator.audioSession "ambient" (Safari 16.4+) makes the ringer/mute switch silence the game.
 */
window.CatAudio = (function () {
  "use strict";
  var A = { ctx: null, master: null, musicBus: null, fxBus: null,
            musicOn: false, fxOn: false, musicVol: 0.35, fxVol: 0.8, timer: 0, nextBar: 0, bar: 0 };
  try { if (navigator.audioSession) navigator.audioSession.type = "ambient"; } catch (e) {}

  function ensure() {
    if (A.ctx) return true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    A.ctx = new AC();
    A.master = A.ctx.createGain(); A.master.gain.value = 1;
    var comp = A.ctx.createDynamicsCompressor();
    A.master.connect(comp); comp.connect(A.ctx.destination);
    A.musicBus = A.ctx.createGain(); A.musicBus.gain.value = 0; A.musicBus.connect(A.master);
    A.fxBus = A.ctx.createGain(); A.fxBus.gain.value = A.fxOn ? A.fxVol : 0; A.fxBus.connect(A.master);
    // gentle "room" echo for the music
    var dl = A.ctx.createDelay(1); dl.delayTime.value = 0.43;
    var fb = A.ctx.createGain(); fb.gain.value = 0.28;
    var lp = A.ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1800;
    A.musicIn = A.ctx.createGain(); A.musicIn.connect(A.musicBus);
    A.musicIn.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(A.musicBus);
    return true;
  }
  function unlock() {
    if (!(A.musicOn || A.fxOn)) return;
    if (!ensure()) return;
    if (A.ctx.state === "suspended") A.ctx.resume();
    // iOS: play a silent buffer inside the gesture
    try { var b = A.ctx.createBuffer(1, 1, 22050), s = A.ctx.createBufferSource(); s.buffer = b; s.connect(A.ctx.destination); s.start(0); } catch (e) {}
    if (A.musicOn) startMusic();
  }
  function ramp(param, v, t) { var now = A.ctx.currentTime; param.cancelScheduledValues(now); param.setValueAtTime(param.value, now); param.linearRampToValueAtTime(v, now + (t || 0.3)); }
  function setMusic(on, vol) {
    A.musicOn = !!on; if (vol != null) A.musicVol = vol;
    if (!A.ctx) { if (on) unlock(); return; }
    ramp(A.musicBus.gain, A.musicOn ? A.musicVol * 0.5 : 0, 0.6);
    if (A.musicOn) startMusic();
  }
  function setFx(on, vol) {
    A.fxOn = !!on; if (vol != null) A.fxVol = vol;
    if (!A.ctx) { if (on) unlock(); return; }
    ramp(A.fxBus.gain, A.fxOn ? A.fxVol : 0, 0.1);
  }

  /* ---------- music (original composition, generated live) ---------- */
  var BPM = 66, BEAT = 60 / BPM, BAR = BEAT * 4;
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  // C major: Cmaj7 - Am7 - Fmaj7 - G6sus, then Em7 - Am7 - Dm7 - G7sus
  var PROG = [
    [48, [60, 64, 67, 71]], [45, [57, 60, 64, 67]], [41, [57, 60, 65, 69]], [43, [55, 59, 62, 64]],
    [40, [55, 59, 62, 64]], [45, [57, 60, 64, 67]], [38, [57, 60, 62, 65]], [43, [55, 60, 62, 65]]
  ];
  var SCALE = [72, 74, 76, 79, 81, 84, 86, 88];
  function pad(freq, t, dur, vol) {
    var c = A.ctx, o1 = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
    o1.type = "triangle"; o2.type = "sine"; o1.frequency.value = freq; o2.frequency.value = freq * 1.003;
    f.type = "lowpass"; f.frequency.value = 900;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.35);
    g.gain.linearRampToValueAtTime(vol * 0.7, t + dur * 0.75); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.6);
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(A.musicIn);
    o1.start(t); o2.start(t); o1.stop(t + dur + 0.8); o2.stop(t + dur + 0.8);
  }
  function bell(freq, t, vol) {
    var c = A.ctx, o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain();
    o.type = "sine"; o.frequency.value = freq; o2.type = "sine"; o2.frequency.value = freq * 3.01;
    var g2 = c.createGain(); g2.gain.value = 0.12;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(A.musicIn);
    o.start(t); o2.start(t); o.stop(t + 1.7); o2.stop(t + 1.7);
  }
  function scheduleBar(t, i) {
    var ch = PROG[i % PROG.length];
    ch[1].forEach(function (m) { pad(mtof(m), t, BAR, 0.035); });
    pad(mtof(ch[0]), t, BAR, 0.05);
    // music box: a few soft notes per bar from the chord tones + pentatonic
    var tones = ch[1].map(function (m) { return m + 12; }).concat(SCALE);
    for (var k = 0; k < 8; k++) {
      if (Math.random() < (k % 2 ? 0.25 : 0.55)) bell(mtof(tones[Math.floor(Math.random() * tones.length)]), t + k * BEAT / 2 + Math.random() * 0.02, 0.05);
    }
  }
  function startMusic() {
    if (!A.ctx || A.timer) return;
    A.nextBar = A.ctx.currentTime + 0.1;
    A.timer = setInterval(function () {
      if (!A.musicOn) { clearInterval(A.timer); A.timer = 0; return; }
      while (A.nextBar < A.ctx.currentTime + 1.5) { scheduleBar(A.nextBar, A.bar++); A.nextBar += BAR; }
    }, 300);
    ramp(A.musicBus.gain, A.musicVol * 0.5, 1.5);
  }

  /* ---------- effects ---------- */
  function tone(type, f0, f1, dur, vol, delay) {
    var c = A.ctx, t = c.currentTime + (delay || 0);
    var o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(A.fxBus); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, vol, freq, type, delay) {
    var c = A.ctx, t = c.currentTime + (delay || 0);
    var buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 1.5);
    var s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = buf; f.type = type || "highpass"; f.frequency.value = freq || 2500; g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(A.fxBus); s.start(t);
  }
  /*
   * Formant cat voice: a buzzy glottal source (sawtooth + a little noise) with a
   * pitch contour, through 3 band-pass "vowel" formants that glide e.g. i -> a -> u
   * ("mi-a-ow"). Optional growl/trill = amplitude modulation.
   */
  function voice(o) {
    var c = A.ctx, t = c.currentTime + (o.delay || 0), dur = o.dur;
    var src = c.createOscillator(); src.type = "sawtooth";
    src.frequency.setValueAtTime(o.pitch[0][1], t);
    o.pitch.forEach(function (p) { src.frequency.linearRampToValueAtTime(p[1], t + p[0] * dur); });
    var vib = c.createOscillator(), vg = c.createGain(); vib.frequency.value = 6; vg.gain.value = o.pitch[0][1] * 0.02;
    vib.connect(vg); vg.connect(src.frequency);
    var amp = c.createGain(); amp.gain.value = 1;
    src.connect(amp);
    if (o.am) { // growl / trill
      var lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = o.am[0]; lg.gain.value = o.am[1];
      lfo.connect(lg); lg.connect(amp.gain); lfo.start(t); lfo.stop(t + dur + 0.1);
    }
    var out = c.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(o.vol, t + Math.min(0.06, dur * 0.2));
    out.gain.setValueAtTime(o.vol, t + dur * 0.7);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    [0, 1, 2].forEach(function (k) {
      var bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = [6, 9, 10][k];
      var fg = c.createGain(); fg.gain.value = [1, 0.7, 0.3][k];
      var fs = o.formants;
      bp.frequency.setValueAtTime(fs[0][1][k], t);
      fs.forEach(function (f) { bp.frequency.linearRampToValueAtTime(f[1][k], t + f[0] * dur); });
      amp.connect(bp); bp.connect(fg); fg.connect(out);
    });
    // breath
    var nb = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate), nd = nb.getChannelData(0);
    for (var i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * 0.15;
    var ns = c.createBufferSource(), nf = c.createBiquadFilter(); ns.buffer = nb; nf.type = "bandpass"; nf.frequency.value = 3000; nf.Q.value = 1;
    ns.connect(nf); nf.connect(out);
    out.connect(A.fxBus);
    src.start(t); vib.start(t); ns.start(t); src.stop(t + dur + 0.05); vib.stop(t + dur + 0.05);
  }
  var I = [300, 2300, 3000], E = [450, 1900, 2700], AA = [800, 1300, 2600], O = [500, 900, 2500], U = [350, 750, 2400];
  function meow(low, kind) {
    var k = low ? 0.72 : 1, r = 0.9 + Math.random() * 0.2;
    if (kind === "chirp") {
      voice({ dur: 0.2, vol: 0.5, pitch: [[0, 650 * k * r], [0.6, 1100 * k * r], [1, 950 * k * r]], formants: [[0, E], [1, AA]], am: [24, 0.6] });
      voice({ dur: 0.16, vol: 0.4, delay: 0.22, pitch: [[0, 800 * k * r], [1, 1150 * k * r]], formants: [[0, E], [1, AA]], am: [24, 0.6] });
    } else if (kind === "purr") {
      // low pulse-train buzz, ~26 Hz, through a dark filter
      voice({ dur: 1.3, vol: 0.9, pitch: [[0, 52 * k], [0.5, 48 * k], [1, 52 * k]], formants: [[0, [180, 400, 800]], [1, [200, 450, 800]]], am: [26, 0.9] });
    } else if (kind === "mrrp") {
      voice({ dur: 0.35, vol: 0.5, pitch: [[0, 420 * k * r], [0.5, 650 * k * r], [1, 560 * k * r]], formants: [[0, U], [0.5, O], [1, AA]], am: [30, 0.5] });
    } else { // meow ("mi-a-ow"); Stanley's is lower, longer, with a grumble
      voice({ dur: low ? 0.85 : 0.65, vol: 0.55, pitch: [[0, 520 * k * r], [0.3, 820 * k * r], [0.7, 700 * k * r], [1, 430 * k * r]],
              formants: [[0, I], [0.35, AA], [0.75, O], [1, U]], am: low ? [34, 0.35] : null });
    }
  }
  function sfx(name) {
    if (!A.fxOn || !A.ctx) return;
    try {
      switch (name) {
        case "tap": tone("sine", 660, 880, 0.08, 0.06); break;
        case "select": tone("triangle", 520, 780, 0.1, 0.08); break;
        case "door": tone("sine", 300, 600, 0.18, 0.06); tone("sine", 450, 900, 0.18, 0.05, 0.1); break;
        case "boop": tone("sine", 400, 300, 0.15, 0.07); break;
        case "hiss": noise(0.7, 0.22, 3200); break;
        case "scuffle": noise(0.35, 0.18, 1200); tone("square", 300, 120, 0.25, 0.03, 0.05); break;
        case "catch": tone("triangle", 600, 1200, 0.1, 0.1); tone("triangle", 900, 1600, 0.12, 0.08, 0.09); break;
        case "squeak": tone("sine", 2000, 2600, 0.06, 0.05); tone("sine", 2200, 2800, 0.06, 0.05, 0.1); break;
        case "ding": tone("sine", 1200, 1200, 0.25, 0.06); break;
        case "hop": tone("sine", 300, 700, 0.15, 0.06); break;
        case "bad": tone("square", 400, 200, 0.25, 0.04); break;
        case "yum": tone("triangle", 700, 900, 0.1, 0.08); tone("triangle", 900, 1100, 0.1, 0.08, 0.1); break;
        case "end": tone("triangle", 523, 523, 0.15, 0.08); tone("triangle", 659, 659, 0.15, 0.08, 0.15); tone("triangle", 784, 784, 0.3, 0.08, 0.3); break;
        case "crash": noise(0.5, 0.35, 2500); tone("triangle", 2400, 1800, 0.25, 0.05, 0.02); tone("triangle", 3100, 2500, 0.2, 0.04, 0.07); noise(0.2, 0.2, 5000, "highpass", 0.12); break;
        case "thud": tone("sine", 140, 60, 0.2, 0.15); break;
        case "scratch": for (var i = 0; i < 4; i++) noise(0.09, 0.12, 1800, "bandpass", i * 0.14); break;
        case "roll": tone("sine", 180, 120, 0.4, 0.06); noise(0.4, 0.05, 600, "lowpass"); break;
        case "swipe": noise(0.12, 0.12, 2000, "bandpass"); break;
      }
    } catch (e) { /* ignore */ }
  }
  function cat(id, kind) {
    if (!A.fxOn || !A.ctx) return;
    try {
      var low = id === "stanley";
      if (!kind) { var r = Math.random(); kind = r < 0.5 ? "meow" : r < 0.75 ? "chirp" : r < 0.9 ? "mrrp" : "purr"; }
      meow(low, kind);
    } catch (e) {}
  }
  return { unlock: unlock, setMusic: setMusic, setFx: setFx, sfx: sfx, cat: cat, state: A };
})();
