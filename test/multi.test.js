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

test('fleet: two units share the work, heavy casualties are lifted together, zero violations', () => {
  const two = (sc, seed, n, w) => { const s = new Simulation(sc, { seed, autoCommander: true, commanderDelay: 4, casualtyCount: n, casualtyWeight: w, robots: 2, transitHarvest: true }); return { r: s.run(900), s }; };
  for (const [sc, seed] of [['fire', 4], ['water', 5], ['collapse', 4]]) {
    const { r } = two(sc, seed, 4, 75);
    assert.equal(r.outcome, 'delivered', sc); assert.equal(r.delivered, 4, sc);
    assert.equal(Object.values(r.violations).reduce((a, b) => a + b, 0), 0);
  }
  const heavy = two('fire', 7, 3, 105);
  assert.equal(heavy.r.delivered, 3); assert.ok(heavy.s.assists >= 1);
  assert.equal(Object.values(heavy.r.violations).reduce((a, b) => a + b, 0), 0);
  const alone = new Simulation('fire', { seed: 7, autoCommander: true, commanderDelay: 4, casualtyCount: 3, casualtyWeight: 105, robots: 1 }).run(900);
  assert.ok(alone.delivered < 3, 'one unit alone cannot lift 105 kg casualties');
});

test('distress call: a refused casualty raises a visible alarm naming the help needed', () => {
  const s = new Simulation('fire', { seed: 7, autoCommander: true, commanderDelay: 4, casualtyCount: 3, casualtyWeight: 105, robots: 1 });
  s.run(900);
  assert.ok(s.alarms.some((a) => a.kind === 'human' && /second unit|lifting crew/.test(a.need)));
});

test('link loss: units hold, a unit carrying keeps going, approvals wait, and everything resumes when the link returns', () => {
  const s = new Simulation('fire', { seed: 4, autoCommander: true, commanderDelay: 4, casualtyCount: 4, casualtyWeight: 75, robots: 2 });
  for (let i = 0; i < 60; i++) s.step();
  s.setLink(false);
  assert.ok(s.alarms.some((a) => /link/i.test(a.reason)));
  const before = s.units.map((u) => [u.robot.x, u.robot.y, u.robot.carrying ? 1 : 0]);
  for (let i = 0; i < 40; i++) s.step();
  s.units.forEach((u, i) => { if (!before[i][2]) assert.ok(Math.abs(u.robot.x - before[i][0]) + Math.abs(u.robot.y - before[i][1]) <= 3, `unit ${u.id} should hold still`); });
  assert.equal(s.pending.filter((a) => a.status === 'timed_out').length, 0, 'approvals do not time out while nobody can answer');
  s.setLink(true);
  const r = s.run(900);
  assert.equal(Object.values(r.violations).reduce((a, b) => a + b, 0), 0);
  assert.ok(r.delivered >= 3);
});
