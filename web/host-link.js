// Laptop side of the phone link: shows the pairing code and QR, sends snapshots, executes the phone's commands.
import { createLink, newCode } from '/web/link.js';
import { makeHello, snapshot } from '/src/snapshot.js';

export function initHost({ getScn, getSim, getCtx, onDeploy, onRestart, onPhone }) {
  let code = null; try { code = sessionStorage.getItem('helixCode'); } catch (e) { /* ignore */ }
  if (!code) { code = newCode(); try { sessionStorage.setItem('helixCode', code); } catch (e) { /* ignore */ } }
  const url = `${location.origin}/web/operator.html?pair=${code}`;
  const card = document.createElement('div'); card.className = 'card'; card.id = 'phoneCard';
  card.innerHTML = `<h2>Operator phone <small>this laptop runs the simulation</small></h2>
    <div class="row"><span>Pairing code</span><b style="font-size:20px;letter-spacing:3px" id="pCode">${code}</b></div>
    <div id="pQr" style="background:#fff;padding:6px;border-radius:8px;width:150px;margin:6px 0"></div>
    <p class="hint">On the phone open <b>${location.host}/web/operator.html</b> and type the code, or scan the QR.</p>
    <div class="row"><span id="pStat" class="hint">waiting for the phone</span></div>`;
  const aside = document.querySelector('aside.right'); if (aside) aside.prepend(card);
  (async () => {
    try { if (!window.qrcode) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = '/web/vendor/qrcode.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); const q = window.qrcode(0, 'M'); q.addData(url); q.make(); card.querySelector('#pQr').innerHTML = q.createSvgTag(3, 0); card.querySelector('#pQr svg').style.width = '100%'; card.querySelector('#pQr svg').style.height = 'auto'; }
    catch (e) { card.querySelector('#pQr').remove(); }
  })();

  let phoneSeen = 0, helloSent = false, via = '', net = '';
  const link = createLink({ role: 'host', code, onStatus: (s) => { net = s; paint(); }, onMessage: handle });
  const connected = () => Date.now() - phoneSeen < 6000;
  let wasConnected = false;
  function paint() { const c = connected(); card.querySelector('#pStat').innerHTML = c ? `<b style="color:#7be0ab">phone connected</b> (via ${via || 'link'})` : `waiting for the phone · ${net || 'starting'}`; }
  function sendHello() { const s = getSim(); if (s) link.send(makeHello(s, getScn())); helloSent = true; }
  function handle(m, v) {
    const sim = getSim(); if (!sim) return;
    if (m.t === 'hi') { phoneSeen = Date.now(); via = v === 'browser' ? 'same browser' : 'internet'; if (m.need === 'hello' || !helloSent) sendHello(); return; }
    phoneSeen = Date.now(); via = v === 'browser' ? 'same browser' : 'internet';
    if (m.t === 'deploy') onDeploy();
    else if (m.t === 'cmd') { const res = sim.command(String(m.text ?? '').slice(0, 200), m.source ?? 'phone'); link.send({ t: 'reply', ok: res.ok, intent: res.intent, text: res.reply, heard: String(m.text ?? '').slice(0, 200) }); if (res.intent === 'deploy' && res.ok) onDeploy(); }
    else if (m.t === 'approve') { if (m.ok) sim.approve(m.id); else sim.reject(m.id); }
    else if (m.t === 'link') sim.setLink(!!m.up);
    else if (m.t === 'restart') onRestart();
  }
  setInterval(() => {
    const c = connected(); if (c !== wasConnected) { wasConnected = c; if (onPhone) onPhone(c); paint(); }
    const sim = getSim(); if (c && sim) link.send(snapshot(sim, getScn(), getCtx()));
  }, 500);
  return { code, url, get connected() { return connected(); }, restarted() { helloSent = false; if (connected()) sendHello(); }, link };
}
