import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation } from '../src/sim.js';
import { GatedActuatorBus, SimulatedPort, HardwarePort } from '../src/hal.js';

const fresh = () => new Simulation('fire', { seed: 1 });

test('hal: an unknown action never reaches the actuator', () => {
  const port = new SimulatedPort(), bus = new GatedActuatorBus(fresh(), port);
  const r = bus.send({ type: 'overdrive_motors' });
  assert.equal(r.sent, false);
  assert.equal(port.executed.length, 0);
});

test('hal: moving into a cell above the temperature limit is not forwarded', () => {
  const sim = fresh(), port = new SimulatedPort(), bus = new GatedActuatorBus(sim, port);
  sim.tempField[sim.idx(10, 10)] = 400;
  const r = bus.send({ type: 'move', to: { x: 10, y: 10 } });
  assert.equal(r.sent, false);
  assert.equal(r.rule, 'R3_temperature');
  assert.equal(port.executed.length, 0);
});

test('hal: a lift is forwarded only after the human approvals exist', () => {
  const sim = fresh(), port = new SimulatedPort(), bus = new GatedActuatorBus(sim, port);
  const c = sim.casualties[0]; c.spinal = true;
  assert.equal(bus.send({ type: 'load', casualty: c }).sent, false);
  sim.approvals.add('medic:C1');
  assert.equal(bus.send({ type: 'load', casualty: c }).sent, false);
  sim.approvals.add('lift:C1');
  const r = bus.send({ type: 'load', casualty: c });
  assert.equal(r.sent, true);
  assert.equal(port.executed.length, 1);
});

test('hal: with no hardware connected, even a gate-approved action fails loudly', () => {
  const bus = new GatedActuatorBus(fresh(), new HardwarePort());
  const r = bus.send({ type: 'hold' });
  assert.equal(r.sent, false);
  assert.equal(r.rule, 'HARDWARE_NOT_CONNECTED');
});
