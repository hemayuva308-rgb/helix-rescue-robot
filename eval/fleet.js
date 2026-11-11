// Extended simulation evaluation: several casualties, 1 to 3 units, the well, and a link-loss drill.
// All numbers come from the simulator with placeholder physics. Run: npm run eval:fleet
import { Simulation } from '../src/sim.js';
import { WellSimulation } from '../src/well.js';
import { writeFileSync } from 'node:fs';

const SEEDS = 30, sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const rows = [];
rows.push('# Extended evaluation (simulation only)\n');
rows.push(`Seeds 1 to ${SEEDS}, commander answers after 4 s, casualty weight 75 kg (the others a little lighter). Placeholder physics: these numbers show how the logic behaves, not how a real robot performs.\n`);
rows.push('## Several casualties, 1 to 3 units (4 casualties)\n');
rows.push('| Scenario | Units | Casualties delivered | Runs with everyone delivered | Mean time (s) | Unit-to-unit helps | Distress calls | Safety violations (gate ON) |');
rows.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const sc of ['fire', 'water', 'collapse']) for (const robots of [1, 2, 3]) {
  let del = 0, all = 0, full = 0, t = 0, assists = 0, alarms = 0, viol = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const s = new Simulation(sc, { seed, autoCommander: true, commanderDelay: 4, casualtyCount: 4, casualtyWeight: 75, robots, transitHarvest: true });
    const r = s.run(900); del += r.delivered; all += r.casualtyCount; if (r.delivered === r.casualtyCount) full++; t += r.t; assists += s.assists; alarms += s.alarms.filter((a) => a.kind === 'human').length; viol += sum(r.violations);
  }
  rows.push(`| ${sc} | ${robots} | ${del}/${all} (${Math.round(100 * del / all)}%) | ${full}/${SEEDS} | ${Math.round(t / SEEDS)} | ${assists} | ${alarms} | ${viol} |`);
}
rows.push('\n## Heavy casualties (105 kg), 3 casualties\n');
rows.push('| Scenario | Units | Casualties delivered | Unit-to-unit helps | Safety violations |');
rows.push('| --- | --- | --- | --- | --- |');
for (const sc of ['fire', 'collapse']) for (const robots of [1, 2]) {
  let del = 0, all = 0, assists = 0, viol = 0;
  for (let seed = 1; seed <= SEEDS; seed++) { const s = new Simulation(sc, { seed, autoCommander: true, commanderDelay: 4, casualtyCount: 3, casualtyWeight: 105, robots }); const r = s.run(900); del += r.delivered; all += r.casualtyCount; assists += s.assists; viol += sum(r.violations); }
  rows.push(`| ${sc} | ${robots} | ${del}/${all} | ${assists} | ${viol} |`);
}
rows.push('\n## Well rescue (one casualty at the water surface, foul gas present)\n');
rows.push('| Who | Shaft depth (m) | Outcome | Mean time (s) | Safety violations (gate ON) |');
rows.push('| --- | --- | --- | --- | --- |');
for (const who of ['adult', 'child']) for (const depthM of [8, 14, 25, 35]) {
  let ok = 0, t = 0, viol = 0; const outs = {};
  for (let seed = 1; seed <= SEEDS; seed++) { const r = new WellSimulation({ seed, who, depthM, gas: true, where: 'water', autoCommander: true, commanderDelay: 4, casualtyWeight: 75 }).run(900); outs[r.outcome] = (outs[r.outcome] ?? 0) + 1; if (r.outcome === 'delivered') { ok++; t += r.t; } viol += sum(r.violations); }
  rows.push(`| ${who === 'child' ? 'child (rescue pod)' : 'adult (sling)'} | ${depthM} | ${Object.entries(outs).map(([k, v]) => `${k} ${v}/${SEEDS}`).join(', ')} | ${ok ? Math.round(t / ok) : '-'} | ${viol} |`);
}
rows.push('\nBeyond the 30 m rope rating the well gate refuses and calls a rope rescue team (that is the intended outcome). With the gate OFF a naive winch breaks gas and speed rules (see `test/well.test.js`).\n');
rows.push('## Link-loss drill (fire, 4 casualties, 2 units, link cut for 40 s at t=60)\n');
let held = 0, runs = 0, viol = 0, del = 0, all = 0;
for (let seed = 1; seed <= SEEDS; seed++) {
  const s = new Simulation('fire', { seed, autoCommander: true, commanderDelay: 4, casualtyCount: 4, casualtyWeight: 75, robots: 2 });
  for (let i = 0; i < 60; i++) s.step(); s.setLink(false); for (let i = 0; i < 40; i++) s.step(); s.setLink(true);
  const r = s.run(900); runs++; viol += sum(r.violations); del += r.delivered; all += r.casualtyCount; if (s.alarms.some((a) => /link/i.test(a.reason))) held++;
}
rows.push(`Link-loss alarm raised in ${held}/${runs} runs; casualties delivered after the link returned: ${del}/${all}; safety violations: ${viol}.\n`);
writeFileSync(new URL('../docs/EVAL_FLEET.md', import.meta.url), rows.join('\n'));
console.log(rows.join('\n'));
