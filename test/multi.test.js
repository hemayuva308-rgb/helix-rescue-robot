import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim.js';

const run = (sc, seed, n = 3) => new Simulation(sc, { seed, autoCommander: true, commanderDelay: 4, casualtyCount: n, casualtyWeight: 75 }).run(900);

test('multi-casualty: unit keeps rescuing until the area is clear (demo seeds)', () => {
  for (const [sc, seed] of [['fire', 60], ['water', 19], ['collapse', 4]]) {
    const r = run(sc, seed);
    assert.equal(r.outcome, 'delivered', sc);
    assert.equal(r.delivered, 3, sc);
    assert.equal(r.auditOk, true);
  }
});

test('multi-casualty: safety gate keeps zero violations across seeds', () => {
  for (const sc of ['fire', 'water', 'collapse']) for (let seed = 1; seed <= 12; seed++) {
    const r = run(sc, seed);
    assert.equal(Object.values(r.violations).reduce((a, b) => a + b, 0), 0, `${sc} seed ${seed}`);
    assert.equal(r.auditOk, true);
  }
});

test('multi-casualty: an over-capacity casualty is referred, the others are still rescued', () => {
  const s = new Simulation('collapse', { seed: 4, autoCommander: true, commanderDelay: 4, casualtyCount: 3, casualtyWeight: 75 });
  s.casualties[1].weightKg = 130;
  const r = s.run(900);
  assert.equal(r.referred, 1);
  assert.equal(r.delivered, 2);
  assert.ok(s.humanTeamRequested);
});

test('single-casualty behaviour is unchanged by default', () => {
  const s = new Simulation('fire', { seed: 10, autoCommander: true, commanderDelay: 4 });
  assert.equal(s.multi, false);
  assert.equal(s.casualties.length, 1);
});

test('multi-casualty: four people in the fire scenario, all delivered (seed 26)', () => {
  const r = run('fire', 26, 4);
  assert.equal(r.outcome, 'delivered');
  assert.equal(r.delivered, 4);
  assert.equal(Object.values(r.violations).reduce((a, b) => a + b, 0), 0);
});

test('water: charging while moving never breaks a safety rule and a leakage fault cuts it off', () => {
  let viol = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const s = new Simulation('water', { seed, autoCommander: true, commanderDelay: 4, casualtyCount: 3, casualtyWeight: 75, transitHarvest: true });
    const r = s.run(900);
    viol += Object.values(r.violations).reduce((a, b) => a + b, 0);
    assert.equal(r.auditOk, true);
  }
  assert.equal(viol, 0);
  const faulty = new Simulation('water', { seed: 19, autoCommander: true, commanderDelay: 4, casualtyCount: 3, casualtyWeight: 75, transitHarvest: true, leakageFaultAt: 1 });
  for (let i = 0; i < 10; i++) faulty.step();
  assert.equal(faulty.transitTotal, 0, 'no charging while the leakage fault is active');
});
