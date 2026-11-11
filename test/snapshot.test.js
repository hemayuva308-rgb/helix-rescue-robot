import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim.js';
import { WellSimulation } from '../src/well.js';
import { snapshot, makeHello } from '../src/snapshot.js';

test('snapshot: a small JSON-safe view model that survives the link, for every scenario', () => {
  for (const scn of ['fire', 'water', 'collapse']) {
    const s = new Simulation(scn, { seed: 4, autoCommander: true, commanderDelay: 4, casualtyCount: 4, casualtyWeight: 75, robots: 2 });
    for (let i = 0; i < 80; i++) s.step();
    const hello = JSON.parse(JSON.stringify(makeHello(s, scn)));
    const snap = JSON.parse(JSON.stringify(snapshot(s, scn, { deployed: true })));
    assert.equal(hello.grid.length, hello.W * hello.H);
    assert.equal(snap.units.length, 2);
    assert.ok(JSON.stringify(snap).length < 6000, `${scn} snapshot ${JSON.stringify(snap).length} bytes`);
    assert.ok(Array.isArray(snap.sense) && Array.isArray(snap.people) && Array.isArray(snap.alarms));
  }
  const w = new WellSimulation({ seed: 3, who: 'child', depthM: 14, gas: true, autoCommander: true, commanderDelay: 4 });
  for (let i = 0; i < 60; i++) w.step();
  const ws = JSON.parse(JSON.stringify(snapshot(w, 'well', { deployed: true })));
  assert.equal(ws.well.depthM, 14);
});

test('snapshot reflects commands: recall and link loss show up for the phone', () => {
  const s = new Simulation('fire', { seed: 4, autoCommander: true, commanderDelay: 4, casualtyCount: 4, casualtyWeight: 75, robots: 2 });
  for (let i = 0; i < 40; i++) s.step();
  s.command('come out');
  assert.equal(snapshot(s, 'fire', { deployed: true }).recall, true);
  s.setLink(false);
  const v = snapshot(s, 'fire', { deployed: true });
  assert.equal(v.linkUp, false);
  assert.ok(v.alarms.some((a) => /link/i.test(a.reason)));
});
