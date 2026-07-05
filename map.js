/* ============================================================================
   GT · ATLAS — particle boundary map
   India → Tamil Nadu → Coimbatore district → Vadavalli
   Data: map-data.js (window.MAP_DATA). Rendering: three.js r128 + GSAP.
   World space: 612 × 696, y-up. Red = target designation.
   ========================================================================== */
(function () {
  'use strict';
  /* interaction layer added: hover picking, POIs, keyboard, ripple, drop-pin, mobile */
  var D = window.MAP_DATA;
  var canvas = document.getElementById('gl');
  if (!window.THREE || !D) { document.getElementById('fallback').style.display = 'flex'; return; }

  /* surface startup crashes instead of a silent black screen */
  window.addEventListener('error', function (e) {
    if (window.__atlasOK) return;
    var f = document.getElementById('fallback');
    if (f) {
      f.style.display = 'flex';
      f.querySelector('p').innerHTML = 'The atlas failed to start:<br><span style="color:var(--accent)">' +
        (e.message || 'unknown error') + '</span><br><br><a href="index.html" style="color:var(--accent)">← Back to portfolio</a>';
    }
  });

  var isMobile = matchMedia('(max-width: 820px)').matches;
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var N = isMobile ? 9000 : 18000;          // particle count (constant across stages)
  var HOLD = 4.6;                            // seconds each stage is held in auto-play
  var MORPH = 2.4;                           // seconds per morph

  /* ---------------- geometry helpers ---------------- */

  function ringLength(r) {
    var L = 0, i;
    for (i = 2; i < r.length; i += 2) L += Math.hypot(r[i] - r[i - 2], r[i + 1] - r[i - 1]);
    return L;
  }
  /* n points evenly spaced along a flat ring [x0,y0,x1,y1,...] */
  function sampleRing(r, n, out, off) {
    var total = ringLength(r);
    if (total === 0 || n <= 0) return off;
    var step = total / n, dist = step * Math.random(), acc = 0, i = 2, placed = 0;
    var ax = r[0], ay = r[1];
    while (placed < n && i < r.length) {
      var bx = r[i], by = r[i + 1];
      var seg = Math.hypot(bx - ax, by - ay);
      while (acc + seg >= dist && placed < n) {
        var t = seg === 0 ? 0 : (dist - acc) / seg;
        out[off++] = ax + (bx - ax) * t;
        out[off++] = ay + (by - ay) * t;
        placed++; dist += step;
      }
      acc += seg; ax = bx; ay = by; i += 2;
    }
    while (placed < n) { out[off++] = ax; out[off++] = ay; placed++; }
    return off;
  }
  function ringsLength(rings) { var L = 0; rings.forEach(function (r) { L += ringLength(r); }); return L; }
  /* distribute n points across many rings proportional to perimeter */
  function sampleRings(rings, n, out, off) {
    var total = ringsLength(rings), left = n;
    for (var k = 0; k < rings.length; k++) {
      var take = (k === rings.length - 1) ? left : Math.round(n * ringLength(rings[k]) / total);
      take = Math.min(take, left);
      off = sampleRing(rings[k], take, out, off);
      left -= take;
    }
    return off;
  }
  function bboxOf(ringsList) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    ringsList.forEach(function (r) {
      for (var i = 0; i < r.length; i += 2) {
        if (r[i] < x0) x0 = r[i]; if (r[i] > x1) x1 = r[i];
        if (r[i + 1] < y0) y0 = r[i + 1]; if (r[i + 1] > y1) y1 = r[i + 1];
      }
    });
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }
  /* ring scaled towards its centroid — used for echo/fill rings */
  function shrink(r, f) {
    var cx = 0, cy = 0, n = r.length / 2, out = new Array(r.length), i;
    for (i = 0; i < r.length; i += 2) { cx += r[i]; cy += r[i + 1]; }
    cx /= n; cy /= n;
    for (i = 0; i < r.length; i += 2) {
      out[i] = cx + (r[i] - cx) * f;
      out[i + 1] = cy + (r[i + 1] - cy) * f;
    }
    return out;
  }

  /* ---------------- collect source rings ---------------- */

  var ISLANDS = { 'Andaman and Nicobar Islands': 1, 'Lakshadweep': 1 };
  var indiaRings = [], mainRings = [], tnStateRings = D.tnSvg.rings;
  D.india.forEach(function (s) {
    s.rings.forEach(function (r) {
      indiaRings.push(r);
      if (!ISLANDS[s.n]) mainRings.push(r);
    });
  });

  var tnRings = [], cbeRings = [], cbeNeighbors = [];
  D.tn.forEach(function (d) {
    d.rings.forEach(function (r) {
      tnRings.push(r);
      if (d.n === 'Coimbatore') cbeRings.push(r);
      if (d.n === 'Tiruppur' || d.n === 'Nilgiris' || d.n === 'Erode' || d.n === 'Dindigul' || d.n === 'Theni') cbeNeighbors.push(r);
    });
  });
  var vadRing = D.vad.ring, vadPin = D.vad.pin;

  var BB = {
    india: bboxOf(indiaRings),
    main: bboxOf(mainRings),       // mainland only — used for framing so islands don't skew the centre
    tn: bboxOf(tnRings),
    cbe: bboxOf(cbeRings),
    vad: bboxOf([vadRing])
  };

  /* ---------------- stage layouts ----------------
     Palette: cyan accent, dim steel context, warm white highlight, signal red target. */

  var ACC = [0.337, 0.784, 0.941];      // #56C8F0
  var DIM = [0.30, 0.42, 0.52];
  var FNT = [0.12, 0.20, 0.27];         // faint context
  var HOT = [0.95, 0.98, 1.0];
  var RED = [1.0, 0.29, 0.34];          // #FF4A57 — target designation

  function paint(cols, sizes, from, to, col, s) {
    for (var i = from; i < to; i++) {
      cols[i * 3] = col[0]; cols[i * 3 + 1] = col[1]; cols[i * 3 + 2] = col[2];
      sizes[i] = s;
    }
  }
  function layout() {
    return { p: new Float32Array(N * 2), c: new Float32Array(N * 3), s: new Float32Array(N) };
  }

  /* Stage 0 — INDIA: every state outline; Tamil Nadu glows. */
  function buildIndia() {
    var L = layout(), off = 0, i0;
    var other = [], tn = tnStateRings;
    D.india.forEach(function (s) { if (s.n !== 'Tamil Nadu') s.rings.forEach(function (r) { other.push(r); }); });
    var nTN = Math.floor(N * 0.14);
    off = sampleRings(other, N - nTN, L.p, off);
    i0 = off / 2;
    paint(L.c, L.s, 0, i0, DIM, 1.6);
    off = sampleRings(tn, nTN, L.p, off);
    paint(L.c, L.s, i0, N, ACC, 2.2);
    return L;
  }

  /* Stage 1 — TAMIL NADU: district mesh; Coimbatore hot; India kept as faint context. */
  function buildTN() {
    var L = layout(), off = 0, a, b;
    var nCtx = Math.floor(N * 0.22), nCbe = Math.floor(N * 0.16);
    off = sampleRings(indiaRings, nCtx, L.p, off); a = off / 2;
    paint(L.c, L.s, 0, a, FNT, 1.2);
    var rest = [];
    D.tn.forEach(function (d) { if (d.n !== 'Coimbatore') d.rings.forEach(function (r) { rest.push(r); }); });
    off = sampleRings(rest, N - nCtx - nCbe, L.p, off); b = off / 2;
    paint(L.c, L.s, a, b, ACC, 1.9);
    off = sampleRings(cbeRings, nCbe, L.p, off);
    paint(L.c, L.s, b, N, HOT, 2.5);
    return L;
  }

  /* Stage 2 — COIMBATORE: dense outline + echo rings inward; neighbours faint. */
  function buildCBE() {
    var L = layout(), off = 0, a, b;
    var nCtx = Math.floor(N * 0.20), nEcho = Math.floor(N * 0.30);
    off = sampleRings(cbeNeighbors.concat([tnStateRings[0] || []]), nCtx, L.p, off); a = off / 2;
    paint(L.c, L.s, 0, a, FNT, 1.2);
    var echoes = [];
    [0.86, 0.72, 0.58, 0.42, 0.26].forEach(function (f) { cbeRings.forEach(function (r) { echoes.push(shrink(r, f)); }); });
    off = sampleRings(echoes, nEcho, L.p, off); b = off / 2;
    paint(L.c, L.s, a, b, DIM, 1.5);
    off = sampleRings(cbeRings, N - off / 2, L.p, off);
    paint(L.c, L.s, b, N, ACC, 2.4);
    return L;
  }

  /* Stage 3 — VADAVALLI: locality ring + red pin burst; district edge as context. */
  function buildVAD() {
    var L = layout(), off = 0, a, b, c;
    var nCtx = Math.floor(N * 0.22), nEcho = Math.floor(N * 0.26), nPin = Math.floor(N * 0.10);
    off = sampleRings(cbeRings, nCtx, L.p, off); a = off / 2;
    paint(L.c, L.s, 0, a, FNT, 1.2);
    var echoes = [];
    [0.84, 0.68, 0.5, 0.32].forEach(function (f) { echoes.push(shrink(vadRing, f)); });
    off = sampleRings(echoes, nEcho, L.p, off); b = off / 2;
    paint(L.c, L.s, a, b, DIM, 1.6);
    /* pin burst — tight gaussian cluster on the pin, signal red */
    for (var i = 0; i < nPin; i++) {
      var ang = Math.random() * Math.PI * 2, rad = Math.pow(Math.random(), 2.2) * 0.10;
      L.p[off++] = vadPin[0] + Math.cos(ang) * rad;
      L.p[off++] = vadPin[1] + Math.sin(ang) * rad;
    }
    c = off / 2;
    paint(L.c, L.s, b, c, RED, 2.7);
    off = sampleRings([vadRing], N - c, L.p, off);
    paint(L.c, L.s, c, N, ACC, 2.4);
    return L;
  }

  var LAYOUTS = [buildIndia(), buildTN(), buildCBE(), buildVAD()];

  /* ---------------- stage metadata ---------------- */

  /* pad = breathing room; the small offsets push the subject up-right so the
     bottom-left title block doesn't make the composition feel lopsided */
  function view(bb, pad) {
    var m = Math.max(bb.w, bb.h) * pad;
    var v = { cx: bb.cx, cy: bb.cy, h: bb.h + m, w: bb.w + m };
    v.cx -= v.w * 0.035;
    v.cy -= v.h * 0.045;
    return v;
  }
  var STAGES = [
    { kicker: 'PARTICLE ATLAS — 01 / 04', title: 'INDIA', ghost: false,
      sub: 'Thirty-six states & territories, drawn in light.',
      coords: 'LAT 21.7679°N — LON 78.9629°E',
      view: view(BB.main, 0.16), label: null },
    { kicker: 'ZOOM — 02 / 04', title: 'TAMIL NADU', ghost: false,
      sub: 'Home state. 37 districts on the Bay of Bengal.',
      coords: 'LAT 11.1271°N — LON 78.6569°E',
      view: view(BB.tn, 0.30), label: { t: 'TAMIL NADU', x: BB.tn.cx, y: BB.tn.cy } },
    { kicker: 'ZOOM — 03 / 04', title: 'COIMBATORE', ghost: false,
      sub: 'The Manchester of South India — where I studied & build.',
      coords: 'DISTRICT — LAT 11.0168°N — LON 76.9558°E',
      view: view(BB.cbe, 0.34), label: { t: 'COIMBATORE DISTRICT', x: BB.cbe.cx, y: BB.cbe.cy } },
    { kicker: 'PINPOINT — 04 / 04', title: 'VADAVALLI', ghost: true,
      sub: 'Home ground, western Coimbatore. Where the drawings begin.',
      coords: 'LAT 11.0268°N — LON 76.8985°E — OUTLINE APPROX.',
      view: view(BB.vad, 1.4), label: { t: 'VADAVALLI', x: vadPin[0], y: vadPin[1] } }
  ];

  /* debug/testing hook */
  window.__ATLAS = { layouts: LAYOUTS, stages: STAGES, bb: BB, N: N };

  /* ---------------- three.js scene ---------------- */

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
  } catch (e) { document.getElementById('fallback').style.display = 'flex'; return; }
  var DPR = Math.min(devicePixelRatio || 1, 2);
  renderer.setPixelRatio(DPR);

  var scene = new THREE.Scene();
  var cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
  var camState = { cx: STAGES[0].view.cx, cy: STAGES[0].view.cy, h: STAGES[0].view.h * 1.9 }; // start pulled back

  var geo = new THREE.BufferGeometry();
  var posA = new Float32Array(N * 3), posB = new Float32Array(N * 3);
  var colA = new Float32Array(N * 3), colB = new Float32Array(N * 3);
  var sizA = new Float32Array(N), sizB = new Float32Array(N);
  var rnd = new Float32Array(N);
  for (var i = 0; i < N; i++) rnd[i] = Math.random();

  function fillB(L) {
    for (var i = 0; i < N; i++) {
      posB[i * 3] = L.p[i * 2]; posB[i * 3 + 1] = L.p[i * 2 + 1]; posB[i * 3 + 2] = 0;
      colB[i * 3] = L.c[i * 3]; colB[i * 3 + 1] = L.c[i * 3 + 1]; colB[i * 3 + 2] = L.c[i * 3 + 2];
      sizB[i] = L.s[i];
    }
    geo.attributes.posB.needsUpdate = true;
    geo.attributes.colB.needsUpdate = true;
    geo.attributes.sizB.needsUpdate = true;
  }
  /* freeze the CURRENT (possibly mid-morph) state into A so a new morph starts cleanly */
  function commit() {
    var P = uni.uProg.value;
    if (P > 0 && P < 1) {
      for (var i = 0; i < N; i++) {
        var t = Math.min(Math.max(P * 1.35 - rnd[i] * 0.35, 0), 1);
        t = t * t * (3 - 2 * t);
        posA[i * 3] += (posB[i * 3] - posA[i * 3]) * t;
        posA[i * 3 + 1] += (posB[i * 3 + 1] - posA[i * 3 + 1]) * t;
        colA[i * 3] += (colB[i * 3] - colA[i * 3]) * t;
        colA[i * 3 + 1] += (colB[i * 3 + 1] - colA[i * 3 + 1]) * t;
        colA[i * 3 + 2] += (colB[i * 3 + 2] - colA[i * 3 + 2]) * t;
        sizA[i] += (sizB[i] - sizA[i]) * t;
      }
    } else if (P >= 1) {
      posA.set(posB); colA.set(colB); sizA.set(sizB);
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.colA.needsUpdate = true;
    geo.attributes.sizA.needsUpdate = true;
    uni.uProg.value = 0;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(posA, 3));
  geo.setAttribute('posB', new THREE.BufferAttribute(posB, 3));
  geo.setAttribute('colA', new THREE.BufferAttribute(colA, 3));
  geo.setAttribute('colB', new THREE.BufferAttribute(colB, 3));
  geo.setAttribute('sizA', new THREE.BufferAttribute(sizA, 1));
  geo.setAttribute('sizB', new THREE.BufferAttribute(sizB, 1));
  geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));

  /* initial state: scattered cloud (A) aimed at the India layout (B) */
  (function () {
    var bb = BB.india;
    for (var i = 0; i < N; i++) {
      posA[i * 3] = bb.cx + (Math.random() - 0.5) * bb.w * 2.6;
      posA[i * 3 + 1] = bb.cy + (Math.random() - 0.5) * bb.h * 2.6;
      posA[i * 3 + 2] = 0;
      colA[i * 3] = FNT[0]; colA[i * 3 + 1] = FNT[1]; colA[i * 3 + 2] = FNT[2];
      sizA[i] = 1.0;
    }
    fillB(LAYOUTS[0]);
  })();

  var uni = {
    uProg: { value: 0 },
    uTime: { value: 0 },
    uMouse: { value: new THREE.Vector2(-9999, -9999) },
    uPxPerWorld: { value: 1 },
    uDpr: { value: DPR },
    uRipT: { value: -100 },                          // time (s) the last click ripple fired
    uRipPos: { value: new THREE.Vector2(0, 0) }      // world-space ripple origin
  };

  var mat = new THREE.ShaderMaterial({
    uniforms: uni,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: [
      'attribute vec3 posB;',
      'attribute vec3 colA; attribute vec3 colB;',
      'attribute float sizA; attribute float sizB;',
      'attribute float aRnd;',
      'uniform float uProg; uniform float uTime; uniform vec2 uMouse;',
      'uniform float uPxPerWorld; uniform float uDpr;',
      'uniform float uRipT; uniform vec2 uRipPos;',
      'varying vec3 vCol; varying float vFade;',
      'void main(){',
      '  float t = clamp((uProg*1.35 - aRnd*0.35), 0.0, 1.0);',
      '  t = t*t*(3.0-2.0*t);',
      '  vec3 p = mix(position, posB, t);',
      /* mid-flight swirl */
      '  float mid = sin(t*3.14159);',
      '  p.x += mid * sin(aRnd*40.0 + uTime*0.8) * 6.0 * (1.0/max(uPxPerWorld,0.02));',
      '  p.y += mid * cos(aRnd*35.0 + uTime*0.7) * 6.0 * (1.0/max(uPxPerWorld,0.02));',
      /* idle shimmer (constant on screen) */
      '  float px = 1.0/max(uPxPerWorld, 0.02);',
      '  p.x += sin(uTime*(0.6+aRnd)+aRnd*80.0) * 0.7 * px;',
      '  p.y += cos(uTime*(0.5+aRnd)+aRnd*60.0) * 0.7 * px;',
      /* cursor repulsion — done in screen space */
      '  vec2 dpx = (p.xy - uMouse) * uPxPerWorld;',
      '  float dl = length(dpx);',
      '  if(dl < 90.0 && dl > 0.001){',
      '    float f = (90.0 - dl)/90.0;',
      '    p.xy += normalize(dpx) * f * f * 26.0 * px;',
      '  }',
      /* click ripple — an expanding screen-space shockwave */
      '  float rage = uTime - uRipT;',
      '  if(rage > 0.0 && rage < 0.9){',
      '    vec2 rdpx = (p.xy - uRipPos) * uPxPerWorld;',
      '    float rlpx = length(rdpx);',
      '    float radpx = rage * 340.0;',
      '    float band = 1.0 - smoothstep(0.0, 28.0, abs(rlpx - radpx));',
      '    float decay = 1.0 - rage/0.9;',
      '    if(rlpx > 0.001) p.xy += normalize(rdpx) * band * decay * 34.0 * px;',
      '  }',
      '  vCol = mix(colA, colB, t);',
      '  float s = mix(sizA, sizB, t);',
      '  vFade = 0.75 + 0.25*sin(uTime*2.0 + aRnd*90.0);',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);',
      '  gl_PointSize = s * uDpr;',
      '}'
    ].join('\n'),
    fragmentShader: [
      'varying vec3 vCol; varying float vFade;',
      'void main(){',
      '  vec2 uv = gl_PointCoord - 0.5;',
      '  float d = length(uv);',
      '  float a = smoothstep(0.5, 0.12, d);',
      '  gl_FragColor = vec4(vCol, a * vFade);',
      '}'
    ].join('\n')
  });
  scene.add(new THREE.Points(geo, mat));

  /* ---------------- hover highlight outline ----------------
     One reusable LineSegments buffer redrawn to whichever region is hovered
     (or a stage-button preview). Additive so it reads as a glow over particles. */
  var HL_MAX = 20000;                              // max vertices in the highlight buffer
  var hlPos = new Float32Array(HL_MAX * 3);
  var hlGeo = new THREE.BufferGeometry();
  hlGeo.setAttribute('position', new THREE.BufferAttribute(hlPos, 3));
  hlGeo.setDrawRange(0, 0);
  var hlMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(0.337, 0.784, 0.941), transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  var hlLine = new THREE.LineSegments(hlGeo, hlMat);
  hlLine.renderOrder = 2;
  scene.add(hlLine);

  /* build a flat segment list (pairs of endpoints) from a region's rings */
  function ringsToSegments(rings) {
    var n = 0;
    for (var k = 0; k < rings.length && n < HL_MAX - 2; k++) {
      var r = rings[k];
      for (var i = 0; i + 3 < r.length && n < HL_MAX - 2; i += 2) {
        hlPos[n * 3] = r[i];     hlPos[n * 3 + 1] = r[i + 1]; hlPos[n * 3 + 2] = 0; n++;
        hlPos[n * 3] = r[i + 2]; hlPos[n * 3 + 1] = r[i + 3]; hlPos[n * 3 + 2] = 0; n++;
      }
    }
    hlGeo.attributes.position.needsUpdate = true;
    hlGeo.setDrawRange(0, n);
  }
  function showHighlight(rings, color, op) {
    op = (op == null) ? 0.9 : op;
    ringsToSegments(rings);
    hlMat.color.setRGB(color[0], color[1], color[2]);
    if (window.gsap) gsap.to(hlMat, { opacity: op, duration: 0.18, overwrite: true });
    else hlMat.opacity = op;
  }
  function hideHighlight() {
    if (window.gsap) gsap.to(hlMat, { opacity: 0, duration: 0.25, overwrite: true });
    else hlMat.opacity = 0;
  }

  /* ---------------- camera & resize ---------------- */

  function applyCam() {
    var asp = innerWidth / innerHeight;
    var h = camState.h, w = h * asp;
    cam.left = camState.cx - w / 2; cam.right = camState.cx + w / 2;
    cam.top = camState.cy + h / 2; cam.bottom = camState.cy - h / 2;
    cam.updateProjectionMatrix();
    uni.uPxPerWorld.value = innerHeight / h;
  }
  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    applyCam();
  }
  addEventListener('resize', resize);
  resize();

  function frameFor(v) {
    /* choose height so the bbox fits both axes */
    var asp = innerWidth / innerHeight;
    return Math.max(v.h, v.w / asp);
  }

  /* ---------------- HUD ---------------- */

  var elKickBox = document.getElementById('stage-kicker');
  var elKick = elKickBox.firstElementChild || elKickBox;
  var elTitle = document.getElementById('stage-title');
  var elSub = document.getElementById('stage-sub').firstElementChild || document.getElementById('stage-sub');
  var elCoords = document.getElementById('stage-coords');
  var elLabel = document.getElementById('map-label');
  var elPin = document.getElementById('pin');
  var elRet = document.getElementById('reticle');
  var btns = [].slice.call(document.querySelectorAll('.stage-btn'));
  var playBtn = document.getElementById('play-btn');
  var hint = document.getElementById('hint');

  /* HUD-style digit scramble for the coordinates readout (red while resolving) */
  function scramble(el, target, dur) {
    var digits = '0123456789';
    var t0 = (window.performance || Date).now();
    el.classList.add('lock');
    (function step() {
      var k = ((window.performance || Date).now() - t0) / (dur * 1000);
      if (k >= 1) { el.textContent = target; el.classList.remove('lock'); return; }
      var out = '';
      for (var i = 0; i < target.length; i++) {
        var ch = target.charAt(i);
        out += (i / target.length < k || '0123456789'.indexOf(ch) < 0) ? ch : digits.charAt((Math.random() * 10) | 0);
      }
      el.textContent = out;
      requestAnimationFrame(step);
    })();
  }

  function setHUD(s) {
    var st = STAGES[s];
    elKick.textContent = st.kicker;
    elKickBox.style.color = (s === 3) ? 'var(--red)' : '';
    elTitle.innerHTML = '<div class="reveal"><span' + (st.ghost ? ' class="ghost"' : '') + '>' + st.title + '</span></div>';
    elSub.textContent = st.sub;
    scramble(elCoords, st.coords, reduced ? 0.01 : 1.5);
    btns.forEach(function (b, i) { b.classList.toggle('on', i === s); });
    if (window.gsap && !reduced) {
      gsap.fromTo('#stage-hud .reveal>span', { yPercent: 110 }, { yPercent: 0, duration: 0.9, ease: 'power4.out', stagger: 0.07 });
    }
  }

  /* ---------------- red target-lock reticle ---------------- */

  var retAnchor = null;
  function aimReticle(st) {
    retAnchor = st.label ? { x: st.label.x, y: st.label.y } : { x: st.view.cx, y: st.view.cy };
    if (reduced) { elRet.style.opacity = 0.25; return; }
    if (gsap.killTweensOf) gsap.killTweensOf(elRet);
    gsap.set(elRet, { opacity: 0, scale: 2.3 });
    gsap.to(elRet, { opacity: 0.95, scale: 1, duration: MORPH * 0.85, ease: 'power3.inOut' });
    gsap.to(elRet, { opacity: 0.22, duration: 0.7, delay: MORPH * 0.85 + 1.1 });
  }

  /* ---------------- sequencing ---------------- */

  var stage = 0, playing = true, morphTween = null, holdTween = null;

  function goto(s, opts) {
    opts = opts || {};
    if (s === stage && !opts.force) return;
    stage = s;
    var st = STAGES[s];
    setHUD(s);
    try { history.replaceState(null, '', '#' + ['india', 'tamil-nadu', 'coimbatore', 'vadavalli'][s]); } catch (e) {}
    if (holdTween) { holdTween.kill(); holdTween = null; }
    btns.forEach(function (b) { gsap.set(b.querySelector('.fill'), { scaleX: 0 }); });

    commit();               // freeze current as A
    fillB(LAYOUTS[s]);      // aim at new layout

    var dur = reduced ? 0.01 : MORPH;
    if (morphTween) morphTween.kill();
    morphTween = gsap.to(uni.uProg, { value: 1, duration: dur, ease: 'power2.inOut' });
    gsap.to(camState, {
      cx: st.view.cx, cy: st.view.cy, h: frameFor(st.view),
      duration: reduced ? 0.01 : MORPH * 1.05, ease: 'power3.inOut', onUpdate: applyCam,
      onComplete: function () { if (playing) hold(); }
    });
    labelFor(s);
    aimReticle(st);
  }

  function hold() {
    var next = (stage + 1) % STAGES.length;
    var fill = btns[stage].querySelector('.fill');
    gsap.set(fill, { scaleX: 0 });
    holdTween = gsap.to(fill, {
      scaleX: 1, duration: HOLD, ease: 'none',
      onComplete: function () { if (playing) goto(next, { force: true }); }
    });
  }

  function setPlaying(p) {
    playing = p;
    playBtn.textContent = p ? '▮▮' : '▶';
    if (!p && holdTween) { holdTween.kill(); holdTween = null; btns.forEach(function (b) { gsap.to(b.querySelector('.fill'), { scaleX: 0, duration: .3 }); }); }
    if (p) hold();
  }
  playBtn.addEventListener('click', function () { setPlaying(!playing); });
  btns.forEach(function (b) {
    b.addEventListener('click', function () {
      setPlaying(false);
      goto(+b.dataset.stage, { force: true });
    });
  });

  /* ---------------- floating label & pin ---------------- */

  var labelAnchor = null, pinOn = false;
  function labelFor(s) {
    var st = STAGES[s];
    labelAnchor = st.label;
    pinOn = (s === 3);
    elLabel.classList.toggle('red', s === 3);
    gsap.to(elLabel, { opacity: labelAnchor ? 1 : 0, duration: 0.6, delay: labelAnchor ? 1.2 : 0 });
    gsap.to(elPin, { opacity: pinOn ? 1 : 0, duration: 0.5, delay: pinOn ? 1.4 : 0 });
    if (labelAnchor) elLabel.textContent = labelAnchor.t;
  }
  function project(x, y) {
    var v = new THREE.Vector3(x, y, 0).project(cam);
    return [(v.x * 0.5 + 0.5) * innerWidth, (-v.y * 0.5 + 0.5) * innerHeight];
  }

  /* ---------------- free explore: wheel zoom + drag pan ---------------- */

  var dragging = false, lx = 0, ly = 0;
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    hint.style.opacity = 0;
    var f = Math.exp(e.deltaY * 0.0012);
    var v0 = STAGES[0].view;
    camState.h = Math.min(Math.max(camState.h * f, 0.4), v0.h * 2.5);
    applyCam();
  }, { passive: false });
  canvas.addEventListener('pointerdown', function (e) { dragging = true; lx = e.clientX; ly = e.clientY; });
  addEventListener('pointerup', function () { dragging = false; });
  addEventListener('pointermove', function (e) {
    /* world-space mouse for the shader */
    var wpp = uni.uPxPerWorld.value;
    uni.uMouse.value.set(
      cam.left + (e.clientX / innerWidth) * (cam.right - cam.left),
      cam.top - (e.clientY / innerHeight) * (cam.top - cam.bottom)
    );
    if (dragging && !pinching) {
      hint.style.opacity = 0;
      camState.cx -= (e.clientX - lx) / wpp;
      camState.cy += (e.clientY - ly) / wpp;
      lx = e.clientX; ly = e.clientY;
      applyCam();
    }
  });

  /* ---------------- custom cursor (matches index.html) ---------------- */

  (function () {
    var dot = document.getElementById('cur'), ring = document.getElementById('cur-ring');
    if (!dot) return;
    var x = innerWidth / 2, y = innerHeight / 2, rx = x, ry = y;
    addEventListener('mousemove', function (e) { x = e.clientX; y = e.clientY; dot.style.left = x + 'px'; dot.style.top = y + 'px'; });
    (function loop() { rx += (x - rx) * 0.16; ry += (y - ry) * 0.16; ring.style.left = rx + 'px'; ring.style.top = ry + 'px'; requestAnimationFrame(loop); })();
    function bindCursor(el) {
      el.addEventListener('mouseenter', function () { ring.classList.add('big'); ring.textContent = el.dataset.cursor; });
      el.addEventListener('mouseleave', function () { ring.classList.remove('big'); ring.textContent = ''; });
    }
    [].slice.call(document.querySelectorAll('[data-cursor]')).forEach(bindCursor);
    window.__bindCursor = bindCursor;   // so dynamically-added POI markers can opt in
  })();

  /* ---------------- render loop ---------------- */

  var clock = new THREE.Clock();
  (function tick() {
    requestAnimationFrame(tick);
    uni.uTime.value = clock.getElapsedTime();
    if (labelAnchor) {
      var pt = project(labelAnchor.x, labelAnchor.y);
      elLabel.style.left = pt[0] + 'px'; elLabel.style.top = pt[1] + 'px';
    }
    if (pinOn) {
      var pp = project(vadPin[0], vadPin[1]);
      elPin.style.left = pp[0] + 'px'; elPin.style.top = pp[1] + 'px';
    }
    if (retAnchor) {
      var rp = project(retAnchor.x, retAnchor.y);
      elRet.style.left = rp[0] + 'px'; elRet.style.top = rp[1] + 'px';
    }
    renderer.render(scene, cam);
  })();

  /* ============================================================================
     INTERACTION LAYER — hover picking, POI markers, keyboard, ripple, drop-pin,
     stage previews, deep-links, scale bar, mobile gestures.
     ========================================================================== */

  /* -------- world <-> lat/lon (equirectangular, fit from TN geometry) -------- */
  var KX = 20.960, BX = -1429.554, KY = 21.509, BY = -145.498;
  function lonOf(x) { return (x - BX) / KX; }
  function latOf(y) { return (y - BY) / KY; }
  var KM_PER_WORLD = 110.57 / KY;                 // ~5.14 km per world unit
  function fmtLatLon(x, y) {
    var la = latOf(y), lo = lonOf(x);
    return 'LAT ' + Math.abs(la).toFixed(4) + (la >= 0 ? '°N' : '°S') +
           ' — LON ' + Math.abs(lo).toFixed(4) + (lo >= 0 ? '°E' : '°W');
  }
  function screenToWorld(cx, cy) {
    return [cam.left + (cx / innerWidth) * (cam.right - cam.left),
            cam.top - (cy / innerHeight) * (cam.top - cam.bottom)];
  }

  /* -------- pickable regions per stage -------- */
  function mkRegions(list, key) { return list.map(function (o) { return { name: o[key], rings: o.rings }; }); }
  var REG_INDIA = mkRegions(D.india, 'n');
  var REG_TN = mkRegions(D.tn, 'n');
  var REG_VAD = [{ name: 'Vadavalli', rings: [vadRing] }];
  function regionsForStage(s) { return s === 0 ? REG_INDIA : s === 3 ? REG_VAD : REG_TN; }

  function pip(x, y, r) {
    var inside = false;
    for (var i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      var yi = r[i + 1], yj = r[j + 1];
      if ((yi > y) !== (yj > y) && x < (r[j] - r[i]) * (y - yi) / (yj - yi) + r[i]) inside = !inside;
    }
    return inside;
  }
  function hitRegion(x, y, regions) {
    for (var k = 0; k < regions.length; k++) {
      var rr = regions[k].rings;
      for (var m = 0; m < rr.length; m++) if (pip(x, y, rr[m])) return regions[k];
    }
    return null;
  }
  function regionCenter(reg) {
    var b = bboxOf(reg.rings);
    return { cx: b.cx, cy: b.cy, span: Math.max(b.w, b.h) };
  }

  /* -------- fly-to (free navigation, pauses autoplay) -------- */
  function flyTo(cx, cy, h) {
    setPlaying(false);
    gsap.to(camState, { cx: cx, cy: cy, h: h, duration: 1.0, ease: 'power3.inOut', onUpdate: applyCam });
  }
  function recenter() {
    var v = STAGES[stage].view;
    gsap.to(camState, { cx: v.cx, cy: v.cy, h: frameFor(v), duration: 0.8, ease: 'power3.inOut', onUpdate: applyCam });
  }

  var HOVER = [0.62, 0.9, 1.0];                    // brighter cyan for hovered outline
  var elTip = document.getElementById('tooltip');

  /* -------- pinch/touch state (declared early; used by hover guard) -------- */
  var pointers = {}, pinching = false, pinchD0 = 0, pinchH0 = 0;

  /* -------- hover picking (mouse only) -------- */
  var lastHover = null, previewing = false;
  addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch' || dragging || pinching) return;
    var w = screenToWorld(e.clientX, e.clientY);
    var reg = hitRegion(w[0], w[1], regionsForStage(stage));
    if (reg) {
      elTip.textContent = reg.name;
      elTip.style.left = (e.clientX + 16) + 'px';
      elTip.style.top = (e.clientY - 8) + 'px';
      elTip.classList.add('on');
      if (reg !== lastHover) { showHighlight(reg.rings, HOVER, 0.85); lastHover = reg; }
    } else {
      elTip.classList.remove('on');
      if (lastHover && !previewing) { hideHighlight(); }
      lastHover = null;
    }
  });

  /* -------- tap / click: region focus, or ripple + drop-pin -------- */
  var downX = 0, downY = 0, downT = 0;
  var STAGE_OF = { 'Tamil Nadu': 1, 'Coimbatore': 2, 'Vadavalli': 3 };
  canvas.addEventListener('pointerdown', function (e) { downX = e.clientX; downY = e.clientY; downT = Date.now(); });
  canvas.addEventListener('pointerup', function (e) {
    if (pinching) return;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 7 || Date.now() - downT > 400) return; // was a drag
    var w = screenToWorld(e.clientX, e.clientY);
    var reg = hitRegion(w[0], w[1], regionsForStage(stage));
    if (reg && STAGE_OF[reg.name] != null && STAGE_OF[reg.name] !== stage) {
      setPlaying(false); goto(STAGE_OF[reg.name], { force: true }); return;
    }
    if (reg) { var c = regionCenter(reg); flyTo(c.cx, c.cy, Math.max(c.span * 1.6, 6)); return; }
    /* empty space — fire ripple + drop a coordinate pin */
    if (!reduced) { uni.uRipT.value = uni.uTime.value; uni.uRipPos.value.set(w[0], w[1]); }
    dropPin(w[0], w[1]);
  });

  /* -------- drop-pin coordinate readout -------- */
  var elDrop = document.getElementById('droppin'), dropWorld = null, dropTimer = null;
  function dropPin(x, y) {
    dropWorld = [x, y];
    elDrop.querySelector('.dp-co').textContent = fmtLatLon(x, y);
    elDrop.classList.add('on');
    clearTimeout(dropTimer);
    dropTimer = setTimeout(function () { elDrop.classList.remove('on'); dropWorld = null; }, 3200);
  }

  /* -------- POI markers + info card -------- */
  var POIS = [
    { id: 'akc', t: 'AK Consultant', r: 'Structural Engineer · Chennai',
      d: 'Structural design & analysis for building projects on India’s east coast.',
      href: 'index.html#xp', x: 252.95, y: 134.87, on: { 1: 1 }, offsetX: 0, offsetY: 0 },
    { id: 'cbe', t: 'Coimbatore', r: 'GRJ Builders · KGiSL Institute',
      d: 'Civil Engineer at GRJ Builders; M.E. Structural Engineering at KGiSL. Where I studied and build.',
      href: 'index.html#xp', x: 183.44, y: 90.43, on: { 1: 1, 2: 1 }, offsetX: 0, offsetY: 0 },
    { id: 'home', t: 'Vadavalli', r: 'Home ground',
      d: 'Western Coimbatore — where the drawings begin.',
      href: 'index.html#xp', x: 182.238, y: 90.645, on: { 2: 1 }, offsetX: 0, offsetY: 0, align: 'left' }
  ];
  var poiLayer = document.getElementById('poi-layer');
  POIS.forEach(function (p) {
    var el = document.createElement('button');
    el.className = 'poi'; el.setAttribute('data-cursor', 'OPEN');
    
    var xOff = p.offsetX ? (12 + p.offsetX) + 'px' : '12px';
    var yOff = p.offsetY ? 'calc(-50% + ' + p.offsetY + 'px)' : '-50%';
    
    // Switch to 'right' positioning if align is set to 'left', otherwise keep standard 'left'
    var sideStyle = p.align === 'left' ? 'right: ' + xOff + '; left: auto;' : 'left: ' + xOff + ';';
    
    el.innerHTML = '<span class="poi-dot"></span><span class="poi-lab" style="' + sideStyle + ' transform: translateY(' + yOff + ');">' + p.t + '</span>';
    
    el.addEventListener('click', function (ev) { ev.stopPropagation(); openCard(p); });
    if (window.__bindCursor) window.__bindCursor(el);
    p.el = el; poiLayer.appendChild(el);
  });
  var card = document.getElementById('poi-card');
  function openCard(p) {
    card.querySelector('.pc-t').textContent = p.t;
    card.querySelector('.pc-r').textContent = p.r;
    card.querySelector('.pc-d').textContent = p.d;
    card.querySelector('.pc-link').setAttribute('href', p.href);
    card.querySelector('.pc-co').textContent = fmtLatLon(p.x, p.y);
    card.classList.add('on');
    flyTo(p.x, p.y, Math.max(camState.h * 0.5, 7));
  }
  function closeCard() { card.classList.remove('on'); }
  card.querySelector('.pc-x').addEventListener('click', closeCard);

  /* -------- stage-button hover preview -------- */
  var previewRings = [mainRings, tnStateRings, cbeRings, [vadRing]];
  btns.forEach(function (b, i) {
    b.addEventListener('mouseenter', function () {
      if (i === stage) return;
      previewing = true; showHighlight(previewRings[i], DIM, 0.5);
    });
    b.addEventListener('mouseleave', function () {
      previewing = false; if (!lastHover) hideHighlight();
    });
  });

  /* -------- keyboard -------- */
  addEventListener('keydown', function (e) {
    var k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowDown') { setPlaying(false); goto((stage + 1) % STAGES.length, { force: true }); }
    else if (k === 'ArrowLeft' || k === 'ArrowUp') { setPlaying(false); goto((stage + STAGES.length - 1) % STAGES.length, { force: true }); }
    else if (k >= '1' && k <= '4') { setPlaying(false); goto(+k - 1, { force: true }); }
    else if (k === ' ') { e.preventDefault(); setPlaying(!playing); }
    else if (k === 'r' || k === 'R') { recenter(); }
    else if (k === 'Escape') { closeCard(); }
  });

  /* -------- recenter button -------- */
  document.getElementById('recenter').addEventListener('click', recenter);

  /* -------- pinch-zoom (touch) -------- */
  addEventListener('pointerdown', function (e) {
    if (e.pointerType !== 'touch') return;
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    var ids = Object.keys(pointers);
    if (ids.length === 2) {
      pinching = true; dragging = false;
      var a = pointers[ids[0]], b = pointers[ids[1]];
      pinchD0 = Math.hypot(a.x - b.x, a.y - b.y); pinchH0 = camState.h;
    }
  });
  addEventListener('pointermove', function (e) {
    if (!pointers[e.pointerId]) return;
    pointers[e.pointerId].x = e.clientX; pointers[e.pointerId].y = e.clientY;
    if (pinching) {
      var ids = Object.keys(pointers);
      if (ids.length >= 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        var d = Math.hypot(a.x - b.x, a.y - b.y);
        var v0 = STAGES[0].view;
        camState.h = Math.min(Math.max(pinchH0 * pinchD0 / Math.max(d, 1), 0.4), v0.h * 2.5);
        applyCam();
      }
    }
  });
  function endPtr(e) { delete pointers[e.pointerId]; if (Object.keys(pointers).length < 2) pinching = false; }
  addEventListener('pointerup', endPtr);
  addEventListener('pointercancel', endPtr);

  /* -------- projection loop: markers, drop-pin, scale bar -------- */
  var elScale = document.getElementById('scalebar'), scaleSteps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];
  (function overlayLoop() {
    requestAnimationFrame(overlayLoop);
    POIS.forEach(function (p) {
      var vis = !!p.on[stage];
      if (!vis) { p.el.style.display = 'none'; return; }
      var s = project(p.x, p.y);
      p.el.style.display = 'block';
      p.el.style.left = s[0] + 'px'; p.el.style.top = s[1] + 'px';
    });
    if (dropWorld) { var dp = project(dropWorld[0], dropWorld[1]); elDrop.style.left = dp[0] + 'px'; elDrop.style.top = dp[1] + 'px'; }
    /* scale bar */
    var kmPerPx = KM_PER_WORLD / uni.uPxPerWorld.value;
    for (var i = 0; i < scaleSteps.length; i++) {
      var wpx = scaleSteps[i] / kmPerPx;
      if (wpx >= 46 && wpx <= 150) {
        elScale.style.width = wpx + 'px';
        elScale.querySelector('.sb-lab').textContent = scaleSteps[i] >= 1000 ? (scaleSteps[i] / 1000) + ',000 km' : scaleSteps[i] + ' km';
        break;
      }
    }
  })();

  /* ---------------- opening sequence ---------------- */

  /* deep-link: #india | #tamil-nadu | #coimbatore | #vadavalli | #2 ... */
  var SLUGS = { 'india': 0, 'tamil-nadu': 1, 'tamilnadu': 1, 'coimbatore': 2, 'vadavalli': 3 };
  var hash = (location.hash || '').replace('#', '').toLowerCase();
  var startStage = SLUGS[hash] != null ? SLUGS[hash] : (hash >= '1' && hash <= '4' ? +hash - 1 : 0);

  setHUD(0);
  labelFor(0);
  aimReticle(STAGES[0]);
  window.__atlasOK = true;
  gsap.to(uni.uProg, { value: 1, duration: reduced ? 0.01 : 2.6, ease: 'power2.out', delay: 0.2 });
  gsap.to(camState, {
    h: frameFor(STAGES[0].view), duration: reduced ? 0.01 : 2.8, ease: 'power3.inOut', delay: 0.2,
    onUpdate: applyCam,
    onComplete: function () {
      if (startStage > 0) { setPlaying(false); goto(startStage, { force: true }); }
      else if (playing) hold();
    }
  });
})();