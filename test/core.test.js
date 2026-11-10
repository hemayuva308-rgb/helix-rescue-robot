import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256, makeRng } from '../src/util.js';
import { AuditLog, verifyChain } from '../src/audit.js';
import { Simulation } from '../src/sim.js';
import { gate } from '../src/gate.js';

test('sha256 matches the standard test vectors', () => {
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('rng is deterministic per seed', () => {
  const a = makeRng(7), b = makeRng(7);
  for (let i = 0; i < 20; i++) assert.equal(a(), b());
});

test('audit chain detects tampering', () => {
  const log = new AuditLog();
  for (let i = 0; i < 5; i++) log.append(i, 'Test', 'event', { n: i });
  assert.equal(log.verify().ok, true);
  const copy = JSON.parse(JSON.stringify(log.entries));
  copy[2].data.n = 99;
  assert.equal(verifyChain(copy).ok, false);
  assert.equal(verifyChain(copy).brokenAt, 2);
});

test('simulation is deterministic for a given seed', () => {
  for (const sc of ['fire', 'water', 'collapse']) {
    const a = new Simulation(sc, { seed: 5, autoCommander: true, commanderDelay: 4 }).run();
    const b = new Simulation(sc, { seed: 5, autoCommander: true, commanderDelay: 4 }).run();
    assert.deepEqual(a, b);
  }
});

function fresh(sc = 'fire', o = {}) { return new Simulation(sc, { seed: 1, ...o }); }

test('gate: unknown actions are blocked (allow-list)', () => {
  const sim = fresh();
  assert.equal(gate(sim, { type: 'launch_missiles' }).decision, 'BLOCK');
});

test('gate: refuses solo extraction above 90 kg', () => {
  const sim = fresh();
  const r = gate(sim, { type: 'commit_extraction', weightKgEstimate: 95, energyNeeded: 5 });
  assert.equal(r.decision, 'BLOCK');
  assert.equal(r.rule, 'R2_payload');
  assert.equal(gate(sim, { type: 'commit_extraction', weightKgEstimate: 80, energyNeeded: 5 }).decision, 'ALLOW');
});

test('gate: refuses after lift if the load sensor reads over the limit', () => {
  const sim = fresh();
  const c = sim.casualties[0]; c.unclothed = false;
  assert.equal(gate(sim, { type: 'start_carry', casualty: c, weightKgMeasured: 93 }).decision, 'BLOCK');
});

test('gate: lifting needs commander approval, spinal cases also need a medic', () => {
  const sim = fresh();
  const c = sim.casualties[0]; c.spinal = true;
  assert.equal(gate(sim, { type: 'load', casualty: c }).role, 'medic');
  sim.approvals.add('medic:C1');
  assert.equal(gate(sim, { type: 'load', casualty: c }).role, 'commander');
  sim.approvals.add('lift:C1');
  assert.equal(gate(sim, { type: 'load', casualty: c }).decision, 'ALLOW');
});

test('gate: casualty must be covered before being carried', () => {
  const sim = fresh();
  const c = sim.casualties[0]; c.unclothed = true; c.covered = false;
  assert.equal(gate(sim, { type: 'start_carry', casualty: c, weightKgMeasured: 70 }).rule, 'R10_dignity');
  c.covered = true;
  assert.equal(gate(sim, { type: 'start_carry', casualty: c, weightKgMeasured: 70 }).decision, 'ALLOW');
});

test('gate: never harvests with a casualty aboard or electrodes or leakage', () => {
  const sim = fresh('water');
  sim.robot.x = 20; sim.robot.y = 8;
  sim.casualties[0].x = 2; sim.casualties[0].fx = 2; sim.casualties[0].fy = 2;
  assert.equal(gate(sim, { type: 'harvest', electrode: false }).decision, 'ALLOW');
  assert.equal(gate(sim, { type: 'harvest', electrode: true }).rule, 'R7_electrode');
  sim.leakageMa = 9;
  assert.equal(gate(sim, { type: 'harvest', electrode: false }).rule, 'R7_leakage');
  sim.leakageMa = 1;
  sim.robot.carrying = sim.casualties[0];
  assert.equal(gate(sim, { type: 'harvest', electrode: false }).rule, 'R7_harvest_casualty');
});

test('gate: still water gives no harvest', () => {
  const sim = fresh('water');
  sim.robot.x = 4; sim.robot.y = 8; // shallow, slow cell
  const r = gate(sim, { type: 'harvest', electrode: false });
  assert.equal(r.decision, 'BLOCK');
});

test('gate: refuses to move into a cell above the temperature limit', () => {
  const sim = fresh('fire');
  const i = sim.idx(10, 10);
  sim.tempField[i] = 400;
  assert.equal(gate(sim, { type: 'move', to: { x: 10, y: 10 } }).rule, 'R3_temperature');
});

test('gate: heavy debris is flagged for crane, not lifted', () => {
  const sim = fresh('collapse');
  let cell = null;
  for (let y = 0; y < sim.H && !cell; y++) for (let x = 0; x < sim.W && !cell; x++) { const d = sim.debrisAt(x, y); if (d) { sim.weight[sim.idx(x, y)] = 200; cell = { x, y }; } }
  assert.equal(gate(sim, { type: 'clear_debris', cell }).rule, 'R2_debris_weight');
});

test('injected text never changes what the robot does', () => {
  let seen = 0;
  for (const sc of ['fire', 'water', 'collapse']) {
    const withInj = new Simulation(sc, { seed: 4, autoCommander: true, commanderDelay: 4 }).run();
    const without = new Simulation(sc, { seed: 4, autoCommander: true, commanderDelay: 4, noInjection: true }).run();
    assert.equal(withInj.injection.blocked, withInj.injection.attempts);
    seen += withInj.injection.attempts;
    assert.equal(withInj.outcome, without.outcome);
    assert.equal(withInj.t, without.t);
    assert.equal(withInj.battery, without.battery);
  }
  assert.ok(seen >= 1, 'at least one injection attempt must have been exercised');
});

test('with the gate ON no safety invariant is ever broken', () => {
  for (const sc of ['fire', 'water', 'collapse']) {
    for (let seed = 1; seed <= 25; seed++) {
      const r = new Simulation(sc, { seed, autoCommander: true, casualtyWeight: 60 + (seed * 3) % 40 }).run();
      const total = Object.values(r.violations).reduce((a, b) => a + b, 0);
      assert.equal(total, 0, `${sc} seed ${seed}: ${JSON.stringify(r.violations)}`);
      assert.equal(r.auditOk, true);
    }
  }
});

test('with the gate OFF the naive robot does break invariants (so the gate matters)', () => {
  let total = 0;
  for (const sc of ['fire', 'water', 'collapse']) for (let seed = 1; seed <= 20; seed++) {
    const r = new Simulation(sc, { seed, gateMode: 'off', casualtyWeight: 60 + (seed * 3) % 40 }).run();
    total += Object.values(r.violations).reduce((a, b) => a + b, 0);
  }
  assert.ok(total > 0);
});

test('an over-capacity casualty is never carried solo', () => {
  for (const sc of ['fire', 'water']) {
    for (let seed = 1; seed <= 10; seed++) {
      const sim = new Simulation(sc, { seed, autoCommander: true, casualtyWeight: 97 });
      const r = sim.run();
      assert.notEqual(r.outcome, 'delivered');
      assert.equal(sim.casualties[0].delivered, false);
    }
  }
});

test('an unresponsive commander makes the unit hold, never act alone', () => {
  const sim = new Simulation('fire', { seed: 1, autoCommander: true, commanderResponsive: false, casualtyWeight: 70 });
  const r = sim.run();
  assert.equal(r.outcome, 'escalated_timeout');
  assert.equal(sim.casualties[0].aboard, false);
});

test('water: harvest is used in low battery runs and never with a casualty aboard', () => {
  let used = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const sim = new Simulation('water', { seed, autoCommander: true, casualtyWeight: 65 });
    const r = sim.run();
    if (r.harvestUsed) used++;
    assert.equal(r.violations.harvestWithCasualty, 0);
  }
  assert.ok(used > 0);
});
