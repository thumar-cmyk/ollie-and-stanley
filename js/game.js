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
  function newStats() { return { spiders: 0, mice: 0, stolen: 0, saved: 0, escaped: 0, caught: 0, treats: 0, naps: 0, mischief: 0, cups: 0, couch: 0, play: 0 }; }
  function newCatStats() { var o = {}; Object.keys(C.cats).forEach(function (id) { o[id] = { critters: 0, nap: 0 }; }); return o; }
  state.stats = newStats();
  state.catStats = newCatStats();

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
      air: null, perch: null, snackGoal: null, treatGoal: null,
      room: null, task: null, doorGoal: null, roamT: rnd(C.roam.every[0], C.roam.every[1]), afterLand: null
    };
  });
  var catIds = Object.keys(cats);
  function other(id) { return catIds.filter(function (c) { return c !== id; })[0]; }
  function room() { return rooms[state.room]; }
  function R(cat) { return rooms[cat.room]; }
  function visible(cat) { return cat.room === state.room; }
  function depthScale(y, r) {
    var d = (r || room()).depth;
    return d.s1 + (d.s2 - d.s1) * (y - d.y1) / (d.y2 - d.y1);
  }
  function catScale(cat) { return cat.scaleOverride || depthScale(cat.y, R(cat)); }
  function catsIn(roomId) { return catIds.map(function (id) { return cats[id]; }).filter(function (c) { return c.room === roomId; }); }

  /* ---------- score ---------- */
  function addScore(n, at, label, roomId) {
    state.score += n;
    if (state.score < 0) state.score = 0;
    if (state.score > state.best) { state.best = state.score; store.set("best", state.best); }
    scoreEl.textContent = state.score;
    bestEl.textContent = state.best;
    scoreEl.parentNode.classList.remove("bump", "bump-neg");
    void scoreEl.parentNode.offsetWidth;
    scoreEl.parentNode.classList.add(n >= 0 ? "bump" : "bump-neg");
    var txt = (n >= 0 ? "+" : "") + n + (label ? " " + label : "");
    if (at && (!roomId || roomId === state.room)) state.popups.push({ x: at[0], y: at[1], text: txt, good: n >= 0, t: 0 });
    else if (at && roomId) showWarn(txt + " (" + rooms[roomId].name + ")", 2.2);
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
      b.innerHTML = '<span class="arr">' + ARROWS[d.arrow] + '</span><span class="lbl">' + rooms[d.to].name + '</span><span class="badge"></span><span class="faces"></span>';
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
  function nextHop(target, from) {
    var start = from || state.room;
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
    var faces = {};
    catIds.forEach(function (id) {
      var c = cats[id];
      if (c.room === state.room) return;
      var hop = nextHop(c.room);
      if (hop) (faces[hop] = faces[hop] || []).push(id);
    });
    var key = JSON.stringify(marks) + JSON.stringify(faces) + state.room;
    if (key === lastBadgeKey) return;
    lastBadgeKey = key;
    Array.prototype.forEach.call(hotLayer.querySelectorAll(".door[data-to]"), function (b) {
      var m = marks[b.dataset.to] || "";
      b.querySelector(".badge").textContent = m.slice(0, 4);
      b.classList.toggle("has-critter", !!m);
      var fb = b.querySelector(".faces");
      fb.innerHTML = (faces[b.dataset.to] || []).map(function (id) { return '<img src="' + cats[id].cfg.face + '" alt="' + cats[id].cfg.name + '">'; }).join("");
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
    if (cat.perch && cat.perch.obj) cat.perch.obj.occupied = null;
    if (cat.perch && cat.perch.spot) cat.perch.spot.occupied = null;
    if (cat.task && cat.task.spot) cat.task.spot.occupied = null;
    cat.sunny = null; cat.rollT = 0;
    cat.mode = "idle"; cat.path = []; cat.bubble = null; cat.air = null; cat.perch = null;
    cat.scaleOverride = null; cat.snackGoal = null; cat.treatGoal = null; cat.napT = 0; cat.idleTotal = 0;
    cat.task = null; cat.doorGoal = null; cat.afterLand = null; cat.sortY = null;
  }
  // Put a cat into a room at the door that leads back to where it came from.
  function placeCat(cat, roomId, fromId, offset) {
    var r = rooms[roomId];
    resetCatForRoom(cat);
    cat.room = roomId;
    var back = (r.doors || []).filter(function (d) { return d.to === fromId; })[0];
    var p = clampToFloor(back ? back.floor : r.spawn, r.floor);
    cat.x = p[0] + (offset || 0); cat.y = p[1];
    var q = clampToFloor([cat.x, cat.y], r.floor); cat.x = q[0]; cat.y = q[1];
    var c = centroid(r.floor);
    walkTo(cat, clampToFloor([p[0] + (c[0] - p[0]) * 0.35, p[1] + (c[1] - p[1]) * 0.35], r.floor));
  }
  function setView(roomId, toastText) {
    state.room = roomId;
    var r = rooms[roomId];
    loadImg(imgDir + r.image);
    buildHotspots();
    var here = state.critters.filter(function (k) { return k.room === roomId; });
    showToast(toastText || (r.name + (here.length ? "  \u2014  " + (here[0].type === "spider" ? "a spider!" : "a mouse!") : "")));
    (r.doors || []).forEach(function (d) { loadImg(imgDir + rooms[d.to].image); });
    if (state.treat && state.treat.room !== roomId) state.treat = null;
  }
  function enterRoom(id, fromId) {
    var sel = cats[state.selected];
    placeCat(sel, id, fromId);
    setView(id);
    var oth = cats[other(state.selected)];
    if (oth.room === id) say(oth, oth.id === "stanley" ? "Hmm?" : "Mrrp!", 1);
    state.chaseTimer = Math.max(state.chaseTimer, 3);
  }
  // Fade the view over to another room (e.g. when picking the other cat).
  function fadeToView(roomId, cb) {
    if (state.transitioning) return;
    state.transitioning = true;
    fadeEl.classList.add("on");
    setTimeout(function () {
      var go = function () { setView(roomId); fadeEl.classList.remove("on"); state.transitioning = false; if (cb) cb(); };
      var im = loadImg(imgDir + rooms[roomId].image);
      if (im.complete) go(); else { im.onload = go; im.onerror = go; }
    }, 260);
  }
  function goTo(door) {
    if (state.transitioning || state.paused) return;
    var sel = cats[state.selected];
    if (sel.air || sel.mode === "scuffle") return;
    state.transitioning = true;
    setTreatMode(false);
    sfx("door");
    if (sel.perch || sel.air) { if (sel.perch && sel.perch.obj) sel.perch.obj.occupied = null; sel.air = null; sel.perch = null; sel.scaleOverride = null; }
    sel.snackGoal = null; sel.task = null;
    if (cats.stanley && cats.stanley.mode === "chase") { cats.stanley.mode = "idle"; cats.stanley.path = []; }
    var target = clampToFloor(door.floor, room().floor);
    walkTo(sel, target);
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
  // AI cats use doors on their own.
  function aiTravel(cat, door) {
    walkTo(cat, door.floor, "toDoor");
    cat.doorGoal = door;
  }
  function arriveDoor(cat) {
    var door = cat.doorGoal, from = cat.room;
    var wasVisible = visible(cat);
    placeCat(cat, door.to, from, 0.02);
    if (visible(cat)) {
      showWarn(cat.cfg.name + " came in!", 1.8);
      say(cat, cat.id === "stanley" ? "\uD83D\uDE3C" : "Mrrp!", 1.2);
      if (cat.id === "stanley" && state.selected === "ollie") state.chaseTimer = Math.min(state.chaseTimer, rnd(2, 5));
    } else if (wasVisible) showWarn(cat.cfg.name + " wandered off to the " + rooms[door.to].name, 2);
    lastBadgeKey = "";
  }
  function updateRoam(cat, dt) {
    if (cat.id === state.selected || cat.mode !== "idle" || busy(cat) || cat.path.length) return;
    cat.roamT -= dt;
    if (cat.roamT > 0) return;
    var RM = C.roam;
    cat.roamT = params.get("roam") && RM.every[0] < 1e9 ? +params.get("roam") : rnd(RM.every[0], RM.every[1]);
    var r = R(cat), doors = r.doors || [];
    if (!doors.length) return;
    var to = null;
    var ol = cats.ollie;
    if (cat.id === "stanley" && ol && ol.room !== cat.room && Math.random() < RM.stanleySeeksOllie) to = nextHop(ol.room, cat.room);
    else if (Math.random() < RM.wander) to = pick(doors).to;
    if (!to) return;
    var door = doors.filter(function (d) { return d.to === to; })[0];
    if (door) { if (cat.mode === "nap") wake(cat, true); aiTravel(cat, door); }
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
    var r = R(cat);
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
  function busy(cat) { return cat.air || cat.perch || cat.snackGoal || cat.treatGoal || cat.task || cat.doorGoal || cat.mode === "scuffle"; }
  function startChase() {
    var st = cats.stanley, ol = cats.ollie;
    if (!st || !ol || busy(st) || busy(ol) || st.room !== ol.room || st.room !== state.room) return false;
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
      if (state.selected !== "ollie") walkTo(ol, farPointFrom([st.x, st.y], R(ol)), "flee", ol.cfg.fleeSpeed / ol.cfg.speed);
    }, 250);
    return true;
  }
  function updateAI(dt) {
    var st = cats.stanley, ol = cats.ollie;
    if (!st || state.transitioning) return;
    if (st.mode === "chase" && (st.room !== ol.room)) { st.mode = "idle"; st.path = []; }
    if (st.mode === "chase") {
      st.chaseT -= dt;
      var target = [ol.x, ol.y];
      st.path = [target];
      st.speedMul = st.cfg.chaseSpeed / st.cfg.speed;
      var reach = 0.05 * depthScale(st.y, R(st)) / 0.15;
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
    if (st.room !== ol.room || st.room !== state.room) return;
    if (state.snack || state.treat) return; // he's distracted
    state.chaseTimer -= dt;
    if (state.chaseTimer <= 0) {
      state.chaseTimer = nextChaseDelay();
      if (DEBUG || Math.random() < C.ai.chaseChance) startChase();
    }
  }
  function endScuffle() {
    var st = cats.stanley, ol = cats.ollie, r = R(st);
    st.mode = "idle"; ol.mode = "idle";
    say(ol, "Mrrp!", 1.2);
    walkTo(ol, farPointFrom([st.x, st.y], r), "walk", 1.3);
    walkTo(st, clampToFloor([st.x + (st.x > ol.x ? 0.08 : -0.08), st.y + 0.02], r.floor), "walk");
    state.chaseTimer = nextChaseDelay();
  }

  /* ---------- critters ---------- */
  var critterId = 0;
  function nearestCatDist(p, roomId) {
    var cs = catsIn(roomId);
    if (!cs.length) return 9;
    return Math.min.apply(0, cs.map(function (c) { return hdist(p, [c.x, c.y]); }));
  }
  function spawnCritter(type, roomId) {
    var CC = C.critters;
    type = type || (Math.random() < 0.55 ? "spider" : "mouse");
    if (!roomId) {
      var ids = Object.keys(rooms);
      roomId = Math.random() < CC.currentRoomChance ? state.room : pick(ids.filter(function (i) { return i !== state.room; }));
    }
    if (state.critters.some(function (c) { return c.room === roomId && c.type === type; })) return null;
    var r = rooms[roomId];
    var k = { id: ++critterId, type: type, room: roomId, life: CC[type].life, t: 0, facing: 1, pause: 0, caught: 0, noticeT: rnd(4, 9) };
    if (type === "spider") {
      var p = randomIn(r.floor);
      for (var tries = 0; tries < 10 && nearestCatDist(p, roomId) < 0.2; tries++) p = randomIn(r.floor);
      k.x = p[0]; k.y = p[1];
      k.drop = 1;                 // 1 = at top of thread, 0 = on floor
      k.dropFrom = CC.spider.dropFrom;
      k.target = null;
    } else {
      // enter from the door farthest from the cats so it isn't caught instantly
      var doors = (r.doors || []).length ? r.doors : [{ floor: r.spawn }];
      var d = doors[0], bestD = -1;
      doors.forEach(function (dd) {
        var m = catsIn(roomId).length ? nearestCatDist(dd.floor, roomId) : Math.random();
        if (m > bestD) { bestD = m; d = dd; }
      });
      var q = clampToFloor(d.floor, r.floor);
      if (catsIn(roomId).length && bestD < 0.25) { var c0 = catsIn(roomId)[0]; q = farPointFrom([c0.x, c0.y], r); }
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
      var r = rooms[k.room], cfg = CC[k.type];
      if (k.type === "spider" && k.drop > 0) {
        k.drop = Math.max(0, k.drop - dt * 0.45);
        return true;
      }
      if (k.pause > 0) { k.pause -= dt; return true; }
      if (!k.target) k.target = randomIn(r.floor);
      var dx = k.target[0] - k.x, dy = k.target[1] - k.y, d = Math.hypot(dx, dy);
      var persp = Math.max(0.35, depthScale(k.y, r) / r.depth.s2);
      var v = cfg.speed * persp * dt;
      // the mouse runs away from nearby cats
      if (k.type === "mouse") {
        catsIn(k.room).forEach(function (c) {
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
    state.critters.forEach(function (k) {
      if (k.caught || k.drop > 0.15) return;
      // AI cats notice critters in their room after a few seconds and hunt them
      catsIn(k.room).forEach(function (c) {
        if (c.id === state.selected || c.mode === "nap" && k.t < 15) return;
        if (busy(c) || c.mode === "chase" || c.mode === "flee") return;
        if (c.mode === "hunt") {
          c.huntT = (c.huntT || 0) - dt;
          if (c.huntT <= 0) { c.huntT = 0.4; walkTo(c, [k.x, k.y], "hunt", 1.15); }
          return;
        }
        if (state.noHunt) return;
        k.noticeT -= dt / catsIn(k.room).length;
        if (k.noticeT <= 0) { c.huntT = 0.4; walkTo(c, [k.x, k.y], "hunt", 1.15); say(c, "!", 0.8); }
      });
      // catches
      catsIn(k.room).forEach(function (c) {
        if (k.caught || c.perch || c.air || c.mode === "nap") return;
        var reach = Math.max(0.03, catScale(c) * 0.33);
        if (hdist([c.x, c.y], [k.x, k.y]) < reach) catchCritter(c, k);
      });
    });
    catIds.forEach(function (id) {
      var c = cats[id];
      if (c.mode === "hunt" && !state.critters.some(function (k) { return k.room === c.room && !k.caught; })) { c.mode = c.path.length ? "walk" : "idle"; }
    });
    updateDoorBadges();
  }
  function catchCritter(cat, k) {
    k.caught = 0.01;
    cat.pounce = 0.45;
    cat.facing = k.x > cat.x ? 1 : -1;
    if (cat.mode === "hunt") { cat.mode = "idle"; cat.path = []; }
    var pts = k.type === "spider" ? SC.spider : SC.mouse;
    if (k.type === "spider") state.stats.spiders++; else state.stats.mice++;
    state.catStats[cat.id].critters++;
    say(cat, k.type === "spider" ? "Got it!" : "Gotcha!", 1.2);
    addScore(pts, [k.x, k.y - catScale(cat) * 0.5], k.type + (cat.id !== state.selected ? " (" + cat.cfg.name + ")" : ""), k.room);
    if (k.room === state.room) { poof(k.x, k.y, k.type === "spider" ? "#333" : "#999"); sfx("catch"); }
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

  /* ---------- hops (counter / cat tree) ---------- */
  // Jump from where the cat is to `to`, scaling from its current size to `s1`.
  function hop(cat, to, s1, opts) {
    opts = opts || {};
    var s0 = catScale(cat);
    cat.path = [];
    cat.mode = "jump";
    cat.air = { from: [cat.x, cat.y], to: to.slice(), t: 0, dur: opts.dur || 0.55, h: opts.h || 0.12, then: opts.then || "land", s0: s0, s1: s1 };
    cat.scaleOverride = s0;
    if (opts.sortY != null) cat.sortY = opts.sortY;
    if (Math.abs(to[0] - cat.x) > 0.005) cat.facing = to[0] > cat.x ? 1 : -1;
    if (visible(cat)) sfx("hop");
  }
  function hopDown(cat, after) {
    var p = cat.perch;
    if (!p) return;
    if (p.obj && p.obj.occupied === cat.id) p.obj.occupied = null;
    if (p.spot && p.spot.occupied === cat.id) p.spot.occupied = null;
    if (p.nap) cat.sunny = null;
    cat.perch = null; cat.scratchT = 0;
    var from = clampToFloor(p.from || [cat.x, 0.9], R(cat).floor);
    cat.afterLand = after || null;
    hop(cat, from, depthScale(from[1], R(cat)), { dur: p.kind === "tree" ? 0.7 : 0.5, h: 0.05, then: "land" });
  }

  /* ---------- snacks ---------- */
  function spawnSnack(roomId) {
    if (state.snack || state.transitioning) return null;
    if (!roomId) {
      var cand = Object.keys(rooms).filter(function (id) { return rooms[id].surfaces && rooms[id].surfaces.length && catsIn(id).length; });
      if (!cand.length) return null;
      roomId = cand.indexOf(state.room) >= 0 && Math.random() < 0.7 ? state.room : pick(cand);
    }
    var r = rooms[roomId];
    if (!r.surfaces || !r.surfaces.length) return null;
    var surf = pick(r.surfaces);
    var item = pick(C.snacks.items);
    var p = randomIn(surf.poly);
    state.snack = { item: item, surf: surf, x: p[0], y: p[1], t: 0, warnAt: C.snacks.warnDelay, life: C.snacks.life, thief: null, state: "fresh", room: r.id };
    if (r.id === state.room) sfx("ding");
    else showWarn("Someone left " + item.name + " out in the " + r.name + "!", 2.5);
    lastBadgeKey = "";
    return state.snack;
  }
  function chooseThief(sn) {
    var sel = state.selected;
    var prefer = Math.random() < C.snacks.stanleyChance ? "stanley" : "ollie";
    // non-selected cat goes first; the selected one only if it is just sitting around
    var order = prefer === sel ? [other(sel), sel] : [prefer, other(prefer)];
    for (var i = 0; i < order.length; i++) {
      var c = cats[order[i]];
      if (!c || c.room !== sn.room) continue;
      if (busy(c) || c.mode === "chase" || c.mode === "flee") continue;
      if (c.id === sel && c.idleTotal < 4 && c.mode !== "nap") continue;
      return c;
    }
    return null;
  }
  function updateSnack(dt) {
    var S = C.snacks;
    if (!state.snack) {
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
        var thief = chooseThief(sn);
        if (thief) {
          sn.thief = thief.id; sn.state = "targeted";
          wake(thief, true);
          walkTo(thief, sn.surf.from, "toSnack", 0.8);
          thief.snackGoal = sn;
          if (sn.room === state.room) showWarn(thief.cfg.name + " eyes the " + sn.item.name + "\u2026 tap it to put it away!", 3);
          else showWarn(thief.cfg.name + " eyes the " + sn.item.name + " in the " + rooms[sn.room].name + "!", 3);
          say(thief, "\uD83D\uDC40", 1.5);
        } else sn.warnAt = sn.t + 1.5;
      }
    } else if (sn.state === "targeted") {
      var c = cats[sn.thief];
      if (c.snackGoal !== sn || c.room !== sn.room) { c.snackGoal = null; sn.state = "fresh"; sn.thief = null; sn.warnAt = sn.t + 3; return; }
      if (c.mode === "toSnack" && !c.path.length) {
        hop(c, [sn.x, sn.y], depthScale(sn.surf.from[1], R(c)), { then: "eat", sortY: sn.surf.from[1] - 0.001 });
        c.scaleOverride = c.air.s1; c.air.s0 = c.air.s1;
        c.facing = sn.x > c.x ? 1 : -1;
        sn.state = "stealing";
        warnEl.classList.remove("show");
      }
    } else if (sn.state === "stealing" || sn.state === "eaten") {
      var th = cats[sn.thief];
      if (!th || th.room !== sn.room || (!th.air && !th.perch)) state.snack = null;
    }
  }
  function putAwaySnack() {
    var sn = state.snack;
    if (!sn || sn.state === "eaten" || sn.state === "stealing") return false;
    state.stats.saved++;
    addScore(SC.snackSaved, [sn.x, sn.y - 0.04], "saved!", sn.room);
    if (sn.room === state.room) { poof(sn.x, sn.y, "#fff"); sfx("ding"); }
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
    if (a.s1) cat.scaleOverride = a.s1;
    cat.squash = 0.22;
    if (a.then === "eat") {
      var sn = state.snack;
      cat.perch = { t: 1.6, kind: "snack", from: sn ? sn.surf.from : null };
      if (sn) {
        sn.state = "eaten";
        state.stats.stolen++;
        say(cat, "Bad kitty!", 1.8);
        if (visible(cat)) sfx("bad");
        addScore(SC.snackStolen, [sn.x, sn.y - 0.06], cat.cfg.name + " ate it", sn.room);
      }
    } else if (a.then === "cup") {
      var o = cat.task && cat.task.obj;
      cat.task = null;
      cat.perch = { t: 1.4, kind: "cup", obj: o, from: o ? o.from : null };
      cat.facing = o && o.x > cat.x ? 1 : -1;
      cat.swipeT = 0.6;
      if (visible(cat)) sfx("swipe");
      setTimeout(function () { if (o) knockCup(o, cat); }, 300);
    } else if (a.then === "seat") {
      var so = cat.task && cat.task.obj, spt = cat.task && cat.task.spot;
      cat.task = null;
      cat.perch = { t: cat.id === state.selected ? Infinity : rnd(15, 35), kind: "seat", obj: so, spot: spt, from: so ? so.from : null, idle: 0 };
      if (so && so.knead) {
        cat.scratchT = 1.4; if (visible(cat)) sfx("scratch");
        say(cat, "knead knead", 1.2);
        var nk = performance.now() / 1000;
        if (!so.lastPts || nk - so.lastPts > 20) { so.lastPts = nk; state.stats.play++; addScore(1, [cat.x, cat.y - cat.scaleOverride * 0.9], "comfy!", cat.room); }
      } else say(cat, cat.id === "stanley" ? "\uD83D\uDE3C" : "\uD83D\uDE3A", 1);
    } else if (a.then === "tree") {
      var tr = cat.task && cat.task.obj;
      cat.task = null;
      cat.perch = { t: cat.id === state.selected ? Infinity : rnd(8, 16), kind: "tree", obj: tr, from: tr ? tr.from : null, idle: 0 };
      if (tr) tr.occupied = cat.id;
      cat.scratchT = 1.3; cat.facing = -1;
      if (visible(cat)) sfx("scratch");
      var now = performance.now() / 1000;
      if (tr && (!tr.lastPts || now - tr.lastPts > 20)) {
        tr.lastPts = now;
        state.stats.play++;
        addScore(C.objectPoints.tree, [cat.x, cat.y - 0.12], "good scratch!", cat.room);
      } else say(cat, "\uD83D\uDE3A", 1.2);
    } else {
      cat.scaleOverride = null; cat.sortY = null; cat.mode = "idle"; cat.idleTotal = 0;
      cat.snackGoal = null;
      if (cat.afterLand) { var f = cat.afterLand; cat.afterLand = null; f(); }
    }
  }

  /* ---------- objects: cups, couch, cat tree, sun spots, toys ---------- */
  var objects = [];
  Object.keys(rooms).forEach(function (id) {
    (rooms[id].objects || []).forEach(function (o) {
      o.room = id; o.state = "ok";
      if (o.type === "toy") { o.home = [o.x, o.y]; o.vx = 0; o.vy = 0; o.spin = 0; }
      objects.push(o);
    });
  });
  function inRect(p, r) { return p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3]; }
  function freeSpots(o, cat) { return (o.spots || []).filter(function (s) { return !s.occupied || s.occupied === cat.id; }); }
  function objHit(o, p, sx, sy) {
    if (o.rect) return inRect(p, o.rect);
    var s = toScreen([o.x, o.y]);
    if (o.type === "sun") return Math.abs(p[0] - o.x) < o.rx * 1.2 && Math.abs(p[1] - o.y) < o.ry * 1.6;
    if (o.type === "cup") { if (o.state !== "ok") return false; var r = Math.max(26, o.size * view.ih * 0.9); return Math.hypot(sx - s[0], sy - (s[1] - o.size * view.ih * 0.5)) < r; }
    if (o.type === "toy") return Math.hypot(sx - s[0], sy - s[1]) < Math.max(26, depthScale(o.y) * view.ih * 0.25);
    return false;
  }
  function objectAt(p, sx, sy) {
    var hits = objects.filter(function (o) { return o.room === state.room && objHit(o, p, sx, sy); });
    var order = { cup: 0, toy: 1, sun: 2, couch: 3, tree: 4, seat: 5, rug: 6 };
    hits.sort(function (a, b) { return order[a.type] - order[b.type]; });
    return hits[0] || null;
  }
  function canUse(cat, o) {
    if (o.room !== cat.room) return false;
    if (o.type === "cup") return o.state === "ok" && !objects.some(function (q) { return q === o && q.claimed && q.claimed !== cat.id; });
    if (o.type === "tree") return !o.occupied || o.occupied === cat.id;
    if (o.type === "seat") return freeSpots(o, cat).length > 0;
    return true;
  }
  function useObject(cat, o, tap) {
    if (!canUse(cat, o)) { say(cat, o.type === "cup" ? "Already broken\u2026" : "Taken!", 1.2); return false; }
    wake(cat, true);
    cat.snackGoal = null; cat.treatGoal = null;
    var target = o.type === "sun" || o.type === "toy" ? [o.x, o.y] : o.from;
    if (o.type === "toy") target = [o.x - 0.03 * (o.x > cat.x ? 1 : -1), o.y];
    var spot = null;
    if (o.type === "seat") {
      var fs = freeSpots(o, cat);
      spot = tap ? fs.slice().sort(function (a, b) { return hdist(a, tap) - hdist(b, tap); })[0] : pick(fs);
      spot.occupied = cat.id;
    }
    if (o.type === "rug") {
      // roll where you are if already on the rug, else walk onto it first
      if (inRect([cat.x, cat.y], o.rect) && inPoly([cat.x, cat.y], R(cat).floor)) { cat.task = { obj: o }; cat.path = []; arriveObj(cat); return true; }
      for (var i = 0; i < 30; i++) { target = [rnd(o.rect[0], o.rect[2]), rnd(o.rect[1], o.rect[3])]; if (inPoly(target, R(cat).floor)) break; }
    }
    walkTo(cat, target, "toObj");
    cat.task = { obj: o, spot: spot };
    if (o.type === "cup") o.claimed = cat.id;
    return true;
  }
  function arriveObj(cat) {
    var o = cat.task.obj;
    if (o.type === "cup") {
      o.claimed = null;
      if (o.state !== "ok") { cat.task = null; cat.mode = "idle"; say(cat, "Hmm.", 1); return; }
      var side = o.from[0] < o.x ? -1 : 1;
      hop(cat, [o.x + side * 0.03, o.y], depthScale(o.from[1], R(cat)), { then: "cup", sortY: o.from[1] - 0.001 });
      cat.scaleOverride = cat.air.s1; cat.air.s0 = cat.air.s1;
    } else if (o.type === "tree") {
      hop(cat, [o.x, o.y], o.catScale, { then: "tree", dur: 0.8, h: 0.16, sortY: o.sortY });
    } else if (o.type === "couch") {
      cat.task = null;
      cat.mode = "scratch"; cat.scratchT = 2; cat.path = [];
      var cx = (o.rect[0] + o.rect[2]) / 2;
      cat.facing = cx > cat.x ? 1 : -1;
      state.stats.mischief++; state.stats.couch++;
      if (visible(cat)) sfx("scratch");
      say(cat, cat.id === "stanley" ? "\uD83D\uDE3C" : "Scritch!", 1.2);
      addScore(C.objectPoints.couch, [cat.x, cat.y - catScale(cat) * 0.8], "couch!", cat.room);
      o.marks = { x: cx + (cat.x - cx) * 0.6, y: o.rect[3] - 0.06, t: 0 };
    } else if (o.type === "seat") {
      var sp = cat.task.spot;
      var rise = Math.max(0.06, (cat.y - sp[1]) * 0.55);
      hop(cat, [sp[0], sp[1]], sp[2], { then: "seat", dur: 0.55 + rise, h: rise, sortY: o.sortY });
    } else if (o.type === "rug") {
      cat.task = null;
      cat.mode = "roll"; cat.rollT = 2.4; cat.path = [];
      var nowr = performance.now() / 1000;
      if (!o.lastPts || nowr - o.lastPts > 15) { o.lastPts = nowr; state.stats.play++; addScore(1, [cat.x, cat.y - catScale(cat) * 0.8], "roll!", cat.room); }
      say(cat, "\uD83D\uDE38", 1.2);
    } else if (o.type === "sun") {
      cat.task = null;
      startNap(cat, o);
    } else if (o.type === "toy") {
      cat.task = null; cat.mode = "idle";
      kickToy(cat, o);
    }
  }
  function startNap(cat, sun) {
    cat.mode = "nap"; cat.napT = 0; cat.napPts = 0; cat.path = [];
    cat.sunny = sun || null;
    state.stats.naps++;
    say(cat, sun ? "\u2600\uFE0F zzz" : "zzz", 1.2);
  }
  function knockCup(o, cat) {
    if (o.state !== "ok") return;
    o.state = "falling";
    var r = rooms[o.room];
    var dir = cat ? cat.facing : 1;
    var land = clampToFloor([o.x + dir * 0.04, Math.max(o.y + 0.22, o.from[1] - 0.05)], r.floor);
    o.fall = { t: 0, dur: 0.45, from: [o.x, o.y], to: land, dir: dir };
  }
  function updateObjects(dt) {
    objects.forEach(function (o) {
      if (o.type === "cup") {
        if (o.state === "falling") {
          o.fall.t += dt;
          if (o.fall.t >= o.fall.dur) {
            o.state = "broken"; o.brokenT = 0; o.respawn = C.cupRespawn;
            state.stats.mischief++; state.stats.cups++;
            var at = o.fall.to;
            o.shards = [];
            for (var i = 0; i < 9; i++) o.shards.push({ dx: rnd(-0.035, 0.035), dy: rnd(-0.012, 0.012), a: rnd(0, 6.3), s: rnd(0.4, 1) });
            if (o.room === state.room) { sfx("crash"); poof(at[0], at[1], o.glass ? "#dff4ff" : "#fff"); }
            addScore(C.objectPoints.cup, [at[0], at[1] - 0.08], "crash!", o.room);
          }
        } else if (o.state === "broken") {
          o.brokenT += dt; o.respawn -= dt;
          if (o.respawn <= 0) { o.state = "ok"; o.shards = null; if (o.room === state.room) poof(o.x, o.y, "#fff"); }
        }
      } else if (o.type === "toy") {
        var sp = Math.hypot(o.vx, o.vy);
        if (sp > 0.005) {
          var r2 = rooms[o.room];
          var nx = o.x + o.vx * dt, ny = o.y + o.vy * dt;
          if (!inPoly([nx, ny], r2.floor)) { o.vx = -o.vx * 0.6; o.vy = -o.vy * 0.6; nx = o.x; ny = o.y; }
          o.x = nx; o.y = ny;
          o.spin += sp * dt * 60 * (o.vx >= 0 ? 1 : -1);
          var f = Math.max(0, 1 - dt * 1.6);
          o.vx *= f; o.vy *= f;
        } else { o.vx = o.vy = 0; }
      } else if (o.type === "couch" && o.marks) {
        o.marks.t += dt; if (o.marks.t > 3) o.marks = null;
      }
    });
  }
  function kickToy(cat, o) {
    cat.pounce = 0.45;
    cat.facing = o.x > cat.x ? 1 : -1;
    var sp = rnd(0.3, 0.45);
    o.vx = cat.facing * sp; o.vy = rnd(-0.06, 0.06);
    state.stats.play++;
    if (visible(cat)) sfx("roll");
    addScore(C.objectPoints.toy, [o.x, o.y - 0.08], "play!", cat.room);
  }
  // Idle AI cats sometimes go play with something.
  function aiPickObject(cat) {
    var opts = objects.filter(function (o) { return canUse(cat, o) && !(o.type === "sun" && cats[other(cat.id)] && cats[other(cat.id)].sunny === o); });
    if (!opts.length) return false;
    var w = opts.map(function (o) {
      if (cat.id === "stanley") return { cup: 3, couch: 3, tree: 1, toy: 1, sun: 1, seat: 2, rug: 1 }[o.type];
      return { cup: 1, couch: 1, tree: 3, toy: 2, sun: 2, seat: 3, rug: 1 }[o.type];
    });
    var tot = w.reduce(function (a, b) { return a + b; }, 0), x = Math.random() * tot;
    for (var i = 0; i < opts.length; i++) { x -= w[i]; if (x <= 0) return useObject(cat, opts[i]); }
    return false;
  }
  // The player's command for the selected cat; a cat up on the tree hops down first.
  function command(cat, fn) {
    if (cat.mode === "scuffle" || cat.air) return false;
    if (cat.perch) {
      if (cat.perch.kind === "tree" || cat.perch.kind === "seat") { hopDown(cat, fn); return true; }
      return false;
    }
    fn(); return true;
  }

  /* ---------- treats ---------- */
  function setTreatMode(on) {
    state.treatMode = on && state.treatCooldown <= 0;
    treatBtn.classList.toggle("armed", state.treatMode);
    if (state.treatMode) showWarn("Tap the floor to drop a treat", 2);
  }
  function dropTreat(p) {
    var r = room();
    var t = clampToFloor(p, r.floor);
    state.treat = { x: t[0], y: t[1], t: 0, room: r.id };
    state.treatCooldown = C.treat.cooldown;
    setTreatMode(false);
    // nearest available cat in this room goes for it (cancels a chase)
    var best = null, bd = 1e9;
    catsIn(r.id).forEach(function (c) {
      if (c.air || c.perch && c.perch.kind !== "tree" && c.perch.kind !== "seat") return;
      var d = dist([c.x, c.y], t);
      if (d < bd) { bd = d; best = c; }
    });
    if (best) {
      if (best.mode === "chase") { best.mode = "idle"; cats.ollie.mode === "flee" && (cats.ollie.mode = "walk"); }
      if (best.snackGoal) { state.snack && (state.snack.state = "fresh", state.snack.thief = null, state.snack.warnAt = state.snack.t + 3); best.snackGoal = null; }
      if (best.task && best.task.obj) best.task.obj.claimed = null;
      best.task = null;
      var go = function () { best.treatGoal = state.treat; walkTo(best, t, "toTreat", 1.2); best.treatGoal = state.treat; };
      if (best.perch) hopDown(best, go); else go();
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
    catsIn(tr.room).forEach(function (c) {
      if (!state.treat || c.air || c.perch) return;
      if (hdist([c.x, c.y], [tr.x, tr.y]) < Math.max(0.03, catScale(c) * 0.25)) {
        state.treat = null; c.treatGoal = null;
        if (c.mode === "toTreat") c.mode = "idle";
        state.stats.treats++;
        say(c, "Yum!", 1.2); sfx("yum");
        addScore(SC.treatEaten, [tr.x, tr.y - catScale(c) * 0.6], "", tr.room);
      }
    });
    if (state.treat && tr.t > 15) state.treat = null;
  }

  /* ---------- per-cat update ---------- */
  function inSun(cat) {
    return objects.filter(function (o) {
      return o.type === "sun" && o.room === cat.room && Math.pow((cat.x - o.x) / o.rx, 2) + Math.pow((cat.y - o.y) / o.ry, 2) <= 1.3;
    })[0] || null;
  }
  function updateCat(cat, dt) {
    if (cat.bubble) { cat.bubble.t -= dt; if (cat.bubble.t <= 0) cat.bubble = null; }
    if (cat.blink > 0) cat.blink -= dt;
    if (cat.pounce > 0) cat.pounce = Math.max(0, cat.pounce - dt);
    if (cat.swipeT > 0) cat.swipeT = Math.max(0, cat.swipeT - dt);
    if (cat.scratchT > 0) {
      cat.scratchT = Math.max(0, cat.scratchT - dt); cat.phase += dt * 20;
      if (cat.mode === "scratch") { if (cat.scratchT <= 0) { cat.mode = "idle"; cat.idleT = 1; } return; }
    }
    if (cat.mode === "roll") {
      cat.rollT -= dt; cat.phase += dt * 6;
      if (cat.rollT <= 0) { cat.mode = "idle"; cat.idleT = 1.5; cat.idleTotal = 0; }
      return;
    }
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
      if (a.s1) cat.scaleOverride = a.s0 + (a.s1 - a.s0) * k;
      cat.airLift = Math.sin(k * Math.PI) * a.h;
      cat.moveAmt = 0;
      if (k >= 1) { cat.airLift = 0; finishAir(cat); }
      return;
    }
    if (cat.squash > 0) cat.squash = Math.max(0, cat.squash - dt);
    if (cat.perch) {
      cat.perch.t -= dt;
      cat.phase += dt * 4;
      var pk = cat.perch;
      if ((pk.kind === "seat" || pk.kind === "tree") && !(cat.scratchT > 0)) {
        if (!pk.nap) {
          pk.idle += dt;
          if (pk.idle >= (pk.obj && pk.obj.sun ? C.nap.sunAfter : C.nap.after)) { pk.nap = true; cat.sunny = pk.obj && pk.obj.sun ? pk.obj : null; cat.napPts = 0; state.stats.naps++; say(cat, cat.sunny ? "\u2600\uFE0F zzz" : "zzz", 1.2); }
        } else {
          cat.napPts = (cat.napPts || 0) + dt;
          if (cat.napPts >= SC.napEvery) {
            cat.napPts = 0;
            var m2 = cat.sunny ? 2 : 1;
            state.catStats[cat.id].nap += SC.napPoint * m2;
            addScore(SC.napPoint * m2, [cat.x, cat.y - catScale(cat) * 0.5], cat.sunny ? "zzz \u2600\uFE0F" : "zzz", cat.room);
          }
        }
      }
      if (cat.perch.t <= 0) {
        if (cat.perch.kind === "snack" && state.snack && state.snack.thief === cat.id) state.snack = null;
        hopDown(cat);
      }
      return;
    }
    if (cat.path.length) {
      var t = cat.path[0], r = R(cat);
      var dx = t[0] - cat.x, dy = t[1] - cat.y, d = Math.hypot(dx, dy);
      var persp = depthScale(cat.y, r) / r.depth.s2;
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
      if (!cat.path.length && ["chase", "toSnack", "toTreat", "toObj", "toDoor", "hunt"].indexOf(cat.mode) < 0) {
        cat.mode = "idle"; cat.idleT = 2 + Math.random() * 5;
      }
      return;
    }
    cat.moveAmt = Math.max(0, cat.moveAmt - dt * 5);
    cat.stillT += dt;
    if (cat.mode === "toDoor") { if (cat.doorGoal) arriveDoor(cat); else cat.mode = "idle"; return; }
    if (cat.mode === "toObj") { if (cat.task) arriveObj(cat); else cat.mode = "idle"; return; }
    if (cat.mode === "hunt") { cat.mode = "idle"; }
    if (cat.mode === "toTreat" && !state.treat) { cat.mode = "idle"; cat.treatGoal = null; }
    if (cat.mode === "nap") {
      cat.napT += dt;
      cat.napPts = (cat.napPts || 0) + dt;
      if (cat.napPts >= SC.napEvery) {
        cat.napPts = 0;
        var mul = cat.sunny ? 2 : 1;
        state.catStats[cat.id].nap += SC.napPoint * mul;
        addScore(SC.napPoint * mul, [cat.x, cat.y - catScale(cat) * 0.5], cat.sunny ? "zzz \u2600\uFE0F" : "zzz", cat.room);
      }
      // AI nappers get up eventually
      if (cat.id !== state.selected && cat.napT > (cat.napLen || (cat.napLen = rnd(25, 50)))) { cat.napLen = 0; wake(cat, true); }
      return;
    }
    if (cat.mode === "idle") {
      cat.idleTotal += dt;
      updateRoam(cat, dt);
      if (cat.mode !== "idle") return;
      var calm = !(cats.stanley && cats.stanley.mode === "chase" && cats.stanley.room === cat.room);
      var sun = inSun(cat);
      var snackHere = state.snack && state.snack.room === cat.room;
      var treatHere = state.treat && state.treat.room === cat.room;
      if (cat.idleTotal >= (sun ? C.nap.sunAfter : C.nap.after) && calm && !snackHere && !treatHere) {
        startNap(cat, sun);
        return;
      }
      cat.idleT -= dt;
      if (cat.idleT <= 0) {
        cat.idleT = 3 + Math.random() * 6;
        var roll = Math.random();
        if (cat.id !== state.selected && roll < C.aiObjectChance && calm) { if (aiPickObject(cat)) return; }
        roll = Math.random();
        if (roll < 0.45) cat.blink = 0.25;
        else if (roll < 0.75) cat.sit = cat.sit ? 0 : 1;
        else if (cat.id !== state.selected && Math.random() < 0.5) {
          var keep = cat.idleTotal;
          walkTo(cat, clampToFloor([cat.x + (Math.random() - 0.5) * 0.2, cat.y + (Math.random() - 0.5) * 0.08], R(cat).floor));
          cat.idleTotal = keep; // small wanders don't reset the nap clock
        }
      }
    }
  }

  /* ---------- input ---------- */
  function onPointer(e) {
    e.preventDefault();
    unlockAudio();
    closeAudioPanel();
    if (state.transitioning || state.paused) return;
    var rect = canvas.getBoundingClientRect();
    var sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    var p = toImage(sx, sy);
    if (DEBUG) debugEl.textContent = "tap " + p[0].toFixed(3) + ", " + p[1].toFixed(3);
    // snack?
    var sn = state.snack;
    if (sn && sn.state !== "eaten" && sn.room === state.room) {
      var sp = toScreen([sn.x, sn.y]);
      var rr = Math.max(28, sn.surf.size * view.ih * 1.1);
      if (Math.hypot(sx - sp[0], sy - (sp[1] - rr * 0.3)) < rr) { if (putAwaySnack()) return; }
    }
    if (state.treatMode) {
      if (p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1) dropTreat(p);
      return;
    }
    var hit = hitCat(sx, sy);
    if (hit) CatAudio.cat(hit);
    if (hit && cats[hit].perch && cats[hit].perch.nap) { var hp = cats[hit].perch; hp.nap = false; hp.idle = 0; cats[hit].sunny = null; say(cats[hit], "Mrrp?", 1); if (hit !== state.selected) selectCat(hit, true); return; }
    if (hit && cats[hit].mode === "nap") { wake(cats[hit]); if (hit !== state.selected) selectCat(hit, true); return; }
    if (hit && hit !== state.selected) { selectCat(hit); return; }
    if (hit && hit === state.selected && !cats[hit].perch) {
      var me = cats[hit];
      var rug = objects.filter(function (o) { return o.type === "rug" && o.room === me.room && inRect([me.x, me.y], o.rect); })[0];
      if (rug && !me.air && me.mode !== "scuffle" && me.mode !== "roll") { useObject(me, rug); return; }   // tap your cat on the rug: it rolls
      say(me, hit === "stanley" ? "Mrrow." : "Mew!", 0.9); return;
    }
    if (hit && hit === state.selected && cats[hit].perch && cats[hit].perch.kind !== "tree" && cats[hit].perch.kind !== "seat") return;
    if (p[0] < 0 || p[0] > 1 || p[1] < 0 || p[1] > 1) return;
    var cat = cats[state.selected];
    var obj = objectAt(p, sx, sy);
    var t = clampToFloor(p, room().floor);
    // tapping the floor right under a tree/couch rect should still walk there
    if (obj && obj.type === "rug" && !(inRect([cat.x, cat.y], obj.rect) && !cat.perch)) obj = null;  // first tap walks onto the rug, next tap rolls
    if (obj && obj.rect && obj.type !== "rug" && inPoly(p, room().floor) && p[1] > obj.rect[3] - 0.04) obj = null;
    if (obj && cat.perch && cat.perch.obj === obj && obj.type === "seat") {
      // tap another spot on the same furniture: hop over to it
      var near = freeSpots(obj, cat).sort(function (a, b) { return hdist(a, p) - hdist(b, p); })[0];
      if (near && near !== cat.perch.spot) {
        cat.perch.spot.occupied = null; near.occupied = cat.id;
        var keepObj = obj; cat.perch = null;
        cat.task = { obj: keepObj, spot: near };
        hop(cat, [near[0], near[1]], near[2], { then: "seat", dur: 0.6, h: 0.06, sortY: keepObj.sortY });
      }
      return;
    }
    if (obj && cat.perch && cat.perch.obj === obj) return;
    if (cat.task && cat.task.obj) cat.task.obj.claimed = null;
    if (cat.task && cat.task.spot && !cat.air) cat.task.spot.occupied = null;
    if (!cat.air) cat.task = null;
    if (cat.snackGoal) { cat.snackGoal = null; } // steering the thief away stops the theft
    cat.treatGoal = null;
    var ok = command(cat, function () {
      if (obj) { if (useObject(cat, obj, p)) state.ripples.push({ x: obj.x != null ? obj.x : t[0], y: obj.type === "tree" ? obj.from[1] : (obj.y != null ? obj.y : t[1]), t: 0 }); }
      else walkTo(cat, t);
    });
    if (ok && !obj) state.ripples.push({ x: t[0], y: t[1], t: 0 });
    sfx("tap");
  }
  function hitCat(sx, sy) {
    var best = null;
    catIds.forEach(function (id) {
      var b = cats[id]._box;
      if (b && visible(cats[id]) && sx >= b[0] && sx <= b[2] && sy >= b[1] && sy <= b[3]) best = id;
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
    if (cat.mode === "hunt") { cat.mode = "walk"; }
    if (cat.perch && (cat.perch.kind === "tree" || cat.perch.kind === "seat")) cat.perch.t = Infinity;
    if (cat.room !== state.room) fadeToView(cat.room, function () { showToast(cat.cfg.name + " \u2014 " + R(cat).name); });
    if (!quiet) { say(cat, id === "stanley" ? "Mew?" : "Mrrp!", 0.9); sfx("select"); }
    // the other cat goes back to its own life (a perched AI cat comes down eventually)
    var o = cats[other(id)];
    if (o && o.perch && o.perch.t === Infinity) o.perch.t = rnd(8, 20);
    lastBadgeKey = "";
  }
  function buildCatButtons() {
    catIds.forEach(function (id) {
      var b = document.createElement("button");
      b.className = "cat-btn";
      b.dataset.cat = id;
      b.innerHTML = '<img src="' + cats[id].cfg.face + '" alt=""><span>' + cats[id].cfg.name + '</span><em class="where"></em>';
      b.setAttribute("aria-label", "Play as " + cats[id].cfg.name);
      b.addEventListener("click", function (e) {
        e.stopPropagation(); unlockAudio(); closeAudioPanel();
        if (state.paused) return;
        CatAudio.cat(id);
        if (cats[id].mode === "nap") wake(cats[id]);
        selectCat(id);
      });
      catBtns.appendChild(b);
    });
  }
  function updateCatButtons() {
    Array.prototype.forEach.call(catBtns.children, function (b) {
      var c = cats[b.dataset.cat];
      var w = b.querySelector(".where");
      var txt = c.room === state.room ? "" : R(c).name;
      if (w.textContent !== txt) w.textContent = txt;
    });
  }

  /* ---------- sound (all synthesized; see audio.js) ---------- */
  var audioPrefs = store.get("audio", { music: true, fx: true, mv: C.audio.music, fv: C.audio.effects });
  var audioPanel = $("audio-panel");
  function applyAudio() {
    CatAudio.setMusic(audioPrefs.music, audioPrefs.mv);
    CatAudio.setFx(audioPrefs.fx, audioPrefs.fv);
    var any = audioPrefs.music || audioPrefs.fx;
    soundBtn.textContent = any ? "\uD83D\uDD0A" : "\uD83D\uDD07";
    soundBtn.setAttribute("aria-label", any ? "Sound settings (on)" : "Sound settings (off)");
    $("aud-music").checked = audioPrefs.music; $("aud-fx").checked = audioPrefs.fx;
    $("aud-music-vol").value = Math.round(audioPrefs.mv * 100); $("aud-fx-vol").value = Math.round(audioPrefs.fv * 100);
    store.set("audio", audioPrefs);
  }
  var audioUnlocked = false;
  function unlockAudio() {
    CatAudio.unlock();
    if (!audioUnlocked && (audioPrefs.music || audioPrefs.fx)) { audioUnlocked = true; applyAudio(); }
  }
  function sfx(name) { CatAudio.sfx(name === "meow" ? "boop" : name); if (name === "meow") CatAudio.cat("ollie", "meow"); }
  function closeAudioPanel() { if (audioPanel && !audioPanel.hidden) audioPanel.hidden = true; }
  soundBtn.addEventListener("click", function (e) {
    e.stopPropagation();
    audioPanel.hidden = !audioPanel.hidden;
    unlockAudio();
  });
  audioPanel.addEventListener("click", function (e) { e.stopPropagation(); });
  audioPanel.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
  $("aud-music").addEventListener("change", function () { audioPrefs.music = this.checked; unlockAudio(); applyAudio(); });
  $("aud-fx").addEventListener("change", function () { audioPrefs.fx = this.checked; unlockAudio(); applyAudio(); if (this.checked) CatAudio.cat(state.selected); });
  $("aud-music-vol").addEventListener("input", function () { audioPrefs.mv = this.value / 100; if (audioPrefs.mv > 0) audioPrefs.music = true; applyAudio(); });
  $("aud-fx-vol").addEventListener("input", function () { audioPrefs.fv = this.value / 100; if (audioPrefs.fv > 0) audioPrefs.fx = true; applyAudio(); });
  $("aud-fx-vol").addEventListener("change", function () { sfx("ding"); });
  treatBtn.addEventListener("click", function (e) {
    e.stopPropagation(); unlockAudio(); closeAudioPanel();
    if (state.treatCooldown > 0) { showWarn("Treats in " + Math.ceil(state.treatCooldown) + "s", 1.2); return; }
    setTreatMode(!state.treatMode);
  });

  /* ---------- round mode / help ---------- */
  function startRound() {
    state.round = { left: +(params.get("roundsecs") || C.round.seconds) };
    state.score = 0; state.stats = newStats(); state.catStats = newCatStats();
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
    $("sum-mischief").textContent = s.cups + (s.cups === 1 ? " cup" : " cups") + " broken, " + s.couch + " couch scratch" + (s.couch === 1 ? "" : "es");
    $("sum-cats").textContent = catIds.map(function (id) { var c = state.catStats[id]; return cats[id].cfg.name + ": " + c.critters + " caught, " + c.nap + " nap pts"; }).join(" \u00b7 ");
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
    if (cat.mode === "roll") return cat.rollT > 1.8 ? { st: "pounce", f: 0 } : { st: "nap", f: 0 };
    if (cat.perch && cat.perch.nap) return { st: "nap", f: 0 };
    if (cat.perch && cat.perch.kind === "seat") return cat.scratchT > 0 ? { st: "pounce", f: 0 } : { st: "sit", f: 0 };
    if (cat.perch) return cat.perch.kind === "tree" && !(cat.scratchT > 0) || cat.perch.kind === "cup" && !(cat.swipeT > 0) ? { st: "sit", f: 0 } : { st: "pounce", f: 0 };
    if (cat.mode === "scratch") return { st: "pounce", f: 0 };
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
    if (cat.scratchT > 0) { tilt = Math.sin(cat.phase) * 0.07; sx = 1 + Math.sin(cat.phase * 0.5) * 0.04; }
    if (cat.squash > 0) { var qk = Math.sin(cat.squash / 0.22 * Math.PI); sy *= 1 - 0.13 * qk; sx *= 1 + 0.09 * qk; }
    if (cat.mode === "roll") {
      if (cat.rollT > 1.8) { sx = 1.14; sy = 0.92; }                      // big stretch first
      else { tilt = Math.sin(cat.phase * 1.6) * 0.55; bob = Math.abs(Math.sin(cat.phase * 1.6)) * h * 0.12; var rollFlip = Math.sin(cat.phase * 0.8) < 0; }
    }
    // tail-flick / settle: a tiny periodic wiggle while sitting still
    if (pose.st === "sit" && !walk) { var tf = (performance.now() / 1000 + (cat.id === "ollie" ? 1.7 : 0)) % 4.2; if (tf < 0.35) tilt += Math.sin(tf / 0.35 * Math.PI * 2) * 0.025; }
    if (cat.swipeT > 0) { tilt = -0.18 * Math.sin((0.6 - cat.swipeT) / 0.6 * Math.PI); sx = 1.06; }
    if (pose.st === "nap") { var br = 1 + Math.sin(performance.now() / 650) * 0.02; sy = br; sx = 1 + (br - 1) * 0.4; }
    if (pose.st === "sit" && cat.blink > 0) sy = 1 - Math.sin(cat.blink / 0.25 * Math.PI) * 0.03;
    var flip = cat.facing === stc.faces ? 1 : -1;
    if (cat.mode === "roll" && rollFlip) flip = -flip;
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
    if (pose.st === "nap" && cat.mode !== "roll") drawZzz(cat, sp[0] + w * 0.25 * (stc.faces * flip), sp[1] - h * sy);
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
  /* objects */
  function drawFloorObjects() {
    var t = performance.now() / 1000;
    objects.forEach(function (o) {
      if (o.room !== state.room) return;
      if (o.type === "sun") {
        var p = toScreen([o.x, o.y]), rx = o.rx * view.iw, ry = o.ry * view.ih;
        var a = 0.42 + 0.1 * Math.sin(t * 1.3);
        ctx.save();
        ctx.translate(p[0], p[1]); ctx.scale(1, ry / rx);
        var g = ctx.createRadialGradient(0, 0, rx * 0.1, 0, 0, rx);
        g.addColorStop(0, "rgba(255,236,150," + a + ")"); g.addColorStop(0.7, "rgba(255,214,110," + a * 0.6 + ")"); g.addColorStop(1, "rgba(255,200,90,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, rx, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        // tiny sun marker so kids know it's special
        var occupied = catsIn(o.room).some(function (c) { return c.sunny === o; });
        if (!occupied) {
          ctx.save(); ctx.globalAlpha = 0.85; ctx.font = Math.max(14, ry * 0.9) + "px sans-serif"; ctx.textAlign = "center";
          ctx.fillText("\u2600\uFE0F", p[0], p[1] - ry * 0.2 + Math.sin(t * 2) * 2); ctx.restore();
        }
      } else if (o.type === "cup" && o.state === "broken" && o.shards && o.brokenT < 6) {
        var q = toScreen(o.fall.to), s = o.size * view.ih;
        ctx.save(); ctx.globalAlpha = Math.min(1, (6 - o.brokenT) / 1.5);
        o.shards.forEach(function (sh) {
          ctx.save();
          ctx.translate(q[0] + sh.dx * view.iw, q[1] + sh.dy * view.ih); ctx.rotate(sh.a);
          ctx.fillStyle = o.glass ? "rgba(215,240,255,.85)" : (o.id === "cup-kitchen" ? "#e45b4a" : "#f4f1ea");
          ctx.strokeStyle = "rgba(60,60,70,.6)"; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(-s * 0.18 * sh.s, 0); ctx.lineTo(0, -s * 0.12 * sh.s); ctx.lineTo(s * 0.16 * sh.s, s * 0.05 * sh.s); ctx.closePath(); ctx.fill(); ctx.stroke();
          ctx.restore();
        });
        if (o.glass) { ctx.fillStyle = "rgba(150,200,255,.25)"; ctx.beginPath(); ctx.ellipse(q[0], q[1], s * 0.9, s * 0.2, 0, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      } else if (o.type === "couch" && o.marks) {
        var m = toScreen([o.marks.x, o.marks.y]), L = view.ih * 0.05;
        ctx.save(); ctx.globalAlpha = Math.max(0, 1 - o.marks.t / 3); ctx.strokeStyle = "rgba(255,255,255,.85)"; ctx.lineWidth = 2.5; ctx.lineCap = "round";
        for (var i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(m[0] + i * L * 0.3, m[1] - L); ctx.lineTo(m[0] + i * L * 0.3 + L * 0.15, m[1]); ctx.stroke(); }
        ctx.restore();
      }
    });
  }
  // Subtle pulsing sparkles on tappable things so kids discover them (staggered, one at a time-ish).
  function hintAnchor(o) {
    if (o.type === "seat") { var s = o.spots[0]; return [s[0], s[1] - s[2] * 0.5]; }
    if (o.type === "cup") return o.state === "ok" ? [o.x, o.y - o.size * 1.3] : null;
    if (o.type === "tree") return o.occupied ? null : [o.x, o.y - 0.06];
    if (o.rect) return [(o.rect[0] + o.rect[2]) / 2, (o.rect[1] + o.rect[3]) / 2];
    if (o.type === "toy") return [o.x, o.y - 0.05];
    return null;   // sun spots already glow
  }
  function drawHints() {
    var t = performance.now() / 1000, i = 0;
    objects.forEach(function (o) {
      if (o.room !== state.room) return;
      var idx = i++;
      if (o.type === "seat" && freeSpots(o, { id: "_" }).length === 0) return;
      var a = hintAnchor(o); if (!a) return;
      var ph = (t * 0.45 + idx * 0.29) % 1.6;
      if (ph > 0.7) return;
      var k = Math.sin(ph / 0.7 * Math.PI);
      var p = toScreen(a), r = Math.max(7, view.ih * 0.022) * (0.6 + 0.6 * k);
      ctx.save();
      ctx.globalAlpha = 0.75 * k;
      ctx.translate(p[0], p[1]); ctx.rotate(ph * 1.2);
      ctx.fillStyle = "#fffbe0"; ctx.shadowColor = "rgba(255,220,120,.9)"; ctx.shadowBlur = 10;
      ctx.beginPath();
      for (var j = 0; j < 8; j++) { var rr = j % 2 ? r * 0.28 : r, an = j * Math.PI / 4; ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr); }
      ctx.closePath(); ctx.fill();
      ctx.restore();
    });
  }
  function drawCup(o) {
    var x = o.x, y = o.y, rot = 0;
    if (o.state === "falling") {
      var k = Math.min(1, o.fall.t / o.fall.dur);
      x = o.fall.from[0] + (o.fall.to[0] - o.fall.from[0]) * k;
      y = o.fall.from[1] + (o.fall.to[1] - o.fall.from[1]) * k * k;
      rot = o.fall.dir * k * 2.4;
    }
    var p = toScreen([x, y]), s = o.size * view.ih;
    ctx.save();
    ctx.translate(p[0], p[1]);
    if (o.state === "ok") { ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.beginPath(); ctx.ellipse(0, 0, s * 0.42, s * 0.1, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.rotate(rot);
    if (o.glass) {
      // tall water glass
      ctx.fillStyle = "rgba(210,235,255,.55)"; ctx.strokeStyle = "rgba(255,255,255,.95)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(-s * 0.26, -s); ctx.lineTo(s * 0.26, -s); ctx.lineTo(s * 0.21, 0); ctx.lineTo(-s * 0.21, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "rgba(120,180,255,.5)";
      ctx.beginPath(); ctx.moveTo(-s * 0.245, -s * 0.6); ctx.lineTo(s * 0.245, -s * 0.6); ctx.lineTo(s * 0.21, 0); ctx.lineTo(-s * 0.21, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.8)"; ctx.beginPath(); ctx.moveTo(-s * 0.15, -s * 0.9); ctx.lineTo(-s * 0.12, -s * 0.15); ctx.stroke();
    } else {
      // red coffee mug
      ctx.fillStyle = "#e45b4a"; ctx.strokeStyle = "#8c2a1f"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.rect(-s * 0.32, -s * 0.8, s * 0.64, s * 0.8); ctx.fill(); ctx.stroke();
      ctx.lineWidth = Math.max(2, s * 0.12); ctx.beginPath(); ctx.arc(s * 0.36, -s * 0.42, s * 0.18, -1.3, 1.3); ctx.stroke();
      ctx.fillStyle = "#5a3a22"; ctx.beginPath(); ctx.ellipse(0, -s * 0.8, s * 0.3, s * 0.07, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.font = "bold " + Math.round(s * 0.35) + "px sans-serif"; ctx.textAlign = "center"; ctx.fillText("\u2665", 0, -s * 0.28);
    }
    ctx.restore();
  }
  function drawToy(o) {
    var p = toScreen([o.x, o.y]), L = depthScale(o.y) * view.ih * 0.34, t = performance.now() / 1000;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.3)"; ctx.beginPath(); ctx.ellipse(p[0], p[1], L * 0.45, L * 0.1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.translate(p[0], p[1] - L * 0.2);
    ctx.rotate(o.spin);
    // felt toy mouse: purple body, pink ears, string tail, little bell
    ctx.strokeStyle = "#e8d5b0"; ctx.lineWidth = Math.max(1.5, L * 0.04); ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-L * 0.38, 0); ctx.quadraticCurveTo(-L * 0.7, L * 0.15 + Math.sin(t * 3) * L * 0.05, -L * 0.85, -L * 0.05); ctx.stroke();
    ctx.fillStyle = "#8e5bd8"; ctx.beginPath(); ctx.ellipse(0, 0, L * 0.4, L * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ff9ec4"; ctx.beginPath(); ctx.arc(L * 0.2, -L * 0.17, L * 0.09, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#222"; ctx.beginPath(); ctx.arc(L * 0.3, -L * 0.04, L * 0.03, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffd84a"; ctx.beginPath(); ctx.arc(L * 0.42, L * 0.03, L * 0.05, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
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
    objects.forEach(function (o) {
      if (o.room !== r.id) return;
      ctx.strokeStyle = "rgba(255,80,255,.9)"; ctx.lineWidth = 2;
      if (o.rect) { var a = toScreen([o.rect[0], o.rect[1]]), b = toScreen([o.rect[2], o.rect[3]]); ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); }
      if (o.from) { var f = toScreen(o.from); ctx.fillStyle = "#f0f"; ctx.fillRect(f[0] - 4, f[1] - 4, 8, 8); }
    });
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
        updateObjects(dt);
        catIds.forEach(function (id) { updateCat(cats[id], dt); });
        updateCatButtons();
      } else dt = 0;
      ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      drawBackground();
      if (DEBUG) drawDebug();
      drawRipples(dt);
      drawFloorObjects();
      drawHints();
      if (state.snack && state.snack.room === state.room) drawSnack(state.snack);
      if (state.treat && state.treat.room === state.room) drawTreat(state.treat);
      // depth-sort cats + critters (a cat on a counter sorts by the floor spot it jumped from)
      var items = [];
      catIds.forEach(function (id) {
        var c = cats[id];
        if (!visible(c)) { c._box = null; c._head = null; return; }
        var key = (c.perch || c.air) && c.sortY != null ? c.sortY : c.y;
        items.push({ y: key, draw: function () { drawCat(c); } });
      });
      objects.forEach(function (o) {
        if (o.room !== state.room) return;
        if (o.type === "cup" && o.state !== "broken") items.push({ y: o.state === "falling" ? o.fall.to[1] - 0.002 : o.from[1] - 0.0005, draw: function () { drawCup(o); } });
        if (o.type === "toy") items.push({ y: o.y, draw: function () { drawToy(o); } });
      });
      state.critters.forEach(function (k) { if (k.room === state.room) items.push({ y: k.y, draw: function () { drawCritter(k); } }); });
      items.sort(function (a, b) { return a.y - b.y; }).forEach(function (it) { it.draw(); });
      drawPoofs(dt);
      catIds.forEach(function (id) { if (visible(cats[id])) drawBubble(cats[id]); });
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
    catIds.forEach(function (id) { cats[id].room = state.room; });
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
  // v3 test switches: ?noroam=1 (AI cats stay in their room), ?noaiobj=1 (AI cats don't play with objects), ?nohunt=1
  if (params.get("noroam") === "1") { C.roam.every = [1e9, 1e9]; catIds.forEach(function (id) { cats[id].roamT = 1e9; }); }
  if (params.get("roam")) catIds.forEach(function (id) { cats[id].roamT = +params.get("roam"); });
  if (params.get("noaiobj") === "1") C.aiObjectChance = 0;
  if (params.get("nohunt") === "1") state.noHunt = true;
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
    setTreatMode: setTreatMode, objects: objects, objectAt: objectAt, toImage: toImage, useObject: useObject, knockCup: knockCup,
    selectCat: selectCat, moveCat: function (id, roomId) { var c = cats[id], f = c.room; placeCat(c, roomId, f); if (id === state.selected) setView(roomId); lastBadgeKey = ""; },
    sendCat: function (id, to) { var c = cats[id], d = (R(c).doors || []).filter(function (x) { return x.to === to; })[0]; if (d) aiTravel(c, d); return !!d; },
    audio: CatAudio, audioPrefs: function () { return audioPrefs; },
    goTo: function (to) { var d = (room().doors || []).filter(function (x) { return x.to === to; })[0]; if (d) goTo(d); return !!d; }
  };

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").then(function () { window.__swRegistered = true; })
        .catch(function (err) { console.warn("SW failed", err); });
    });
  }
})();
