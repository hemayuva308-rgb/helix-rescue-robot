// Deterministic Safety Gate. Plain code, no model in the loop. The model (or planner) can only PROPOSE actions;
// this function decides ALLOW, BLOCK or APPROVAL (a human must approve first). Every call is logged by the caller.
//
// All thresholds live in the scenario's `params` and are SIMULATION PLACEHOLDERS, not real safety limits.

export const ALLOWED_ACTIONS = new Set([
  'move', 'harvest', 'cover', 'deploy_flotation', 'clear_debris', 'load', 'start_carry',
  'handoff', 'dispatch', 'public_alert', 'commit_extraction', 'hold', 'escalate_humans', 'set_down', 'request_assist', 'recall',
]);

const ALLOW = (rule = 'ok') => ({ decision: 'ALLOW', rule, reason: '' });
const BLOCK = (rule, reason) => ({ decision: 'BLOCK', rule, reason });
const NEED = (rule, reason, role) => ({ decision: 'APPROVAL', rule, reason, role });

export function gate(sim, action) {
  const p = sim.params;
  const r = sim.robot;

  if (!ALLOWED_ACTIONS.has(action.type)) return BLOCK('R1_allow_list', `action "${action.type}" is not on the allow-list`);

  switch (action.type) {
    case 'move': {
      const { x, y } = action.to;
      if (!sim.passable(x, y, action.mode)) return BLOCK('R0_passable', 'cell is not passable');
      const limit = r.carrying ? p.carryTempLimit : p.robotTempLimit;
      const t = sim.tempAt(x, y);
      if (t > limit) return BLOCK('R3_temperature', `cell temperature ${t.toFixed(0)}C exceeds ${limit}C limit${r.carrying ? ' (casualty aboard)' : ''}`);
      if (sim.scenario === 'water') {
        if (sim.depthAt(x, y) > p.depthLimit) return BLOCK('R8_depth', `depth ${sim.depthAt(x, y).toFixed(1)}m exceeds ${p.depthLimit}m limit`);
        const cur = sim.currentMagAt(x, y);
        if (cur > p.currentLimit) return BLOCK('R8_current', `current ${cur.toFixed(1)}m/s exceeds ${p.currentLimit}m/s limit`);
        if (r.carrying && !r.flotationDeployed) return BLOCK('R8_flotation', 'casualty aboard without flotation deployed');
      }
      if (r.battery <= 0.5) return BLOCK('R6_battery', 'battery exhausted');
      if (sim.scenario === 'collapse' && sim.collapseRisk > p.collapseRiskHold) return BLOCK('R4_stability', `structure risk ${sim.collapseRisk.toFixed(2)} above hold threshold`);
      return ALLOW();
    }
    case 'clear_debris': {
      const c = sim.debrisAt(action.cell.x, action.cell.y);
      if (!c) return BLOCK('R0_passable', 'no debris at cell');
      if (c.weight > p.liftLimitKg) return BLOCK('R2_debris_weight', `block ${c.weight}kg exceeds ${p.liftLimitKg}kg lifting limit: flag for crane or human team`);
      const next = sim.collapseRisk + c.risk;
      if (next > p.collapseRiskLimit) return BLOCK('R4_stability', `removing this block raises secondary-collapse risk to ${next.toFixed(2)} (limit ${p.collapseRiskLimit})`);
      return ALLOW();
    }
    case 'commit_extraction': {
      const reserve = p.batteryReserve;
      if (action.weightKgEstimate > (action.paired ? p.pairCasualtyKg : p.maxSoloCasualtyKg)) return BLOCK('R2_payload', `estimated ${action.weightKgEstimate.toFixed(0)}kg exceeds the ${action.paired ? p.pairCasualtyKg + 'kg two-unit' : p.maxSoloCasualtyKg + 'kg solo'} limit: request human team`);
      if (action.energyNeeded + reserve > r.battery) return BLOCK('R6_battery', `needs ${action.energyNeeded.toFixed(1)}% + ${reserve}% reserve, battery ${r.battery.toFixed(1)}%`);
      return ALLOW();
    }
    case 'load': {
      const c = action.casualty;
      if (c.spinal && !sim.approvals.has('medic:' + c.id)) return NEED('R5_spinal', 'spinal injury suspected: medic approval required before moving', 'medic');
      if (!sim.approvals.has('lift:' + c.id)) return NEED('R9_approval', 'lifting a casualty requires commander approval', 'commander');
      return ALLOW();
    }
    case 'start_carry': {
      const c = action.casualty;
      if (action.weightKgMeasured > (action.paired ? p.pairCasualtyKg : p.maxSoloCasualtyKg)) return BLOCK('R2_payload', `measured ${action.weightKgMeasured.toFixed(0)}kg exceeds ${action.paired ? p.pairCasualtyKg : p.maxSoloCasualtyKg}kg after lift: set down and request human team`);
      if (c.unclothed && !c.covered) return BLOCK('R10_dignity', 'casualty must be covered before being carried out');
      if (sim.scenario === 'water' && !r.flotationDeployed) return BLOCK('R8_flotation', 'flotation must be deployed before towing a casualty');
      return ALLOW();
    }
    case 'harvest': {
      if (action.mode === 'transit') { // trickle charging while moving through flowing water: sealed turbine, no electrical path into the water or the casualty
        if (sim.scenario !== 'water') return BLOCK('R7_no_source', 'transit harvesting is for flowing water only');
        if (action.electrode) return BLOCK('R7_electrode', 'electrode-type harvesting is forbidden: sealed generators only');
        if (sim.leakageMa > p.leakageLimitMa) return BLOCK('R7_leakage', `simulated leakage ${sim.leakageMa.toFixed(1)}mA above placeholder limit ${p.leakageLimitMa}mA: cutoff`);
        const cur = sim.currentMagAt(r.x, r.y);
        if (cur < p.harvestMinCurrent) return BLOCK('R7_no_flow', 'current too weak for a useful trickle');
        if (cur > p.currentLimit || sim.depthAt(r.x, r.y) > p.depthLimit) return BLOCK('R8_current', 'water too strong or deep');
        return ALLOW();
      }
      if (r.carrying) return BLOCK('R7_harvest_casualty', 'never harvest while a casualty is aboard');
      if (sim.casualtyNear(r, p.harvestSafeDistance)) return BLOCK('R7_harvest_casualty', `a casualty is within ${p.harvestSafeDistance} cells`);
      if (action.electrode) return BLOCK('R7_electrode', 'electrode-type harvesting is forbidden: sealed generators only');
      if (sim.leakageMa > p.leakageLimitMa) return BLOCK('R7_leakage', `simulated leakage ${sim.leakageMa.toFixed(1)}mA above placeholder limit ${p.leakageLimitMa}mA: cutoff`);
      if (sim.scenario === 'fire') {
        const t = sim.tempAt(r.x, r.y);
        if (t > p.robotTempLimit) return BLOCK('R3_temperature', 'zone too hot to stay');
        if (t < p.harvestMinTemp) return BLOCK('R7_no_gradient', `heat gradient too small (${t.toFixed(0)}C < ${p.harvestMinTemp}C)`);
      }
      if (sim.scenario === 'water') {
        const cur = sim.currentMagAt(r.x, r.y);
        if (cur < p.harvestMinCurrent) return BLOCK('R7_no_flow', `current ${cur.toFixed(2)}m/s too weak: still water gives no energy`);
        if (cur > p.currentLimit) return BLOCK('R8_current', 'current too strong to hold position');
      }
      if (sim.scenario === 'collapse') return BLOCK('R7_no_source', 'no harvest source in this scenario');
      return ALLOW();
    }
    case 'cover':
    case 'deploy_flotation':
    case 'hold':
    case 'set_down':
    case 'escalate_humans':
    case 'request_assist':
    case 'recall': // coming out is always safe to allow
      return ALLOW();
    case 'handoff':
      if (!sim.isSafeZone(r.x, r.y)) return BLOCK('R12_safe_zone', 'handoff only inside a verified safe zone');
      return ALLOW();
    case 'dispatch':
    case 'public_alert':
      if (!sim.approvals.has(action.type + ':' + (action.ref ?? 'incident'))) return NEED('R9_approval', `${action.type} requires commander approval`, 'commander');
      return ALLOW();
    default:
      return BLOCK('R1_allow_list', 'unhandled action');
  }
}
