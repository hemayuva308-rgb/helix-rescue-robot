import { Simulation } from '/src/sim.js';
import { WellSimulation } from '/src/well.js';
import { T } from '/src/scenarios.js';
import { playAlarm } from '/web/alarm.js';

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const fmt = (n, d = 1) => Number(n).toFixed(d);
const SEEDS = { fire: 4, water: 5, collapse: 4, well: 3 };
const UCOL = { A: '#3b82c4', B: '#8b5cf6', C: '#d97706' };
const WORDS = { SEARCH: 'searching', INVESTIGATE: 'checking a detection', ASSESS: 'assessing a casualty', HARVEST: 'charging from the environment', APPROACH: 'going to the casualty', AWAIT_APPROVAL: 'waiting for approval', PREP: 'preparing the lift', PREP_BUSY: 'preparing the lift', CARRY: 'carrying out', DONE: 'task complete', HOLD_ESCALATED: 'holding: help requested', ASSIST: 'helping another unit', WALK: 'walking to the well', DETECT: 'scanning the shaft', MEASURE: 'measuring depth and air', LOWER: 'lowering the sling', DESCEND: 'sending the pod down', GRAB: 'pod holding the casualty', SECURE: 'securing the casualty', HOIST: 'hoisting' };

let sim = null, deployed = false, held = false, speed = 5, acc = 0, last = 0, alarmSeen = 0, logN = 0;

function scn() { return $('inScn').value; }
function make() {
  const o = { seed: Number($('inSeed').value) || 1, autoCommander: $('chkAuto').checked, commanderDelay: 4, casualtyWeight: Number($('inWeight').value), casualtyCount: Number($('inCount').value), robots: Number($('inRobots').value), transitHarvest: true };
  if (scn() === 'well') return new WellSimulation({ seed: o.seed, depthM: 14, gas: true, autoCommander: o.autoCommander, commanderDelay: 4, casualtyWeight: o.casualtyWeight, who: 'child', where: 'water', widthM: 1.4 });
  return new Simulation(scn(), o);
}
function restart() {
  sim = make(); sim.params.approvalTimeout = 120; window.sim = sim; // a person with a handheld screen needs more than 25 simulated seconds to answer deployed = false; held = false; alarmSeen = 0; logN = 0; $('oLog').innerHTML = '';
  speed = Number($('inSpeed').value); $('btnDeploy').disabled = false; $('btnDeploy').className = 'big'; $('btnDeploy').innerHTML = scn() === 'well' ? '&#9654; DEPLOY: go to the well, go down, search and rescue (autonomous)' : '&#9654; DEPLOY: go in, search and rescue (autonomous)';
  $('btnHold').textContent = 'Hold'; $('btnLink').textContent = 'Cut link (test)'; render();
}
function unitsOf() { return sim.units ?? [{ id: 'A', robot: sim.robot, mission: sim.mission }]; }

// ---------------------------------------------------------------- rendering
function map() {
  const cv = $('oMap'), g = cv.getContext('2d'), W = cv.width, H = cv.height; g.fillStyle = '#070b10'; g.fillRect(0, 0, W, H);
  if (scn() === 'well') {
    const D = sim.well.depthM, k = (H - 40) / Math.max(D, 10), gy = 40, wx = W * 0.6, hw = 34;
    g.fillStyle = '#3a2f26'; g.fillRect(0, gy, W, H - gy); g.fillStyle = '#05080c'; g.fillRect(wx - hw, gy, hw * 2, D * k);
    g.fillStyle = 'rgba(27,95,158,.75)'; g.fillRect(wx - hw, gy + sim.well.waterAtM * k, hw * 2, (D - sim.well.waterAtM) * k);
    const r = sim.robot, c = sim.casualty;
    if (sim.gas.lel > 10) { g.fillStyle = 'rgba(190,220,80,.2)'; g.fillRect(wx - hw, gy, hw * 2, D * k); g.fillStyle = '#d8ef7a'; g.font = '11px system-ui'; g.fillText(`foul air: methane ${fmt(sim.gas.lel, 0)}% LEL`, wx + hw + 8, gy + 16); }
    if (r.ropeOutM > 0) { g.strokeStyle = '#ffd08a'; g.lineWidth = 2; g.beginPath(); g.moveTo(wx, gy - 20); g.lineTo(wx, gy + r.ropeOutM * k); g.stroke(); g.fillStyle = '#3b82c4'; g.beginPath(); g.roundRect(wx - 9, gy + r.ropeOutM * k - 4, 18, 22, 6); g.fill(); }
    if (sim.mission.verified && !c.delivered) { g.fillStyle = '#e98a3c'; g.beginPath(); g.arc(c.secured ? wx : wx - 16, gy + (c.secured ? r.ropeOutM : c.posM) * k, 6, 0, 7); g.fill(); }
    g.fillStyle = '#3b82c4'; g.fillRect(Math.min(wx - hw - 20, 20 + r.x * 12), gy - 30, 8, 30); g.fillStyle = '#8aa0b6'; g.font = '11px system-ui'; g.fillText(`${fmt(D)} m deep · rope out ${fmt(r.ropeOutM)} m`, 8, 16);
    return;
  }
  const C = Math.min(W / sim.W, H / sim.H), ox = 0, oy = 0;
  for (let y = 0; y < sim.H; y++) for (let x = 0; x < sim.W; x++) {
    const i = y * sim.W + x, t = sim.type[i]; let col = '#070b10';
    if (t === T.FLOOR) col = '#1b2733'; else if (t === T.WALL) col = '#5d6d7e'; else if (t === T.DOOR) col = '#3c5a44'; else if (t === T.EXIT) col = '#2e7d57'; else if (t === T.SAFE) col = '#12452f'; else if (t === T.DEBRIS) col = '#5a4632'; else if (t === T.WEIR) col = '#7a2a2a'; else if (t === T.WATER) col = '#14508f';
    g.fillStyle = col; g.fillRect(ox + x * C, oy + y * C, C, C);
    if (scn() === 'fire') { const f = sim.fireI[i]; if (f > 0) { g.fillStyle = `rgba(255,${Math.round(150 - 100 * f)},30,${0.35 + 0.6 * f})`; g.fillRect(ox + x * C, oy + y * C, C, C); } }
  }
  for (const c of sim.casualties) if (c.alive && !c.delivered && !c.aboard && c.verifiedOnce) { g.fillStyle = '#e98a3c'; g.beginPath(); g.arc(ox + (Math.round(c.fx) + 0.5) * C, oy + (Math.round(c.fy) + 0.5) * C, C * 0.5, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = `${Math.max(9, C * 0.6)}px system-ui`; g.fillText(c.id, ox + (Math.round(c.fx) + 1) * C, oy + Math.round(c.fy) * C); }
  for (const u of sim.units) { g.fillStyle = UCOL[u.id]; g.beginPath(); g.arc(ox + (u.robot.x + 0.5) * C, oy + (u.robot.y + 0.5) * C, C * 0.6, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = `bold ${Math.max(9, C * 0.7)}px system-ui`; g.fillText(u.id, ox + (u.robot.x + 0.2) * C, oy + (u.robot.y + 0.95) * C); }
  const now = performance.now() / 1000;
  for (const a of sim.alarms) { if (sim.t - a.t > 40) continue; const ph = (now * 0.9) % 1; g.strokeStyle = a.kind === 'human' ? `rgba(255,70,70,${1 - ph})` : `rgba(90,200,255,${1 - ph})`; g.lineWidth = 2; g.beginPath(); g.arc(ox + (a.x + 0.5) * C, oy + (a.y + 0.5) * C, C + ph * C * 3, 0, 7); g.stroke(); }
}

function render() {
  const units = unitsOf();
  const total = scn() === 'well' ? 1 : sim.casualties.length, done = scn() === 'well' ? (sim.casualty.delivered ? 1 : 0) : sim.casualties.filter((c) => c.delivered).length;
  $('oState').textContent = !deployed ? 'STANDBY' : sim.linkUp === false ? 'LINK LOST' : held ? 'ON HOLD' : sim.outcome ? 'FINISHED' : 'ACTIVE';
  $('oTime').textContent = `${sim.t}s`; $('oRescued').textContent = `${done} / ${total}`;
  $('oOutcome').textContent = sim.outcome ? sim.outcome.result.replace('_', ' ') : '-';
  // alarm banner + sound (the alarm lives on the operator's screen)
  const al = $('alarm'), lastA = sim.alarms[sim.alarms.length - 1];
  if (lastA) { al.style.display = ''; al.className = 'alarm ' + (lastA.kind === 'human' ? 'human' : 'unit'); al.innerHTML = lastA.kind === 'human' ? `<b>DISTRESS CALL</b> · t=${lastA.t}s · unit ${lastA.unit} needs <b>${esc(lastA.need)}</b><br><span>${esc(lastA.reason)}</span>` : `<b>UNIT-TO-UNIT HELP</b> · t=${lastA.t}s · unit ${lastA.unit} asks <b>${esc(lastA.need)}</b><br><span>${esc(lastA.reason)}</span>`; } else al.style.display = 'none';
  if (sim.alarms.length > alarmSeen && $('chkSound').checked) playAlarm(sim.alarms.slice(alarmSeen).some((x) => x.kind === 'human') ? 'human' : 'unit');
  alarmSeen = sim.alarms.length;
  // units
  $('oUnits').innerHTML = units.map((u) => {
    const b = Math.max(0, Math.min(100, u.robot.battery)), col = b < 20 ? '#ff6b6b' : b < 40 ? '#ffb454' : '#4cd694';
    const st = !deployed ? 'standing by' : sim.linkUp === false && !['CARRY', 'HOIST', 'DONE', 'HOLD_ESCALATED'].includes(u.mission.state) ? 'holding position (no operator link)' : (WORDS[u.mission.state] ?? u.mission.state.toLowerCase()) + (u.mission.paired ? ` (lifting together with ${u.mission.partner.id})` : '');
    const extra = scn() === 'water' ? ` · ${fmt(sim.depthAt(u.robot.x, u.robot.y))} m water` : scn() === 'fire' ? ` · ${fmt(sim.tempAt(u.robot.x, u.robot.y), 0)} °C around it` : '';
    return `<div class="row"><span><b style="color:${UCOL[u.id]}">Unit ${u.id}</b> · ${esc(st)}${extra}</span><span>${fmt(b)}%</span></div><div class="ubar"><div style="width:${b}%;background:${col}"></div></div>`;
  }).join('') + (sim.harvestedTotal ? `<p class="note">Energy gathered from the environment so far: ${fmt(sim.harvestedTotal)}%</p>` : '');
  // approvals
  const pend = sim.pending.filter((a) => a.status === 'pending'), ap = $('oAppr');
  ap.innerHTML = pend.length ? '' : '<p class="hint">Nothing waiting.</p>';
  for (const a of pend) { const d = document.createElement('div'); d.className = 'appr'; d.innerHTML = `<div><b>${a.role}</b>: ${esc(a.reason)}</div><div class="hint">answer within ${Math.max(0, a.deadline - sim.t)}s or the units hold and call for help</div><div class="btns"><button class="ok">Approve</button><button class="no">Reject</button></div>`; d.querySelector('.ok').onclick = () => { sim.approve(a.id); render(); }; d.querySelector('.no').onclick = () => { sim.reject(a.id); render(); }; ap.appendChild(d); }
  // senses
  if (scn() === 'well') {
    const h = sim.mission.hits, names = { sound: 'voice', thermal: 'heat camera', co2: 'breath (CO2)', radar: 'radar' };
    $('oSense').innerHTML = [`air in the shaft   methane ${fmt(sim.gas.lel, 0)}% LEL · oxygen ${fmt(sim.gas.o2)}%`, `shaft             ${fmt(sim.well.depthM)} m deep, water at ${fmt(sim.well.waterAtM)} m`, `detections        ${Object.keys(h).filter((k) => h[k] >= 2).map((k) => names[k]).join(' + ') || 'none yet'}${sim.mission.verified ? ' → verified' : ''}`, `rope              ${fmt(sim.robot.ropeOutM)} m out · load ${fmt(sim.robot.load, 0)} kg`].join('<br>');
    $('oPeople').innerHTML = sim.mission.verified ? `C1 · ${sim.casualty.age} · ${sim.casualty.conscious ? 'conscious' : 'unconscious'} · health ${fmt(sim.casualty.health, 0)} · ${sim.casualty.delivered ? 'DELIVERED' : sim.casualty.alive ? 'being rescued' : 'lost'}` : 'none verified yet';
  } else {
    const names = { thermal: 'heat camera', sound: 'voice', co2: 'breath CO2', radar: 'radar', capacitive: 'touch' };
    const lines = units.map((u) => { const r = u.robot; const bits = [`heat ${fmt(sim.tempAt(r.x, r.y), 0)} °C`]; if (scn() === 'fire') bits.push(`smoke ${fmt(sim.smoke[sim.idx(r.x, r.y)] * 100, 0)}%`); if (scn() === 'water') bits.push(`current ${fmt(sim.currentMagAt(r.x, r.y))} m/s`); if (scn() === 'collapse') bits.push(`structure risk ${fmt(sim.collapseRisk, 2)}`); return `unit ${u.id}   ${bits.join(' · ')}`; });
    const det = sim.candidates.filter((c) => !c.handled).slice(-5).map((c) => `detection #${c.id}  ${Object.keys(c.hits).map((k) => names[k]).join(' + ')}  ${c.status === 'verified' ? '→ VERIFIED (2 sensor types)' : c.status === 'rejected' ? '→ rejected (decoy)' : '→ checking'}`);
    $('oSense').innerHTML = [...lines, ...det].join('<br>');
    const found = sim.casualties.filter((c) => c.verifiedOnce);
    $('oPeople').innerHTML = found.length ? found.map((c) => `${c.id} · ${c.age} · ${c.estimate ? fmt(c.estimate, 0) + ' kg' : '? kg'} · health ${fmt(c.health, 0)} · ${c.delivered ? 'DELIVERED' : c.referred ? 'human team called' : !c.alive ? 'lost' : c.aboard ? 'being carried' : 'waiting'}`).join('<br>') : 'none found yet';
  }
  $('oAlarms').innerHTML = sim.alarms.length ? sim.alarms.slice().reverse().slice(0, 8).map((a) => `<div><span class="chip ${a.kind === 'human' ? 'block' : 'appr'}">${a.kind === 'human' ? 'HUMAN HELP' : 'UNIT HELP'}</span>t=${a.t}s unit ${a.unit}: ${esc(a.need)} <span class="hint">${esc(a.reason)}</span></div>`).join('') : '<span class="hint">No alarms.</span>';
  const lg = $('oLog'); for (; logN < sim.events.length; logN++) { const e = sim.events[logN]; const d = document.createElement('div'); d.className = 'ev ' + e.kind; d.innerHTML = `<span class="t">${e.t}s</span> <b>${e.agent}</b> ${esc(e.msg)}`; lg.appendChild(d); } lg.scrollTop = lg.scrollHeight;
  map();
}

function frame(ts) {
  const dt = Math.min(0.1, (ts - last) / 1000); last = ts;
  if (deployed && !held && !(sim.outcome && sim.mission.state !== 'DONE') && !(sim.outcome && sim.pending.every((a) => a.status !== 'pending') && sim.mission.state === 'DONE')) { acc += dt * 4 * speed; let n = 0; while (acc >= 1 && n < 60) { acc -= 1; n++; sim.step(); } }
  render(); requestAnimationFrame(frame);
}
$('btnDeploy').onclick = () => { if (deployed) return; deployed = true; sim.emit('Operator', 'info', 'Operator signal: DEPLOY. The units go in autonomously; no manual steering.'); $('btnDeploy').disabled = true; $('btnDeploy').textContent = 'DEPLOYED: units are working on their own'; };
$('btnLink').onclick = () => { const up = sim.linkUp === false; sim.setLink(up); $('btnLink').textContent = up ? 'Cut link (test)' : 'Restore link'; };
$('btnHold').onclick = () => { held = !held; $('btnHold').textContent = held ? 'Resume' : 'Hold'; };
$('btnRestart').onclick = restart; $('btnSound').onclick = () => playAlarm('human');
for (const id of ['inScn', 'inCount', 'inRobots', 'inWeight', 'inSeed', 'chkAuto']) $(id).onchange = () => { if (id === 'inScn') $('inSeed').value = SEEDS[scn()]; restart(); };
$('inSpeed').onchange = () => { speed = Number($('inSpeed').value); };
if (q.get('scenario')) { $('inScn').value = q.get('scenario'); $('inSeed').value = SEEDS[scn()] ?? 1; }
if (q.get('seed')) $('inSeed').value = q.get('seed'); if (q.get('speed')) $('inSpeed').value = q.get('speed'); if (q.get('weight')) $('inWeight').value = q.get('weight'); if (q.get('robots')) $('inRobots').value = q.get('robots'); if (q.get('count')) $('inCount').value = q.get('count');
restart(); requestAnimationFrame(frame);
