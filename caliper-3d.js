// Interactive 3D wheel + brake caliper, plain WebGL (no libraries).
// Exposes window.CaliperViewer = { setColor(hex), setFinish(name), setView(name) }.
(function () {
  const canvas = document.getElementById('caliper-canvas');
  const view = document.getElementById('caliper-view');
  if (!canvas || !view) return;
  const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true });
  if (!gl) { view.classList.add('no-gl'); return; }

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- small math helpers ----------
  const v3 = {
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  };
  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  }
  function lookAt(eye, target, up) {
    const z = v3.norm(v3.sub(eye, target)), x = v3.norm(v3.cross(up, z)), y = v3.cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
      -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
      -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
      -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]), 1]);
  }
  const hexToLinear = hex => {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => Math.pow(c / 255, 2.2));
  };

  // ---------- geometry builders ----------
  function mesh(mat) { return { pos: [], nrm: [], mat }; }
  function tri(m, a, b, c, na, nb, nc) {
    m.pos.push(...a, ...b, ...c);
    m.nrm.push(...na, ...(nb || na), ...(nc || na));
  }
  // Revolve a 2D profile [[r, z], ...] around the Z axis (optionally around an offset centre).
  function lathe(m, profile, segs, a0, a1, opts = {}) {
    const { closed = false, caps = false, cx = 0, cy = 0, smooth = 0.8 } = opts;
    const pts = closed ? profile.concat([profile[0]]) : profile;
    const segN = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const dr = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][1] - pts[i][1], l = Math.hypot(dr, dz) || 1;
      segN.push([dz / l, -dr / l]);
    }
    // vertex normals: average neighbouring segment normals when the corner is gentle
    const vn = (i, side) => {
      const own = segN[i];
      const j = side === 0 ? i - 1 : i + 1;
      const other = segN[closed ? (j + segN.length) % segN.length : j];
      if (!other) return own;
      const d = own[0] * other[0] + own[1] * other[1];
      if (d < smooth) return own;
      const s = [own[0] + other[0], own[1] + other[1]], l = Math.hypot(s[0], s[1]) || 1;
      return [s[0] / l, s[1] / l];
    };
    const P = (r, z, t) => [cx + r * Math.cos(t), cy + r * Math.sin(t), z];
    const N = (n, t) => [n[0] * Math.cos(t), n[0] * Math.sin(t), n[1]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i], p1 = pts[i + 1], n0 = vn(i, 0), n1 = vn(i, 1);
      for (let j = 0; j < segs; j++) {
        const t0 = a0 + (a1 - a0) * j / segs, t1 = a0 + (a1 - a0) * (j + 1) / segs;
        const A = P(p0[0], p0[1], t0), B = P(p1[0], p1[1], t0), C = P(p1[0], p1[1], t1), D = P(p0[0], p0[1], t1);
        tri(m, A, B, C, N(n0, t0), N(n1, t0), N(n1, t1));
        tri(m, A, C, D, N(n0, t0), N(n1, t1), N(n0, t1));
      }
    }
    if (caps) {
      for (const t of [a0, a1]) {
        let cr = 0, cz = 0; profile.forEach(p => { cr += p[0]; cz += p[1]; });
        cr /= profile.length; cz /= profile.length;
        const n = [-Math.sin(t), Math.cos(t), 0], c = P(cr, cz, t);
        for (let i = 0; i < profile.length; i++) {
          const a = profile[i], b = profile[(i + 1) % profile.length];
          tri(m, c, P(a[0], a[1], t), P(b[0], b[1], t), n);
        }
      }
    }
  }
  // Rounded rectangle profile in (r, z)
  function roundRect(r0, r1, z0, z1, rad, steps = 5) {
    const out = [];
    const corners = [[r1 - rad, z1 - rad, 0], [r0 + rad, z1 - rad, Math.PI / 2], [r0 + rad, z0 + rad, Math.PI], [r1 - rad, z0 + rad, Math.PI * 1.5]];
    corners.forEach(([cr, cz, s]) => {
      for (let k = 0; k <= steps; k++) { const a = s + (Math.PI / 2) * k / steps; out.push([cr + rad * Math.cos(a), cz + rad * Math.sin(a)]); }
    });
    return out;
  }
  // Flat-shaded quad prism from 8 corners: front quad f[0..3], back quad b[0..3]
  function prism(m, f, b) {
    const quad = (a, b2, c, d) => {
      const n = v3.norm(v3.cross(v3.sub(b2, a), v3.sub(c, a)));
      tri(m, a, b2, c, n); tri(m, a, c, d, n);
    };
    quad(f[0], f[1], f[2], f[3]); quad(b[3], b[2], b[1], b[0]);
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(f[i], b[i], b[j], f[j]); }
  }

  // ---------- materials ----------
  const MAT = {
    tire:    { color: hexToLinear('#18191b'), spec: 0.12, shin: 14, env: 0.04, metal: 0 },
    rim:     { color: hexToLinear('#3a3e44'), spec: 0.6, shin: 60, env: 0.6, metal: 1 },
    rimLip:  { color: hexToLinear('#55595e'), spec: 0.7, shin: 90, env: 0.8, metal: 1 },
    barrel:  { color: hexToLinear('#141517'), spec: 0.2, shin: 20, env: 0.1, metal: 1 },
    well:    { color: hexToLinear('#08090a'), spec: 0.0, shin: 1, env: 0.0, metal: 0 },
    rotor:   { color: hexToLinear('#6c7075'), spec: 0.4, shin: 36, env: 0.3, metal: 1, pattern: 1 },
    hat:     { color: hexToLinear('#4b4e52'), spec: 0.3, shin: 30, env: 0.25, metal: 1 },
    bolt:    { color: hexToLinear('#c9cdd1'), spec: 0.9, shin: 90, env: 0.7, metal: 1 },
    lug:     { color: hexToLinear('#8e9297'), spec: 0.8, shin: 80, env: 0.6, metal: 1 },
    caliper: { color: hexToLinear('#CD1620'), spec: 1.0, shin: 140, env: 1.0, metal: 0 },
    plate:   { color: hexToLinear('#CD1620'), spec: 1.0, shin: 140, env: 1.0, metal: 0, logo: 1 }
  };
  const FINISH = {
    gloss: { spec: 1.0, shin: 140, env: 1.0 },
    satin: { spec: 0.35, shin: 28, env: 0.28 },
    matte: { spec: 0.06, shin: 8, env: 0.04 }
  };

  // ---------- build the wheel ----------
  const meshes = [];
  const add = mat => { const m = mesh(mat); meshes.push(m); return m; };
  const TAU = Math.PI * 2;

  // wheel well / backing so the gaps between spokes read as depth, not empty space
  lathe(add(MAT.well), [[0, -0.3], [0.74, -0.3]], 64, 0, TAU);

  // tyre: superellipse cross-section
  {
    const prof = [], n = 3.2, steps = 56;
    for (let k = 0; k < steps; k++) {
      const t = TAU * k / steps, c = Math.cos(t), s = Math.sin(t);
      prof.push([0.858 + 0.118 * Math.sign(c) * Math.pow(Math.abs(c), 2 / n), 0.235 * Math.sign(s) * Math.pow(Math.abs(s), 2 / n)]);
    }
    lathe(add(MAT.tire), prof, 120, 0, TAU, { closed: true, smooth: 0.5 });
  }
  // rim barrel (inside) and polished front lip
  lathe(add(MAT.barrel), [[0.705, -0.26], [0.705, 0.17]], 96, 0, TAU);
  lathe(add(MAT.rimLip), [[0.705, 0.17], [0.715, 0.205], [0.735, 0.228], [0.758, 0.236], [0.772, 0.228], [0.768, 0.212], [0.75, 0.2]], 120, 0, TAU, { smooth: 0.5 });

  // rotor + hat
  lathe(add(MAT.rotor), roundRect(0.2, 0.6, -0.035, 0.035, 0.008, 2), 120, 0, TAU, { closed: true });
  lathe(add(MAT.hat), roundRect(0.08, 0.235, -0.04, 0.12, 0.015, 3), 64, 0, TAU, { closed: true });

  // caliper body (sector wrapped over the rotor edge at 3 o'clock), raised face plate, bolts
  const SPAN = 0.64, PLATE = SPAN - 0.12;
  const calBody = add(MAT.caliper);
  lathe(calBody, roundRect(0.415, 0.688, -0.13, 0.135, 0.045, 6), 56, -SPAN, SPAN, { closed: true, caps: true, smooth: 0.6 });
  lathe(add(MAT.plate), roundRect(0.465, 0.645, 0.1, 0.16, 0.02, 4), 56, -PLATE, PLATE, { closed: true, caps: true, smooth: 0.6 });
  const bolts = add(MAT.bolt);
  for (const t of [-SPAN + 0.06, SPAN - 0.06]) {
    lathe(bolts, roundRect(0, 0.024, 0.12, 0.162, 0.006, 2), 20, 0, TAU, { closed: true, cx: 0.555 * Math.cos(t), cy: 0.555 * Math.sin(t) });
  }

  // spokes: five split "Y" spokes, concave from hub to rim
  const spokes = add(MAT.rim);
  const spoke = (ai, ao) => {
    const ri = 0.14, ro = 0.712, zi = 0.258, zo = 0.196, depth = 0.075, wi = 0.092, wo = 0.074;
    const ci = [ri * Math.cos(ai), ri * Math.sin(ai), zi], co = [ro * Math.cos(ao), ro * Math.sin(ao), zo];
    const d = v3.sub(co, ci), s = v3.norm([-d[1], d[0], 0]);
    const fi = [v3.add(ci, v3.scale(s, wi / 2)), v3.add(ci, v3.scale(s, -wi / 2))];
    const fo = [v3.add(co, v3.scale(s, -wo / 2)), v3.add(co, v3.scale(s, wo / 2))];
    const f = [fi[0], fi[1], fo[0], fo[1]];
    const b = f.map(p => [p[0], p[1], p[2] - depth]);
    // soften the front edges a touch by insetting the front face slightly
    const fIn = f.map((p, k) => { const o = k < 2 ? ci : co; return v3.add(o, v3.scale(v3.sub(p, o), 0.86)); }).map(p => [p[0], p[1], p[2] + 0.006]);
    prism(spokes, fIn, f);
    prism(spokes, f, b);
  };
  for (let k = 0; k < 5; k++) {
    const c = Math.PI / 2 + k * TAU / 5;
    spoke(c - 0.075, c - 0.15);
    spoke(c + 0.075, c + 0.15);
  }
  // hub, lug nuts and centre cap
  lathe(spokes, [[0.16, 0.2], [0.155, 0.245], [0.14, 0.268], [0.11, 0.276], [0.0, 0.276]], 64, 0, TAU, { smooth: 0.5 });
  const lugs = add(MAT.lug);
  for (let k = 0; k < 5; k++) {
    const t = Math.PI / 2 + TAU / 10 + k * TAU / 5;
    lathe(lugs, [[0.019, 0.27], [0.019, 0.292], [0.014, 0.3], [0, 0.3]], 6, 0, TAU, { cx: 0.098 * Math.cos(t), cy: 0.098 * Math.sin(t), smooth: 0.95 });
  }
  lathe(add(MAT.rimLip), [[0.05, 0.276], [0.05, 0.284], [0.044, 0.29], [0, 0.29]], 40, 0, TAU, { smooth: 0.5 });

  // ---------- GL setup ----------
  const vs = `
    attribute vec3 aPos; attribute vec3 aNrm;
    uniform mat4 uProj, uView;
    varying vec3 vP, vN;
    void main(){ vP = aPos; vN = aNrm; gl_Position = uProj * uView * vec4(aPos, 1.0); }`;
  const fs = `
    precision highp float;
    varying vec3 vP, vN;
    uniform vec3 uCam, uColor;
    uniform float uSpec, uShin, uEnv, uMetal, uPattern, uLogo, uSpan;
    uniform vec3 uInk;
    uniform sampler2D uTex;
    vec3 env(vec3 R){
      vec3 c = mix(vec3(0.015), vec3(0.07,0.075,0.085), smoothstep(-0.3, 0.4, R.y));
      c += vec3(2.2) * smoothstep(0.55, 0.72, R.y) * smoothstep(0.98, 0.84, R.y);           // overhead softbox
      c += vec3(1.1) * smoothstep(0.45, 0.75, R.x) * smoothstep(0.45, 0.05, abs(R.y - 0.05)); // right strip
      c += vec3(0.5,0.55,0.6) * smoothstep(-0.5,-0.8, R.x) * smoothstep(0.5, 0.0, abs(R.y));  // cool left fill
      return c;
    }
    vec3 light(vec3 N, vec3 V, vec3 L, vec3 col, vec3 base){
      float d = max(dot(N, L), 0.0);
      vec3 H = normalize(L + V);
      float s = pow(max(dot(N, H), 0.0), uShin) * uSpec * (uShin + 8.0) / 40.0;
      vec3 sc = mix(vec3(1.0), base, uMetal);
      return col * (base * d * (1.0 - 0.6 * uMetal) + sc * s * d);
    }
    void main(){
      vec3 N = normalize(vN);
      vec3 V = normalize(uCam - vP);
      if (dot(N, V) < 0.0) N = -N;
      vec3 base = uColor;
      float ink = 0.0;
      if (uPattern > 0.5) {
        float r = length(vP.xy);
        base *= 0.88 + 0.12 * sin(r * 900.0) * sin(r * 37.0);
        base *= 1.0 - 0.35 * smoothstep(0.585, 0.6, r) - 0.25 * (1.0 - smoothstep(0.3, 0.32, r));
        // cross-drilled holes on the friction face, three staggered rows
        if (abs(N.z) > 0.8 && r > 0.33) {
          float a = atan(vP.y, vP.x);
          float hole = 0.0;
          for (int i = 0; i < 3; i++) {
            float rr = 0.38 + float(i) * 0.075;
            float aa = (a + float(i) * 0.087) / 0.2618;
            float da = (fract(aa) - 0.5) * 0.2618 * rr;
            hole = max(hole, 1.0 - smoothstep(0.009, 0.013, length(vec2(da, r - rr))));
          }
          base *= 1.0 - 0.92 * hole;
        }
      }
      if (uLogo > 0.5 && N.z > 0.85) {
        float r = length(vP.xy), a = atan(vP.y, vP.x);
        vec2 uv = vec2(0.5 + (r - 0.555) / 0.17, 0.5 - a / (2.0 * uSpan));
        if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) ink = texture2D(uTex, uv).a;
      }
      vec3 c = base * mix(vec3(0.05,0.045,0.04), vec3(0.11,0.12,0.13), N.y * 0.5 + 0.5);
      c += light(N, V, normalize(vec3(-0.45, 0.75, 0.6)), vec3(2.4, 2.3, 2.15), base);
      c += light(N, V, normalize(vec3(0.85, 0.15, 0.45)), vec3(0.7, 0.78, 0.9), base);
      c += light(N, V, normalize(vec3(0.3, 0.5, -0.8)), vec3(0.9), base);
      float ndv = max(dot(N, V), 0.0);
      vec3 R = reflect(-V, N);
      float F = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
      vec3 e = env(R);
      c += mix(e * F, e * base * (0.5 + 0.5 * F), uMetal) * uEnv;
      c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
      c = mix(c, uInk * (0.9 + 0.5 * pow(max(dot(N, normalize(normalize(vec3(-0.45, 0.75, 0.6)) + V)), 0.0), 40.0)), ink);
      gl_FragColor = vec4(pow(clamp(c, 0.0, 1.0), vec3(1.0/2.2)), 1.0);
    }`;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (e) { view.classList.add('no-gl'); return; }
  gl.useProgram(prog);
  const loc = n => gl.getUniformLocation(prog, n);
  const U = { logo: loc('uLogo'), span: loc('uSpan'), ink: loc('uInk'), tex: loc('uTex'), proj: loc('uProj'), view: loc('uView'), cam: loc('uCam'), color: loc('uColor'), spec: loc('uSpec'), shin: loc('uShin'), env: loc('uEnv'), metal: loc('uMetal'), pattern: loc('uPattern') };
  const aPos = gl.getAttribLocation(prog, 'aPos'), aNrm = gl.getAttribLocation(prog, 'aNrm');
  gl.enableVertexAttribArray(aPos); gl.enableVertexAttribArray(aNrm);
  meshes.forEach(m => {
    m.count = m.pos.length / 3;
    m.pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, m.pb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(m.pos), gl.STATIC_DRAW);
    m.nb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, m.nb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(m.nrm), gl.STATIC_DRAW);
    m.pos = m.nrm = null;
  });
  gl.enable(gl.DEPTH_TEST);

  // Brand lettering for the caliper face, drawn once into a texture.
  // Text runs along the arc: texture x = radius, y = angle.
  const logoTex = gl.createTexture();
  function drawLogo() {
    const tc = document.createElement('canvas'); tc.width = 128; tc.height = 512;
    const g = tc.getContext('2d');
    g.translate(64, 256); g.rotate(Math.PI / 2);
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '600 52px Michroma, Saira, Arial, sans-serif';
    g.fillText('MAIN LINE', 0, 4, 470);
    gl.bindTexture(gl.TEXTURE_2D, logoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tc);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(loc('uTex'), 0);
    dirty = true;
  }
  let dirty = true;
  drawLogo();
  if (document.fonts) document.fonts.load('600 52px Michroma').then(drawLogo, () => {});

  // ---------- camera & views ----------
  const VIEWS = {
    front: { yaw: 0.0,  pitch: 0.04, dist: 4.05, tx: 0.0,  ty: 0.0,  tz: 0.0 },
    three: { yaw: 0.62, pitch: 0.14, dist: 3.8,  tx: 0.1,  ty: 0.0,  tz: 0.0 },
    low:   { yaw: -0.5, pitch: -0.2, dist: 3.8,  tx: 0.05, ty: 0.05, tz: 0.0 },
    close: { yaw: 0.78, pitch: 0.1,  dist: 1.85, tx: 0.5,  ty: 0.0,  tz: 0.05 }
  };
  const cam = Object.assign({}, VIEWS.three);
  let tween = null, interacted = false, visible = true, colorTween = null;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; dirty = true; }
  }
  function draw(t) {
    resize();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    let yaw = cam.yaw;
    if (!interacted && !reduceMotion && !tween) yaw += 0.14 * Math.sin(t / 1600);
    const target = [cam.tx, cam.ty, cam.tz];
    const eye = [target[0] + cam.dist * Math.sin(yaw) * Math.cos(cam.pitch), target[1] + cam.dist * Math.sin(cam.pitch), target[2] + cam.dist * Math.cos(yaw) * Math.cos(cam.pitch)];
    gl.uniformMatrix4fv(U.proj, false, perspective(30 * Math.PI / 180, canvas.width / canvas.height, 0.1, 20));
    gl.uniformMatrix4fv(U.view, false, lookAt(eye, target, [0, 1, 0]));
    gl.uniform3fv(U.cam, eye);
    meshes.forEach(m => {
      const s = m.mat;
      gl.uniform3fv(U.color, s.color);
      gl.uniform1f(U.spec, s.spec); gl.uniform1f(U.shin, s.shin); gl.uniform1f(U.env, s.env);
      gl.uniform1f(U.metal, s.metal); gl.uniform1f(U.pattern, s.pattern || 0);
      gl.uniform1f(U.logo, s.logo || 0); gl.uniform1f(U.span, PLATE);
      gl.uniform3fv(U.ink, inkColor());
      gl.bindBuffer(gl.ARRAY_BUFFER, m.pb); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, m.nb); gl.vertexAttribPointer(aNrm, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, m.count);
    });
  }
  function inkColor() {
    const c = MAT.caliper.color, lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    return lum > 0.35 ? [0.06, 0.06, 0.07] : [0.95, 0.95, 0.95];
  }
  const ease = x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  function frame(t) {
    if (tween) {
      const k = Math.min((t - tween.start) / tween.dur, 1), e = ease(k);
      for (const key in tween.to) cam[key] = tween.from[key] + (tween.to[key] - tween.from[key]) * e;
      if (k >= 1) tween = null;
      dirty = true;
    }
    if (colorTween) {
      const k = Math.min((t - colorTween.start) / 320, 1), e = ease(k);
      MAT.caliper.color = colorTween.from.map((c, i) => c + (colorTween.to[i] - c) * e);
      ['spec', 'shin', 'env', 'metal'].forEach(p => { MAT.caliper[p] = colorTween.f0[p] + (colorTween.f1[p] - colorTween.f0[p]) * e; });
      Object.assign(MAT.plate, { color: MAT.caliper.color, spec: MAT.caliper.spec, shin: MAT.caliper.shin, env: MAT.caliper.env, metal: MAT.caliper.metal });
      if (k >= 1) colorTween = null;
      dirty = true;
    }
    const swaying = !interacted && !reduceMotion;
    if (visible && (dirty || swaying)) { draw(t); dirty = false; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  new ResizeObserver(() => { dirty = true; }).observe(canvas);
  new IntersectionObserver(es => { visible = es[0].isIntersecting; dirty = true; }).observe(canvas);

  // ---------- interaction ----------
  const clampCam = () => { cam.yaw = Math.max(-1.3, Math.min(1.3, cam.yaw)); cam.pitch = Math.max(-0.35, Math.min(0.65, cam.pitch)); };
  const markInteracted = () => { if (!interacted) { interacted = true; view.classList.add('interacted'); } setActiveView(null); };
  let drag = null;
  canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, type: e.pointerType }; canvas.setPointerCapture(e.pointerId); tween = null; });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY;
    cam.yaw -= dx * 0.008;
    if (drag.type !== 'touch') cam.pitch += dy * 0.006;
    clampCam(); markInteracted(); dirty = true;
  });
  const end = () => { drag = null; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('keydown', e => {
    const step = 0.12;
    if (e.key === 'ArrowLeft') cam.yaw += step; else if (e.key === 'ArrowRight') cam.yaw -= step;
    else if (e.key === 'ArrowUp') cam.pitch += step * 0.7; else if (e.key === 'ArrowDown') cam.pitch -= step * 0.7;
    else return;
    e.preventDefault(); clampCam(); markInteracted(); dirty = true;
  });

  const viewButtons = Array.from(view.querySelectorAll('[data-view]'));
  function setActiveView(name) { viewButtons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === name))); }
  function setView(name) {
    const to = VIEWS[name]; if (!to) return;
    interacted = true; view.classList.add('interacted');
    setActiveView(name);
    if (reduceMotion) { Object.assign(cam, to); dirty = true; return; }
    tween = { from: Object.assign({}, cam), to, start: performance.now(), dur: 750 };
  }
  viewButtons.forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  setActiveView('three');

  let goalColor = MAT.caliper.color.slice(), goalFinish = FINISH.gloss, goalMetal = 0;
  function retarget() {
    const f1 = Object.assign({ metal: goalMetal }, goalFinish);
    if (reduceMotion) { MAT.caliper.color = goalColor.slice(); Object.assign(MAT.caliper, f1); Object.assign(MAT.plate, { color: MAT.caliper.color }, f1); dirty = true; return; }
    colorTween = { from: MAT.caliper.color.slice(), to: goalColor, f0: { spec: MAT.caliper.spec, shin: MAT.caliper.shin, env: MAT.caliper.env, metal: MAT.caliper.metal }, f1, start: performance.now() };
  }
  function setColor(hex, opts = {}) { goalColor = hexToLinear(hex).map(c => opts.metallic ? c * 0.42 : c); goalMetal = opts.metallic ? 0.7 : 0; retarget(); }
  function setFinish(name) { if (FINISH[name]) { goalFinish = FINISH[name]; retarget(); } }
  view.classList.add('gl-ready');
  window.CaliperViewer = { setColor, setFinish, setView };
})();
