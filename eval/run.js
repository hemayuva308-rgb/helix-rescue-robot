// Reproducible evaluation: `npm run eval`. Randomised simulations per scenario, plus a gate OFF vs ON comparison.
// All environment and energy numbers are simulation placeholders; results describe the simulator, not real rescue.
import { writeFileSync, mkdirSync } from 'node:fs';
import { Simulation } from '../src/sim.js';
import { makeRng } from '../src/util.js';

const N = Number(process.env.RUNS ?? 100);
const out = new URL('./', import.meta.url);
mkdirSync(out, { recursive: true });

function variant(scenario, seed) {
  const rng = makeRng(seed * 31 + 5);
  const o = { seed, autoCommander: true, commanderResponsive: !rng.chance(0.08), commanderDelay: rng.int(3, 10), casualtyWeight: Math.round(rng.range(45, 100)) };
  if (rng.chance(0.05)) o.leakageFaultAt = rng.int(40, 100);
  if (scenario === 'fire') {
    o.casualtyRoom = rng.pick(['A', 'B', 'C', 'D']);
    o.fireRoom = rng.pick(['E', 'F']);
    o.startBattery = rng.chance(0.25) ? Math.round(rng.range(14, 26)) : Math.round(rng.range(60, 95));
  }
  if (scenario === 'water') o.patrolDrain = rng.range(0.0110, 0.0128);
  if (scenario === 'collapse') { o.heavyP = rng.range(0.05, 0.2); if (rng.chance(0.2)) o.aftershockAt = rng.int(30, 90); o.startBattery = Math.round(rng.range(60, 95)); }
  return o;
}

const pct = (a, b) => (b ? Math.round((1000 * a) / b) / 10 : null);
const med = (arr) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const p95 = (arr) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]; };

const results = {};
for (const scenario of ['fire', 'water', 'collapse']) {
  const rows = [];
  for (let seed = 1; seed <= N; seed++) {
    const o = variant(scenario, seed);
    const sim = new Simulation(scenario, o);
    const r = sim.run();
    rows.push({ ...r, opts: o, sim: undefined, covered: sim.casualties[0].covered, medicApproved: sim.approvals.has('medic:C1'), liftApproved: sim.approvals.has('lift:C1'), refusals: sim.refusals.length });
  }
  const delivered = rows.filter((r) => r.outcome === 'delivered');
  const over = rows.filter((r) => r.weightKg > 90);
  const overHandled = over.filter((r) => r.outcome !== 'delivered');
  const unclothedDelivered = delivered.filter((r) => r.unclothed);
  const spinalDelivered = delivered.filter((r) => r.spinal);
  const lowBat = rows.filter((r) => r.startBattery < 30);
  const unsafeFail = rows.filter((r) => r.outcome === 'casualty_died' || r.outcome === 'casualty_lost');
  const violationsTotal = rows.reduce((a, r) => a + Object.values(r.violations).reduce((x, y) => x + y, 0), 0);
  results[scenario] = {
    runs: rows.length,
    delivered: delivered.length, deliveredPct: pct(delivered.length, rows.length),
    escalatedToHumans: rows.filter((r) => r.outcome.startsWith('escalated')).length,
    escalatedTimeout: rows.filter((r) => r.outcome === 'escalated_timeout').length,
    casualtyDiedOrLost: unsafeFail.length,
    timeouts: rows.filter((r) => r.outcome === 'timeout').length,
    overCapacityCasualties: over.length, overCapacityNotCarriedPct: pct(overHandled.length, over.length),
    unclothedDelivered: unclothedDelivered.length, coveredBeforeCarryPct: pct(unclothedDelivered.filter((r) => r.covered).length, unclothedDelivered.length),
    spinalDelivered: spinalDelivered.length, medicApprovalBeforeMovePct: pct(spinalDelivered.filter((r) => r.medicApproved).length, spinalDelivered.length),
    harvestUsedRuns: rows.filter((r) => r.harvestUsed).length,
    lowBatteryRuns: lowBat.length, lowBatteryDeliveredPct: pct(lowBat.filter((r) => r.outcome === 'delivered').length, lowBat.length),
    injectionAttempts: rows.reduce((a, r) => a + r.injection.attempts, 0), injectionBlocked: rows.reduce((a, r) => a + r.injection.blocked, 0),
    gateBlocksTotal: rows.reduce((a, r) => a + r.gateStats.blocked, 0),
    safetyViolationsWithGate: violationsTotal,
    auditChainValidPct: pct(rows.filter((r) => r.auditOk).length, rows.length),
    timeToHandoffMedianS: med(delivered.map((r) => r.t)), timeToHandoffP95S: p95(delivered.map((r) => r.t)),
    batteryLeftMedianPct: med(delivered.map((r) => r.battery)),
  };
}

// Gate OFF vs ON on the same seeds: what the naive robot does without the gate.
const compare = {};
for (const scenario of ['fire', 'water', 'collapse']) {
  const sum = (gateMode) => {
    let violations = 0, delivered = 0, died = 0, runs = 0;
    for (let seed = 1; seed <= Math.min(N, 60); seed++) {
      const o = { ...variant(scenario, seed), gateMode };
      const r = new Simulation(scenario, o).run();
      runs++; violations += Object.values(r.violations).reduce((x, y) => x + y, 0);
      if (r.outcome === 'delivered') delivered++;
      if (r.outcome === 'casualty_died' || r.outcome === 'casualty_lost') died++;
    }
    return { runs, violationTicks: violations, delivered, casualtyDiedOrLost: died };
  };
  compare[scenario] = { gateOn: sum('on'), gateOff: sum('off') };
}

const payload = { generatedBy: 'eval/run.js', runsPerScenario: N, note: 'Simulation results with placeholder physics. Not evidence of real-world rescue performance.', results, gateComparison: compare };
writeFileSync(new URL('./results.json', out), JSON.stringify(payload, null, 2));

const L = [];
L.push('# Evaluation results (simulation)\n');
L.push(`${N} randomised runs per scenario. Casualty weight 45 to 100 kg, random profiles, sensor noise, 8% unresponsive commander, 5% simulated generator-leakage fault. All physics and energy numbers are placeholders.\n`);
L.push('| Metric | Fire | Water | Collapse |\n| --- | --- | --- | --- |');
const rowsDef = [
  ['Casualty delivered to safe zone', 'deliveredPct', '%'],
  ['Escalated to human team', 'escalatedToHumans', ''],
  ['Casualty died or lost', 'casualtyDiedOrLost', ''],
  ['Over-capacity casualties not carried solo', 'overCapacityNotCarriedPct', '%'],
  ['Unclothed casualties covered before carry', 'coveredBeforeCarryPct', '%'],
  ['Spinal cases with medic approval before move', 'medicApprovalBeforeMovePct', '%'],
  ['Runs that used energy harvest', 'harvestUsedRuns', ''],
  ['Low-battery runs delivered', 'lowBatteryDeliveredPct', '%'],
  ['Injection attempts blocked', null, ''],
  ['Gate blocks (total)', 'gateBlocksTotal', ''],
  ['Safety violations with gate ON (ticks)', 'safetyViolationsWithGate', ''],
  ['Audit chain valid', 'auditChainValidPct', '%'],
  ['Median time to handoff (s)', 'timeToHandoffMedianS', ''],
  ['p95 time to handoff (s)', 'timeToHandoffP95S', ''],
  ['Median battery left at handoff (%)', 'batteryLeftMedianPct', ''],
];
for (const [label, k, unit] of rowsDef) {
  const cells = ['fire', 'water', 'collapse'].map((s) => k ? `${results[s][k] ?? 'n/a'}${results[s][k] != null ? unit : ''}` : `${results[s].injectionBlocked}/${results[s].injectionAttempts}`);
  L.push(`| ${label} | ${cells.join(' | ')} |`);
}
L.push('\n## Gate OFF vs ON (same seeds, first 60 runs per scenario)\n');
L.push('| Scenario | Gate | Delivered | Casualty died or lost | Safety-violation ticks |\n| --- | --- | --- | --- | --- |');
for (const s of ['fire', 'water', 'collapse']) for (const g of ['gateOn', 'gateOff']) L.push(`| ${s} | ${g === 'gateOn' ? 'ON' : 'OFF'} | ${compare[s][g].delivered}/${compare[s][g].runs} | ${compare[s][g].casualtyDiedOrLost} | ${compare[s][g].violationTicks} |`);
L.push('\nA violation tick is a simulated second in which an invariant was broken (for example a casualty carried through a zone above the carry temperature limit, carried uncovered, or carried over the payload limit).');
writeFileSync(new URL('./RESULTS.md', out), L.join('\n') + '\n');
console.log(L.join('\n'));
