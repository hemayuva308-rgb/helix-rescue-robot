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

// Phone and laptop on different networks (for example mobile data and Wi-Fi) usually need a relay: STUN alone often fails.
const ICE = { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
] };
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
    const idFor = (v) => 'helix-' + code + (v ? '-' + (v + 1) : '');   // a reloaded page can find its old id still taken at the broker: use the next one
    try {
      if (role === 'host') {
        let variant = 0;
        const startHost = () => {
          if (closed) return;
          peer = new Peer(idFor(variant), { config: ICE });
          peer.on('open', () => status('internet link ready'));
          peer.on('connection', (c) => { c.on('open', () => wire(c)); });
          peer.on('disconnected', () => { status('reconnecting to the broker'); try { peer.reconnect(); } catch (e) { /* ignore */ } });
          peer.on('error', (e) => { status(`internet link problem (${e.type})`); if (e.type === 'unavailable-id' && variant < 5) { variant++; try { peer.destroy(); } catch (x) { /* ignore */ } setTimeout(startHost, 600); } });
        };
        startHost();
        window.addEventListener('beforeunload', () => { try { peer && peer.destroy(); } catch (e) { /* ignore */ } });
      } else {
        let vi = 0, timer = null;
        peer = new Peer(undefined, { config: ICE });
        const next = () => { clearTimeout(timer); vi = (vi + 1) % 6; retry = setTimeout(attempt, 1200); };
        const attempt = () => {
          if (closed || !peer || peer.destroyed) return;
          const c = peer.connect(idFor(vi), { reliable: true, serialization: 'json' });
          timer = setTimeout(() => { if (!c.open) { try { c.close(); } catch (e) { /* ignore */ } status(`looking for the laptop (no answer from id ${vi + 1})`); next(); } }, 6000);
          c.on('open', () => { clearTimeout(timer); wire(c); status('internet link up'); });
          c.on('iceStateChanged', (s) => status(`connecting (${s})`));
          c.on('close', () => { if (!closed) { clearTimeout(timer); retry = setTimeout(attempt, 2000); } });
          c.on('error', () => {});
        };
        peer.on('open', attempt);
        peer.on('error', (e) => { status(`looking for the laptop (${e.type})`); if (!closed && e.type === 'peer-unavailable') next(); });
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
