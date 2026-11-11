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

function casualtyFaces() {
  // A 75 kg casualty lying across the forearms (drawn only for design review; not part of the URDF).
  const faces = [];
  const cx = 0.80, cz = 1.05, L = 0.70, W = 0.15, H = 0.09;
  const v = [[cx - L, -W, cz - H], [cx + L, -W, cz - H], [cx + L, W, cz - H], [cx - L, W, cz - H], [cx - L, -W, cz + H], [cx + L, -W, cz + H], [cx + L, W, cz + H], [cx - L, W, cz + H]];
  for (const f of [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 3, 7, 4]]) faces.push({ pts: f.map((i) => v[i]), color: [0.48, 0.21, 0.32, 1] });
  const b = [[cx - L + 0.1, -W - 0.01, cz + H], [cx + L - 0.4, -W - 0.01, cz + H], [cx + L - 0.4, W + 0.01, cz + H], [cx - L + 0.1, W + 0.01, cz + H]];
  faces.push({ pts: b, color: [0.18, 0.42, 0.54, 1] });
  return faces;
}

function draw(t) {
  const dt = Math.min(0.05, (t - last) / 1000); last = t;
  if (walking) { phase += dt * 2 * Math.PI * Number($('rCad').value) * 0.5; Object.assign(q, gaitPose(phase, true)); syncSliders(); }
  const bob = walking ? 0.012 * Math.cos(2 * phase) : 0;
  g.fillStyle = '#070b10'; g.fillRect(0, 0, cv.width, cv.height);
  const c = camera();
  // ground grid (scrolls while walking)
  g.strokeStyle = '#17222f'; g.lineWidth = 1;
  const off = walking ? -((phase * 0.18) % 0.5) : 0;
  for (let i = -8; i <= 8; i++) {
    const a = project(c, [i * 0.5 + off, -4, 0]), b = project(c, [i * 0.5 + off, 4, 0]); if (a.z > 0.1 && b.z > 0.1) { g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
    const a2 = project(c, [-4, i * 0.5, 0]), b2 = project(c, [4, i * 0.5, 0]); if (a2.z > 0.1 && b2.z > 0.1) { g.beginPath(); g.moveTo(a2.x, a2.y); g.lineTo(b2.x, b2.y); g.stroke(); }
  }
  const T0 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, bob, 0, 0, 0, 1];
  let faces = visualFaces(model, q, T0);
  if ($('cCas').checked) faces = faces.concat(casualtyFaces());
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
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1; g.stroke();
  }
  g.fillStyle = '#8AA0B6'; g.font = '14px system-ui'; g.fillText(walking ? 'Walking preview (kinematic)' : 'Pose preview', 16, 26);
  const s = modelStats(model, q);
  $('stats').innerHTML = [['Height', `${s.height.toFixed(2)} m (${(s.height * 3.281).toFixed(1)} ft)`], ['Mass (assumed)', `${s.mass.toFixed(0)} kg`], ['Centre of mass height', `${s.com[2].toFixed(2)} m`], ['Links / joints', `${model.links.size} / ${model.joints.length}`], ['Actuated joints', `${joints.length}`]].map(([k, v]) => `<div class="stat"><span>${k}</span><b>${v}</b></div>`).join('');
  requestAnimationFrame(draw);
}
syncSliders();
requestAnimationFrame(draw);
window.__robot = { model, q: () => q, setWalking: (v) => { walking = v; } };
