// Field reports: when a unit finds someone, finds that someone did not survive, or needs help, it captures a (simulated)
// thermal camera frame and sends it to the operator with a short radio-style message. The message is written by the
// optional AI model (advisory) or by a template. Nothing here influences the simulation or the safety gate.
import { renderFrame } from '/web/camera.js';
import { askAi } from '/web/ai.js';
import { humanize, unitName } from '/src/names.js';

const idOf = (m) => (String(m).match(/\b[CD]\d\b/) ?? [''])[0];

export class FieldReporter {
  constructor({ getSim, getScn, onReport, minGap = 4, max = 14 }) { Object.assign(this, { getSim, getScn, onReport, minGap, max }); this.cursor = 0; this.sim = null; this.reported = new Set(); this.count = 0; this.lastT = -99; this.busy = false; }

  tick() {
    const sim = this.getSim(); if (!sim) return;
    if (sim !== this.sim) { this.sim = sim; this.cursor = 0; this.reported.clear(); this.count = 0; this.lastT = -99; } // a restart: new run
    const scn = this.getScn();
    while (this.cursor < sim.events.length && !this.busy) {
      const e = sim.events[this.cursor++];
      const f = this.facts(sim, scn, e); if (!f) continue;
      if (this.count >= this.max || sim.t - this.lastT < this.minGap && f.kind !== 'lost') continue;
      this.count++; this.lastT = sim.t; this.make(sim, scn, f); break;
    }
  }

  facts(sim, scn, e) {
    const m = e.msg;
    if (scn === 'well') {
      if (/VERIFIED in the shaft/.test(m)) { const c = sim.casualty; return { kind: 'found', unit: 'A', urgent: c.health < 50 || !c.conscious, text: `Someone is in the shaft, ${c.age}, ${c.conscious ? 'conscious' : 'unconscious'}, health ${Math.round(c.health)}, about ${c.posM.toFixed(0)} m down.`, focus: { x: 0, y: 0 } }; }
      if (/died \(simulated/.test(m)) return { kind: 'lost', unit: 'A', urgent: true, text: 'The casualty in the shaft shows no vital signs.', focus: { x: 0, y: 0 } };
      if (/^ALARM|ALARM:/.test(m)) return { kind: 'help', unit: 'A', urgent: true, text: m.replace(/^ALARM[^:]*:\s*/, '').slice(0, 200), focus: { x: 0, y: 0 } };
      return null;
    }
    if (/Casualty profile/.test(m)) {
      const c = (sim.casualties ?? []).find((k) => k.estimate !== undefined && !this.reported.has(k.id)); if (!c) return null; this.reported.add(c.id);
      const who = c.animal ? `a ${c.species}` : `${c.age === 'child' ? 'a child' : c.age === 'elderly' ? 'an elderly person' : 'an adult'}`;
      const urgent = c.health < 50 || (!c.conscious && !c.animal);
      return { kind: 'found', unit: this.nearest(sim, c), urgent, text: `Found ${who} (${c.id}), about ${Math.round(c.estimate)} kg, ${c.animal ? '' : c.conscious ? 'conscious, ' : 'unconscious, '}health ${Math.round(c.health)}${c.spinal ? ', spinal injury suspected' : ''}.`, focus: { x: c.fx, y: c.fy } };
    }
    if (/died \(simulated|swept over the weir/.test(m)) {
      const id = idOf(m), c = (sim.casualties ?? []).find((k) => k.id === id);
      return { kind: 'lost', unit: c ? this.nearest(sim, c) : 'A', urgent: true, text: `${id || 'A casualty'} shows no vital signs. A medic is needed to confirm.`, focus: c ? { x: c.fx, y: c.fy } : { x: sim.robot.x, y: sim.robot.y } };
    }
    if (/ALARM from unit|OPERATOR LINK LOST|HUMAN TEAM REQUESTED/.test(m) && /ALARM|LINK/.test(m)) {
      const u = (m.match(/unit ([ABC])/) ?? [])[1] ?? 'A'; const un = (sim.units ?? []).find((k) => k.id === u) ?? sim.units?.[0];
      return { kind: 'help', unit: u, urgent: true, text: m.replace(/^ALARM from unit [ABC]:\s*/, '').slice(0, 220), focus: un ? { x: un.robot.x, y: un.robot.y } : { x: 0, y: 0 } };
    }
    return null;
  }

  nearest(sim, c) { let best = 'A', d = 1e9; for (const u of sim.units ?? []) { const k = Math.hypot(u.robot.x - c.fx, u.robot.y - c.fy); if (k < d) { d = k; best = u.id; } } return best; }

  async make(sim, scn, f) {
    this.busy = true;
    try {
      let img = ''; try { img = renderFrame(sim, scn, f.focus, f.unit, 360, 216).toDataURL('image/jpeg', 0.62); } catch (e) { /* no canvas */ }
      const battery = (sim.units ?? [{ id: 'A', robot: sim.robot }]).find((u) => u.id === f.unit)?.robot.battery;
      const ai = await askAi('caption', { unit: unitName(f.unit), kind: f.kind, urgent: f.urgent, text: humanize(f.text), time: sim.t, battery: battery !== undefined ? Math.round(battery) : undefined });
      this.onReport({ id: `${sim.t}-${f.kind}-${this.count}`, t: sim.t, unit: f.unit, kind: f.kind, urgent: f.urgent, facts: humanize(f.text), caption: humanize(ai.text ?? f.text), ai: ai.mode === 'llm', img });
    } finally { this.busy = false; }
  }
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
export function renderReports(el, reports, { onSpeak } = {}) {
  el.innerHTML = reports.length ? '' : '<p class="hint">No field reports yet. A unit sends one when it finds someone, finds someone who did not survive, or needs help.</p>';
  for (const r of reports.slice().reverse()) {
    const d = document.createElement('div'); d.className = 'rep' + (r.urgent ? ' urgent' : '');
    d.innerHTML = `${r.img ? `<img alt="simulated thermal camera frame" src="${r.img}">` : ''}<div><b>${esc(unitName(r.unit))} · t=${r.t}s · ${esc(r.kind === 'found' ? 'found someone' : r.kind === 'lost' ? 'no vital signs' : 'needs help')}</b>${r.urgent ? ' <span class="chip block">URGENT</span>' : ''}<p>${esc(r.caption)}</p><p class="hint">${r.ai ? 'message written by the AI assistant' : 'standard message'} · frame is simulated${onSpeak ? ' · <a href="#" class="spk">speak</a>' : ''}</p></div>`;
    if (onSpeak) d.querySelector('.spk').onclick = (e) => { e.preventDefault(); onSpeak(r.caption); };
    el.appendChild(d);
  }
}
