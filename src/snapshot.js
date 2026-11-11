// A small, JSON-safe "view model" of a running simulation: what the operator's phone needs to show.
// The laptop runs the simulation and sends these snapshots; the phone only displays them and sends commands back.
import { T } from './scenarios.js';
import { humanize, unitName } from './names.js';

const fmt = (n, d = 1) => Number(n).toFixed(d);
export const WORDS = { SEARCH: 'searching', INVESTIGATE: 'checking a detection', ASSESS: 'assessing a casualty', HARVEST: 'charging from the environment', APPROACH: 'going to the casualty', AWAIT_APPROVAL: 'waiting for approval', PREP: 'preparing the lift', PREP_BUSY: 'preparing the lift', CARRY: 'carrying out', DONE: 'task complete', HOLD_ESCALATED: 'holding: help requested', ASSIST: 'helping another unit', WALK: 'walking to the well', DETECT: 'scanning the shaft', MEASURE: 'measuring depth and air', LOWER: 'lowering the sling', DESCEND: 'sending the pod down', GRAB: 'pod holding the casualty', SECURE: 'securing the casualty', HOIST: 'hoisting', RETURN: 'coming out to the safe zone', RETURNED: 'out, in the safe zone', RETRACT: 'pulling the rope and pod back' };
const SENSE = { thermal: 'heat camera', sound: 'voice', co2: 'breath CO2', radar: 'radar', capacitive: 'touch' };

// Sent once when a phone connects (and after a restart): the static map.
export function makeHello(sim, scn) {
  const hello = { t: 'hello', scn, units: (sim.units ?? [{ id: 'A' }]).map((u) => u.id) };
  if (scn === 'well') return hello;
  hello.W = sim.W; hello.H = sim.H;
  hello.grid = Array.from(sim.type).join('');
  hello.safe = sim.sc.safeZones;
  return hello;
}

export function snapshot(sim, scn, ctx = {}) {
  const well = scn === 'well';
  const units = well ? [{ id: 'A', robot: sim.robot, mission: sim.mission }] : sim.units;
  const total = well ? 1 : sim.casualties.length, done = well ? (sim.casualty.delivered ? 1 : 0) : sim.casualties.filter((c) => c.delivered).length;
  const s = {
    t: 'snap', scn, time: sim.t, deployed: !!ctx.deployed, held: !!(ctx.held || sim.holdCmd), recall: !!sim.recall && !sim.outcome, linkUp: sim.linkUp !== false,
    outcome: sim.outcome ? { result: sim.outcome.result, reason: sim.outcome.reason } : null, total, done, harvested: +(sim.harvestedTotal ?? 0).toFixed(1),
    standing: !!(sim.opts && sim.opts.standingApproval),
    en: sim.events.length, ev: sim.events.slice(-14).map((e, k) => ({ i: sim.events.length - Math.min(14, sim.events.length) + k, t: e.t, agent: e.agent, kind: e.kind, msg: humanize(e.msg) })),
    pending: sim.pending.filter((a) => a.status === 'pending').map((a) => ({ id: a.id, role: a.role, reason: humanize(a.reason), left: Math.max(0, a.deadline - sim.t) })),
    alarms: sim.alarms.map((a) => ({ t: a.t, kind: a.kind, unit: a.unit, need: humanize(a.need), reason: humanize(a.reason), x: a.x ?? 0, y: a.y ?? 0 })),
  };
  s.units = units.map((u) => {
    const r = u.robot, st = !ctx.deployed ? 'standing by' : sim.linkUp === false && !['CARRY', 'RETURN', 'HOIST', 'DONE', 'HOLD_ESCALATED'].includes(u.mission.state) ? 'holding position (no operator link)' : (WORDS[u.mission.state] ?? u.mission.state.toLowerCase()) + (u.mission.paired ? ` (lifting together with ${unitName(u.mission.partner.id)})` : '');
    const extra = well ? '' : scn === 'water' ? ` · ${fmt(sim.depthAt(r.x, r.y))} m water` : scn === 'fire' ? ` · ${fmt(sim.tempAt(r.x, r.y), 0)} °C around it` : '';
    return { id: u.id, name: unitName(u.id), label: st + extra, battery: +r.battery.toFixed(1), x: +r.x.toFixed(1), y: r.y ?? 0, carrying: !!r.carrying };
  });
  if (well) {
    const h = sim.mission.hits, names = { sound: 'voice', thermal: 'heat camera', co2: 'breath (CO2)', radar: 'radar' }, c = sim.casualty;
    s.well = { depthM: sim.well.depthM, waterAtM: sim.well.waterAtM, ropeOutM: sim.robot.ropeOutM, lel: sim.gas.lel, o2: sim.gas.o2, found: !!sim.mission.verified, posM: c.posM, secured: !!c.secured, delivered: !!c.delivered, load: sim.robot.load };
    s.sense = [`air in the shaft   methane ${fmt(sim.gas.lel, 0)}% LEL · oxygen ${fmt(sim.gas.o2)}%`, `shaft             ${fmt(sim.well.depthM)} m deep, water at ${fmt(sim.well.waterAtM)} m`, `detections        ${Object.keys(h).filter((k) => h[k] >= 2).map((k) => names[k]).join(' + ') || 'none yet'}${sim.mission.verified ? ' → verified' : ''}`, `rope              ${fmt(sim.robot.ropeOutM)} m out · load ${fmt(sim.robot.load, 0)} kg`];
    s.people = sim.mission.verified ? [`C1 · ${c.age} · ${c.conscious ? 'conscious' : 'unconscious'} · health ${fmt(c.health, 0)} · ${c.delivered ? 'DELIVERED' : c.alive ? 'being rescued' : 'lost'}`] : [];
    s.heads = [];
  } else {
    s.sense = units.map((u) => { const r = u.robot, bits = [`heat ${fmt(sim.tempAt(r.x, r.y), 0)} °C`]; if (scn === 'fire') bits.push(`smoke ${fmt(sim.smoke[sim.idx(r.x, r.y)] * 100, 0)}%`); if (scn === 'water') bits.push(`current ${fmt(sim.currentMagAt(r.x, r.y))} m/s`); if (scn === 'collapse') bits.push(`structure risk ${fmt(sim.collapseRisk, 2)}`); return `${unitName(u.id)}   ${bits.join(' · ')}`; })
      .concat(sim.candidates.filter((c) => !c.handled).slice(-5).map((c) => `detection #${c.id}  ${Object.keys(c.hits).map((k) => SENSE[k]).join(' + ')}  ${c.status === 'verified' ? '→ VERIFIED (2 sensor types)' : c.status === 'rejected' ? '→ rejected (decoy)' : '→ checking'}`));
    const found = sim.casualties.filter((c) => c.verifiedOnce);
    s.people = found.map((c) => `${c.id} · ${c.animal ? 'dog' : c.age} · ${c.estimate ? fmt(c.estimate, 0) + ' kg' : '? kg'} · health ${fmt(c.health, 0)} · ${c.delivered ? 'DELIVERED' : c.referred ? 'human team called' : !c.alive ? 'lost' : c.aboard ? 'being carried' : 'waiting'}`);
    s.heads = found.filter((c) => c.alive && !c.delivered && !c.aboard).map((c) => [Math.round(c.fx), Math.round(c.fy), c.id, c.animal ? 1 : 0]);
    if (scn === 'fire') { const f = []; for (let i = 0; i < sim.fireI.length; i++) if (sim.fireI[i] > 0.02) f.push([i % sim.W, Math.floor(i / sim.W), +sim.fireI[i].toFixed(2)]); s.fire = f; }
  }
  return s;
}

export { T };
