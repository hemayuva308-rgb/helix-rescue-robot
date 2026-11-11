// Alarm sounds (Web Audio, no files). Browsers only allow sound after a click or key press, so the audio is unlocked on the first one.
let ctx = null;
function audio() {
  try { ctx = ctx ?? new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); } catch (e) { ctx = null; }
  return ctx;
}
for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, () => audio(), { once: false, passive: true });

function tone(c, freq, start, dur, vol = 0.22, type = 'square') {
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq; o.connect(g); g.connect(c.destination);
  const t0 = c.currentTime + start;
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01); g.gain.setValueAtTime(vol, t0 + dur - 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

// kind 'human': urgent siren-style beeps (a call for human help). kind 'unit': a softer two-tone chime (one unit asking another).
export function playAlarm(kind = 'human') {
  const c = audio(); if (!c) return false;
  if (kind === 'human') { for (let i = 0; i < 6; i++) { tone(c, i % 2 ? 660 : 990, i * 0.28, 0.22); } for (let i = 0; i < 3; i++) tone(c, 880, 1.9 + i * 0.25, 0.16); }
  else { tone(c, 660, 0, 0.18, 0.16, 'sine'); tone(c, 880, 0.2, 0.26, 0.16, 'sine'); }
  return true;
}
