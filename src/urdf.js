// Minimal URDF loader and forward kinematics (no dependencies, works in Node and the browser).
// Supports the subset used by robot/helix.urdf: links with box/cylinder/sphere visuals, inertial mass,
// materials, and fixed/revolute joints with origin, axis and limits.

export function parseXml(text) {
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/([\w:-]+)\s*>|<([\w:-]+)((?:\s+[\w:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[1]) { stack.pop(); continue; }
    if (!m[2]) continue;
    const attrs = {};
    for (const a of (m[3] || '').matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
    const node = { tag: m[2], attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!m[4]) stack.push(node);
  }
  return root.children[0];
}

const nums = (s, n, d = 0) => { const a = (s ?? '').trim().split(/\s+/).filter(Boolean).map(Number); while (a.length < n) a.push(d); return a; };
const kid = (n, tag) => n.children.find((c) => c.tag === tag);
const kids = (n, tag) => n.children.filter((c) => c.tag === tag);

export function loadUrdf(text) {
  const robot = parseXml(text);
  const materials = new Map();
  for (const m of kids(robot, 'material')) { const c = kid(m, 'color'); if (c) materials.set(m.attrs.name, nums(c.attrs.rgba, 4, 1)); }
  const links = new Map();
  for (const l of kids(robot, 'link')) {
    const visuals = kids(l, 'visual').map((v) => {
      const g = kid(v, 'geometry').children[0];
      const o = kid(v, 'origin');
      const mat = kid(v, 'material');
      return { geom: { type: g.tag, ...Object.fromEntries(Object.entries(g.attrs).map(([k, val]) => [k, nums(val, 1)])) }, xyz: nums(o?.attrs.xyz, 3), rpy: nums(o?.attrs.rpy, 3), color: mat ? materials.get(mat.attrs.name) ?? [0.6, 0.6, 0.6, 1] : [0.6, 0.6, 0.6, 1] };
    });
    const inert = kid(l, 'inertial');
    links.set(l.attrs.name, { name: l.attrs.name, visuals, mass: inert ? Number(kid(inert, 'mass').attrs.value) : 0, comXyz: inert ? nums(kid(inert, 'origin')?.attrs.xyz, 3) : [0, 0, 0] });
  }
  const joints = kids(robot, 'joint').map((j) => {
    const o = kid(j, 'origin'), lim = kid(j, 'limit'), ax = kid(j, 'axis');
    return { name: j.attrs.name, type: j.attrs.type, parent: kid(j, 'parent').attrs.link, child: kid(j, 'child').attrs.link, xyz: nums(o?.attrs.xyz, 3), rpy: nums(o?.attrs.rpy, 3), axis: nums(ax?.attrs.xyz ?? '1 0 0', 3), lower: lim ? Number(lim.attrs.lower ?? 0) : 0, upper: lim ? Number(lim.attrs.upper ?? 0) : 0 };
  });
  const children = new Set(joints.map((j) => j.child));
  const root = [...links.keys()].find((n) => !children.has(n));
  return { name: robot.attrs.name, links, joints, root };
}

// ---- 4x4 row-major matrices
const I4 = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
export function mul(a, b) { const r = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j]; return r; }
function fromXyzRpy([x, y, z], [r, p, w]) {
  const cr = Math.cos(r), sr = Math.sin(r), cp = Math.cos(p), sp = Math.sin(p), cy = Math.cos(w), sy = Math.sin(w);
  return [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr, x, sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr, y, -sp, cp * sr, cp * cr, z, 0, 0, 0, 1];
}
function axisAngle([x, y, z], a) {
  const n = Math.hypot(x, y, z) || 1; x /= n; y /= n; z /= n;
  const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0, t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0, t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0, 0, 0, 0, 1];
}
export const apply = (T, p) => [T[0] * p[0] + T[1] * p[1] + T[2] * p[2] + T[3], T[4] * p[0] + T[5] * p[1] + T[6] * p[2] + T[7], T[8] * p[0] + T[9] * p[1] + T[10] * p[2] + T[11]];

export function revoluteJoints(model) { return model.joints.filter((j) => j.type === 'revolute'); }

// q: { jointName: angle in radians }. Returns Map linkName -> world transform.
export function forwardKinematics(model, q = {}) {
  const T = new Map([[model.root, I4()]]);
  const pending = [...model.joints];
  let guard = 0;
  while (pending.length && guard++ < 1000) {
    for (let i = pending.length - 1; i >= 0; i--) {
      const j = pending[i];
      if (!T.has(j.parent)) continue;
      let t = mul(T.get(j.parent), fromXyzRpy(j.xyz, j.rpy));
      if (j.type === 'revolute') { const a = Math.max(j.lower, Math.min(j.upper, q[j.name] ?? 0)); t = mul(t, axisAngle(j.axis, a)); }
      T.set(j.child, t);
      pending.splice(i, 1);
    }
  }
  return T;
}

// ---- geometry
function boxFaces(sx, sy, sz) {
  const x = sx / 2, y = sy / 2, z = sz / 2;
  const v = [[-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z], [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]];
  return [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 3, 7, 4]].map((f) => f.map((i) => v[i]));
}
function cylinderFaces(r, len, seg = 14) {
  const faces = [], h = len / 2, top = [], bot = [];
  for (let i = 0; i < seg; i++) {
    const a0 = (2 * Math.PI * i) / seg, a1 = (2 * Math.PI * (i + 1)) / seg;
    const p0 = [r * Math.cos(a0), r * Math.sin(a0)], p1 = [r * Math.cos(a1), r * Math.sin(a1)];
    faces.push([[p0[0], p0[1], -h], [p1[0], p1[1], -h], [p1[0], p1[1], h], [p0[0], p0[1], h]]);
    top.push([p0[0], p0[1], h]); bot.push([p0[0], p0[1], -h]);
  }
  faces.push(top, bot);
  return faces;
}
function sphereFaces(r, lat = 7, lon = 12) {
  const faces = [];
  const pt = (i, j) => { const th = (Math.PI * i) / lat, ph = (2 * Math.PI * j) / lon; return [r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th)]; };
  for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) faces.push([pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)]);
  return faces;
}
function localFaces(g) {
  if (g.type === 'box') return boxFaces(...nums(String(g.size.join(' ')), 3));
  if (g.type === 'cylinder') return cylinderFaces(g.radius[0], g.length[0]);
  if (g.type === 'sphere') return sphereFaces(g.radius[0]);
  return [];
}

// World-space faces [{pts, color}] for all visuals at pose q.
export function visualFaces(model, q = {}, extraRootT = null) {
  const T = forwardKinematics(model, q);
  const out = [];
  for (const [name, link] of model.links) {
    let Tl = T.get(name);
    if (!Tl) continue;
    if (extraRootT) Tl = mul(extraRootT, Tl);
    for (const v of link.visuals) {
      const Tv = mul(Tl, fromXyzRpy(v.xyz, v.rpy));
      for (const f of localFaces(v.geom)) out.push({ pts: f.map((p) => apply(Tv, p)), color: v.color, link: name });
    }
  }
  return out;
}

export function modelStats(model, q = {}) {
  const T = forwardKinematics(model, q);
  let zmin = Infinity, zmax = -Infinity, mass = 0, cx = 0, cy = 0, cz = 0;
  for (const f of visualFaces(model, q)) for (const p of f.pts) { zmin = Math.min(zmin, p[2]); zmax = Math.max(zmax, p[2]); }
  for (const [name, link] of model.links) {
    const Tl = T.get(name);
    if (!Tl || !link.mass) continue;
    const c = apply(Tl, link.comXyz);
    mass += link.mass; cx += link.mass * c[0]; cy += link.mass * c[1]; cz += link.mass * c[2];
  }
  return { height: zmax - Math.max(0, zmin), zmin, mass, com: mass ? [cx / mass, cy / mass, cz / mass] : [0, 0, 0] };
}

// Kinematic walking preview (NOT a physics simulation). phase in radians. Returns joint angles.
export function gaitPose(phase, carry = true) {
  const s = Math.sin(phase), s2 = Math.sin(phase + Math.PI);
  const leg = (sw) => {
    const hip = -0.42 * sw;
    const knee = 0.12 + 0.75 * Math.max(0, sw);
    return { hip, knee, ankle: -(hip + knee) };
  };
  const L = leg(s), R = leg(s2);
  const q = {
    l_hip_pitch: L.hip, l_knee_pitch: L.knee, l_ankle_pitch: L.ankle,
    r_hip_pitch: R.hip, r_knee_pitch: R.knee, r_ankle_pitch: R.ankle,
  };
  if (carry) Object.assign(q, CARRY_POSE); else Object.assign(q, { l_shoulder_pitch: 0.5 * s2, r_shoulder_pitch: 0.5 * s, l_elbow_pitch: -0.3, r_elbow_pitch: -0.3 });
  return q;
}
export const CARRY_POSE = { l_shoulder_pitch: -1.35, r_shoulder_pitch: -1.35, l_elbow_pitch: -0.5, r_elbow_pitch: -0.5 };
