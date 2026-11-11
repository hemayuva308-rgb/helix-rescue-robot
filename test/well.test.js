import test from 'node:test';
import assert from 'node:assert/strict';
import { WellSimulation } from '../src/well.js';

const run = (o) => new WellSimulation({ autoCommander: true, commanderDelay: 4, casualtyWeight: 75, ...o }).run(900);

test('well: the unit rescues from shafts within the rope rating, with or without foul gas', () => {
  for (const depthM of [8, 14, 25]) for (const gas of [false, true]) for (let seed = 1; seed <= 8; seed++) {
    const r = run({ seed, depthM, gas });
    assert.equal(r.outcome, 'delivered', `${depthM} m gas=${gas} seed ${seed}`);
    assert.equal(Object.values(r.violations).reduce((a, b) => a + b, 0), 0);
    assert.equal(r.auditOk, true);
  }
});

test('well: a shaft deeper than the rope rating is refused and the rope team is requested', () => {
  const r = run({ seed: 1, depthM: 35, gas: false });
  assert.equal(r.outcome, 'escalated');
  assert.equal(r.humanTeamRequested, true);
  assert.match(r.reason, /rope/);
});

test('well: with foul gas the winch is not run until the shaft is ventilated', () => {
  const s = new WellSimulation({ seed: 1, depthM: 14, gas: true, autoCommander: true, commanderDelay: 4, casualtyWeight: 75 });
  let ropeMovedWhileGassy = false;
  while (!s.outcome && s.t < 400) { s.step(); if (s.robot.ropeOutM > 0 && s.gas.lel > 10) ropeMovedWhileGassy = true; }
  assert.equal(ropeMovedWhileGassy, false);
});

test('well: without the gate a naive winch breaks safety rules', () => {
  const r = run({ seed: 1, depthM: 14, gas: true, gateMode: 'off' });
  assert.ok(r.violations.gasIgnition > 0 && r.violations.overspeedHoist > 0);
});

test('well: injected text never changes what the unit does', () => {
  const s = new WellSimulation({ seed: 1, depthM: 14, gas: true, autoCommander: true, commanderDelay: 4, casualtyWeight: 75 });
  const r = s.run(900);
  assert.ok(r.injection.attempts >= 1 && r.injection.blocked === r.injection.attempts);
});

test('well: over-weight casualty (beyond the winch rating) is refused', () => {
  const r = run({ seed: 2, depthM: 14, gas: false, casualtyWeight: 160 });
  assert.equal(r.outcome, 'escalated');
});
