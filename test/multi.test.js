import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim.js';

const run = (sc, seed, n = 3) => new Simulation(sc, { seed, autoCommander: true, commanderDelay: 4, casualtyCount: n, casualtyWeight: 75 }).run(900);

test('multi-casualty: unit keeps rescuing until the area is clear (demo seeds)', () => {
  for (const [sc, seed] of [['fire', 4], ['water', 19], ['collapse', 4]]) {
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
