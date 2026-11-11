/* Ollie & Stanley: tap-to-walk cat game. Plain JS, no build step. */
(function () {
  "use strict";
  var C = window.GAME_CONFIG;
  var params = new URLSearchParams(location.search);
  var DEBUG = params.get("debug") === "1";

  var canvas = document.getElementById("game");
  var ctx = canvas.getContext("2d");
  var hotLayer = document.getElementById("hotspots");
  var toastEl = document.getElementById("room-toast");
  var fadeEl = document.getElementById("fade");
  var catBtns = document.getElementById("cat-buttons");
  var soundBtn = document.getElementById("sound-btn");
  var debugEl = document.getElementById("debug-info");

  /* ---------- geometry helpers ---------- */
  function inPoly(p, poly) {
    var x = p[0], y = p[1], inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function closestOnSeg(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1];
    var t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1);
    t = Math.max(0, Math.min(1, t));
    return [a[0] + t * dx, a[1] + t * dy];
  }
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
  function centroid(poly) {
    var x = 0, y = 0;
    poly.forEach(function (p) { x += p[0]; y += p[1]; });
    return [x / poly.length, y / poly.length];
  }
  // Clamp a point onto the floor (nudged slightly inside so paths work).
  function clampToFloor(p, poly) {
    if (inPoly(p, poly)) return p.slice();
    var best = null, bd = 1e9;
    for (var i = 0; i < poly.length; i++) {
      var q = closestOnSeg(p, poly[i], poly[(i + 1) % poly.length]);
      var d = dist(p, q);
      if (d < bd) { bd = d; best = q; }
    }
    var c = centroid(poly);
    for (var k = 1; k <= 40; k++) {
      var t = k * 0.006;
      var cand = [best[0] + (c[0] - best[0]) * t, best[1] + (c[1] - best[1]) * t];
      if (inPoly(cand, poly)) return cand;
    }
    return c;
  }
  function segInside(a, b, poly) {
    var n = Math.max(4, Math.ceil(dist(a, b) / 0.01));
    for (var i = 1; i < n; i++) {
      var t = i / n;
      if (!inPoly([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], poly)) return false;
    }
    return true;
  }
  // Inset polygon vertices a little; used as waypoints around concave corners.
  function waypoints(poly) {
    var out = [];
    for (var i = 0; i < poly.length; i++) {
      var p = poly[i];
      var a = poly[(i - 1 + poly.length) % poly.length], b = poly[(i + 1) % poly.length];
      var bx = (a[0] + b[0]) / 2 - p[0], by = (a[1] + b[1]) / 2 - p[1];
      var l = Math.hypot(bx, by) || 1;
      for (var s = 1; s >= -1; s -= 2) {
        var q = [p[0] + s * bx / l * 0.015, p[1] + s * by / l * 0.015];
        if (inPoly(q, poly)) { out.push(q); break; }
      }
    }
    return out;
  }
  function findPath(a, b, room) {
    var poly = room.floor;
    if (segInside(a, b, poly)) return [b];
    var nodes = [a, b].concat(room._wps);
    var n = nodes.length, d = [], prev = [], done = [];
    for (var i = 0; i < n; i++) { d[i] = 1e9; prev[i] = -1; done[i] = false; }
    d[0] = 0;
    for (var it = 0; it < n; it++) {
      var u = -1;
      for (i = 0; i < n; i++) if (!done[i] && (u < 0 || d[i] < d[u])) u = i;
      if (u < 0 || d[u] >= 1e9) break;
      done[u] = true;
      if (u === 1) break;
      for (var v = 0; v < n; v++) {
        if (done[v]) continue;
        var w = dist(nodes[u], nodes[v]);
        if (d[u] + w < d[v] && segInside(nodes[u], nodes[v], poly)) { d[v] = d[u] + w; prev[v] = u; }
      }
    }
    if (prev[1] < 0) return [b];
    var path = [], k = 1;
    while (k > 0) { path.unshift(nodes[k]); k = prev[k]; }
    return path;
  }

  /* ---------- state ---------- */
  var rooms = C.rooms;
  Object.keys(rooms).forEach(function (id) { rooms[id].id = id; rooms[id]._wps = waypoints(rooms[id].floor); });
  var state = {
    room: rooms[params.get("room")] ? params.get("room") : C.startRoom,
    selected: C.startCat,
    ripples: [],
    transitioning: false,
    chaseTimer: 0,
    chases: 0,
    catches: 0,
    errors: []
  };
  var useSmall = Math.max(screen.width, screen.height) * (window.devicePixelRatio || 1) < 1500;
  var imgDir = "assets/rooms/" + (params.get("res") || (useSmall ? "1280" : "1920")) + "/";

  var images = {};
  function loadImg(src) {
    if (images[src]) return images[src];
    var im = new Image();
    im.decoding = "async";
    im.src = src;
    images[src] = im;
    return im;
  }

  var cats = {};
  Object.keys(C.cats).forEach(function (id, i) {
    var cfg = C.cats[id];
    cats[id] = {
      id: id, cfg: cfg, img: loadImg(cfg.sprite),
      x: 0.5, y: 0.8, path: [], mode: "idle", speedMul: 1,
      facing: 1, phase: Math.random() * 6, moveAmt: 0,
      bubble: null, idleT: 2 + Math.random() * 4, blink: 0, sit: 0,
      onArrive: null, scuffle: 0
    };
  });
  var catIds = Object.keys(cats);
  function other(id) { return catIds.filter(function (c) { return c !== id; })[0]; }

  function room() { return rooms[state.room]; }
  function depthScale(y, r) {
    var d = (r || room()).depth;
    return d.s1 + (d.s2 - d.s1) * (y - d.y1) / (d.y2 - d.y1);
  }

  /* ---------- layout ---------- */
  var view = { w: 0, h: 0, dpr: 1, ix: 0, iy: 0, iw: 0, ih: 0 };
  function layout() {
    var w = window.innerWidth, h = window.innerHeight;
    document.documentElement.style.setProperty("--vh", h + "px");
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    view.w = w; view.h = h; view.dpr = dpr;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.width = w + "px"; canvas.style.height = h + "px";
    // "contain" fit of the 16:9 photo; leftover bars get a dimmed fill.
    var ar = 16 / 9;
    if (w / h > ar) { view.ih = h; view.iw = h * ar; } else { view.iw = w; view.ih = w / ar; }
    view.ix = (w - view.iw) / 2; view.iy = (h - view.ih) / 2;
    placeHotspots();
  }
  function toScreen(p) { return [view.ix + p[0] * view.iw, view.iy + p[1] * view.ih]; }
  function toImage(sx, sy) { return [(sx - view.ix) / view.iw, (sy - view.iy) / view.ih]; }

  /* ---------- hotspots (doors) ---------- */
  var ARROWS = { left: "\u2190", right: "\u2192", up: "\u2191", down: "\u2193" };
  function buildHotspots() {
    hotLayer.innerHTML = "";
    var r = room();
    (r.doors || []).forEach(function (d) {
      var b = document.createElement("button");
      b.className = "door arrow-" + d.arrow;
      b.dataset.to = d.to;
      b.dataset.x = d.x; b.dataset.y = d.y;
      b.innerHTML = '<span class="arr">' + ARROWS[d.arrow] + '</span><span class="lbl">' + rooms[d.to].name + "</span>";
      b.setAttribute("aria-label", "Go to " + rooms[d.to].name);
      b.addEventListener("click", function (e) { e.stopPropagation(); goTo(d); });
      hotLayer.appendChild(b);
    });
    (r.hints || []).forEach(function (h) {
      var b = document.createElement("button");
      b.className = "door hint arrow-" + (h.arrow || "up");
      b.dataset.x = h.x; b.dataset.y = h.y;
      b.setAttribute("aria-disabled", "true");
      b.innerHTML = '<span class="arr">' + (ARROWS[h.arrow] || "\u2191") + '</span><span class="lbl">' + h.label + "</span>";
      b.addEventListener("click", function (e) { e.stopPropagation(); showToast(h.label); sfx("boop"); });
      hotLayer.appendChild(b);
    });
    placeHotspots();
  }
  function placeHotspots() {
    Array.prototype.forEach.call(hotLayer.children, function (b) {
      var p = toScreen([+b.dataset.x, +b.dataset.y]);
      b.style.left = p[0] + "px"; b.style.top = p[1] + "px";
    });
  }

  /* ---------- room switching ---------- */
  var toastTimer = 0;
  function showToast(text) {
    toastEl.textContent = text;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 1800);
  }
  function enterRoom(id, fromId) {
    state.room = id;
    var r = rooms[id];
    loadImg(imgDir + r.image);
    var back = (r.doors || []).filter(function (d) { return d.to === fromId; })[0];
    var p = clampToFloor(back ? back.floor : r.spawn, r.floor);
    var sel = cats[state.selected], oth = cats[other(state.selected)];
    var c = centroid(r.floor);
    // Arrive at the door, then step a bit into the room.
    var inward = clampToFloor([p[0] + (c[0] - p[0]) * 0.35, p[1] + (c[1] - p[1]) * 0.35], r.floor);
    var inward2 = clampToFloor([p[0] + (c[0] - p[0]) * 0.55 + 0.06, p[1] + (c[1] - p[1]) * 0.55], r.floor);
    [sel, oth].forEach(function (cat) {
      cat.x = p[0]; cat.y = p[1]; cat.mode = "idle"; cat.path = []; cat.bubble = null; cat.onArrive = null;
    });
    oth.x = clampToFloor([p[0] + 0.03, p[1]], r.floor)[0];
    walkTo(sel, inward);
    setTimeout(function () { if (state.room === id && oth.mode === "idle") walkTo(oth, inward2); }, 500);
    buildHotspots();
    showToast(r.name);
    state.chaseTimer = nextChaseDelay();
    // preload neighbours
    (r.doors || []).forEach(function (d) { loadImg(imgDir + rooms[d.to].image); });
  }
  function goTo(door) {
    if (state.transitioning) return;
    state.transitioning = true;
    sfx("door");
    var sel = cats[state.selected], oth = cats[other(state.selected)];
    var target = clampToFloor(door.floor, room().floor);
    walkTo(sel, target);
    walkTo(oth, clampToFloor([target[0] + 0.03, target[1]], room().floor));
    var from = state.room;
    var wait = Math.min(1100, 200 + dist([sel.x, sel.y], target) / sel.cfg.speed * 1000);
    setTimeout(function () {
      fadeEl.classList.add("on");
      setTimeout(function () {
        var go = function () {
          enterRoom(door.to, from);
          fadeEl.classList.remove("on");
          state.transitioning = false;
        };
        var im = loadImg(imgDir + rooms[door.to].image);
        if (im.complete) go(); else { im.onload = go; im.onerror = go; }
      }, 260);
    }, wait);
  }

  /* ---------- cat behaviour ---------- */
  function walkTo(cat, target, mode, speedMul) {
    var r = room();
    var t = clampToFloor(target, r.floor);
    cat.path = findPath([cat.x, cat.y], t, r);
    cat.mode = mode || "walk";
    cat.speedMul = speedMul || 1;
    cat.sit = 0;
  }
  function say(cat, text, secs) { cat.bubble = { text: text, t: secs || 1.4 }; }
  function nextChaseDelay() {
    var a = C.ai;
    var lo = DEBUG ? a.debugChaseMin : a.chaseMin, hi = DEBUG ? a.debugChaseMax : a.chaseMax;
    return lo + Math.random() * (hi - lo);
  }
  function farPointFrom(p, r) {
    var best = null, bd = -1;
    for (var i = 0; i < 40; i++) {
      var q = randomFloorPoint(r);
      var d = dist(p, q);
      if (d > bd) { bd = d; best = q; }
    }
    return best;
  }
  function randomFloorPoint(r) {
    var xs = r.floor.map(function (p) { return p[0]; }), ys = r.floor.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(0, xs), x1 = Math.max.apply(0, xs), y0 = Math.min.apply(0, ys), y1 = Math.max.apply(0, ys);
    for (var i = 0; i < 200; i++) {
      var q = [x0 + Math.random() * (x1 - x0), y0 + Math.random() * (y1 - y0)];
      if (inPoly(q, r.floor)) return q;
    }
    return centroid(r.floor);
  }
  function startChase() {
    var st = cats.stanley, ol = cats.ollie;
    if (!st || !ol) return false;
    state.chases++;
    say(st, "Hiss!", 1.6);
    sfx("hiss");
    st.mode = "chase"; st.path = []; st.sit = 0;
    setTimeout(function () {
      if (st.mode !== "chase") return;
      say(ol, "Mrow!", 1.4);
      sfx("meow");
      walkTo(ol, farPointFrom([st.x, st.y], room()), "flee", ol.cfg.fleeSpeed / ol.cfg.speed);
    }, 250);
    st.chaseT = 4.5;
    return true;
  }
  function updateAI(dt) {
    var st = cats.stanley, ol = cats.ollie;
    if (!st || state.transitioning) return;
    if (st.mode === "chase") {
      st.chaseT -= dt;
      var target = [ol.x, ol.y];
      st.path = [target];
      st.speedMul = st.cfg.chaseSpeed / st.cfg.speed;
      var reach = 0.05 * depthScale(st.y) / 0.15;
      if (dist([st.x, st.y], target) < Math.max(0.035, reach)) {
        // caught! scuffle
        state.catches++;
        st.mode = "scuffle"; ol.mode = "scuffle"; st.path = []; ol.path = [];
        st.scuffle = ol.scuffle = 0.9;
        say(st, "Pounce!", 1); sfx("scuffle");
      } else if (st.chaseT <= 0) {
        st.mode = "idle"; st.path = []; say(st, "Hmph.", 1.2);
      }
      return;
    }
    if (st.mode === "scuffle") return;
    if (state.selected === "stanley") return; // player is driving Stanley
    if (st.mode !== "idle" || ol.mode === "flee") return;
    state.chaseTimer -= dt;
    if (state.chaseTimer <= 0) {
      state.chaseTimer = nextChaseDelay();
      if (DEBUG || Math.random() < C.ai.chaseChance) startChase();
    }
  }
  function endScuffle() {
    var st = cats.stanley, ol = cats.ollie, r = room();
    st.mode = "idle"; ol.mode = "idle";
    say(ol, "Mrrp!", 1.2);
    walkTo(ol, farPointFrom([st.x, st.y], r), "walk", 1.3);
    walkTo(st, clampToFloor([st.x + (st.x > ol.x ? 0.08 : -0.08), st.y + 0.02], r.floor), "walk");
    state.chaseTimer = nextChaseDelay();
  }

  function updateCat(cat, dt) {
    if (cat.bubble) { cat.bubble.t -= dt; if (cat.bubble.t <= 0) cat.bubble = null; }
    if (cat.blink > 0) cat.blink -= dt;
    if (cat.mode === "scuffle") {
      cat.scuffle -= dt; cat.phase += dt * 30;
      if (cat.scuffle <= 0 && cat.id === "stanley") endScuffle();
      return;
    }
    if (cat.path.length) {
      var t = cat.path[0];
      var dx = t[0] - cat.x, dy = t[1] - cat.y, d = Math.hypot(dx, dy);
      // slower when far away (perspective)
      var persp = depthScale(cat.y) / room().depth.s2;
      var v = cat.cfg.speed * cat.speedMul * Math.max(0.35, persp) * dt;
      // vertical motion covers more ground in perspective; slow it a bit
      if (Math.abs(dx) > 0.002) cat.facing = dx > 0 ? 1 : -1;
      if (d <= v) {
        cat.x = t[0]; cat.y = t[1]; cat.path.shift();
      } else {
        cat.x += dx / d * v; cat.y += dy / d * v;
      }
      cat.moveAmt = Math.min(1, cat.moveAmt + dt * 6);
      cat.phase += dt * (9 + 5 * cat.speedMul);
      if (!cat.path.length && cat.mode !== "chase") {
        cat.mode = "idle"; cat.idleT = 2 + Math.random() * 5;
      }
    } else {
      cat.moveAmt = Math.max(0, cat.moveAmt - dt * 5);
      if (cat.mode === "idle") {
        cat.idleT -= dt;
        if (cat.idleT <= 0) {
          cat.idleT = 3 + Math.random() * 6;
          var roll = Math.random();
          if (roll < 0.45) cat.blink = 0.25;
          else if (roll < 0.75) cat.sit = cat.sit ? 0 : 1;
          else if (cat.id !== state.selected) {
            // wander a little
            var r = room();
            walkTo(cat, clampToFloor([cat.x + (Math.random() - 0.5) * 0.2, cat.y + (Math.random() - 0.5) * 0.08], r.floor));
          }
        }
      }
    }
  }

  /* ---------- input ---------- */
  function onPointer(e) {
    e.preventDefault();
    unlockAudio();
    if (state.transitioning) return;
    var rect = canvas.getBoundingClientRect();
    var p = toImage(e.clientX - rect.left, e.clientY - rect.top);
    if (DEBUG) debugEl.textContent = "tap " + p[0].toFixed(3) + ", " + p[1].toFixed(3);
    // tapping a cat selects it
    var hit = hitCat(e.clientX - rect.left, e.clientY - rect.top);
    if (hit && hit !== state.selected) { selectCat(hit); return; }
    if (p[0] < 0 || p[0] > 1 || p[1] < 0 || p[1] > 1) return;
    var cat = cats[state.selected];
    var t = clampToFloor(p, room().floor);
    if (cat.mode === "scuffle") return;
    if (cat.mode === "chase") cat.mode = "walk";
    walkTo(cat, t);
    state.ripples.push({ x: t[0], y: t[1], t: 0 });
    sfx("tap");
  }
  function hitCat(sx, sy) {
    var best = null;
    catIds.forEach(function (id) {
      var b = cats[id]._box;
      if (b && sx >= b[0] && sx <= b[2] && sy >= b[1] && sy <= b[3]) best = id;
    });
    return best;
  }
  function selectCat(id) {
    state.selected = id;
    Array.prototype.forEach.call(catBtns.children, function (b) {
      var on = b.dataset.cat === id;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    var cat = cats[id];
    if (cat.mode === "chase" || cat.mode === "flee") { cat.mode = "walk"; }
    say(cat, id === "stanley" ? "Mew?" : "Mrrp!", 0.9);
    sfx("select");
  }
  function buildCatButtons() {
    catIds.forEach(function (id) {
      var b = document.createElement("button");
      b.className = "cat-btn";
      b.dataset.cat = id;
      b.innerHTML = '<img src="' + cats[id].cfg.face + '" alt=""><span>' + cats[id].cfg.name + "</span>";
      b.setAttribute("aria-label", "Play as " + cats[id].cfg.name);
      b.addEventListener("click", function (e) { e.stopPropagation(); unlockAudio(); selectCat(id); });
      catBtns.appendChild(b);
    });
  }

  /* ---------- sound (synthesized, muted by default) ---------- */
  var audio = { ctx: null, on: false };
  function unlockAudio() {
    if (!audio.on) return;
    if (!audio.ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audio.ctx = new AC();
    }
    if (audio.ctx.state === "suspended") audio.ctx.resume();
  }
  function tone(type, f0, f1, dur, vol, delay) {
    var a = audio.ctx, t = a.currentTime + (delay || 0);
    var o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, vol, freq) {
    var a = audio.ctx, t = a.currentTime;
    var buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    var s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = buf; f.type = "highpass"; f.frequency.value = freq || 2500; g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(a.destination); s.start(t);
  }
  function sfx(name) {
    if (!audio.on || !audio.ctx) return;
    try {
      if (name === "tap") tone("sine", 660, 880, 0.08, 0.08);
      else if (name === "select") tone("triangle", 520, 780, 0.12, 0.12);
      else if (name === "door") { tone("sine", 300, 600, 0.18, 0.08); tone("sine", 450, 900, 0.18, 0.06, 0.1); }
      else if (name === "boop") tone("sine", 400, 300, 0.15, 0.08);
      else if (name === "meow") { tone("sawtooth", 500, 900, 0.18, 0.05); tone("sawtooth", 900, 420, 0.32, 0.05, 0.16); }
      else if (name === "hiss") noise(0.6, 0.18, 3000);
      else if (name === "scuffle") { noise(0.35, 0.15, 1200); tone("square", 300, 120, 0.25, 0.04, 0.05); }
    } catch (err) { /* ignore audio errors */ }
  }
  soundBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    audio.on = !audio.on;
    soundBtn.textContent = audio.on ? "\uD83D\uDD0A" : "\uD83D\uDD07";
    soundBtn.setAttribute("aria-label", audio.on ? "Sound on" : "Sound off");
    unlockAudio(); sfx("select");
  });

  /* ---------- drawing ---------- */
  function drawBackground() {
    var r = room(), im = images[imgDir + r.image];
    ctx.fillStyle = "#120c08";
    ctx.fillRect(0, 0, view.w, view.h);
    if (!im || !im.complete || !im.naturalWidth) return;
    if (view.ix > 1 || view.iy > 1) {
      // dim stretched copy behind the bars
      var s = Math.max(view.w / im.naturalWidth, view.h / im.naturalHeight) * 1.15;
      ctx.globalAlpha = 0.35;
      ctx.drawImage(im, (view.w - im.naturalWidth * s) / 2, (view.h - im.naturalHeight * s) / 2, im.naturalWidth * s, im.naturalHeight * s);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(10,6,4,0.45)";
      ctx.fillRect(0, 0, view.w, view.h);
    }
    ctx.drawImage(im, view.ix, view.iy, view.iw, view.ih);
  }
  function drawCat(cat) {
    var im = cat.img;
    if (!im.complete || !im.naturalWidth) return;
    var sp = toScreen([cat.x, cat.y]);
    var h = depthScale(cat.y) * cat.cfg.height * view.ih;
    var w = h * im.naturalWidth / im.naturalHeight;
    var walk = cat.moveAmt;
    var bob = Math.abs(Math.sin(cat.phase)) * h * 0.05 * walk;
    var squash = 1 + Math.sin(cat.phase * 2) * 0.035 * walk;
    var tilt = Math.sin(cat.phase) * 0.05 * walk;
    if (cat.mode === "scuffle") { tilt = Math.sin(cat.phase) * 0.25; bob = Math.abs(Math.sin(cat.phase * 0.7)) * h * 0.08; }
    var sitS = cat.sit && !walk ? 0.96 : 1;
    var blinkS = cat.blink > 0 ? 1 - Math.sin(cat.blink / 0.25 * Math.PI) * 0.06 : 1;
    var sy = squash * sitS * blinkS, sx = (2 - squash) * (cat.sit && !walk ? 1.03 : 1);
    var flip = cat.cfg.faces === 0 ? 1 : (cat.facing === cat.cfg.faces ? 1 : -1);
    // shadow
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0," + (0.32 - 0.12 * walk * Math.abs(Math.sin(cat.phase))) + ")";
    ctx.beginPath();
    var sh = cat.cfg.shadow || { y: 0.01, w: 0.42, h: 0.07 };
    ctx.ellipse(sp[0], sp[1] - h * sh.y, w * sh.w, Math.max(2, h * sh.h), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // selection ring
    if (cat.id === state.selected) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,230,120,0.85)";
      ctx.lineWidth = Math.max(2, h * 0.02);
      ctx.beginPath();
      ctx.ellipse(sp[0], sp[1] - h * sh.y, w * (sh.w + 0.08), Math.max(3, h * (sh.h + 0.02)), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.translate(sp[0], sp[1] - bob);
    ctx.rotate(tilt * (cat.cfg.faces === 0 ? 1 : flip));
    ctx.scale(sx * flip, sy);
    ctx.drawImage(im, -w / 2, -h, w, h);
    ctx.restore();
    cat._box = [sp[0] - w / 2, sp[1] - h, sp[0] + w / 2, sp[1]];
    cat._head = [sp[0], sp[1] - h * sy - bob];
  }
  function drawBubble(cat) {
    if (!cat.bubble || !cat._head) return;
    var fs = Math.max(14, Math.min(26, view.ih * 0.05));
    ctx.save();
    ctx.font = "bold " + fs + "px 'Trebuchet MS', 'Chalkboard SE', system-ui, sans-serif";
    var tw = ctx.measureText(cat.bubble.text).width;
    var bw = tw + fs * 1.2, bh = fs * 1.7;
    var x = Math.max(bw / 2 + 4, Math.min(view.w - bw / 2 - 4, cat._head[0]));
    var y = Math.max(bh + 4, cat._head[1] - fs * 0.6);
    var pop = Math.min(1, (1.6 - Math.min(1.6, cat.bubble.t)) * 8 + 0.6);
    ctx.translate(x, y); ctx.scale(Math.min(1, pop), Math.min(1, pop));
    ctx.fillStyle = cat.bubble.text === "Hiss!" || cat.bubble.text === "Pounce!" ? "#ffe0e0" : "#ffffff";
    ctx.strokeStyle = "rgba(60,30,20,0.8)"; ctx.lineWidth = 2.5;
    ctx.beginPath();
    roundRect(-bw / 2, -bh, bw, bh, bh / 2);
    ctx.moveTo(-6, 0); ctx.lineTo(0, 10); ctx.lineTo(6, 0);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#3a1d12"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(cat.bubble.text, 0, -bh / 2);
    ctx.restore();
  }
  function roundRect(x, y, w, h, r) {
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
  }
  function drawRipples(dt) {
    state.ripples = state.ripples.filter(function (r) { r.t += dt; return r.t < 0.6; });
    state.ripples.forEach(function (r) {
      var p = toScreen([r.x, r.y]);
      var s = depthScale(r.y) * view.ih * 0.5;
      var k = r.t / 0.6;
      ctx.save();
      ctx.strokeStyle = "rgba(255,240,150," + (1 - k) + ")";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(p[0], p[1], s * (0.2 + k * 0.6), s * (0.07 + k * 0.2), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    });
  }
  function drawDebug() {
    var r = room();
    ctx.save();
    ctx.strokeStyle = "rgba(0,255,120,0.9)"; ctx.fillStyle = "rgba(0,255,120,0.12)"; ctx.lineWidth = 2;
    ctx.beginPath();
    r.floor.forEach(function (p, i) { var s = toScreen(p); if (i) ctx.lineTo(s[0], s[1]); else ctx.moveTo(s[0], s[1]); });
    ctx.closePath(); ctx.fill(); ctx.stroke();
    (r.doors || []).forEach(function (d) { var s = toScreen(d.floor); ctx.fillStyle = "#0ff"; ctx.fillRect(s[0] - 4, s[1] - 4, 8, 8); });
    ctx.restore();
  }

  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    try {
      updateAI(dt);
      catIds.forEach(function (id) { updateCat(cats[id], dt); });
      ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      drawBackground();
      if (DEBUG) drawDebug();
      drawRipples(dt);
      var order = catIds.slice().sort(function (a, b) { return cats[a].y - cats[b].y; });
      order.forEach(function (id) { drawCat(cats[id]); });
      order.forEach(function (id) { drawBubble(cats[id]); });
    } catch (err) {
      state.errors.push(String(err));
      if (state.errors.length < 3) console.error(err);
    }
    requestAnimationFrame(frame);
  }

  /* ---------- boot ---------- */
  canvas.addEventListener("pointerdown", onPointer);
  // iOS: block pinch/double-tap zoom and rubber-banding
  ["gesturestart", "gesturechange", "gestureend"].forEach(function (ev) {
    document.addEventListener(ev, function (e) { e.preventDefault(); }, { passive: false });
  });
  document.addEventListener("touchmove", function (e) { if (e.touches.length > 1 || e.target === canvas) e.preventDefault(); }, { passive: false });
  var lastTouch = 0;
  document.addEventListener("touchend", function (e) {
    var t = Date.now();
    if (t - lastTouch < 350 && e.target === canvas) e.preventDefault();
    lastTouch = t;
  }, { passive: false });
  document.addEventListener("dblclick", function (e) { e.preventDefault(); });
  window.addEventListener("resize", layout);
  window.addEventListener("orientationchange", function () { setTimeout(layout, 200); });
  if (window.visualViewport) window.visualViewport.addEventListener("resize", layout);

  buildCatButtons();
  layout();
  // place cats in the start room
  (function () {
    var r = room();
    loadImg(imgDir + r.image);
    var p = clampToFloor(r.spawn, r.floor);
    cats.ollie.x = p[0] - 0.08; cats.ollie.y = p[1];
    cats.stanley.x = p[0] + 0.08; cats.stanley.y = p[1] - 0.02;
    catIds.forEach(function (id) { var q = clampToFloor([cats[id].x, cats[id].y], r.floor); cats[id].x = q[0]; cats[id].y = q[1]; });
    cats.ollie.facing = 1; cats.stanley.facing = -1;
    buildHotspots();
    showToast(r.name);
    state.chaseTimer = nextChaseDelay();
    (r.doors || []).forEach(function (d) { loadImg(imgDir + rooms[d.to].image); });
  })();
  selectCat(state.selected);
  cats[state.selected].bubble = null;
  if (DEBUG) { debugEl.hidden = false; }
  requestAnimationFrame(frame);

  // Test / debug hooks
  window.__game = {
    state: state, cats: cats, rooms: rooms, view: view,
    inPoly: inPoly, toScreen: toScreen, startChase: startChase,
    goTo: function (to) { var d = (room().doors || []).filter(function (x) { return x.to === to; })[0]; if (d) goTo(d); return !!d; }
  };

  if ("serviceWorker" in navigator && location.protocol === "https:" || location.hostname === "localhost") {
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", function () {
        navigator.serviceWorker.register("sw.js").then(function (reg) { window.__swRegistered = true; })
          .catch(function (err) { console.warn("SW failed", err); });
      });
    }
  }
})();
