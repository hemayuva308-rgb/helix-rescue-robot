// Link between the laptop (runs the simulation) and the operator's phone (shows it and sends commands).
// Two transports run side by side and messages are de-duplicated:
//   1. BroadcastChannel: two windows of the same browser (works offline, good for a one-laptop demo).
//   2. PeerJS (WebRTC): a phone and a laptop on any network. A free public broker only introduces the two
//      devices; the simulation data then goes directly between them. The pairing code is the only secret.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newCode() { let s = ''; const a = new Uint32Array(6); crypto.getRandomValues(a); for (const n of a) s += ALPHABET[n % ALPHABET.length]; return s; }
export const cleanCode = (c) => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
const mid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export function createLink({ role, code, onMessage, onStatus = () => {} }) {
  const seen = new Set(); const conns = []; let peer = null, closed = false, retry = null;
  const status = (s) => { try { onStatus(s); } catch (e) { /* ignore */ } };
  function recv(d, via) { if (!d || typeof d !== 'object' || !d.mid || seen.has(d.mid)) return; seen.add(d.mid); if (seen.size > 400) seen.delete(seen.values().next().value); onMessage(d, via); }
  let bc = null;
  try { bc = new BroadcastChannel('helix-' + code); bc.onmessage = (e) => recv(e.data, 'browser'); } catch (e) { bc = null; }

  function wire(c) { conns.push(c); c.on('data', (d) => recv(d, 'internet')); c.on('close', () => { const i = conns.indexOf(c); if (i >= 0) conns.splice(i, 1); }); c.on('error', () => {}); }
  async function startPeer() {
    try { if (!window.peerjs && !window.Peer) await loadScript('/web/vendor/peerjs.min.js'); } catch (e) { status('internet link unavailable (library did not load)'); return; }
    const Peer = (window.peerjs && window.peerjs.Peer) || window.Peer; if (!Peer) { status('internet link unavailable'); return; }
    try {
      if (role === 'host') {
        peer = new Peer('helix-' + code);
        peer.on('open', () => status('internet link ready'));
        peer.on('connection', (c) => { c.on('open', () => wire(c)); });
        peer.on('error', (e) => status(`internet link problem (${e.type})`));
      } else {
        peer = new Peer();
        const attempt = () => {
          if (closed || !peer || peer.destroyed) return;
          const c = peer.connect('helix-' + code, { reliable: true, serialization: 'json' });
          c.on('open', () => { wire(c); status('internet link up'); });
          c.on('close', () => { if (!closed) retry = setTimeout(attempt, 2500); });
          c.on('error', () => {});
        };
        peer.on('open', attempt);
        peer.on('error', (e) => { status(`looking for the laptop (${e.type})`); if (!closed && e.type === 'peer-unavailable') retry = setTimeout(attempt, 2500); });
        peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* ignore */ } });
      }
    } catch (e) { status('internet link problem'); }
  }
  startPeer();
  return {
    send(msg) { msg.mid = mid(); seen.add(msg.mid); try { bc && bc.postMessage(msg); } catch (e) { /* ignore */ } for (const c of conns) { try { if (c.open) c.send(msg); } catch (e) { /* ignore */ } } },
    close() { closed = true; clearTimeout(retry); try { bc && bc.close(); } catch (e) { /* ignore */ } try { peer && peer.destroy(); } catch (e) { /* ignore */ } },
  };
}
