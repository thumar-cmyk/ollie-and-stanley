/* Ollie & Stanley: tap-to-walk cat game (v2). Plain JS, no build step. */
(function () {
  "use strict";
  var C = window.GAME_CONFIG;
  var params = new URLSearchParams(location.search);
  var DEBUG = params.get("debug") === "1";
  var SC = C.scoring;

  var $ = function (id) { return document.getElementById(id); };
  var canvas = $("game"), ctx = canvas.getContext("2d");
  var hotLayer = $("hotspots"), toastEl = $("room-toast"), fadeEl = $("fade");
  var catBtns = $("cat-buttons"), soundBtn = $("sound-btn"), debugEl = $("debug-info");
  var scoreEl = $("score-val"), bestEl = $("best-val"), timerEl = $("round-timer");
  var treatBtn = $("treat-btn"), treatCd = $("treat-cd");
  var helpEl = $("help"), summaryEl = $("summary"), warnEl = $("warn");

  /* ---------- geometry ---------- */
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
  // distance in "photo-height" units (x is 16/9 wider)
  function hdist(a, b) { return Math.hypot((a[0] - b[0]) * 16 / 9, a[1] - b[1]); }
  function centroid(poly) {
    var x = 0, y = 0;
    poly.forEach(function (p) { x += p[0]; y += p[1]; });
    return [x / poly.length, y / poly.length];
  }
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
    var n = nodes.length, d = [], prev = [], done = [], i;
    for (i = 0; i < n; i++) { d[i] = 1e9; prev[i] = -1; done[i] = false; }
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
  function randomIn(poly) {
    var xs = poly.map(function (p) { return p[0]; }), ys = poly.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(0, xs), x1 = Math.max.apply(0, xs), y0 = Math.min.apply(0, ys), y1 = Math.max.apply(0, ys);
    for (var i = 0; i < 200; i++) {
      var q = [x0 + Math.random() * (x1 - x0), y0 + Math.random() * (y1 - y0)];
      if (inPoly(q, poly)) return q;
    }
    return centroid(poly);
  }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  /* ---------- state ---------- */
  var rooms = C.rooms;
  Object.keys(rooms).forEach(function (id) { rooms[id].id = id; rooms[id]._wps = waypoints(rooms[id].floor); });
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem("os_" + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem("os_" + k, JSON.stringify(v)); } catch (e) {} }
  };
  var state = {
    room: rooms[params.get("room")] ? params.get("room") : C.startRoom,
    selected: C.startCat,
    ripples: [], popups: [], poofs: [],
    transitioning: false, paused: false,
    chaseTimer: 0, chases: 0, catches: 0,
    score: 0, best: store.get("best", 0),
    stats: null,
    critters: [], critterTimer: 0,
    snack: null, snackTimer: 0,
    treat: null, treatMode: false, treatCooldown: 0,
    round: null,
    errors: []
  };
  function newStats() { return { spiders: 0, mice: 0, stolen: 0, saved: 0, escaped: 0, caught: 0, treats: 0, naps: 0 }; }
  state.stats = newStats();

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
  Object.keys(C.cats).forEach(function (id) {
    var cfg = C.cats[id];
    var sp = (window.CAT_SPRITES || {})[id] || {};
    var frames = {};
    Object.keys(cfg.states).forEach(function (st) {
      frames[st] = ((sp[st] || {}).frames || []).map(loadImg);
    });
    cats[id] = {
      id: id, cfg: cfg, frames: frames, stillT: 0,
      x: 0.5, y: 0.8, path: [], mode: "idle", speedMul: 1,
      facing: 1, phase: Math.random() * 6, moveAmt: 0,
      bubble: null, idleT: 2 + Math.random() * 4, blink: 0, sit: 0,
      scuffle: 0, idleTotal: 0, napT: 0, pounce: 0,
      air: null, perch: null, snackGoal: null, treatGoal: null
    };
  });
  var catIds = Object.keys(cats);
  function other(id) { return catIds.filter(function (c) { return c !== id; })[0]; }
  function room() { return rooms[state.room]; }
  function depthScale(y, r) {
    var d = (r || room()).depth;
    return d.s1 + (d.s2 - d.s1) * (y - d.y1) / (d.y2 - d.y1);
  }
  function catScale(cat) { return cat.scaleOverride || depthScale(cat.y); }

  /* ---------- score ---------- */
  function addScore(n, at, label) {
    state.score += n;
    if (state.score < 0) state.score = 0;
    if (state.score > state.best) { state.best = state.score; store.set("best", state.best); }
    scoreEl.textContent = state.score;
    bestEl.textContent = state.best;
    scoreEl.parentNode.classList.remove("bump", "bump-neg");
    void scoreEl.parentNode.offsetWidth;
    scoreEl.parentNode.classList.add(n >= 0 ? "bump" : "bump-neg");
    if (at) state.popups.push({ x: at[0], y: at[1], text: (n >= 0 ? "+" : "") + n + (label ? " " + label : ""), good: n >= 0, t: 0 });
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
    var ar = 16 / 9;
    if (w / h > ar) { view.ih = h; view.iw = h * ar; } else { view.iw = w; view.ih = w / ar; }
    view.ix = (w - view.iw) / 2; view.iy = (h - view.ih) / 2;
    placeHotspots();
  }
  function toScreen(p) { return [view.ix + p[0] * view.iw, view.iy + p[1] * view.ih]; }
  function toImage(sx, sy) { return [(sx - view.ix) / view.iw, (sy - view.iy) / view.ih]; }

  /* ---------- doors ---------- */
  var ARROWS = { left: "\u2190", right: "\u2192", up: "\u2191", down: "\u2193" };
  function buildHotspots() {
    hotLayer.innerHTML = "";
    var r = room();
    (r.doors || []).forEach(function (d) {
      var b = document.createElement("button");
      b.className = "door arrow-" + d.arrow;
      b.dataset.to = d.to;
      b.dataset.x = d.x; b.dataset.y = d.y;
      b.innerHTML = '<span class="arr">' + ARROWS[d.arrow] + '</span><span class="lbl">' + rooms[d.to].name + '</span><span class="badge"></span>';
      b.setAttribute("aria-label", "Go to " + rooms[d.to].name);
      b.addEventListener("click", function (e) { e.stopPropagation(); unlockAudio(); goTo(d); });
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
    updateDoorBadges();
  }
  function placeHotspots() {
    Array.prototype.forEach.call(hotLayer.children, function (b) {
      var p = toScreen([+b.dataset.x, +b.dataset.y]);
      b.style.left = p[0] + "px"; b.style.top = p[1] + "px";
    });
  }
  // first door to take from the current room to reach `target` (BFS)
  function nextHop(target) {
    var start = state.room;
    if (target === start) return null;
    var prev = {}, q = [start], seen = {}; seen[start] = 1;
    while (q.length) {
      var u = q.shift();
      (rooms[u].doors || []).forEach(function (d) {
        if (seen[d.to]) return;
        seen[d.to] = 1; prev[d.to] = u; q.push(d.to);
      });
    }
    if (!seen[target]) return null;
    var cur = target;
    while (prev[cur] !== start) cur = prev[cur];
    return cur;
  }
  var lastBadgeKey = "";
  function updateDoorBadges() {
    var marks = {};
    state.critters.forEach(function (c) {
      if (c.room === state.room) return;
      var hop = nextHop(c.room);
      if (hop) marks[hop] = (marks[hop] || "") + (c.type === "spider" ? "\uD83D\uDD77\uFE0F" : "\uD83D\uDC2D");
    });
    var key = JSON.stringify(marks) + state.room;
    if (key === lastBadgeKey) return;
    lastBadgeKey = key;
    Array.prototype.forEach.call(hotLayer.querySelectorAll(".door[data-to]"), function (b) {
      var m = marks[b.dataset.to] || "";
      b.querySelector(".badge").textContent = m.slice(0, 4);
      b.classList.toggle("has-critter", !!m);
    });
  }

  /* ---------- toast / warnings ---------- */
  var toastTimer = 0, warnTimer = 0;
  function showToast(text) {
    toastEl.textContent = text;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 1800);
  }
  function showWarn(text, secs) {
    warnEl.textContent = text;
    warnEl.classList.add("show");
    clearTimeout(warnTimer);
    warnTimer = setTimeout(function () { warnEl.classList.remove("show"); }, (secs || 2.5) * 1000);
  }

  /* ---------- rooms ---------- */
  function resetCatForRoom(cat) {
    cat.mode = "idle"; cat.path = []; cat.bubble = null; cat.air = null; cat.perch = null;
    cat.scaleOverride = null; cat.snackGoal = null; cat.treatGoal = null; cat.napT = 0; cat.idleTotal = 0;
  }
  function enterRoom(id, fromId) {
    state.room = id;
    var r = rooms[id];
    loadImg(imgDir + r.image);
    var back = (r.doors || []).filter(function (d) { return d.to === fromId; })[0];
    var p = clampToFloor(back ? back.floor : r.spawn, r.floor);
    var sel = cats[state.selected], oth = cats[other(state.selected)];
    var c = centroid(r.floor);
    var inward = clampToFloor([p[0] + (c[0] - p[0]) * 0.35, p[1] + (c[1] - p[1]) * 0.35], r.floor);
    var inward2 = clampToFloor([p[0] + (c[0] - p[0]) * 0.55 + 0.06, p[1] + (c[1] - p[1]) * 0.55], r.floor);
    [sel, oth].forEach(function (cat) { resetCatForRoom(cat); cat.x = p[0]; cat.y = p[1]; });
    oth.x = clampToFloor([p[0] + 0.03, p[1]], r.floor)[0];
    walkTo(sel, inward);
    setTimeout(function () { if (state.room === id && oth.mode === "idle") walkTo(oth, inward2); }, 500);
    state.snack = null; state.treat = null;
    if (!state.snackTimer || state.snackTimer < 4) state.snackTimer = 4 + Math.random() * 4;
    buildHotspots();
    var here = state.critters.filter(function (k) { return k.room === id; });
    showToast(r.name + (here.length ? "  \u2014  " + (here[0].type === "spider" ? "a spider!" : "a mouse!") : ""));
    state.chaseTimer = nextChaseDelay();
    (r.doors || []).forEach(function (d) { loadImg(imgDir + rooms[d.to].image); });
  }
  function goTo(door) {
    if (state.transitioning || state.paused) return;
    state.transitioning = true;
    setTreatMode(false);
    sfx("door");
    var sel = cats[state.selected], oth = cats[other(state.selected)];
    [sel, oth].forEach(function (c) { if (c.perch || c.air) { c.air = null; c.perch = null; c.scaleOverride = null; } c.snackGoal = null; });
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

  /* ---------- cat movement ---------- */
  function wake(cat, quiet) {
    if (cat.mode === "nap") {
      cat.mode = "idle"; cat.napT = 0;
      if (!quiet) say(cat, "Mrrp?", 1);
    }
    cat.idleTotal = 0;
  }
  function walkTo(cat, target, mode, speedMul) {
    var r = room();
    var t = clampToFloor(target, r.floor);
    wake(cat, true);
    cat.path = findPath([cat.x, cat.y], t, r);
    cat.mode = mode || "walk";
    cat.speedMul = speedMul || 1;
    cat.sit = 0;
  }
  function say(cat, text, secs) { cat.bubble = { text: text, t: secs || 1.4, max: secs || 1.4 }; }

  /* ---------- Stanley chase ---------- */
  function nextChaseDelay() {
    var a = C.ai;
    var lo = DEBUG ? a.debugChaseMin : a.chaseMin, hi = DEBUG ? a.debugChaseMax : a.chaseMax;
    return rnd(lo, hi);
  }
  function farPointFrom(p, r) {
    var best = null, bd = -1;
    for (var i = 0; i < 40; i++) {
      var q = randomIn(r.floor);
      var d = dist(p, q);
      if (d > bd) { bd = d; best = q; }
    }
    return best;
  }
  function busy(cat) { return cat.air || cat.perch || cat.snackGoal || cat.treatGoal || cat.mode === "scuffle"; }
  function startChase() {
    var st = cats.stanley, ol = cats.ollie;
    if (!st || !ol || busy(st) || busy(ol)) return false;
    state.chases++;
    wake(st, true); wake(ol, true);
    say(st, "Hiss!", 1.6);
    sfx("hiss");
    st.mode = "chase"; st.path = []; st.sit = 0;
    st.chaseT = 4.5;
    if (state.selected === "ollie") showWarn("Stanley is chasing Ollie \u2014 run!", 2.2);
    setTimeout(function () {
      if (st.mode !== "chase") return;
      say(ol, "Mrow!", 1.4);
      sfx("meow");
      if (state.selected !== "ollie") walkTo(ol, farPointFrom([st.x, st.y], room()), "flee", ol.cfg.fleeSpeed / ol.cfg.speed);
    }, 250);
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
        state.catches++; state.stats.caught++;
        st.mode = "scuffle"; ol.mode = "scuffle"; st.path = []; ol.path = [];
        st.scuffle = ol.scuffle = 0.9;
        say(st, "Pounce!", 1); sfx("scuffle");
        addScore(SC.chaseCaught, [ol.x, ol.y - catScale(ol) * 0.6], "caught!");
      } else if (st.chaseT <= 0) {
        st.mode = "idle"; st.path = []; say(st, "Hmph.", 1.2);
        state.stats.escaped++;
        say(ol, "Ha!", 1.2);
        addScore(SC.chaseEscaped, [ol.x, ol.y - catScale(ol) * 0.6], "escaped!");
        if (ol.mode === "flee") ol.mode = ol.path.length ? "walk" : "idle";
        state.chaseTimer = nextChaseDelay();
      }
      return;
    }
    if (st.mode === "scuffle") return;
    if (state.selected === "stanley") return;
    if (st.mode !== "idle" || busy(st) || ol.mode === "flee" || busy(ol)) return;
    if (state.snack || state.treat) return; // he's distracted
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

  /* ---------- critters ---------- */
  var critterId = 0;
  function spawnCritter(type, roomId) {
    var CC = C.critters;
    type = type || (Math.random() < 0.55 ? "spider" : "mouse");
    if (!roomId) {
      var ids = Object.keys(rooms);
      roomId = Math.random() < CC.currentRoomChance ? state.room : pick(ids.filter(function (i) { return i !== state.room; }));
    }
    if (state.critters.some(function (c) { return c.room === roomId && c.type === type; })) return null;
    var r = rooms[roomId];
    var k = { id: ++critterId, type: type, room: roomId, life: CC[type].life, t: 0, facing: 1, pause: 0, caught: 0 };
    if (type === "spider") {
      var p = randomIn(r.floor);
      for (var tries = 0; tries < 10 && roomId === state.room && catIds.some(function (id) { return hdist(p, [cats[id].x, cats[id].y]) < 0.2; }); tries++) p = randomIn(r.floor);
      k.x = p[0]; k.y = p[1];
      k.drop = 1;                 // 1 = at top of thread, 0 = on floor
      k.dropFrom = CC.spider.dropFrom;
      k.target = null;
    } else {
      // enter from the door farthest from the cats so it isn't caught instantly
      var doors = (r.doors || []).length ? r.doors : [{ floor: r.spawn }];
      var d = doors[0], bestD = -1;
      doors.forEach(function (dd) {
        var m = roomId === state.room ? Math.min.apply(0, catIds.map(function (id) { return hdist(dd.floor, [cats[id].x, cats[id].y]); })) : Math.random();
        if (m > bestD) { bestD = m; d = dd; }
      });
      var q = clampToFloor(d.floor, r.floor);
      if (roomId === state.room && bestD < 0.25) q = farPointFrom([cats[state.selected].x, cats[state.selected].y], r);
      k.x = q[0]; k.y = q[1]; k.drop = 0;
      k.target = randomIn(r.floor);
    }
    state.critters.push(k);
    if (roomId === state.room) {
      showWarn(type === "spider" ? "A spider! Catch it! \uD83D\uDD77\uFE0F" : "A mouse! Quick, catch it! \uD83D\uDC2D", 2.2);
      sfx(type === "spider" ? "boop" : "squeak");
    }
    lastBadgeKey = "";
    return k;
  }
  function updateCritters(dt) {
    var CC = C.critters;
    state.critterTimer -= dt;
    if (state.critterTimer <= 0) {
      state.critterTimer = DEBUG ? rnd(CC.debugSpawnMin, CC.debugSpawnMax) : rnd(CC.spawnMin, CC.spawnMax);
      if (state.critters.length < 2) spawnCritter();
    }
    state.critters = state.critters.filter(function (k) {
      if (k.caught) { k.caught -= dt; return k.caught > 0; }
      k.life -= dt; k.t += dt;
      if (k.life <= 0) {
        if (k.room === state.room) poof(k.x, k.y, "#bbb");
        return false;
      }
      if (k.room !== state.room) return true;
      var r = room(), cfg = CC[k.type];
      if (k.type === "spider" && k.drop > 0) {
        k.drop = Math.max(0, k.drop - dt * 0.45);
        return true;
      }
      if (k.pause > 0) { k.pause -= dt; return true; }
      if (!k.target) k.target = randomIn(r.floor);
      var dx = k.target[0] - k.x, dy = k.target[1] - k.y, d = Math.hypot(dx, dy);
      var persp = Math.max(0.35, depthScale(k.y) / r.depth.s2);
      var v = cfg.speed * persp * dt;
      // the mouse runs away from nearby cats
      if (k.type === "mouse") {
        catIds.forEach(function (id) {
          var c = cats[id];
          if (!c.perch && !c.air && hdist([c.x, c.y], [k.x, k.y]) < 0.12 && k.pause <= 0 && Math.random() < dt * 2) {
            k.target = farPointFrom([c.x, c.y], r);
          }
        });
      }
      if (Math.abs(dx) > 0.001) k.facing = dx > 0 ? 1 : -1;
      if (d <= v) {
        k.x = k.target[0]; k.y = k.target[1]; k.target = null;
        k.pause = k.type === "mouse" ? rnd(0.4, 1.5) : rnd(0.8, 2.5);
      } else { k.x += dx / d * v; k.y += dy / d * v; }
      k.moving = d > v;
      return true;
    });
    // catches
    state.critters.forEach(function (k) {
      if (k.caught || k.room !== state.room || k.drop > 0.15) return;
      catIds.forEach(function (id) {
        var c = cats[id];
        if (k.caught || c.perch || c.air || c.mode === "nap") return;
        var reach = Math.max(0.03, catScale(c) * 0.33);
        if (hdist([c.x, c.y], [k.x, k.y]) < reach) catchCritter(c, k);
      });
    });
    updateDoorBadges();
  }
  function catchCritter(cat, k) {
    k.caught = 0.01;
    cat.pounce = 0.45;
    cat.facing = k.x > cat.x ? 1 : -1;
    var pts = k.type === "spider" ? SC.spider : SC.mouse;
    if (k.type === "spider") state.stats.spiders++; else state.stats.mice++;
    say(cat, k.type === "spider" ? "Got it!" : "Gotcha!", 1.2);
    addScore(pts, [k.x, k.y - catScale(cat) * 0.5], k.type);
    poof(k.x, k.y, k.type === "spider" ? "#333" : "#999");
    sfx("catch");
  }
  function poof(x, y, color) {
    for (var i = 0; i < 10; i++) {
      var a = Math.random() * Math.PI * 2;
      state.poofs.push({ x: x, y: y, vx: Math.cos(a) * 0.08, vy: Math.sin(a) * 0.06 - 0.04, t: 0, color: color });
    }
    for (i = 0; i < 6; i++) {
      var b = Math.random() * Math.PI * 2;
      state.poofs.push({ x: x, y: y, vx: Math.cos(b) * 0.05, vy: Math.sin(b) * 0.04 - 0.05, t: 0, color: "#ffd84a", star: 1 });
    }
  }

  /* ---------- snacks ---------- */
  function spawnSnack() {
    var r = room();
    if (!r.surfaces || !r.surfaces.length || state.snack || state.transitioning) return null;
    var surf = pick(r.surfaces);
    var item = pick(C.snacks.items);
    var p = randomIn(surf.poly);
    state.snack = { item: item, surf: surf, x: p[0], y: p[1], t: 0, warnAt: C.snacks.warnDelay, life: C.snacks.life, thief: null, state: "fresh", room: r.id };
    sfx("ding");
    return state.snack;
  }
  function chooseThief() {
    var cand = catIds.slice();
    var sel = state.selected;
    var st = cats.stanley, ol = cats.ollie;
    var prefer = Math.random() < C.snacks.stanleyChance ? "stanley" : "ollie";
    // non-selected cat goes first; the selected one only if it is just sitting around
    var order = prefer === sel ? [other(sel), sel] : [prefer, other(prefer)];
    for (var i = 0; i < order.length; i++) {
      var c = cats[order[i]];
      if (busy(c) || c.mode === "chase" || c.mode === "flee") continue;
      if (c.id === sel && c.idleTotal < 4 && c.mode !== "nap") continue;
      return c;
    }
    return null;
  }
  function updateSnack(dt) {
    var S = C.snacks;
    if (!state.snack) {
      if (!room().surfaces) return;
      state.snackTimer -= dt;
      if (state.snackTimer <= 0) {
        state.snackTimer = DEBUG ? rnd(S.debugSpawnMin, S.debugSpawnMax) : rnd(S.spawnMin, S.spawnMax);
        spawnSnack();
      }
      return;
    }
    var sn = state.snack;
    sn.t += dt;
    if (sn.state === "fresh") {
      sn.life -= dt;
      if (sn.life <= 0) { state.snack = null; return; }
      if (sn.t >= sn.warnAt) {
        var thief = chooseThief();
        if (thief) {
          sn.thief = thief.id; sn.state = "targeted";
          wake(thief, true);
          thief.snackGoal = sn;
          walkTo(thief, sn.surf.from, "toSnack", 0.8);
          thief.snackGoal = sn;
          showWarn(thief.cfg.name + " eyes the " + sn.item.name + "\u2026 tap it to put it away!", 3);
          say(thief, "\uD83D\uDC40", 1.5);
        } else sn.warnAt = sn.t + 1.5;
      }
    } else if (sn.state === "targeted") {
      var c = cats[sn.thief];
      if (c.snackGoal !== sn) { sn.state = "fresh"; sn.thief = null; sn.warnAt = sn.t + 3; return; }
      if (c.mode === "toSnack" && !c.path.length) {
        // jump up!
        c.mode = "jump";
        c.air = { from: [c.x, c.y], to: [sn.x, sn.y], t: 0, dur: 0.55, h: 0.12, then: "eat" };
        c.scaleOverride = depthScale(sn.surf.from[1]);
        c.facing = sn.x > c.x ? 1 : -1;
        sfx("hop");
        sn.state = "stealing";
        warnEl.classList.remove("show");
      }
    }
  }
  function putAwaySnack() {
    var sn = state.snack;
    if (!sn || sn.state === "eaten" || sn.state === "stealing") return false;
    state.stats.saved++;
    addScore(SC.snackSaved, [sn.x, sn.y - 0.04], "saved!");
    poof(sn.x, sn.y, "#fff");
    sfx("ding");
    if (sn.thief) {
      var c = cats[sn.thief];
      c.snackGoal = null;
      if (c.mode === "toSnack") { c.mode = "walk"; }
      say(c, "Aww\u2026", 1.2);
    }
    state.snack = null;
    return true;
  }
  function finishAir(cat) {
    var a = cat.air;
    cat.x = a.to[0]; cat.y = a.to[1]; cat.air = null;
    if (a.then === "eat") {
      cat.perch = { t: 1.6 };
      var sn = state.snack;
      if (sn) {
        sn.state = "eaten";
        state.stats.stolen++;
        say(cat, "Bad kitty!", 1.8);
        sfx("bad");
        addScore(S_SNACK(), [sn.x, sn.y - 0.06], "");
      }
    } else {
      cat.scaleOverride = null; cat.mode = "idle"; cat.idleTotal = 0;
      cat.snackGoal = null;
    }
  }
  function S_SNACK() { return SC.snackStolen; }

  /* ---------- treats ---------- */
  function setTreatMode(on) {
    state.treatMode = on && state.treatCooldown <= 0;
    treatBtn.classList.toggle("armed", state.treatMode);
    if (state.treatMode) showWarn("Tap the floor to drop a treat", 2);
  }
  function dropTreat(p) {
    var r = room();
    var t = clampToFloor(p, r.floor);
    state.treat = { x: t[0], y: t[1], t: 0 };
    state.treatCooldown = C.treat.cooldown;
    setTreatMode(false);
    // nearest available cat goes for it (cancels a chase)
    var best = null, bd = 1e9;
    catIds.forEach(function (id) {
      var c = cats[id];
      if (c.air || c.perch) return;
      var d = dist([c.x, c.y], t);
      if (d < bd) { bd = d; best = c; }
    });
    if (best) {
      if (best.mode === "chase") { best.mode = "idle"; cats.ollie.mode === "flee" && (cats.ollie.mode = "walk"); }
      if (best.snackGoal) { state.snack && (state.snack.state = "fresh", state.snack.thief = null, state.snack.warnAt = state.snack.t + 3); best.snackGoal = null; }
      best.treatGoal = state.treat;
      walkTo(best, t, "toTreat", 1.2);
      best.treatGoal = state.treat;
      say(best, "Treat?!", 1.2);
    }
    sfx("tap");
  }
  function updateTreat(dt) {
    if (state.treatCooldown > 0) {
      state.treatCooldown = Math.max(0, state.treatCooldown - dt);
      treatCd.textContent = state.treatCooldown > 0 ? Math.ceil(state.treatCooldown) : "";
      treatBtn.classList.toggle("cooling", state.treatCooldown > 0);
    }
    var tr = state.treat;
    if (!tr) return;
    tr.t += dt;
    catIds.forEach(function (id) {
      var c = cats[id];
      if (!state.treat || c.air || c.perch) return;
      if (hdist([c.x, c.y], [tr.x, tr.y]) < Math.max(0.03, catScale(c) * 0.25)) {
        state.treat = null; c.treatGoal = null;
        if (c.mode === "toTreat") c.mode = "idle";
        state.stats.treats++;
        say(c, "Yum!", 1.2); sfx("yum");
        addScore(SC.treatEaten, [tr.x, tr.y - catScale(c) * 0.6], "");
      }
    });
    if (state.treat && tr.t > 15) state.treat = null;
  }

  /* ---------- per-cat update ---------- */
  function updateCat(cat, dt) {
    if (cat.bubble) { cat.bubble.t -= dt; if (cat.bubble.t <= 0) cat.bubble = null; }
    if (cat.blink > 0) cat.blink -= dt;
    if (cat.pounce > 0) cat.pounce = Math.max(0, cat.pounce - dt);
    if (cat.mode === "scuffle") {
      cat.scuffle -= dt; cat.phase += dt * 30;
      if (cat.scuffle <= 0 && cat.id === "stanley") endScuffle();
      return;
    }
    if (cat.air) {
      var a = cat.air;
      a.t += dt;
      var k = Math.min(1, a.t / a.dur);
      cat.x = a.from[0] + (a.to[0] - a.from[0]) * k;
      cat.y = a.from[1] + (a.to[1] - a.from[1]) * k;
      cat.airLift = Math.sin(k * Math.PI) * a.h;
      cat.moveAmt = 0;
      if (k >= 1) { cat.airLift = 0; finishAir(cat); }
      return;
    }
    if (cat.perch) {
      cat.perch.t -= dt;
      cat.phase += dt * 4;
      if (cat.perch.t <= 0) {
        cat.perch = null;
        state.snack = null;
        var from = cat.snackGoal ? cat.snackGoal.surf.from : clampToFloor([cat.x, 0.9], room().floor);
        cat.air = { from: [cat.x, cat.y], to: from.slice(), t: 0, dur: 0.5, h: 0.05, then: "land" };
        sfx("hop");
      }
      return;
    }
    if (cat.path.length) {
      var t = cat.path[0];
      var dx = t[0] - cat.x, dy = t[1] - cat.y, d = Math.hypot(dx, dy);
      var persp = depthScale(cat.y) / room().depth.s2;
      var boost = (cat.id === "ollie" && cats.stanley && cats.stanley.mode === "chase" && state.selected === "ollie") ? cat.cfg.fleeSpeed / cat.cfg.speed : 1;
      var v = cat.cfg.speed * cat.speedMul * boost * Math.max(0.35, persp) * dt;
      if (Math.abs(dx) > 0.002) cat.facing = dx > 0 ? 1 : -1;
      if (d <= v) { cat.x = t[0]; cat.y = t[1]; cat.path.shift(); }
      else { cat.x += dx / d * v; cat.y += dy / d * v; }
      cat.moveAmt = Math.min(1, cat.moveAmt + dt * 6);
      cat.stillT = 0;
      // ~1 walk cycle per 0.5 s at normal pace; faster when running
      cat.phase += dt * (11 + 6 * (cat.speedMul * boost - 1)) * Math.max(0.6, persp + 0.3);
      cat.idleTotal = 0;
      if (!cat.path.length && cat.mode !== "chase" && cat.mode !== "toSnack" && cat.mode !== "toTreat") {
        cat.mode = "idle"; cat.idleT = 2 + Math.random() * 5;
      }
      return;
    }
    cat.moveAmt = Math.max(0, cat.moveAmt - dt * 5);
    cat.stillT += dt;
    if (cat.mode === "toTreat" && !state.treat) { cat.mode = "idle"; cat.treatGoal = null; }
    if (cat.mode === "nap") {
      cat.napT += dt;
      cat.napPts = (cat.napPts || 0) + dt;
      if (cat.napPts >= SC.napEvery) {
        cat.napPts = 0;
        addScore(SC.napPoint, [cat.x, cat.y - catScale(cat) * 0.5], "zzz");
      }
      return;
    }
    if (cat.mode === "idle") {
      cat.idleTotal += dt;
      var calm = !(cats.stanley && cats.stanley.mode === "chase");
      if (cat.idleTotal >= C.nap.after && calm && !state.snack && !state.treat) {
        cat.mode = "nap"; cat.napT = 0; cat.napPts = 0; state.stats.naps++;
        say(cat, "zzz", 1.2);
        return;
      }
      cat.idleT -= dt;
      if (cat.idleT <= 0) {
        cat.idleT = 3 + Math.random() * 6;
        var roll = Math.random();
        if (roll < 0.45) cat.blink = 0.25;
        else if (roll < 0.75) cat.sit = cat.sit ? 0 : 1;
        else if (cat.id !== state.selected && Math.random() < 0.5) {
          var keep = cat.idleTotal;
          walkTo(cat, clampToFloor([cat.x + (Math.random() - 0.5) * 0.2, cat.y + (Math.random() - 0.5) * 0.08], room().floor));
          cat.idleTotal = keep; // small wanders don't reset the nap clock
        }
      }
    }
  }

  /* ---------- input ---------- */
  function onPointer(e) {
    e.preventDefault();
    unlockAudio();
    if (state.transitioning || state.paused) return;
    var rect = canvas.getBoundingClientRect();
    var sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    var p = toImage(sx, sy);
    if (DEBUG) debugEl.textContent = "tap " + p[0].toFixed(3) + ", " + p[1].toFixed(3);
    // snack?
    var sn = state.snack;
    if (sn && sn.state !== "eaten") {
      var sp = toScreen([sn.x, sn.y]);
      var rr = Math.max(28, sn.surf.size * view.ih * 1.1);
      if (Math.hypot(sx - sp[0], sy - (sp[1] - rr * 0.3)) < rr) { if (putAwaySnack()) return; }
    }
    if (state.treatMode) {
      if (p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1) dropTreat(p);
      return;
    }
    var hit = hitCat(sx, sy);
    if (hit && cats[hit].mode === "nap") { wake(cats[hit]); sfx("select"); if (hit !== state.selected) selectCat(hit, true); return; }
    if (hit && hit !== state.selected) { selectCat(hit); return; }
    if (p[0] < 0 || p[0] > 1 || p[1] < 0 || p[1] > 1) return;
    var cat = cats[state.selected];
    if (cat.mode === "scuffle" || cat.air || cat.perch) return;
    var t = clampToFloor(p, room().floor);
    if (cat.snackGoal) { cat.snackGoal = null; } // steering the thief away stops the theft
    cat.treatGoal = null;
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
  function selectCat(id, quiet) {
    state.selected = id;
    Array.prototype.forEach.call(catBtns.children, function (b) {
      var on = b.dataset.cat === id;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    var cat = cats[id];
    if (cat.mode === "chase") { cat.mode = "walk"; }
    if (cat.mode === "flee") { cat.mode = "walk"; }
    if (!quiet) { say(cat, id === "stanley" ? "Mew?" : "Mrrp!", 0.9); sfx("select"); }
  }
  function buildCatButtons() {
    catIds.forEach(function (id) {
      var b = document.createElement("button");
      b.className = "cat-btn";
      b.dataset.cat = id;
      b.innerHTML = '<img src="' + cats[id].cfg.face + '" alt=""><span>' + cats[id].cfg.name + "</span>";
      b.setAttribute("aria-label", "Play as " + cats[id].cfg.name);
      b.addEventListener("click", function (e) { e.stopPropagation(); unlockAudio(); if (cats[id].mode === "nap") wake(cats[id]); selectCat(id); });
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
      else if (name === "catch") { tone("triangle", 600, 1200, 0.1, 0.12); tone("triangle", 900, 1600, 0.12, 0.1, 0.09); }
      else if (name === "squeak") { tone("sine", 2000, 2600, 0.06, 0.06); tone("sine", 2200, 2800, 0.06, 0.06, 0.1); }
      else if (name === "ding") tone("sine", 1200, 1200, 0.25, 0.08);
      else if (name === "hop") tone("sine", 300, 700, 0.15, 0.08);
      else if (name === "bad") { tone("square", 400, 200, 0.25, 0.05); }
      else if (name === "yum") { tone("triangle", 700, 900, 0.1, 0.1); tone("triangle", 900, 1100, 0.1, 0.1, 0.1); }
      else if (name === "end") { tone("triangle", 523, 523, 0.15, 0.1); tone("triangle", 659, 659, 0.15, 0.1, 0.15); tone("triangle", 784, 784, 0.3, 0.1, 0.3); }
    } catch (err) { /* ignore */ }
  }
  soundBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    audio.on = !audio.on;
    soundBtn.textContent = audio.on ? "\uD83D\uDD0A" : "\uD83D\uDD07";
    soundBtn.setAttribute("aria-label", audio.on ? "Sound on" : "Sound off");
    unlockAudio(); sfx("select");
  });
  treatBtn.addEventListener("click", function (e) {
    e.stopPropagation(); unlockAudio();
    if (state.treatCooldown > 0) { showWarn("Treats in " + Math.ceil(state.treatCooldown) + "s", 1.2); return; }
    setTreatMode(!state.treatMode);
  });

  /* ---------- round mode / help ---------- */
  function startRound() {
    state.round = { left: +(params.get("roundsecs") || C.round.seconds) };
    state.score = 0; state.stats = newStats();
    addScore(0);
    timerEl.hidden = false;
    hideOverlays();
    showToast("3-minute round \u2014 go!");
  }
  function startFree() { state.round = null; timerEl.hidden = true; hideOverlays(); }
  function endRound() {
    var s = state.stats;
    state.round = null; timerEl.hidden = true;
    state.paused = true;
    $("sum-score").textContent = state.score;
    $("sum-best").textContent = state.best;
    $("sum-critters").textContent = s.spiders + " spider" + (s.spiders === 1 ? "" : "s") + ", " + s.mice + (s.mice === 1 ? " mouse" : " mice");
    $("sum-snacks").textContent = s.saved + " saved, " + s.stolen + " stolen";
    $("sum-chases").textContent = s.escaped + " escaped, " + s.caught + " caught";
    $("sum-treats").textContent = s.treats;
    summaryEl.hidden = false;
    sfx("end");
  }
  function hideOverlays() { helpEl.hidden = true; summaryEl.hidden = true; state.paused = false; last = performance.now(); }
  function showHelp() { helpEl.hidden = false; state.paused = true; }
  $("help-btn").addEventListener("click", function (e) { e.stopPropagation(); showHelp(); });
  $("btn-free").addEventListener("click", function () { store.set("seenHelp", 1); unlockAudio(); startFree(); });
  $("btn-round").addEventListener("click", function () { store.set("seenHelp", 1); unlockAudio(); startRound(); });
  $("btn-again").addEventListener("click", function () { startRound(); });
  $("btn-free2").addEventListener("click", function () { startFree(); });
  function updateRound(dt) {
    if (!state.round) return;
    state.round.left -= dt;
    var s = Math.max(0, Math.ceil(state.round.left));
    timerEl.textContent = "\u23F1 " + Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2);
    timerEl.classList.toggle("low", s <= 10);
    if (state.round.left <= 0) endRound();
  }

  /* ---------- drawing ---------- */
  function drawBackground() {
    var r = room(), im = images[imgDir + r.image];
    ctx.fillStyle = "#120c08";
    ctx.fillRect(0, 0, view.w, view.h);
    if (!im || !im.complete || !im.naturalWidth) return;
    if (view.ix > 1 || view.iy > 1) {
      var s = Math.max(view.w / im.naturalWidth, view.h / im.naturalHeight) * 1.15;
      ctx.globalAlpha = 0.35;
      ctx.drawImage(im, (view.w - im.naturalWidth * s) / 2, (view.h - im.naturalHeight * s) / 2, im.naturalWidth * s, im.naturalHeight * s);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(10,6,4,0.45)";
      ctx.fillRect(0, 0, view.w, view.h);
    }
    ctx.drawImage(im, view.ix, view.iy, view.iw, view.ih);
  }
  // Which sprite state + frame to show for a cat right now.
  var WALK_SEQ = [0, 1, 2, 3, 2, 1]; // ping-pong over the 4 walk frames
  function poseFor(cat) {
    var walkFrame = WALK_SEQ[Math.floor(cat.phase / (Math.PI * 2) * 6) % 6];
    if (cat.mode === "scuffle") return Math.floor(cat.phase / 3) % 2 ? { st: "pounce", f: 0 } : { st: "walk", f: walkFrame };
    if (cat.air) return { st: "pounce", f: 0 };
    if (cat.perch) return { st: "pounce", f: 0 };
    if (cat.pounce > 0) return cat.pounce > 0.22 ? { st: "pounce", f: 0 } : { st: "walk", f: 1, hop: 1 };
    if (cat.mode === "nap") return { st: "nap", f: 0 };
    if (cat.path.length || cat.moveAmt > 0.3) return { st: "walk", f: walkFrame, moving: 1 };
    if (cat.stillT < 0.6) return { st: "walk", f: 0 };
    return { st: "sit", f: 0 };
  }
  function drawSprite(img, legs, w, h, swingAmt) {
    // local coords: sprite spans x in [-w/2, w/2], y in [-h, 0] (feet at 0)
    if (!legs || Math.abs(swingAmt) < 0.001) { ctx.drawImage(img, -w / 2, -h, w, h); return; }
    var sw = img.naturalWidth, sh = img.naturalHeight;
    var hy = legs.hipY, sp = legs.split;
    var y0 = -h + h * hy, legH = h * (1 - hy);
    // body above the hips
    ctx.drawImage(img, 0, 0, sw, sh * hy + 1, -w / 2, -h, w, h * hy + 1);
    // hind legs (left part) and front legs (right part) swing in opposite phase around the hip line
    [[0, sp, 1], [sp, 1, -1]].forEach(function (part) {
      var k = swingAmt * part[2] * w / legH;
      ctx.save();
      ctx.transform(1, 0, k, 1, -k * y0, 0);
      var sx0 = part[0] * sw, sx1 = part[1] * sw;
      ctx.drawImage(img, sx0, sh * hy, sx1 - sx0, sh * (1 - hy), -w / 2 + part[0] * w - 0.5, y0, (part[1] - part[0]) * w + 1, legH);
      ctx.restore();
    });
  }
  function drawCat(cat) {
    var pose = poseFor(cat);
    var stc = cat.cfg.states[pose.st];
    var fr = cat.frames[pose.st] || [];
    var im = fr[pose.f] || fr[0];
    if (!im || !im.complete || !im.naturalWidth) return;
    var sp = toScreen([cat.x, cat.y]);
    var lift = (cat.airLift || 0) * view.ih;
    var base = catScale(cat) * cat.cfg.height * view.ih;     // sitting-cat height here
    var h = base * stc.rel;
    var w = h * im.naturalWidth / im.naturalHeight;
    var walk = pose.moving ? cat.moveAmt : 0;
    var running = cat.mode === "chase" || cat.mode === "flee" || cat.speedMul > 1.3;
    var bob = Math.abs(Math.sin(cat.phase * 2)) * h * (running ? 0.035 : 0.02) * walk;
    var tilt = Math.sin(cat.phase) * 0.015 * walk;
    var sx = 1, sy = 1;
    if (cat.mode === "scuffle") { tilt = Math.sin(cat.phase) * 0.2; bob = Math.abs(Math.sin(cat.phase * 0.7)) * h * 0.1; }
    if (pose.hop) { var pk = cat.pounce / 0.22; bob += Math.sin(pk * Math.PI) * base * 0.18; }
    if (pose.st === "pounce" && cat.pounce > 0.22) { sy = 0.95; sx = 1.03; }  // crouch, about to spring
    if (cat.air) { tilt = -0.12 * (cat.air.then === "eat" ? 1 : -1); }
    if (cat.perch) { bob = Math.abs(Math.sin(cat.phase * 2)) * h * 0.02; }
    if (pose.st === "nap") { var br = 1 + Math.sin(performance.now() / 650) * 0.02; sy = br; sx = 1 + (br - 1) * 0.4; }
    if (pose.st === "sit" && cat.blink > 0) sy = 1 - Math.sin(cat.blink / 0.25 * Math.PI) * 0.03;
    var flip = cat.facing === stc.faces ? 1 : -1;
    var sh = stc.shadow || { y: 0.02, w: 0.4, h: 0.07 };
    ctx.save();
    var shadowA = cat.air ? 0.15 : 0.32 - 0.1 * walk * Math.abs(Math.sin(cat.phase * 2));
    ctx.fillStyle = "rgba(0,0,0," + shadowA + ")";
    ctx.beginPath();
    ctx.ellipse(sp[0], sp[1] - h * sh.y, w * sh.w, Math.max(2, h * sh.h), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    if (cat.id === state.selected && !cat.air && !cat.perch) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,230,120,0.85)";
      ctx.lineWidth = Math.max(2, base * 0.02);
      ctx.beginPath();
      ctx.ellipse(sp[0], sp[1] - h * sh.y, w * (sh.w + 0.08), Math.max(3, h * (sh.h + 0.03)), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.translate(sp[0], sp[1] - bob - lift);
    ctx.rotate(tilt * flip);
    ctx.scale(sx * flip, sy);
    var legs = pose.st === "walk" && pose.moving ? stc.legs : null;
    var swingAmt = legs ? Math.sin(cat.phase) * legs.swing * (running ? 1.5 : 1) * walk : 0;
    drawSprite(im, legs, w, h, swingAmt);
    ctx.restore();
    cat._box = [sp[0] - w / 2, sp[1] - h * sy - lift - bob, sp[0] + w / 2, sp[1] - lift];
    // keep tap target reasonable for small poses
    if (cat._box[3] - cat._box[1] < base * 0.6) cat._box[1] = cat._box[3] - base * 0.6;
    cat._head = [sp[0] + w * 0.3 * cat.facing, sp[1] - h * sy - bob - lift];
    if (pose.st === "nap") drawZzz(cat, sp[0] + w * 0.25 * (stc.faces * flip), sp[1] - h * sy);
  }
  function drawZzz(cat, x, y) {
    var t = performance.now() / 1000;
    ctx.save();
    ctx.fillStyle = "#e8f0ff"; ctx.strokeStyle = "rgba(20,30,60,.8)"; ctx.lineWidth = 3;
    for (var i = 0; i < 3; i++) {
      var k = (t * 0.5 + i / 3) % 1;
      var fs = 12 + 10 * k;
      ctx.globalAlpha = 1 - k;
      ctx.font = "bold " + fs + "px 'Trebuchet MS', sans-serif";
      ctx.strokeText("z", x + k * 18, y - k * 40);
      ctx.fillText("z", x + k * 18, y - k * 40);
    }
    ctx.restore();
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
    var age = cat.bubble.max - cat.bubble.t;
    var pop = Math.min(1, 0.6 + age * 4);
    ctx.translate(x, y); ctx.scale(pop, pop);
    var bad = /Hiss|Pounce|Bad/.test(cat.bubble.text);
    ctx.fillStyle = bad ? "#ffe0e0" : "#ffffff";
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

  /* critter sprites (drawn) */
  function drawSpider(k) {
    var cfg = C.critters.spider;
    var base = depthScale(k.y) * view.ih;
    var s = base * cfg.size;                       // body+legs width
    var p = toScreen([k.x, k.y]);
    var hang = k.drop * k.dropFrom * view.ih;      // still coming down the thread
    var y = p[1] - s * 0.35 - hang;
    var t = performance.now() / 1000;
    ctx.save();
    // thread
    if (k.drop > 0 || k.t < 4) {
      ctx.strokeStyle = "rgba(255,255,255," + (k.drop > 0 ? 0.7 : Math.max(0, 0.7 - (k.t - 2) * 0.3)) + ")";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(p[0], Math.max(view.iy, p[1] - k.dropFrom * view.ih - s)); ctx.lineTo(p[0], y); ctx.stroke();
    }
    // shadow
    if (k.drop < 0.6) {
      ctx.fillStyle = "rgba(0,0,0," + (0.3 * (1 - k.drop)) + ")";
      ctx.beginPath(); ctx.ellipse(p[0], p[1], s * 0.45, s * 0.12, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.translate(p[0], y);
    var wig = k.moving || k.drop > 0 ? Math.sin(t * 18) * 0.25 : Math.sin(t * 2) * 0.05;
    ctx.strokeStyle = "#1b1410"; ctx.lineWidth = Math.max(1.5, s * 0.06); ctx.lineCap = "round";
    for (var side = -1; side <= 1; side += 2) {
      for (var i = 0; i < 4; i++) {
        var ang = (-0.6 + i * 0.4) + (i % 2 ? wig : -wig);
        var kx = side * s * 0.28, ky = Math.sin(ang) * s * 0.25 - s * 0.05;
        ctx.beginPath();
        ctx.moveTo(side * s * 0.1, 0);
        ctx.quadraticCurveTo(kx, ky - s * 0.18, side * s * (0.42 + 0.03 * i), ky + s * 0.18);
        ctx.stroke();
      }
    }
    ctx.fillStyle = "#2a1f1a";
    ctx.beginPath(); ctx.ellipse(0, -s * 0.02, s * 0.2, s * 0.17, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#3a2c24";
    ctx.beginPath(); ctx.arc(0, -s * 0.2, s * 0.11, 0, Math.PI * 2); ctx.fill();
    // cute eyes
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(-s * 0.045, -s * 0.22, s * 0.045, 0, Math.PI * 2); ctx.arc(s * 0.045, -s * 0.22, s * 0.045, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#000";
    ctx.beginPath(); ctx.arc(-s * 0.04, -s * 0.215, s * 0.022, 0, Math.PI * 2); ctx.arc(s * 0.05, -s * 0.215, s * 0.022, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function drawMouse(k) {
    var cfg = C.critters.mouse;
    var L = depthScale(k.y) * view.ih * cfg.size;   // nose-to-rump length
    var p = toScreen([k.x, k.y]);
    var t = performance.now() / 1000;
    var hop = k.moving ? Math.abs(Math.sin(t * 22)) * L * 0.05 : 0;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.3)";
    ctx.beginPath(); ctx.ellipse(p[0], p[1], L * 0.5, L * 0.1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.translate(p[0], p[1] - hop);
    ctx.scale(k.facing, 1);
    // tail
    ctx.strokeStyle = "#d99aa0"; ctx.lineWidth = Math.max(1.5, L * 0.04); ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-L * 0.42, -L * 0.12);
    var tw = Math.sin(t * 8) * L * 0.08;
    ctx.bezierCurveTo(-L * 0.7, -L * 0.1 + tw, -L * 0.8, -L * 0.35 - tw, -L * 0.95, -L * 0.25);
    ctx.stroke();
    // body
    ctx.fillStyle = "#9a9aa2";
    ctx.beginPath(); ctx.ellipse(-L * 0.05, -L * 0.2, L * 0.4, L * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    // head
    ctx.beginPath(); ctx.ellipse(L * 0.32, -L * 0.2, L * 0.17, L * 0.13, 0.15, 0, Math.PI * 2); ctx.fill();
    // ear
    ctx.fillStyle = "#b5b5bd";
    ctx.beginPath(); ctx.arc(L * 0.22, -L * 0.36, L * 0.1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#f2b3bb";
    ctx.beginPath(); ctx.arc(L * 0.22, -L * 0.36, L * 0.06, 0, Math.PI * 2); ctx.fill();
    // eye, nose
    ctx.fillStyle = "#111";
    ctx.beginPath(); ctx.arc(L * 0.36, -L * 0.24, L * 0.03, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#f08a9a";
    ctx.beginPath(); ctx.arc(L * 0.49, -L * 0.18, L * 0.035, 0, Math.PI * 2); ctx.fill();
    // feet
    ctx.fillStyle = "#e9b5bb";
    var f = k.moving ? Math.sin(t * 22) * L * 0.05 : 0;
    ctx.beginPath(); ctx.ellipse(L * 0.12 + f, -L * 0.02, L * 0.05, L * 0.025, 0, 0, Math.PI * 2);
    ctx.ellipse(-L * 0.25 - f, -L * 0.02, L * 0.05, L * 0.025, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function drawCritter(k) { if (k.caught) return; if (k.type === "spider") drawSpider(k); else drawMouse(k); }

  /* snacks */
  function drawSnack(sn) {
    if (sn.state === "eaten" && !catIds.some(function (id) { return cats[id].perch; })) return;
    var s = sn.surf.size * view.ih;
    var p = toScreen([sn.x, sn.y]);
    var eatK = sn.state === "eaten" ? Math.max(0.2, 1 - (sn.eatT = (sn.eatT || 0) + 0.016) * 0.6) : 1;
    var glow = sn.state !== "eaten" ? 0.5 + 0.5 * Math.sin(performance.now() / 250) : 0;
    ctx.save();
    ctx.translate(p[0], p[1]);
    // plate
    ctx.fillStyle = "rgba(0,0,0,.25)";
    ctx.beginPath(); ctx.ellipse(0, 0, s * 0.95, s * 0.22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#f4f4f0"; ctx.strokeStyle = "#c9c9c2"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(0, -s * 0.05, s * 0.9, s * 0.2, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (glow) {
      ctx.strokeStyle = "rgba(255,220,80," + (0.4 + 0.5 * glow) + ")"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(0, -s * 0.05, s * 1.0, s * 0.26, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.scale(eatK, eatK);
    if (sn.item.id === "salmon") {
      ctx.fillStyle = "#f08a5d";
      ctx.beginPath();
      ctx.moveTo(-s * 0.7, -s * 0.15);
      ctx.quadraticCurveTo(-s * 0.1, -s * 0.65, s * 0.45, -s * 0.25);
      ctx.lineTo(s * 0.75, -s * 0.45); ctx.lineTo(s * 0.7, -s * 0.05); ctx.lineTo(s * 0.45, -s * 0.15);
      ctx.quadraticCurveTo(-s * 0.1, s * 0.05, -s * 0.7, -s * 0.15);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = Math.max(1, s * 0.05);
      for (var i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(-s * 0.35 + i * s * 0.25, -s * 0.4); ctx.lineTo(-s * 0.3 + i * s * 0.25, -s * 0.12); ctx.stroke(); }
      ctx.fillStyle = "#222"; ctx.beginPath(); ctx.arc(-s * 0.5, -s * 0.22, s * 0.05, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = "#f3eadc";
      ctx.beginPath(); ctx.ellipse(s * 0.5, -s * 0.2, s * 0.09, s * 0.07, 0, 0, Math.PI * 2); ctx.ellipse(s * 0.56, -s * 0.12, s * 0.09, s * 0.07, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(s * 0.15, -s * 0.2, s * 0.38, s * 0.07);
      ctx.fillStyle = "#b8682e";
      ctx.beginPath(); ctx.ellipse(-s * 0.15, -s * 0.25, s * 0.42, s * 0.27, -0.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,220,160,.5)";
      ctx.beginPath(); ctx.ellipse(-s * 0.25, -s * 0.35, s * 0.18, s * 0.08, -0.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  function drawTreat(tr) {
    var p = toScreen([tr.x, tr.y]);
    var s = depthScale(tr.y) * view.ih * 0.08;
    var bounce = tr.t < 0.4 ? Math.sin(tr.t / 0.4 * Math.PI) * s * 2 : 0;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.3)";
    ctx.beginPath(); ctx.ellipse(p[0], p[1], s * 1.4, s * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#a0602a"; ctx.strokeStyle = "#6b3c16"; ctx.lineWidth = 1.5;
    [[-0.6, -0.3], [0.5, -0.4], [0, -0.7], [-0.1, -0.2], [0.7, -0.15]].forEach(function (o) {
      ctx.beginPath(); ctx.arc(p[0] + o[0] * s, p[1] + o[1] * s - bounce, s * 0.45, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });
    ctx.restore();
  }
  function drawPopups(dt) {
    state.popups = state.popups.filter(function (q) { q.t += dt; return q.t < 1.3; });
    state.popups.forEach(function (q) {
      var p = toScreen([q.x, q.y]);
      var fs = Math.max(16, Math.min(28, view.ih * 0.06));
      ctx.save();
      ctx.globalAlpha = Math.min(1, 2.2 - q.t * 1.7);
      ctx.font = "900 " + fs + "px 'Trebuchet MS', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.lineWidth = 4; ctx.strokeStyle = "rgba(0,0,0,.7)";
      ctx.fillStyle = q.good ? "#7dff8a" : "#ff6b6b";
      var y = p[1] - q.t * 50;
      ctx.strokeText(q.text, p[0], y); ctx.fillText(q.text, p[0], y);
      ctx.restore();
    });
  }
  function drawPoofs(dt) {
    state.poofs = state.poofs.filter(function (q) { q.t += dt; return q.t < 0.6; });
    state.poofs.forEach(function (q) {
      var x = q.x + q.vx * q.t, y = q.y + q.vy * q.t + 0.08 * q.t * q.t;
      var p = toScreen([x, y]);
      ctx.save();
      ctx.globalAlpha = 1 - q.t / 0.6;
      ctx.fillStyle = q.color;
      ctx.beginPath(); ctx.arc(p[0], p[1], q.star ? 3 : 4 + q.t * 8, 0, Math.PI * 2); ctx.fill();
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
    (r.surfaces || []).forEach(function (sf) {
      ctx.strokeStyle = "rgba(255,220,0,0.9)"; ctx.fillStyle = "rgba(255,220,0,0.15)";
      ctx.beginPath();
      sf.poly.forEach(function (p, i) { var s = toScreen(p); if (i) ctx.lineTo(s[0], s[1]); else ctx.moveTo(s[0], s[1]); });
      ctx.closePath(); ctx.fill(); ctx.stroke();
      var f = toScreen(sf.from); ctx.fillStyle = "#ff0"; ctx.fillRect(f[0] - 4, f[1] - 4, 8, 8);
    });
    (r.doors || []).forEach(function (d) { var s = toScreen(d.floor); ctx.fillStyle = "#0ff"; ctx.fillRect(s[0] - 4, s[1] - 4, 8, 8); });
    ctx.restore();
  }

  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    try {
      if (!state.paused) {
        updateRound(dt);
        updateAI(dt);
        updateCritters(dt);
        updateSnack(dt);
        updateTreat(dt);
        catIds.forEach(function (id) { updateCat(cats[id], dt); });
      } else dt = 0;
      ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      drawBackground();
      if (DEBUG) drawDebug();
      drawRipples(dt);
      if (state.snack) drawSnack(state.snack);
      if (state.treat) drawTreat(state.treat);
      // depth-sort cats + critters (a cat on a counter sorts by the floor spot it jumped from)
      var items = [];
      catIds.forEach(function (id) {
        var c = cats[id];
        var key = (c.perch || c.air) && c.snackGoal ? c.snackGoal.surf.from[1] - 0.001 : c.y;
        items.push({ y: key, draw: function () { drawCat(c); } });
      });
      state.critters.forEach(function (k) { if (k.room === state.room) items.push({ y: k.y, draw: function () { drawCritter(k); } }); });
      items.sort(function (a, b) { return a.y - b.y; }).forEach(function (it) { it.draw(); });
      drawPoofs(dt);
      catIds.forEach(function (id) { drawBubble(cats[id]); });
      drawPopups(dt);
    } catch (err) {
      state.errors.push(String(err));
      if (state.errors.length < 3) console.error(err);
    }
    requestAnimationFrame(frame);
  }

  /* ---------- boot ---------- */
  canvas.addEventListener("pointerdown", onPointer);
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
    state.critterTimer = DEBUG ? 3 : rnd(6, 14);
    state.snackTimer = DEBUG ? 4 : rnd(10, 20);
    (r.doors || []).forEach(function (d) { loadImg(imgDir + rooms[d.to].image); });
  })();
  selectCat(state.selected, true);
  scoreEl.textContent = state.score; bestEl.textContent = state.best;
  if (DEBUG) { debugEl.hidden = false; }

  // debug: ?spawn=spider|mouse|snack (comma list), ?nochase=1, ?round=1, ?roundsecs=N, ?nohelp=1, ?napafter=N
  if (params.get("napafter")) C.nap.after = +params.get("napafter");
  if (params.get("nochase") === "1") { C.ai.chaseChance = 0; C.ai.debugChaseMin = C.ai.debugChaseMax = 1e9; state.chaseTimer = 1e9; }
  if (params.get("nocritters") === "1") { state.critterTimer = 1e9; C.critters.debugSpawnMin = C.critters.debugSpawnMax = C.critters.spawnMin = C.critters.spawnMax = 1e9; }
  if (params.get("nosnacks") === "1") { state.snackTimer = 1e9; C.snacks.debugSpawnMin = C.snacks.debugSpawnMax = C.snacks.spawnMin = C.snacks.spawnMax = 1e9; }
  (params.get("spawn") || "").split(",").forEach(function (s) {
    if (s === "spider" || s === "mouse") setTimeout(function () { spawnCritter(s, state.room); }, 600);
    if (s === "snack") setTimeout(spawnSnack, 600);
  });
  var seen = store.get("seenHelp", 0);
  if (params.get("round") === "1") startRound();
  else if (params.get("nohelp") === "1" || seen) hideOverlays();
  else showHelp();
  requestAnimationFrame(frame);

  window.__game = {
    state: state, cats: cats, rooms: rooms, view: view, config: C,
    inPoly: inPoly, toScreen: toScreen, startChase: startChase,
    spawnCritter: spawnCritter, spawnSnack: spawnSnack, dropTreat: dropTreat,
    putAwaySnack: putAwaySnack, startRound: startRound, endRound: endRound, addScore: addScore,
    setTreatMode: setTreatMode,
    goTo: function (to) { var d = (room().doors || []).filter(function (x) { return x.to === to; })[0]; if (d) goTo(d); return !!d; }
  };

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").then(function () { window.__swRegistered = true; })
        .catch(function (err) { console.warn("SW failed", err); });
    });
  }
})();
