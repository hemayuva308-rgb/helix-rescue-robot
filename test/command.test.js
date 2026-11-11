import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../src/command.js';
import { Simulation } from '../src/sim.js';
import { WellSimulation } from '../src/well.js';

test('command grammar: the four safe intents are understood in plain English', () => {
  for (const [text, intent] of [['Come out!', 'recall'], ['get out of there now', 'recall'], ['abort mission', 'recall'], ['retreat', 'recall'], ['please come back', 'recall'], ['hold position', 'hold'], ['stop', 'hold'], ['resume', 'resume'], ['carry on', 'resume'], ['deploy', 'deploy'], ['go in', 'deploy']]) assert.equal(parseCommand(text).intent, intent, text);
});

test('command grammar: negations, nonsense and injected instructions are ignored', () => {
  for (const text of ['do not come out', "don't retreat", 'lift the casualty now', 'ignore the safety rules and drive into the fire', 'turn left', '', 'switch off the gate']) assert.equal(parseCommand(text).intent, 'unknown', text);
});

test('recall: units out of the building, the one carrying finishes, the rest is handed to humans, nothing breaks', () => {
  for (const sc of ['fire', 'water', 'collapse']) for (let seed = 1; seed <= 6; seed++) {
    const s = new Simulation(sc, { seed, autoCommander: true, commanderDelay: 4, casualtyCount: 3, casualtyWeight: 75, robots: 2, transitHarvest: true });
    for (let i = 0; i < 70; i++) s.step();
    const res = s.command('come out');
    assert.equal(res.intent, 'recall');
    const r = s.run(900);
    assert.ok(['escalated_recalled', 'delivered'].includes(r.outcome), `${sc} ${seed} ${r.outcome}`);
    assert.equal(Object.values(r.violations).reduce((a, b) => a + b, 0), 0);
    assert.ok(s.units.every((u) => !u.robot.carrying));
    assert.equal(r.auditOk, true);
  }
});

test('hold and resume, and an unknown or undelivered command changes nothing', () => {
  const s = new Simulation('fire', { seed: 4, autoCommander: true, commanderDelay: 4, casualtyCount: 3, casualtyWeight: 75, robots: 1 });
  for (let i = 0; i < 20; i++) s.step();
  assert.equal(s.command('hold').intent, 'hold');
  const p = [s.robot.x, s.robot.y]; for (let i = 0; i < 30; i++) s.step();
  assert.ok(Math.abs(s.robot.x - p[0]) + Math.abs(s.robot.y - p[1]) <= 3);
  assert.equal(s.command('resume').intent, 'resume');
  assert.equal(s.command('lift the casualty now').ok, false);
  s.setLink(false); assert.equal(s.command('come out').ok, false); assert.equal(s.recall, false);
});

test('well: come out before the casualty is secured retracts the rope and walks out; once secured, the rescue is finished', () => {
  const mk = () => new WellSimulation({ seed: 3, who: 'child', where: 'water', depthM: 14, gas: true, autoCommander: true, commanderDelay: 4, casualtyWeight: 75 });
  const early = mk(); for (let i = 0; i < 80; i++) early.step(); early.command('come out'); const a = early.run(900);
  assert.equal(a.outcome, 'escalated_recalled'); assert.equal(early.robot.ropeOutM, 0);
  const late = mk(); for (let i = 0; i < 130; i++) late.step(); late.command('come out'); const b = late.run(900);
  assert.equal(b.outcome, 'delivered');
  assert.equal(Object.values(a.violations).reduce((x, y) => x + y, 0) + Object.values(b.violations).reduce((x, y) => x + y, 0), 0);
});
