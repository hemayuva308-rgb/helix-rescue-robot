// Operator console (phone). Two modes:
//   local : runs its own simulation (stand-alone demo).
//   remote: linked to the laptop, which runs the simulation. This page only shows what the laptop sends and
//           sends commands back (deploy, voice or typed commands, approvals, link cut).
import { Simulation } from '/src/sim.js';
import { WellSimulation } from '/src/well.js';
import { T } from '/src/scenarios.js';
import { makeHello, snapshot } from '/src/snapshot.js';
import { playAlarm } from '/web/alarm.js';
import { createLink, cleanCode } from '/web/link.js';
import { askAi } from '/web/ai.js';
import { parseCommand } from '/src/command.js';

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const fmt = (n, d = 1) => Number(n).toFixed(d);
const SEEDS = { fire: 4, water: 4, collapse: 4, well: 3 };
const UCOL = { A: '#12306b', B: '#3b6fd4', C: '#6b7a92' };

let mode = 'local', sim = null, deployed = false, held = false, speed = 2, acc = 0, last = 0, alarmSeen = 0, logN = 0;
let pendingCmd = 0, pingAt = 0, vm = null, hello = null, link = null, lastMsg = 0, code = '', via = '', net = '';

const scn = () => (mode === 'remote' && hello ? hello.scn : $('inScn').value);

// ---------------------------------------------------------------- local simulation
function make() {
  const o = { seed: Number($('inSeed').value) || 1, autoCommander: $('chkAuto').checked, commanderDelay: 4, casualtyWeight: Number($('inWeight').value), casualtyCount: Number($('inCount').value), animals: Number($('inAnimals').value), robots: Number($('inRobots').value), transitHarvest: true };
  if ($('inScn').value === 'well') return new WellSimulation({ seed: o.seed, depthM: 14, gas: true, autoCommander: o.autoCommander, commanderDelay: 4, casualtyWeight: o.casualtyWeight, who: 'child', where: 'water', widthM: 1.4 });
  return new Simulation($('inScn').value, o);
}
function restartLocal() {
  sim = make(); sim.params.approvalTimeout = 120; window.sim = sim; deployed = false; held = false; alarmSeen = 0; logN = 0; $('oLog').innerHTML = '';
  speed = Number($('inSpeed').value); hello = makeHello(sim, $('inScn').value); setDeployButton(false); $('btnHold').textContent = 'Hold'; $('btnLink').textContent = 'Cut link (test)';
}
function setDeployButton(isDeployed) {
  const b = $('btnDeploy'); b.disabled = isDeployed; b.className = 'big';
  b.innerHTML = isDeployed ? 'DEPLOYED: units are working on their own' : (scn() === 'well' ? '&#9654; DEPLOY: go to the well, go down, search and rescue (autonomous)' : '&#9654; DEPLOY: go in, search and rescue (autonomous)');
}

// ---------------------------------------------------------------- actions (local or sent to the laptop)
function actDeploy() {
  if (mode === 'remote') { link.send({ t: 'standing', on: $('chkStanding').checked }); link.send({ t: 'deploy' }); return; }
  if (deployed) return; sim.opts.standingApproval = $('chkStanding').checked; deployed = true; sim.emit('Operator', 'info', 'Operator signal: DEPLOY. The units go in autonomously; no manual steering.'); setDeployButton(true);
}
const CANON = { recall: 'come out', hold: 'hold position', resume: 'resume', deploy: 'deploy' };
async function actCommand(text, source) {
  if (!text.trim()) return;
  $('vHeard').textContent = `Heard: "${text}"`;
  if (parseCommand(text).intent === 'unknown') { // the fixed grammar did not understand: the optional language model may map it to ONE safe intent, nothing else
    $('vReply').textContent = 'Unit reply: checking what you meant...';
    const r = await askAi('interpret', { text });
    if (r.mode === 'llm' && r.intent !== 'none' && CANON[r.intent]) {
      if (r.intent === 'recall' || r.intent === 'hold') { $('vReply').textContent = `AI assistant understood this as "${CANON[r.intent]}".`; return sendCommand(CANON[r.intent], `${source}, AI-interpreted`); }
      $('vConfirm').style.display = ''; $('vConfirm').innerHTML = `The AI assistant thinks you meant <b>${CANON[r.intent]}</b>. <button id="vYes">Yes, do it</button> <button id="vNo">No</button>`;
      $('vYes').onclick = () => { $('vConfirm').style.display = 'none'; sendCommand(CANON[r.intent], `${source}, AI-interpreted and confirmed`); }; $('vNo').onclick = () => { $('vConfirm').style.display = 'none'; $('vReply').textContent = 'Unit reply: cancelled.'; };
      return;
    }
  }
  sendCommand(text, source);
}
function sendCommand(text, source) {
  if (mode === 'remote') { link.send({ t: 'cmd', text, source }); $('vReply').textContent = 'Unit reply: sent to the laptop, waiting for its answer...'; pendingCmd = Date.now(); setTimeout(() => { if (pendingCmd && Date.now() - pendingCmd >= 3000) $('vReply').textContent = 'Unit reply: NO ANSWER from the laptop in 3 seconds. The link is not working (check the code, that both devices are online, and use the same Wi-Fi if you can).'; }, 3100); return; }
  const res = sim.command(text, source);
  if (res.intent === 'deploy' && res.ok && !deployed) actDeploy();
  showReply(res.reply);
}
function showReply(text) { $('vReply').textContent = `Unit reply: ${text}`; speak(text); }
function actApprove(id, ok) { if (mode === 'remote') { link.send({ t: 'approve', id, ok }); return; } if (ok) sim.approve(id); else sim.reject(id); }
function actLink(up) { if (mode === 'remote') { link.send({ t: 'link', up }); return; } sim.setLink(up); }

// ---------------------------------------------------------------- drawing
function map(v) {
  const cv = $('oMap'), g = cv.getContext('2d'), W = cv.width, H = cv.height; g.fillStyle = '#eef3f9'; g.fillRect(0, 0, W, H);
  if (v.scn === 'well' && v.well) {
    const w = v.well, D = w.depthM, k = (H - 40) / Math.max(D, 10), gy = 40, wx = W * 0.6, hw = 34, ux = v.units[0]?.x ?? 0;
    g.fillStyle = '#d9c9b0'; g.fillRect(0, gy, W, H - gy); g.fillStyle = '#1b2a4a'; g.fillRect(wx - hw, gy, hw * 2, D * k);
    g.fillStyle = 'rgba(80,150,225,.8)'; g.fillRect(wx - hw, gy + w.waterAtM * k, hw * 2, (D - w.waterAtM) * k);
    if (w.lel > 10) { g.fillStyle = 'rgba(190,220,80,.35)'; g.fillRect(wx - hw, gy, hw * 2, D * k); g.fillStyle = '#6b7a00'; g.font = '11px system-ui'; g.fillText(`foul air: methane ${fmt(w.lel, 0)}% LEL`, wx + hw + 8, gy + 16); }
    if (w.ropeOutM > 0) { g.strokeStyle = '#ffd08a'; g.lineWidth = 2; g.beginPath(); g.moveTo(wx, gy - 20); g.lineTo(wx, gy + w.ropeOutM * k); g.stroke(); g.fillStyle = '#12306b'; g.beginPath(); g.roundRect(wx - 9, gy + w.ropeOutM * k - 4, 18, 22, 6); g.fill(); g.fillStyle = '#4f7fd9'; g.fillRect(wx - 5, gy + w.ropeOutM * k, 10, 4); }
    if (w.found && !w.delivered) { g.fillStyle = '#e98a3c'; g.beginPath(); g.arc(w.secured ? wx : wx - 16, gy + (w.secured ? w.ropeOutM : w.posM) * k, 6, 0, 7); g.fill(); }
    g.fillStyle = '#12306b'; g.fillRect(Math.min(wx - hw - 20, 20 + ux * 12), gy - 30, 8, 30); g.fillStyle = '#5b6b82'; g.font = '11px system-ui'; g.fillText(`${fmt(D)} m deep · rope out ${fmt(w.ropeOutM)} m`, 8, 16);
    return;
  }
  if (!hello || !hello.grid) return;
  const C = Math.min(W / hello.W, H / hello.H), fire = new Map((v.fire ?? []).map((f) => [f[1] * hello.W + f[0], f[2]]));
  for (let y = 0; y < hello.H; y++) for (let x = 0; x < hello.W; x++) {
    const i = y * hello.W + x, t = Number(hello.grid[i]); let col = '#eaf0f7';
    if (t === T.FLOOR) col = '#ffffff'; else if (t === T.WALL) col = '#27407a'; else if (t === T.DOOR) col = '#c7d8f5'; else if (t === T.EXIT) col = '#a9c3f0'; else if (t === T.SAFE) col = '#dce8fb'; else if (t === T.DEBRIS) col = '#cdbba0'; else if (t === T.WEIR) col = '#e6a3a3'; else if (t === T.WATER) col = '#96c6f0';
    g.fillStyle = col; g.fillRect(x * C, y * C, C, C);
    const f = fire.get(i); if (f) { g.fillStyle = `rgba(255,${Math.round(150 - 100 * f)},30,${0.35 + 0.6 * f})`; g.fillRect(x * C, y * C, C, C); }
  }
  for (const h of v.heads ?? []) { g.fillStyle = h[3] ? '#b07a45' : '#e98a3c'; g.beginPath(); g.arc((h[0] + 0.5) * C, (h[1] + 0.5) * C, C * 0.5, 0, 7); g.fill(); g.fillStyle = '#0f1f3d'; g.font = `${Math.max(9, C * 0.6)}px system-ui`; g.fillText(h[2], (h[0] + 1) * C, h[1] * C); }
  for (const u of v.units) { g.fillStyle = UCOL[u.id]; g.beginPath(); g.arc((u.x + 0.5) * C, (u.y + 0.5) * C, C * 0.6, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = `bold ${Math.max(9, C * 0.7)}px system-ui`; g.fillText(u.id, (u.x + 0.2) * C, (u.y + 0.95) * C); }
  const now = performance.now() / 1000;
  for (const a of v.alarms) { if (v.time - a.t > 40) continue; const ph = (now * 0.9) % 1; g.strokeStyle = a.kind === 'human' ? `rgba(255,70,70,${1 - ph})` : `rgba(90,200,255,${1 - ph})`; g.lineWidth = 2; g.beginPath(); g.arc((a.x + 0.5) * C, (a.y + 0.5) * C, C + ph * C * 3, 0, 7); g.stroke(); }
}

function render(v) {
  if (!v) { $('oState').textContent = mode === 'remote' ? 'WAITING' : '-'; return; }
  $('oState').textContent = !v.deployed ? 'STANDBY' : !v.linkUp ? 'LINK LOST' : v.recall ? 'COMING OUT' : v.held ? 'ON HOLD' : v.outcome ? 'FINISHED' : 'ACTIVE';
  $('oTime').textContent = `${v.time}s`; $('oRescued').textContent = `${v.done} / ${v.total}`; $('oOutcome').textContent = v.outcome ? v.outcome.result.replace('_', ' ') : '-';
  const al = $('alarm'), lastA = v.alarms[v.alarms.length - 1];
  if (lastA) { al.style.display = ''; al.className = 'alarm ' + (lastA.kind === 'human' ? 'human' : 'unit'); al.innerHTML = lastA.kind === 'human' ? `<b>DISTRESS CALL</b> · t=${lastA.t}s · unit ${lastA.unit} needs <b>${esc(lastA.need)}</b><br><span>${esc(lastA.reason)}</span>` : `<b>UNIT-TO-UNIT HELP</b> · t=${lastA.t}s · unit ${lastA.unit} asks <b>${esc(lastA.need)}</b><br><span>${esc(lastA.reason)}</span>`; } else al.style.display = 'none';
  if (v.alarms.length > alarmSeen && $('chkSound').checked) playAlarm(v.alarms.slice(alarmSeen).some((x) => x.kind === 'human') ? 'human' : 'unit');
  alarmSeen = v.alarms.length;
  $('oUnits').innerHTML = v.units.map((u) => { const b = Math.max(0, Math.min(100, u.battery)), col = b < 20 ? '#d32f2f' : b < 40 ? '#e08a00' : '#4f7fd9'; return `<div class="row"><span><b style="color:${UCOL[u.id]}">Unit ${u.id}</b> · ${esc(u.label)}</span><span>${fmt(b)}%</span></div><div class="ubar"><div style="width:${b}%;background:${col}"></div></div>`; }).join('') + (v.harvested ? `<p class="note">Energy gathered from the environment so far: ${fmt(v.harvested)}%</p>` : '');
  const ap = $('oAppr'); const key = v.pending.map((a) => a.id).join('|'); if (ap.dataset.key !== key || !v.pending.length) {
    ap.dataset.key = key; ap.innerHTML = v.pending.length ? '' : '<p class="hint">Nothing waiting.</p>';
    for (const a of v.pending) { const d = document.createElement('div'); d.className = 'appr'; d.innerHTML = `<div><b>${a.role}</b>: ${esc(a.reason)}</div><div class="hint">answer in time or the units hold and call for help</div><div class="btns"><button class="ok">Approve</button><button class="no">Reject</button></div>`; d.querySelector('.ok').onclick = () => actApprove(a.id, true); d.querySelector('.no').onclick = () => actApprove(a.id, false); ap.appendChild(d); }
  }
  $('oSense').innerHTML = v.sense.map(esc).join('<br>'); $('oPeople').innerHTML = v.people.length ? v.people.map(esc).join('<br>') : 'none found yet';
  $('oAlarms').innerHTML = v.alarms.length ? v.alarms.slice().reverse().slice(0, 8).map((a) => `<div><span class="chip ${a.kind === 'human' ? 'block' : 'appr'}">${a.kind === 'human' ? 'HUMAN HELP' : 'UNIT HELP'}</span>t=${a.t}s unit ${a.unit}: ${esc(a.need)} <span class="hint">${esc(a.reason)}</span></div>`).join('') : '<span class="hint">No alarms.</span>';
  const lg = $('oLog'); for (const e of v.ev) if (e.i >= logN) { const d = document.createElement('div'); d.className = 'ev ' + e.kind; d.innerHTML = `<span class="t">${e.t}s</span> <b>${e.agent}</b> ${esc(e.msg)}`; lg.appendChild(d); } logN = Math.max(logN, v.en); lg.scrollTop = lg.scrollHeight;
  if (mode === 'local' || v.deployed) setDeployButton(v.deployed);
  map(v);
}

// ---------------------------------------------------------------- loops
function frame(ts) {
  const dt = Math.min(0.1, (ts - last) / 1000); last = ts;
  if (mode === 'local' && sim) {
    if (deployed && !held && !(sim.outcome && sim.mission.state !== 'DONE') && !(sim.outcome && sim.pending.every((a) => a.status !== 'pending') && sim.mission.state === 'DONE')) { acc += dt * 4 * speed; let n = 0; while (acc >= 1 && n < 60) { acc -= 1; n++; sim.step(); } }
    vm = snapshot(sim, $('inScn').value, { deployed, held });
  }
  render(vm);
  if (mode === 'remote') $('pairStat').innerHTML = hello && Date.now() - lastMsg < 3500 ? `<b style="color:#12306b">linked to the laptop</b> · code ${code} · via ${via || 'link'}` : `looking for the laptop (code ${code})... ${esc(net)}`;
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- pairing with the laptop
function connect(c) {
  code = cleanCode(c); if (code.length !== 6) { $('pairStat').textContent = 'The code has 6 letters or digits.'; return; }
  if (link) link.close();
  mode = 'remote'; vm = null; hello = null; logN = 0; alarmSeen = 0; $('oLog').innerHTML = ''; document.body.classList.add('remote'); $('pairBox').style.display = 'none'; $('pairedBox').style.display = '';
  link = createLink({ role: 'phone', code, onStatus: (s) => { net = s; }, onMessage: (m, v) => {
    lastMsg = Date.now(); via = v === 'browser' ? 'same browser' : 'internet';
    if (m.t === 'hello') { hello = m; setDeployButton(false); logN = 0; $('oLog').innerHTML = ''; }
    else if (m.t === 'snap') { vm = m; if (!hello) link.send({ t: 'hi', need: 'hello' }); }
    else if (m.t === 'pong') { $('vReply').textContent = `Link test: the laptop answered in ${Date.now() - pingAt} ms. The link works.`; }
    else if (m.t === 'reply') { pendingCmd = 0; $('vHeard').textContent = `Heard: "${m.heard}"`; showReply(m.text); }
  } });
  const beat = () => { if (mode === 'remote' && link) link.send({ t: 'hi', need: hello ? '' : 'hello' }); };
  clearInterval(connect.timer); connect.timer = setInterval(beat, 1500); beat(); keepAwake();
}
// Keep the phone screen on while paired: a sleeping phone stops talking to the laptop.
let wakeLock = null;
async function keepAwake() { try { if ('wakeLock' in navigator && mode === 'remote' && document.visibilityState === 'visible') wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* not available */ } }
document.addEventListener('visibilitychange', keepAwake);
function disconnect() { clearInterval(connect.timer); if (link) link.close(); link = null; mode = 'local'; document.body.classList.remove('remote'); $('pairBox').style.display = ''; $('pairedBox').style.display = 'none'; vm = null; restartLocal(); }

// ---------------------------------------------------------------- voice and typed commands
function speak(text) {
  if (!$('chkSpeak').checked || !('speechSynthesis' in window)) return;
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; speechSynthesis.speak(u); } catch (e) { /* no voice */ }
}
$('btnSend').onclick = () => { actCommand($('inCmd').value, 'typed'); $('inCmd').value = ''; };
$('inCmd').onkeydown = (e) => { if (e.key === 'Enter') $('btnSend').click(); };
for (const b of document.querySelectorAll('button.q')) b.onclick = () => actCommand(b.dataset.c, 'button');
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) { $('btnMic').disabled = true; $('btnMic').textContent = 'Microphone not supported here (use Chrome or Edge)'; }
else {
  let rec = null;
  $('btnMic').onclick = () => {
    if (rec) { rec.stop(); return; }
    rec = new SR(); rec.lang = 'en-US'; rec.interimResults = true; rec.maxAlternatives = 1;
    $('btnMic').textContent = '\u{1F3A4} Listening... (tap to stop)';
    rec.onresult = (e) => { const r = e.results[e.results.length - 1]; $('vHeard').textContent = `Heard: "${r[0].transcript}"${r.isFinal ? '' : ' ...'}`; if (r.isFinal) actCommand(r[0].transcript, 'voice'); };
    rec.onerror = (e) => { $('vReply').textContent = `Unit reply: microphone problem (${e.error}). You can type the command instead.`; };
    rec.onend = () => { rec = null; $('btnMic').textContent = '\u{1F3A4} Speak'; };
    try { rec.start(); } catch (e) { rec = null; }
  };
}

// ---------------------------------------------------------------- wiring
$('btnDeploy').onclick = actDeploy;
$('chkStanding').onchange = () => { if (mode === 'remote') link.send({ t: 'standing', on: $('chkStanding').checked }); else if (sim) sim.opts.standingApproval = $('chkStanding').checked; };
$('btnHold').onclick = () => { if (mode === 'remote') { held = !held; link.send({ t: 'cmd', text: held ? 'hold position' : 'resume', source: 'button' }); $('btnHold').textContent = held ? 'Resume' : 'Hold'; return; } held = !held; $('btnHold').textContent = held ? 'Resume' : 'Hold'; };
let linkUpLocal = true;
$('btnLink').onclick = () => { linkUpLocal = !(vm && vm.linkUp === false); actLink(!linkUpLocal); $('btnLink').textContent = linkUpLocal ? 'Restore link' : 'Cut link (test)'; };
$('btnRestart').onclick = () => { if (mode === 'remote') { link.send({ t: 'restart' }); logN = 0; alarmSeen = 0; $('oLog').innerHTML = ''; } else restartLocal(); };
$('btnSound').onclick = () => playAlarm('human');
$('btnPair').onclick = () => connect($('inPair').value); $('inPair').onkeydown = (e) => { if (e.key === 'Enter') connect($('inPair').value); };
$('btnUnpair').onclick = disconnect;
$('btnBrief').onclick = async () => {
  if (!vm) { $('vBrief').textContent = 'Nothing to brief yet.'; return; }
  $('vBrief').textContent = 'Writing the briefing...';
  const r = await askAi('brief', { scenario: vm.scn, time: vm.time, deployed: vm.deployed, done: vm.done, total: vm.total, outcome: vm.outcome, units: vm.units.map((u) => ({ id: u.id, label: u.label, battery: u.battery })), people: vm.people, alarms: vm.alarms.slice(-3), pending: vm.pending.map((a) => ({ role: a.role, reason: a.reason })) });
  $('vBrief').innerHTML = `${esc(r.text)} <span class="note">(${r.mode === 'llm' ? 'written by the AI assistant, advisory only' : 'standard summary, AI not used: ' + esc(r.why ?? 'no AI model connected')})</span>`;
};
$('btnPing').onclick = () => { if (mode !== 'remote') { $('vReply').textContent = 'Link test: not paired with a laptop (this page is running its own simulation).'; return; } pingAt = Date.now(); link.send({ t: 'ping', n: pingAt }); $('vReply').textContent = 'Link test: sent, waiting...'; setTimeout(() => { if (pingAt && $('vReply').textContent.endsWith('waiting...')) $('vReply').textContent = 'Link test: NO ANSWER from the laptop. The link is not working.'; }, 3500); };
for (const id of ['inScn', 'inCount', 'inAnimals', 'inRobots', 'inWeight', 'inSeed', 'chkAuto']) $(id).onchange = () => { if (id === 'inScn') $('inSeed').value = SEEDS[$('inScn').value]; restartLocal(); };
$('inSpeed').onchange = () => { speed = Number($('inSpeed').value); };
if (q.get('scenario')) { $('inScn').value = q.get('scenario'); $('inSeed').value = SEEDS[$('inScn').value] ?? 1; }
if (q.get('seed')) $('inSeed').value = q.get('seed'); if (q.get('speed')) $('inSpeed').value = q.get('speed'); if (q.get('weight')) $('inWeight').value = q.get('weight'); if (q.get('robots')) $('inRobots').value = q.get('robots'); if (q.get('count')) $('inCount').value = q.get('count'); if (q.get('animals')) $('inAnimals').value = q.get('animals');
restartLocal(); requestAnimationFrame(frame);
if (q.get('pair')) { $('inPair').value = cleanCode(q.get('pair')); connect(q.get('pair')); }
