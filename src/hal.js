// Hardware abstraction layer (HAL): the only path from a proposed action to an actuator.
// Every action goes through the deterministic safety gate first. The planner, the AI and the
// simulation never talk to an actuator port directly. A real robot would implement ActuatorPort
// (motor drivers, safety controller); today only the simulated port exists.
import { gate } from './gate.js';

export class ActuatorPort {
  // eslint-disable-next-line no-unused-vars
  execute(action) { throw new Error('ActuatorPort.execute must be implemented'); }
}

// Simulation adapter: records what would be sent to the motors.
export class SimulatedPort extends ActuatorPort {
  constructor() { super(); this.executed = []; }
  execute(action) { this.executed.push({ type: action.type, ...(action.to ? { to: action.to } : {}) }); return { ok: true }; }
}

// Placeholder for a future real robot. Calling it always fails loudly: there is no hardware yet.
export class HardwarePort extends ActuatorPort {
  execute() { const e = new Error('No hardware connected: driver, calibration and safety interlocks are not implemented yet'); e.code = 'HARDWARE_NOT_CONNECTED'; throw e; }
}

// The gate sits between the decision layer and the port.
export class GatedActuatorBus {
  constructor(sim, port) { this.sim = sim; this.port = port; this.log = []; }
  send(action) {
    const res = gate(this.sim, action);
    const entry = { type: action.type, decision: res.decision, rule: res.rule };
    this.log.push(entry);
    if (res.decision !== 'ALLOW') return { sent: false, ...res };
    try { const out = this.port.execute(action); return { sent: true, ...res, out }; }
    catch (e) { return { sent: false, decision: 'ERROR', rule: e.code ?? 'PORT_ERROR', reason: e.message }; }
  }
}
