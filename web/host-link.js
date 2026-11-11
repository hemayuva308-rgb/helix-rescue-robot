// Laptop side of the phone link: shows the pairing code and QR, sends snapshots, executes the phone's commands.
import { createLink, newCode } from '/web/link.js';
import { makeHello, snapshot } from '/src/snapshot.js';

export function initHost({ getScn, getSim, getCtx, onDeploy, onRestart, onPhone, onSolo, onStanding, mount }) {
  // the pairing code stays the same for this browser (until its site data is cleared), so a phone that remembers it keeps working
  let code = null; try { code = localStorage.getItem('helixCode') || sessionStorage.getItem('helixCode'); } catch (e) { /* ignore */ }
  if (!code || !/^[A-Z0-9]{6}$/.test(code)) code = newCode();
  try { localStorage.setItem('helixCode', code); sessionStorage.setItem('helixCode', code); } catch (e) { /* ignore */ }
  const url = `${location.origin}/web/operator.html?pair=${code}`;
  const card = document.createElement('details'); card.className = 'card phone'; card.id = 'phoneCard';
  card.innerHTML = `<summary>Pair a phone as the operator's remote</summary>
    <div class="row"><span>Code</span><b style="font-size:16px;letter-spacing:3px" id="pCode">${code}</b></div>
    <div id="pQr" style="background:#fff;padding:4px;border-radius:8px;width:112px;margin:6px 0;border:1px solid var(--line)"></div>
    <p class="hint">On the phone open <b>${location.host}/web/operator.html</b> and type the code, or scan the QR. This laptop runs the simulation. Keep this tab open and visible: a sleeping or hidden tab (for example Edge's sleeping tabs) drops the link.</p>
    <div class="row"><span id="pStat" class="hint">waiting for the phone</span></div>
    <p class="hint" id="pLog"></p>
    <button id="pSolo">Run without the phone</button>`;
  if (mount) { mount.append(card); card.open = true; } else { const aside = document.querySelector('aside.right'); if (aside) aside.append(card); }
  const tag = document.querySelector('header .tag'); let pill = null;
  if (tag) { pill = document.createElement('a'); pill.className = 'tag'; pill.href = '#phoneCard'; pill.style.textDecoration = 'none'; pill.style.color = 'var(--navy)'; pill.title = 'Open the phone pairing details'; pill.onclick = () => { card.open = true; }; tag.before(pill); }
  card.querySelector('#pSolo').onclick = () => { if (onSolo) onSolo(); };
  const log = []; const note = (s) => { log.unshift(`${new Date().toLocaleTimeString()} ${s}`); log.length = Math.min(log.length, 3); card.querySelector('#pLog').innerHTML = log.join('<br>'); };
  (async () => {
    try { if (!window.qrcode) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = '/web/vendor/qrcode.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); const q = window.qrcode(0, 'M'); q.addData(url); q.make(); card.querySelector('#pQr').innerHTML = q.createSvgTag(3, 0); card.querySelector('#pQr svg').style.width = '100%'; card.querySelector('#pQr svg').style.height = 'auto'; }
    catch (e) { card.querySelector('#pQr').remove(); }
  })();

  const reports = [];
  let phoneSeen = 0, helloSent = false, via = '', net = '', got = 0, lastCmd = '';
  const link = createLink({ role: 'host', code, onStatus: (s) => { net = s; paint(); }, onMessage: handle });
  const connected = () => Date.now() - phoneSeen < 8000; // a phone silent for 8 s counts as a lost operator link: the units hold
  let wasConnected = false;
  function paint() { const c = connected(); if (pill) pill.textContent = c ? 'Phone: connected' : `Phone code ${code} · ${net || 'starting'}`; card.querySelector('summary').textContent = c ? 'Operator phone: connected' : 'Pair a phone as the operator\'s remote'; card.querySelector('#pStat').innerHTML = c ? `<b style="color:#12306b">phone connected</b> (via ${via || 'link'}) · ${got} messages${lastCmd ? ` · last command: "${lastCmd.replace(/[<>&]/g, '')}"` : ''}` : `waiting for the phone · ${net || 'starting'}${got ? ` (${got} messages received so far)` : ''}`; }
  function sendHello() { const s = getSim(); if (s) link.send(makeHello(s, getScn())); if (reports.length) link.send({ t: 'reports', list: reports.slice(-8) }); helloSent = true; }
  function handle(m, v) {
    const sim = getSim(); if (!sim) return;
    got++;
    if (m.t === 'ping') { link.send({ t: 'pong', n: m.n }); return; }
    if (m.t === 'hi') { phoneSeen = Date.now(); checkConn(); via = v === 'browser' ? 'same browser' : 'internet'; if (m.need === 'hello' || !helloSent) sendHello(); return; }
    phoneSeen = Date.now(); via = v === 'browser' ? 'same browser' : 'internet'; checkConn();
    if (m.t === 'deploy') onDeploy();
    else if (m.t === 'cmd') { lastCmd = String(m.text ?? '').slice(0, 60); paint(); const res = sim.command(String(m.text ?? '').slice(0, 200), m.source ?? 'phone'); link.send({ t: 'reply', ok: res.ok, intent: res.intent, text: res.reply, heard: String(m.text ?? '').slice(0, 200) }); if (res.intent === 'deploy' && res.ok) onDeploy(); }
    else if (m.t === 'approve') { if (m.ok) sim.approve(m.id); else sim.reject(m.id); }
    else if (m.t === 'link') sim.setLink(!!m.up);
    else if (m.t === 'standing') { if (onStanding) onStanding(!!m.on); }
    else if (m.t === 'restart') onRestart();
  }
  function checkConn() { const c = connected(); if (c !== wasConnected) { wasConnected = c; note(c ? 'phone connected' : 'phone silent for 8 s: treated as a lost operator link'); if (onPhone) onPhone(c); paint(); } }
  setInterval(() => {
    checkConn();
    const sim = getSim(); if (connected() && sim) link.send(snapshot(sim, getScn(), getCtx()));
  }, 500);
  return { addReport(r) { reports.push(r); if (reports.length > 20) reports.shift(); if (connected()) link.send({ t: 'report', r }); }, clearReports() { reports.length = 0; }, code, url, get connected() { return connected(); }, restarted() { helloSent = false; if (connected()) sendHello(); }, link };
}
