// A simulated thermal camera frame, rendered from the simulation state around a point of interest.
// It is NOT a real photograph: it shows what a heat camera on the unit would show if the simulated world were real.
import { T } from '/src/scenarios.js';

const STOPS = [[0, [11, 6, 48]], [0.25, [60, 26, 122]], [0.5, [194, 37, 92]], [0.75, [255, 140, 26]], [1, [255, 243, 160]]];
function iron(v) {
  v = Math.max(0, Math.min(1, v));
  for (let i = 1; i < STOPS.length; i++) if (v <= STOPS[i][0]) { const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i], k = (v - a) / (b - a); return `rgb(${Math.round(ca[0] + (cb[0] - ca[0]) * k)},${Math.round(ca[1] + (cb[1] - ca[1]) * k)},${Math.round(ca[2] + (cb[2] - ca[2]) * k)})`; }
  return 'rgb(255,243,160)';
}
const norm = (t) => (t <= 10 ? 0 : t <= 22 ? (t - 10) / 12 * 0.2 : t <= 37 ? 0.2 + (t - 22) / 15 * 0.35 : t <= 100 ? 0.55 + (t - 37) / 63 * 0.3 : 0.85 + Math.min(1, (t - 100) / 120) * 0.15);
const hash = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

export function renderFrame(sim, scn, focus, unitId = 'A', w = 480, h = 288) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d');
  if (scn === 'well') return wellFrame(g, sim, w, h);
  const CW = 15, CH = 9, C = w / CW, x0 = Math.round(focus.x) - Math.floor(CW / 2), y0 = Math.round(focus.y) - Math.floor(CH / 2);
  for (let j = 0; j < CH; j++) for (let i = 0; i < CW; i++) {
    const x = x0 + i, y = y0 + j; let t = 12;
    if (sim.inB(x, y)) { const ty = sim.typeAt(x, y); t = ty === T.WALL ? 17 : ty === T.WATER ? 11 : ty === T.DEBRIS ? 19 : ty === T.VOID ? 8 : sim.tempAt(x, y); if (scn === 'fire' && ty !== T.WALL) t = Math.max(t, sim.tempAt(x, y)); }
    g.fillStyle = iron(norm(t)); g.fillRect(i * C, j * C, C + 1, C + 1);
    if (sim.inB(x, y) && sim.typeAt(x, y) === T.WALL) { g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(i * C, j * C, C + 1, C + 1); }
    if (scn === 'fire' && sim.inB(x, y)) { const sm = sim.smoke[sim.idx(x, y)]; if (sm > 0.05) { g.fillStyle = `rgba(120,120,130,${Math.min(0.5, sm * 0.6)})`; g.fillRect(i * C, j * C, C + 1, C + 1); } }
  }
  // warm bodies (people and animals) and the units
  const boxes = [];
  for (const c of sim.casualties ?? []) {
    if (c.delivered) continue; const cx = Math.round(c.fx), cy = Math.round(c.fy), i = cx - x0, j = cy - y0; if (i < 0 || j < 0 || i >= CW || j >= CH) continue;
    const px = (i + 0.5) * C, py = (j + 0.5) * C, body = c.alive ? (c.animal ? 38 : 36.5) : 24;
    const grd = g.createRadialGradient(px, py, 2, px, py, C * 0.75); grd.addColorStop(0, iron(norm(body + (c.alive ? 4 : 0)))); grd.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grd; g.beginPath(); g.arc(px, py, C * 0.75, 0, 7); g.fill();
    boxes.push({ x: px, y: py, label: !c.alive ? `${c.id}: LOW HEAT SIGNATURE` : c.animal ? `${c.id}: ANIMAL (${c.species})` : `${c.id}: PERSON ${70 + (hash(c.id) % 26)}%`, bad: !c.alive });
  }
  for (const u of sim.units ?? []) { const i = Math.round(u.robot.x) - x0, j = Math.round(u.robot.y) - y0; if (i < 0 || j < 0 || i >= CW || j >= CH) continue; g.fillStyle = iron(norm(30)); g.fillRect((i + 0.2) * C, (j + 0.2) * C, C * 0.6, C * 0.6); g.fillStyle = '#fff'; g.font = 'bold 11px system-ui'; g.fillText(u.id, (i + 0.35) * C, (j + 0.7) * C); }
  g.lineWidth = 2; g.font = 'bold 11px system-ui';
  for (const b of boxes) { g.strokeStyle = b.bad ? '#7fd0ff' : '#ffffff'; g.strokeRect(b.x - C * 0.55, b.y - C * 0.6, C * 1.1, C * 1.2); const tw = g.measureText(b.label).width + 8; g.fillStyle = 'rgba(0,0,0,0.65)'; g.fillRect(b.x - C * 0.55, b.y - C * 0.6 - 16, tw, 15); g.fillStyle = b.bad ? '#bfe6ff' : '#fff'; g.fillText(b.label, b.x - C * 0.55 + 4, b.y - C * 0.6 - 5); }
  hud(g, w, h, `THERMAL CAMERA · UNIT ${unitId}`, `t=${sim.t}s`, `${Math.round(sim.tempAt(Math.round(focus.x), Math.round(focus.y)))} °C at centre`);
  return cv;
}

function wellFrame(g, sim, w, h) {
  const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, iron(0.12)); grd.addColorStop(1, iron(0.04)); g.fillStyle = grd; g.fillRect(0, 0, w, h);
  const wy = h * (0.25 + 0.5 * (sim.well.waterAtM / sim.well.depthM));
  g.fillStyle = iron(0.1); g.fillRect(0, wy, w, h - wy); g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(0, wy, w, 2);
  const c = sim.casualty, py = h * (0.25 + 0.5 * (c.posM / sim.well.depthM)), px = w * 0.5;
  if (sim.mission.verified && !c.delivered) {
    const g2 = g.createRadialGradient(px, py, 4, px, py, 70); g2.addColorStop(0, iron(c.alive ? 0.78 : 0.28)); g2.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = g2; g.beginPath(); g.arc(px, py, 70, 0, 7); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.strokeRect(px - 46, py - 46, 92, 92); g.font = 'bold 11px system-ui'; g.fillStyle = 'rgba(0,0,0,0.65)'; g.fillRect(px - 46, py - 62, 140, 15); g.fillStyle = '#fff'; g.fillText(c.alive ? `C1: PERSON ${70 + (hash('C1') % 26)}%` : 'C1: LOW HEAT SIGNATURE', px - 42, py - 51);
  }
  hud(g, w, h, 'POD CAMERA (thermal)', `t=${sim.t}s`, `${sim.well.waterAtM.toFixed(1)} m to the water`);
  return g.canvas;
}

function hud(g, w, h, left, right, bottom) {
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, 0, w, 22); g.fillRect(0, h - 20, w, 20);
  g.fillStyle = '#fff'; g.font = 'bold 11px system-ui'; g.fillText(left + ' · SIMULATED', 8, 15); g.textAlign = 'right'; g.fillText(right, w - 8, 15); g.textAlign = 'left'; g.fillText(bottom, 8, h - 6);
  g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1; g.beginPath(); g.moveTo(w / 2 - 12, h / 2); g.lineTo(w / 2 + 12, h / 2); g.moveTo(w / 2, h / 2 - 12); g.lineTo(w / 2, h / 2 + 12); g.stroke();
  const gr = g.createLinearGradient(w - 16, h - 90, w - 16, h - 28); gr.addColorStop(0, iron(1)); gr.addColorStop(0.5, iron(0.5)); gr.addColorStop(1, iron(0)); g.fillStyle = gr; g.fillRect(w - 20, h - 90, 8, 62);
}
