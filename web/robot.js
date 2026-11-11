import { loadUrdf, visualFaces, modelStats, revoluteJoints, gaitPose, CARRY_POSE } from '/src/urdf.js';

const $ = (id) => document.getElementById(id);
const cv = $('cv'), g = cv.getContext('2d');
const text = await (await fetch('/robot/helix.urdf')).text();
const model = loadUrdf(text);
const joints = revoluteJoints(model);

let q = Object.fromEntries(joints.map((j) => [j.name, 0]));
let walking = false, phase = 0, last = 0;
const cam = { yaw: 0.9, pitch: 0.22, dist: 2.6, target: [0.25, 0, 0.78] };

// ---- controls
const sl = $('sliders');
for (const j of joints) {
  const row = document.createElement('div'); row.className = 'sl';
  row.innerHTML = `<span>${j.name}</span><input type="range" min="${j.lower}" max="${j.upper}" step="0.01" value="0" data-j="${j.name}"><output>0°</output>`;
  sl.appendChild(row);
}
function syncSliders() { for (const inp of sl.querySelectorAll('input')) { inp.value = q[inp.dataset.j] ?? 0; inp.nextElementSibling.textContent = `${Math.round((q[inp.dataset.j] ?? 0) * 57.2958)}°`; } }
sl.addEventListener('input', (e) => { if (!e.target.dataset.j) return; walking = false; $('bWalk').textContent = 'Walk preview'; q[e.target.dataset.j] = Number(e.target.value); e.target.nextElementSibling.textContent = `${Math.round(q[e.target.dataset.j] * 57.2958)}°`; });
$('bStand').onclick = () => { walking = false; $('bWalk').textContent = 'Walk preview'; q = Object.fromEntries(joints.map((j) => [j.name, 0])); syncSliders(); };
$('bCarry').onclick = () => { walking = false; $('bWalk').textContent = 'Walk preview'; q = { ...Object.fromEntries(joints.map((j) => [j.name, 0])), ...CARRY_POSE }; $('cCas').checked = true; syncSliders(); };
$('bWalk').onclick = () => { walking = !walking; $('bWalk').textContent = walking ? 'Stop walking' : 'Walk preview'; if (walking) { Object.assign(q, CARRY_POSE); } };
let drag = null;
cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); });
cv.addEventListener('pointermove', (e) => { if (!drag) return; cam.yaw -= (e.clientX - drag.x) * 0.008; cam.pitch = Math.max(-0.2, Math.min(1.2, cam.pitch + (e.clientY - drag.y) * 0.006)); drag = { x: e.clientX, y: e.clientY }; });
cv.addEventListener('pointerup', () => { drag = null; });
cv.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist = Math.max(1.6, Math.min(8, cam.dist * (1 + e.deltaY * 0.001))); }, { passive: false });

// ---- projection
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const n = Math.hypot(...a) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };

function camera() {
  const eye = [cam.target[0] + cam.dist * Math.cos(cam.pitch) * Math.cos(cam.yaw), cam.target[1] + cam.dist * Math.cos(cam.pitch) * Math.sin(cam.yaw), cam.target[2] + cam.dist * Math.sin(cam.pitch)];
  const f = norm(sub(cam.target, eye)); const r = norm(cross(f, [0, 0, 1])); const u = cross(r, f);
  return { eye, f, r, u };
}
function project(c, p) { const d = sub(p, c.eye); const z = dot(d, c.f); const s = 760 / z; return { x: cv.width / 2 + s * dot(d, c.r), y: cv.height / 2 - s * dot(d, c.u), z }; }
const LIGHT = norm([0.4, -0.6, 0.9]);

// --- Mannequin casualty (drawn only for design review; not part of the URDF) ---------------
function limb(p0, p1, r0, r1, color, n = 8) {
  const a = sub(p1, p0), len = Math.hypot(...a), d = a.map((x) => x / len);
  const h = Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm(cross(d, h)), w = cross(d, u);
  const ring = (p, r) => Array.from({ length: n }, (_, i) => { const t = (i / n) * 2 * Math.PI; return [0, 1, 2].map((k) => p[k] + r * (Math.cos(t) * u[k] + Math.sin(t) * w[k])); });
  const A = ring(p0, r0), B = ring(p1, r1), faces = [];
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; faces.push({ pts: [A[i], A[j], B[j], B[i]], color }); }
  faces.push({ pts: A, color }, { pts: B, color });
  return faces;
}
function blob(c, rx, ry, rz, color, nu = 10, nv = 6) {
  const P = (i, j) => { const th = (i / nu) * 2 * Math.PI, ph = (j / nv) * Math.PI; return [c[0] + rx * Math.sin(ph) * Math.cos(th), c[1] + ry * Math.sin(ph) * Math.sin(th), c[2] + rz * Math.cos(ph)]; };
  const faces = [];
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) faces.push({ pts: [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)], color });
  return faces;
}
function casualtyFaces() {
  // Mannequin in a cradle carry: lying across both forearms, head to the robot's left, legs hanging to its right.
  const SKIN = [0.88, 0.74, 0.62, 1], SHIRT = [0.93, 0.50, 0.18, 1], PANTS = [0.22, 0.28, 0.42, 1], HAIR = [0.16, 0.11, 0.08, 1], SHOE = [0.12, 0.12, 0.14, 1];
  const x = 0.36, z = 1.33; // resting on top of the forearms (forearm centre ~ (0.34, ±0.22, 1.20))
  const F = [];
  F.push(...blob([x, 0.66, z + 0.01], 0.085, 0.10, 0.10, SKIN));            // head
  F.push(...blob([x, 0.67, z + 0.05], 0.088, 0.10, 0.07, HAIR, 10, 3));    // hair cap
  F.push(...limb([x, 0.54, z], [x, 0.60, z], 0.04, 0.035, SKIN, 6));       // neck
  F.push(...limb([x, 0.50, z], [x, 0.04, z - 0.01], 0.13, 0.115, SHIRT));   // torso
  F.push(...limb([x, 0.04, z - 0.01], [x, -0.10, z - 0.02], 0.115, 0.12, PANTS)); // hips
  for (const s of [-1, 1]) {
    const lx = x + s * 0.075;
    F.push(...limb([lx, -0.10, z - 0.02], [lx, -0.50, z - 0.05], 0.08, 0.055, PANTS));          // thigh
    F.push(...limb([lx, -0.50, z - 0.05], [lx + s * 0.01, -0.86, z - 0.17], 0.055, 0.04, PANTS)); // shin hanging slightly down
    F.push(...limb([lx + s * 0.01, -0.86, z - 0.17], [lx + s * 0.01, -0.97, z - 0.19], 0.05, 0.045, SHOE)); // foot
    const ax = x + s * 0.20;
    F.push(...limb([ax, 0.46, z - 0.01], [ax + s * 0.02, 0.18, z - 0.09], 0.045, 0.04, SHIRT));  // upper arm
    F.push(...limb([ax + s * 0.02, 0.18, z - 0.09], [ax + s * 0.03, -0.04, z - 0.20], 0.04, 0.032, SKIN)); // forearm hanging
  }
  return F;
}

function draw(t) {
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
  if (walking) { phase += dt * 2 * Math.PI * Number($('rCad').value) * 0.5; Object.assign(q, gaitPose(phase, true)); syncSliders(); }
  const bob = walking ? 0.012 * Math.cos(2 * phase) : 0;
  g.fillStyle = '#c9d8ec'; g.fillRect(0, 0, cv.width, cv.height);
  const c = camera();
  // ground grid (scrolls while walking)
  g.strokeStyle = '#a9bddb'; g.lineWidth = 1;
  const off = walking ? -((phase * 0.18) % 0.5) : 0;
  for (let i = -8; i <= 8; i++) {
    const a = project(c, [i * 0.5 + off, -4, 0]), b = project(c, [i * 0.5 + off, 4, 0]); if (a.z > 0.1 && b.z > 0.1) { g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
    const a2 = project(c, [-4, i * 0.5, 0]), b2 = project(c, [4, i * 0.5, 0]); if (a2.z > 0.1 && b2.z > 0.1) { g.beginPath(); g.moveTo(a2.x, a2.y); g.lineTo(b2.x, b2.y); g.stroke(); }
  }
  const T0 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, bob, 0, 0, 0, 1];
  let faces = visualFaces(model, q, T0);
  if ($('cCas').checked && (q.l_shoulder_pitch ?? 0) < -0.9) faces = faces.concat(casualtyFaces()); // only drawn when the arms are raised to carry
  const items = faces.map((f) => {
    const P = f.pts.map((p) => project(c, p));
    if (P.some((p) => p.z < 0.1)) return null;
    const n = norm(cross(sub(f.pts[1], f.pts[0]), sub(f.pts[2], f.pts[0])));
    const shade = 0.4 + 0.6 * Math.abs(dot(n, LIGHT));
    return { P, depth: P.reduce((a, p) => a + p.z, 0) / P.length, color: f.color, shade };
  }).filter(Boolean).sort((a, b) => b.depth - a.depth);
  for (const it of items) {
    g.beginPath(); it.P.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath();
    const [r, gr, b] = it.color; g.fillStyle = `rgb(${Math.round(255 * r * it.shade)},${Math.round(255 * gr * it.shade)},${Math.round(255 * b * it.shade)})`; g.fill();
    g.strokeStyle = 'rgba(18,48,107,0.45)'; g.lineWidth = 1; g.stroke();
  }
  g.fillStyle = '#12306b'; g.font = '14px system-ui'; g.fillText(walking ? 'Walking preview (kinematic)' : 'Pose preview', 16, 26);
  const s = modelStats(model, q);
  $('stats').innerHTML = [['Height', `${s.height.toFixed(2)} m (${(s.height * 3.281).toFixed(1)} ft)`], ['Mass (assumed)', `${s.mass.toFixed(0)} kg`], ['Centre of mass height', `${s.com[2].toFixed(2)} m`], ['Links / joints', `${model.links.size} / ${model.joints.length}`], ['Actuated joints', `${joints.length}`]].map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join('');
  requestAnimationFrame(draw);
}
syncSliders();
requestAnimationFrame(draw);
window.__robot = { model, q: () => q, setWalking: (v) => { walking = v; } };
