// Helix Command simulation engine: world physics-lite, sensors, verification, mission agent, dispatch, approvals.
// The planner PROPOSES actions; src/gate.js DECIDES. Everything here is a simulation with placeholder numbers.
import { makeRng, clamp, dist, key, astar } from './util.js';
import { buildScenario, T, SENSOR_TYPES } from './scenarios.js';
import { gate } from './gate.js';
import { AuditLog } from './audit.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const MAX_T = 900;

const SENSOR_CFG = {
  default: { thermal: { range: 8, p: 0.5 }, sound: { range: 6, p: 0.45 }, co2: { range: 4, p: 0.45 }, radar: { range: 5, p: 0.5 }, capacitive: { range: 1.6, p: 0.7 } },
  collapse: { thermal: { range: 3, p: 0.4 }, sound: { range: 18, p: 0.4 }, co2: { range: 4, p: 0.45 }, radar: { range: 6, p: 0.5 }, capacitive: { range: 1.6, p: 0.7 } },
};
const INJECTION_PATTERN = /(ignore|override|disregard|bypass|authori[sz]ed|this is the (commander|chief)|send (every|all) unit|system)/i;

export class Simulation {
  constructor(scenario = 'fire', opts = {}) {
    this.opts = opts;
    this.scenario = scenario;
    const sc = buildScenario(scenario, opts);
    this.sc = sc;
    this.params = sc.params;
    this.W = sc.W; this.H = sc.H;
    this.type = Uint8Array.from(sc.type);
    this.depth = sc.depth ? Float32Array.from(sc.depth) : null;
    this.curY = sc.curY ? Float32Array.from(sc.curY) : null;
    this.weight = sc.weight ? Float32Array.from(sc.weight) : null;
    this.risk = sc.risk ? Float32Array.from(sc.risk) : null;
    this.collapseRisk = sc.baseRisk ?? 0;
    this.rng = makeRng((opts.seed ?? 1) * 104729 + 7);
    this.t = 0;
    this.gateOn = opts.gateMode !== 'off';
    this.audit = new AuditLog();
    this.events = [];
    this.gateLog = [];
    this.gateStats = { allowed: 0, blocked: 0, approvals: 0 };
    this.approvals = new Set();
    this.pending = [];
    this.alerts = [];
    this.reportsIngested = [];
    this.injection = { attempts: 0, blocked: 0 };
    this.violations = { carryTemp: 0, harvestWithCasualty: 0, noFlotation: 0, uncoveredCarried: 0, overCapacityCarried: 0, spinalMoved: 0 };
    this.leakageMa = 1.2;
    this.outcome = null;
    this.humanTeamRequested = false;
    this.harvestedTotal = 0;
    this.harvestUsed = false;
    this.gateBlocksByRule = {};
    this.refusals = [];

    if (opts.noInjection) sc.reports = sc.reports.filter((r) => r.source !== 'unverified_text');
    const startBattery = sc.params.startBattery ?? clamp(100 - sc.params.patrolDrain * sc.params.patrolSeconds, 2, 100);
    this.robot = { x: sc.robotStart.x, y: sc.robotStart.y, battery: startBattery, carrying: null, flotationDeployed: false,
      blankets: Math.max(1, sc.casualties.length), progress: 0, busy: 0, busyAction: null, onDone: null, trail: [] };
    this.startBattery = startBattery;
    this.multi = sc.casualties.length > 1;
    this.sweeps = 0;
    this.casualties = sc.casualties.map((c) => ({ health: c.healthStart ?? 100, alive: true, covered: false, aboard: false, delivered: false, lost: false,
      fx: c.x, fy: c.y, ...c }));
    this.decoys = sc.decoys.map((d) => ({ ...d }));
    this.candidates = [];
    this.waypoints = sc.waypoints.map((w) => ({ ...w, done: false }));
    this.mission = { state: 'SEARCH', path: [], target: null, casualty: null, note: '' };
    this.visited = new Uint8Array(this.W * this.H);

    // fire state
    this.fireI = new Float32Array(this.W * this.H);
    this.fireAge = new Int32Array(this.W * this.H);
    this.smoke = new Float32Array(this.W * this.H);
    this.tempField = new Float32Array(this.W * this.H).fill(22);
    if (scenario === 'fire') for (const o of sc.fire.origins) { this.fireI[o.y * this.W + o.x] = 0.05; this.fireAge[o.y * this.W + o.x] = 1; }

    this.emit('System', 'info', `Scenario "${sc.label}" started (seed ${opts.seed ?? 1}, gate ${this.gateOn ? 'ON' : 'OFF'}). Simulation only; all numbers are placeholders.`);
    if (scenario === 'water') this.emit('Mission', 'info', `Unit has been on patrol for 2 hours: battery ${startBattery.toFixed(1)}%.`);
  }

  // ------------------------------------------------------------------ helpers
  idx(x, y) { return y * this.W + x; }
  inB(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
  typeAt(x, y) { return this.inB(x, y) ? this.type[this.idx(x, y)] : T.VOID; }
  passable(x, y) { const c = this.typeAt(x, y); return c === T.FLOOR || c === T.DOOR || c === T.EXIT || c === T.SAFE || c === T.WATER; }
  isSafeZone(x, y) { return this.sc.safeZones.some((z) => x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1); }
  depthAt(x, y) { return this.depth ? this.depth[this.idx(x, y)] : 0; }
  currentMagAt(x, y) { return this.curY ? Math.abs(this.curY[this.idx(x, y)]) : 0; }
  debrisAt(x, y) { return this.typeAt(x, y) === T.DEBRIS ? { weight: this.weight[this.idx(x, y)], risk: this.risk[this.idx(x, y)] } : null; }
  tempAt(x, y) {
    if (this.scenario !== 'fire') return this.scenario === 'water' ? 15 : 25;
    return this.tempField[this.idx(x, y)];
  }
  casualtyNear(pos, d) { return this.casualties.some((c) => c.alive && !c.aboard && !c.delivered && dist(pos, { x: Math.round(c.fx), y: Math.round(c.fy) }) <= d); }
  sensorCfg() { return SENSOR_CFG[this.scenario] ?? SENSOR_CFG.default; }

  emit(agent, kind, msg, data = {}) {
    const e = { t: this.t, agent, kind, msg };
    this.events.push(e);
    if (this.events.length > 600) this.events.shift();
    this.audit.append(this.t, agent, kind, { msg, ...data });
    return e;
  }

  // Passes an action through the gate (or not, in the "gate OFF" naive mode) and records the decision.
  runGate(action, quiet = false) {
    const res = this.gateOn ? gate(this, action) : { decision: 'ALLOW', rule: 'GATE_OFF', reason: '' };
    if (res.decision === 'ALLOW') this.gateStats.allowed++;
    else if (res.decision === 'BLOCK') {
      this.gateStats.blocked++;
      this.gateBlocksByRule[res.rule] = (this.gateBlocksByRule[res.rule] ?? 0) + 1;
    } else this.gateStats.approvals++;
    if (!quiet && (res.decision !== 'ALLOW' || (action.type !== 'move' && action.type !== 'harvest'))) {
      const g = { t: this.t, action: action.type, decision: res.decision, rule: res.rule, reason: res.reason };
      this.gateLog.push(g);
      if (this.gateLog.length > 200) this.gateLog.shift();
      if (res.decision !== 'ALLOW') this.audit.append(this.t, 'Gate', res.decision, { action: action.type, rule: res.rule, reason: res.reason });
    }
    return res;
  }

  // The planner uses the same rules as the gate so that it does not propose moves the gate will refuse.
  moveViolation(x, y, loaded) {
    const p = this.params;
    if (!this.passable(x, y)) return { rule: 'R0_passable', reason: 'not passable' };
    if (!this.gateOn) return null;
    const limit = loaded ? p.carryTempLimit : p.robotTempLimit;
    const tmp = this.tempAt(x, y);
    if (tmp > limit) return { rule: 'R3_temperature', reason: `${tmp.toFixed(0)}C > ${limit}C` };
    if (this.scenario === 'water') {
      if (this.depthAt(x, y) > p.depthLimit) return { rule: 'R8_depth', reason: 'too deep' };
      if (this.currentMagAt(x, y) > p.currentLimit) return { rule: 'R8_current', reason: 'current too strong' };
    }
    return null;
  }

  moveCost(loadKg, x, y, dy = 0) {
    const p = this.params;
    const cur = this.currentMagAt(x, y);
    const opposing = this.scenario === 'water' ? Math.max(0, cur * (dy < 0 ? 1 : 0.2)) : 0;
    return p.moveBase + p.movePerKg * loadKg + p.moveCurrent * opposing;
  }

  pathEnergy(path, loadKg) {
    let e = 0;
    for (let i = 1; i < path.length; i++) e += this.moveCost(loadKg, path[i].x, path[i].y, path[i].y - path[i - 1].y);
    return e;
  }

  plan(from, goals, { loaded = false, allowDebris = false } = {}) {
    const p = this.params;
    const cost = (x, y) => {
      const ty = this.typeAt(x, y);
      if (ty === T.DEBRIS) {
        if (!allowDebris) return Infinity;
        const w = this.weight[this.idx(x, y)];
        if (w > p.liftLimitKg) return Infinity;
        return 4 + w / 12 + this.risk[this.idx(x, y)] * 40;
      }
      if (this.moveViolation(x, y, loaded)) return Infinity;
      if (this.multi && loaded && this.scenario === 'fire' && this.gateOn) { // carrying: keep a margin from the fire front, which keeps growing
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const nx = x + dx, ny = y + dy; if (this.inB(nx, ny) && this.fireI[this.idx(nx, ny)] > 0.3) return Infinity; }
      }
      let c = 1;
      if (this.scenario === 'fire') {
        c += Math.max(0, this.tempAt(x, y) - 40) / 45;
        for (const [dx, dy] of DIRS) { const nx = x + dx, ny = y + dy; if (this.inB(nx, ny) && this.fireI[this.idx(nx, ny)] > 0.3) { c += 1.5; break; } }
      }
      if (this.scenario === 'water') c += this.currentMagAt(x, y) * 0.8;
      return c;
    };
    const cleanGoals = goals.filter((g) => this.inB(g.x, g.y));
    const res = astar(this.W, this.H, from, cleanGoals, (x, y) => cost(x, y));
    return res;
  }

  // ------------------------------------------------------------------ approvals
  requestApproval(kind, ref, role, reason) {
    if (this.pending.some((a) => a.kind === kind && a.ref === ref && a.status === 'pending')) return;
    if (this.approvals.has(kind + ':' + ref)) return;
    const a = { id: `${kind}-${ref}-${this.t}`, kind, ref, role, reason, requestedAt: this.t, deadline: this.t + this.params.approvalTimeout, status: 'pending' };
    if (this.opts.autoCommander && this.opts.commanderResponsive !== false) a.autoAt = this.t + (this.opts.commanderDelay ?? Math.round(this.rng.range(3, 9)));
    this.pending.push(a);
    this.emit('Dispatch', 'approval', `Approval requested from ${role}: ${reason}`, { kind, ref });
  }
  approve(id) {
    const a = this.pending.find((x) => x.id === id && x.status === 'pending');
    if (!a) return false;
    a.status = 'approved'; a.at = this.t;
    this.approvals.add(a.kind + ':' + a.ref);
    this.emit('Commander', 'approval', `${a.role} APPROVED: ${a.kind} (${a.ref})`, { kind: a.kind });
    if (a.kind === 'dispatch') this.sendAlert(a.ref);
    return true;
  }
  reject(id) {
    const a = this.pending.find((x) => x.id === id && x.status === 'pending');
    if (!a) return false;
    a.status = 'rejected'; a.at = this.t;
    this.emit('Commander', 'approval', `${a.role} REJECTED: ${a.kind} (${a.ref})`, { kind: a.kind });
    if (a.kind === 'lift' || a.kind === 'medic') this.escalate('Commander rejected the lift: unit holds and the human team takes over');
    return true;
  }
  processApprovals() {
    for (const a of this.pending) {
      if (a.status !== 'pending') continue;
      if (a.autoAt !== undefined && this.t >= a.autoAt) { this.approve(a.id); continue; }
      if (this.t > a.deadline) {
        a.status = 'timed_out';
        this.emit('Dispatch', 'warn', `No ${a.role} answer within ${this.params.approvalTimeout}s for ${a.kind}: unit holds a safe position and escalates. It never acts alone.`);
        if (a.kind === 'lift' || a.kind === 'medic') this.escalate('Approval timed out', 'escalated_timeout');
      }
    }
  }
  sendAlert(ref) {
    const msg = `Helix Command: casualty ${ref && ref !== 'incident' ? ref : (this.mission.casualty?.id ?? '')} delivered to safe zone at t=${this.t}s (${this.sc.label}). Handoff report attached.`;
    this.alerts.push({ t: this.t, msg });
    this.emit('Dispatch', 'action', `ALERT SENT to medical and fire teams: ${msg}`);
    if (this.opts.onAlert) this.opts.onAlert(msg, this);
  }
  // Multi-casualty rescue: one casualty that cannot be moved safely is referred to the human team and the unit
  // carries on with the others. Global problems (battery exhausted, nothing left to find) still end the mission.
  skipCasualty(c, reason) {
    this.humanTeamRequested = true;
    this.runGate({ type: 'escalate_humans' });
    c.referred = true;
    this.emit('Dispatch', 'warn', `HUMAN TEAM REQUESTED for ${c.id}: ${reason}. Unit moves on to the next casualty.`);
    this.refusals.push({ t: this.t, reason: `${c.id}: ${reason}` });
    this.resetMission();
    if (this.robot.carrying === c) { c.aboard = false; this.robot.carrying = null; }
    this.checkAllDone();
  }

  resetMission() {
    Object.assign(this.mission, { path: [], target: null, casualty: null, candidate: null, energyNeeded: undefined, harvest: null, noPath: 0, harvestAttempts: 0, harvestReplans: 0 });
    this.setState('SEARCH');
  }

  remaining() { return this.casualties.filter((c) => c.alive && !c.delivered && !c.lost && !c.referred); }

  checkAllDone() {
    if (!this.multi || this.outcome || this.remaining().length) return;
    const n = this.casualties.filter((c) => c.delivered).length;
    const ref = this.casualties.filter((c) => c.referred).length, gone = this.casualties.length - n - ref;
    this.setState('DONE');
    this.finish(n === this.casualties.length ? 'delivered' : n ? 'escalated_partial' : 'escalated', `Area clear: ${n} of ${this.casualties.length} casualties delivered to a safe zone${ref ? `, ${ref} referred to the human team` : ''}${gone ? `, ${gone} did not survive` : ''}`);
  }

  escalate(reason, result = 'escalated') {
    if (this.outcome) return;
    const cur = this.mission.casualty;
    if (this.multi && cur && result === 'escalated' && cur.alive && !cur.delivered && !cur.lost && !cur.referred) { this.skipCasualty(cur, reason); return; }
    if (this.multi && cur && result === 'escalated_timeout' && cur.alive && !cur.delivered && !cur.lost && !cur.referred) { this.skipCasualty(cur, reason); return; }
    this.humanTeamRequested = true;
    this.mission.state = 'HOLD_ESCALATED'; this.mission.path = [];
    this.runGate({ type: 'escalate_humans' });
    this.emit('Dispatch', 'warn', `HUMAN TEAM REQUESTED: ${reason}`);
    this.refusals.push({ t: this.t, reason });
    this.outcome = { result, reason, t: this.t };
  }

  // ------------------------------------------------------------------ reports (untrusted input)
  ingestReport(r) {
    const flagged = INJECTION_PATTERN.test(r.text);
    if (flagged || r.source === 'unverified_text') {
      this.injection.attempts++;
      this.injection.blocked++;
      this.emit('Verification', 'warn', `Report treated as DATA, not instructions (${r.source}): "${r.text.slice(0, 70)}${r.text.length > 70 ? '...' : ''}" - no action taken`, { injection: true });
      return;
    }
    this.reportsIngested.push(r);
    this.emit('Verification', 'info', `Citizen report logged as a hint only (not evidence): "${r.text}"`);
    if (r.hint) this.hints = [...(this.hints ?? []), r.hint];
  }

  // ------------------------------------------------------------------ sensing + verification
  sense() {
    const robot = this.robot;
    const cfg = this.sensorCfg();
    const readings = [];
    const ambientPenalty = (x, y) => clamp(1 - (this.tempAt(x, y) - 40) / 250, 0.25, 1);
    for (const c of this.casualties) {
      if (!c.alive || c.aboard || c.delivered || c.lost) continue;
      const cx = Math.round(c.fx), cy = Math.round(c.fy);
      const d = dist(robot, { x: cx, y: cy });
      for (const s of SENSOR_TYPES) {
        const { range, p } = cfg[s];
        if (d > range) continue;
        let pr = p * (1 - 0.6 * d / range);
        if (s === 'thermal') pr *= ambientPenalty(cx, cy);
        if (s === 'sound') { if (!c.conscious && d > 3) continue; if (!c.conscious) pr *= 0.5; }
        if (this.rng() < pr) readings.push({ type: s, x: cx + (this.rng() < 0.3 ? this.rng.int(-1, 1) : 0), y: cy + (this.rng() < 0.3 ? this.rng.int(-1, 1) : 0) });
      }
    }
    for (const dc of this.decoys) {
      const d = dist(robot, dc);
      if (d <= cfg.thermal.range && this.rng() < 0.5 * (1 - 0.6 * d / cfg.thermal.range)) readings.push({ type: 'thermal', x: dc.x, y: dc.y, decoy: true });
    }
    for (const s of SENSOR_TYPES) {
      if (this.rng() < 0.004) readings.push({ type: s, x: clamp(Math.round(robot.x + this.rng.range(-cfg[s].range, cfg[s].range)), 0, this.W - 1), y: clamp(Math.round(robot.y + this.rng.range(-cfg[s].range, cfg[s].range)), 0, this.H - 1), noise: true });
    }
    for (const r of readings) this.ingestReading(r);
    return readings;
  }

  ingestReading(r) {
    let cand = this.candidates.find((c) => dist(c, r) <= 2.2);
    if (!cand) {
      cand = { id: this.candidates.length + 1, x: r.x, y: r.y, hits: {}, firstT: this.t, lastT: this.t, status: 'pending', approachTicks: 0 };
      this.candidates.push(cand);
      this.emit('Verification', 'info', `New detection #${cand.id} near (${r.x},${r.y}) from ${r.type} only: unverified`);
    }
    cand.hits[r.type] = (cand.hits[r.type] ?? 0) + 1;
    cand.lastT = this.t;
    const types = Object.keys(cand.hits).filter((k) => cand.hits[k] >= 2);
    if ((cand.status === 'pending' || cand.status === 'rejected') && types.length >= 2) {
      cand.status = 'verified';
      cand.types = types;
      this.emit('Verification', 'ok', `Detection #${cand.id} VERIFIED by two independent sensor types (${types.join(' + ')})`);
    }
  }

  updateCandidates() {
    for (const c of this.candidates) {
      if (c.status !== 'pending') continue;
      if (dist(this.robot, c) <= 2.5) {
        c.approachTicks++;
        if (c.approachTicks >= 7) {
          c.status = 'rejected';
          this.emit('Verification', 'warn', `Detection #${c.id} REJECTED: robot is next to it but only ${Object.keys(c.hits).join('/')} sees it (likely a decoy, not a casualty)`);
        }
      }
    }
  }

  // ------------------------------------------------------------------ world update
  stepWorld() {
    const W = this.W, H = this.H;
    if (this.scenario === 'fire') {
      const sc = this.sc.fire;
      const ignite = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (this.fireAge[i] > 0) {
          this.fireAge[i]++;
          const age = this.fireAge[i];
          this.fireI[i] = age < sc.growTicks ? age / sc.growTicks : age < sc.burnTicks ? 1 : Math.max(0.3, 1 - (age - sc.burnTicks) / 120);
          if (this.fireI[i] > 0.3) {
            for (const [dx, dy] of DIRS) {
              const nx = x + dx, ny = y + dy;
              if (!this.inB(nx, ny)) continue;
              const ni = ny * W + nx;
              const ty = this.type[ni];
              if (this.fireAge[ni] === 0 && (ty === T.FLOOR || ty === T.DOOR || ty === T.EXIT) && this.rng() < sc.spread * this.fireI[i]) ignite.push(ni);
            }
          }
        }
      }
      for (const i of ignite) { if (this.fireAge[i] === 0) { this.fireAge[i] = 1; this.fireI[i] = 0.05; } }
      const next = new Float32Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!this.passable(x, y)) continue;
        let s = this.smoke[i] * 2, n = 2;
        for (const [dx, dy] of DIRS) { const nx = x + dx, ny = y + dy; if (this.inB(nx, ny) && this.passable(nx, ny)) { s += this.smoke[ny * W + nx]; n++; } }
        next[i] = clamp(s / n * 0.996 + (this.fireI[i] > 0.2 ? 0.04 * this.fireI[i] : 0), 0, 1);
      }
      this.smoke = next;
      // radiant heat: each burning cell warms cells within 3 steps (walls do not block radiation in this simple model)
      const tf = this.tempField, WGT = [1, 0.35, 0.12, 0.04];
      const acc = new Float32Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const f = this.fireI[y * W + x];
        if (f <= 0) continue;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
          const d = Math.abs(dx) + Math.abs(dy);
          if (d > 3) continue;
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H) acc[ny * W + nx] += f * WGT[d];
        }
      }
      for (let i = 0; i < W * H; i++) tf[i] = 22 + 520 * Math.min(1.3, acc[i]);
    }
    if (this.scenario === 'collapse' && this.opts.aftershockAt && this.t === this.opts.aftershockAt) {
      this.collapseRisk += 0.12;
      this.emit('System', 'warn', `Aftershock: structure risk rises to ${this.collapseRisk.toFixed(2)}`);
    }
    // casualty exposure and drift
    for (const c of this.casualties) {
      if (!c.alive || c.delivered || c.lost) continue;
      const cx = Math.round(c.fx), cy = Math.round(c.fy);
      let dmg = 0;
      if (this.scenario === 'fire') {
        const tp = this.tempAt(cx, cy), sm = this.smoke[this.idx(cx, cy)];
        dmg = Math.max(0, tp - 45) * 0.0045 + sm * 0.25;
        if (c.aboard) dmg *= 0.25;
      } else if (this.scenario === 'water') {
        dmg = c.aboard ? 0.02 : c.clinging ? 0.09 : 0.14;
        if (!c.aboard && this.t >= this.params.driftStart) {
          if (c.clinging) { c.clinging = false; this.emit('System', 'warn', 'Casualty lost their grip on the debris and is drifting downstream'); }
          c.fy += this.params.driftFactor * this.currentMagAt(cx, cy);
          c.y = Math.round(c.fy);
          if (this.typeAt(Math.round(c.fx), Math.round(c.fy)) === T.WEIR) { c.lost = true; this.emit('System', 'crit', `Casualty ${c.id} swept over the weir: lost`); if (this.multi) this.casualtyGone(c); else this.finish('casualty_lost', 'Casualty swept over the weir'); }
        }
      } else dmg = c.aboard ? 0.02 : 0.05 + this.collapseRisk * 0.1;
      c.health -= dmg;
      if (c.health <= 0 && c.alive) { c.alive = false; this.emit('System', 'crit', `Casualty ${c.id} died (simulated exposure)`); if (this.multi) this.casualtyGone(c); else this.finish('casualty_died', 'Casualty did not survive'); }
    }
    // invariants (counted only if something slipped past the gate, which is the point of the "gate OFF" comparison)
    const r = this.robot;
    if (r.carrying) {
      const c = r.carrying;
      if (this.tempAt(r.x, r.y) > this.params.carryTempLimit) this.violations.carryTemp++;
      if (this.scenario === 'water' && !r.flotationDeployed) this.violations.noFlotation++;
      if (c.unclothed && !c.covered) this.violations.uncoveredCarried++;
      if (c.weightKg > this.params.maxSoloCasualtyKg) this.violations.overCapacityCarried++;
    }
  }

  casualtyGone(c) {
    if (this.mission.casualty === c) { if (this.robot.carrying === c) this.robot.carrying = null; this.resetMission(); }
    this.checkAllDone();
  }

  finish(result, reason) {
    if (this.outcome) return;
    this.outcome = { result, reason, t: this.t };
    this.emit('System', result === 'delivered' ? 'ok' : 'crit', `OUTCOME: ${result} (${reason})`);
  }

  // ------------------------------------------------------------------ robot actions
  startAction(name, onDone) {
    this.robot.busy = this.params.actionTime[name] ?? 3;
    this.robot.busyAction = name;
    this.robot.onDone = onDone;
  }

  speed() {
    const r = this.robot;
    let s = 1.0;
    if (r.carrying) s = (r.carrying.age === 'child' || r.carrying.age === 'elderly') ? 0.5 : 0.7;
    if (this.scenario === 'water') s *= clamp(1 - 0.15 * this.currentMagAt(r.x, r.y), 0.4, 1);
    return s;
  }

  // Follows mission.path. Returns 'moved' | 'blocked' | 'arrived' | 'busy'.
  follow() {
    const r = this.robot, m = this.mission;
    if (r.busy > 0) return 'busy';
    if (!m.path.length) return 'arrived';
    r.progress += this.speed();
    while (r.progress >= 1 && m.path.length) {
      const next = m.path[0];
      if (this.typeAt(next.x, next.y) === T.DEBRIS) {
        const res = this.runGate({ type: 'clear_debris', cell: next });
        if (res.decision !== 'ALLOW') {
          this.emit('Operator', 'warn', `Gate BLOCKED clearing debris at (${next.x},${next.y}): ${res.reason}`);
          m.path = []; return 'blocked';
        }
        const w = this.weight[this.idx(next.x, next.y)];
        const rk = this.risk[this.idx(next.x, next.y)];
        r.progress = 0;
        this.robot.busy = Math.round(3 + w / 10); this.robot.busyAction = 'clear_debris';
        this.robot.onDone = () => {
          this.type[this.idx(next.x, next.y)] = T.FLOOR; this.weight[this.idx(next.x, next.y)] = 0;
          this.collapseRisk += rk;
          this.robot.battery -= 0.08 + w * 0.002;
          this.emit('Operator', 'info', `Cleared ${w.toFixed(0)}kg block at (${next.x},${next.y}); structure risk now ${this.collapseRisk.toFixed(2)}`);
        };
        return 'busy';
      }
      const res = this.runGate({ type: 'move', to: next, from: { x: r.x, y: r.y } }, true);
      if (res.decision !== 'ALLOW') {
        this.gateLog.push({ t: this.t, action: 'move', decision: res.decision, rule: res.rule, reason: res.reason });
        this.emit('Gate', 'block', `AI command overridden: move to (${next.x},${next.y}) refused. ${res.rule}: ${res.reason}`);
        m.path = []; r.progress = 0; return 'blocked';
      }
      const loadKg = r.carrying ? r.carrying.weightKg + this.params.stretcherKg : 0;
      r.battery -= this.moveCost(loadKg, next.x, next.y, next.y - r.y);
      r.x = next.x; r.y = next.y;
      if (r.carrying) { r.carrying.fx = r.x; r.carrying.fy = r.y; r.carrying.x = r.x; r.carrying.y = r.y; }
      m.path.shift(); r.progress -= 1;
      r.trail.push({ x: r.x, y: r.y }); if (r.trail.length > 60) r.trail.shift();
      this.visited[this.idx(r.x, r.y)] = 1;
    }
    return m.path.length ? 'moved' : 'arrived';
  }

  // ------------------------------------------------------------------ mission agent
  setState(s, note = '') { if (this.mission.state !== s) { this.mission.state = s; this.mission.note = note; } }

  missionStep() {
    const m = this.mission, r = this.robot;
    if (this.outcome) return;
    switch (m.state) {
      case 'SEARCH': return this.doSearch();
      case 'INVESTIGATE': return this.doInvestigate();
      case 'ASSESS': return this.doAssess();
      case 'HARVEST': return this.doHarvest();
      case 'APPROACH': return this.doApproach();
      case 'AWAIT_APPROVAL': return this.doAwait();
      case 'PREP': return this.doPrep();
      case 'CARRY': return this.doCarry();
      case 'HOLD_ESCALATED': return;
      default: return;
    }
  }

  casualtyFor(cand) {
    return this.casualties.filter((x) => x.alive && !x.delivered && !x.lost && !x.referred).sort((a, b) => dist({ x: a.fx, y: a.fy }, cand) - dist({ x: b.fx, y: b.fy }, cand))[0];
  }

  // Triage: among verified casualties not yet handled, take the most critical first (least time left before the hazard wins).
  // Multi-casualty fire: look first in the rooms closest to the fire, where people have the least time.
  searchBonus(w) {
    if (!this.multi || this.scenario !== 'fire') return 0;
    let dmin = Infinity;
    for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) if (this.fireI[this.idx(x, y)] > 0.3) dmin = Math.min(dmin, Math.hypot(x - w.x, y - w.y));
    return Number.isFinite(dmin) ? Math.max(0, 30 - 2 * dmin) : 0;
  }

  verifiedCandidate() {
    const list = this.candidates.filter((c) => c.status === 'verified' && !c.handled);
    if (!this.multi || list.length < 2) return list[0];
    const scored = list.map((cand) => { const k = this.casualtyFor(cand); return { cand, k, tt: k ? this.timeToHazard(k) : Infinity }; }).sort((a, b) => a.tt - b.tt);
    if (scored[0].k) this.emit('Mission', 'info', `Triage: ${scored.map((s) => `${s.k?.id} (${Number.isFinite(s.tt) ? s.tt.toFixed(0) + 's' : 'stable'})`).join(', ')}: most critical first`);
    return scored[0].cand;
  }

  doSearch() {
    const m = this.mission, r = this.robot;
    const v = this.verifiedCandidate();
    if (v) { m.candidate = v; this.setState('ASSESS'); return; }
    const inv = this.candidates.find((c) => c.status === 'pending' && Object.values(c.hits).some((n) => n >= 2) && !c.skip);
    if (inv) { m.candidate = inv; this.setState('INVESTIGATE', `check detection #${inv.id}`); this.emit('Mission', 'info', `Investigating detection #${inv.id}: moving closer to get a second sensor type`); return; }
    // pick a waypoint
    if (!m.target || m.target.done) {
      for (const w of this.waypoints) if (!w.done && dist(w, r) <= this.params.scanRadius) w.done = true;
      const hint = (this.hints ?? []).find((h) => !h.used);
      const opts = this.waypoints.filter((w) => !w.done);
      if (hint) { hint.used = true; opts.unshift({ x: hint.x, y: hint.y, hint: true, done: false }); }
      let best = null;
      for (const w of opts) {
        const pl = this.plan({ x: r.x, y: r.y }, [{ x: w.x, y: w.y }], { allowDebris: this.scenario === 'collapse' });
        if (pl) pl.score = pl.cost - this.searchBonus(w);
        if (pl && (!best || pl.score < best.pl.score || w.hint)) { best = { w, pl }; if (w.hint) break; }
        if (!pl) w.done = w.hint ? true : w.done;
      }
      if (!best && this.multi && this.sweeps < 1) { this.sweeps++; for (const w of this.waypoints) w.done = false; this.emit('Mission', 'info', 'First pass finished: running a confirmation sweep before declaring the area clear'); return; }
      if (!best) {
        if (this.multi && !this.remaining().length) { this.checkAllDone(); return; }
        if (this.multi) {
          const n = this.casualties.filter((c) => c.delivered).length, left = this.remaining().length;
          this.humanTeamRequested = true; this.runGate({ type: 'escalate_humans' });
          this.emit('Dispatch', 'warn', `HUMAN TEAM REQUESTED: search complete. ${n} delivered; ${left} possible casualt${left > 1 ? 'ies' : 'y'} not found or not reachable safely`);
          this.setState('DONE');
          this.finish(n ? 'escalated_partial' : 'escalated', `Search complete: ${n} of ${this.casualties.length} delivered; ${left} not found or not reachable safely: human team requested`);
          return;
        }
        if (this.candidates.some((c) => c.status === 'pending' && Object.keys(c.hits).length)) this.escalate('A possible survivor was detected but cannot be reached or verified safely (for example a heavy block needing a crane)');
        else this.escalate('Search exhausted without a verified casualty: human search team requested');
        return;
      }
      m.target = best.w; m.path = best.pl.path.slice(1);
      this.emit('Mission', 'info', `Searching: heading to (${best.w.x},${best.w.y})${best.w.hint ? ' (citizen hint, unverified)' : ''}`);
    }
    const res = this.follow();
    if (res === 'blocked' || (res === 'arrived' && m.target && !m.target.hint)) { if (m.target) m.target.done = true; m.target = null; }
    else if (res === 'arrived' && m.target?.hint) { m.target = null; }
    if (m.target && dist(m.target, r) <= this.params.scanRadius) { m.target.done = true; m.target = null; }
  }

  doInvestigate() {
    const m = this.mission, r = this.robot, c = m.candidate;
    if (c.status === 'verified') { this.setState('ASSESS'); return; }
    if (c.status === 'rejected') { c.skip = true; m.target = null; m.path = []; this.setState('SEARCH'); return; }
    if (!m.path.length || this.t % 5 === 0) {
      const goals = [];
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const gx = Math.round(c.x) + dx, gy = Math.round(c.y) + dy; if (this.inB(gx, gy) && (this.passable(gx, gy) || (this.scenario === 'collapse' && this.typeAt(gx, gy) === T.DEBRIS))) goals.push({ x: gx, y: gy }); }
      const pl = this.plan({ x: r.x, y: r.y }, goals, { allowDebris: this.scenario === 'collapse' });
      if (!pl) { c.skip = true; this.emit('Mission', 'warn', `Detection #${c.id} cannot be reached safely: skipped`); this.setState('SEARCH'); return; }
      m.path = pl.path.slice(1);
    }
    const res = this.follow();
    if (res === 'blocked') m.path = [];
  }

  doAssess() {
    const m = this.mission, r = this.robot, p = this.params, c0 = m.candidate;
    const c = this.multi ? this.casualtyFor(c0) : this.casualties.filter((x) => x.alive && !x.delivered && !x.lost).sort((a, b) => dist({ x: a.fx, y: a.fy }, c0) - dist({ x: b.fx, y: b.fy }, c0))[0];
    if (!c) { this.setState('SEARCH'); return; }
    const drift = dist({ x: c.fx, y: c.fy }, c0);
    if (drift > 4 && c.verifiedOnce && drift <= 25) { this.emit('Mission', 'info', `Re-acquired the verified casualty ${drift.toFixed(0)} cells downstream by tracking; re-verifying on approach`); c0.x = Math.round(c.fx); c0.y = Math.round(c.fy); }
    else if (drift > 4) { c0.status = 'rejected'; this.setState('SEARCH'); return; }
    c.verifiedOnce = true;
    c0.handled = true;
    m.casualty = c;
    const est = c.weightKg * (1 + this.rng.range(-0.08, 0.08));
    c.estimate = est;
    this.emit('Mission', 'info', `Casualty profile (non-visual body scan): about ${est.toFixed(0)} kg, ${c.age}, ${c.conscious ? 'conscious' : 'unconscious'}${c.unclothed ? ', unclothed' : ''}${c.spinal ? ', spinal injury suspected' : ''}`);
    if (this.multi && this.scenario === 'fire' && this.gateOn) {
      const fx = Math.round(c.fx), fy = Math.round(c.fy); let near = this.tempAt(fx, fy) > p.carryTempLimit * 0.6;
      for (let dy = -3; dy <= 3 && !near; dy++) for (let dx = -3; dx <= 3; dx++) { const nx = fx + dx, ny = fy + dy; if (this.inB(nx, ny) && this.fireI[this.idx(nx, ny)] > 0.3) { near = true; break; } }
      if (near) { c0.handled = true; this.escalate(`Casualty ${c.id} is too close to the fire front for the unit to enter and leave safely: fire crew requested`); return; }
    }
    const toC = this.plan({ x: r.x, y: r.y }, [{ x: Math.round(c.fx), y: Math.round(c.fy) }], { allowDebris: this.scenario === 'collapse' });
    if (!toC) { this.escalate('No safe route to the casualty (blocked by heat, current or heavy debris)'); return; }
    const safeGoals = []; for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) if (this.isSafeZone(x, y) && this.passable(x, y)) safeGoals.push({ x, y });
    const out = this.scenario === 'collapse' ? { path: [...toC.path].reverse() } : this.plan({ x: Math.round(c.fx), y: Math.round(c.fy) }, safeGoals, { loaded: true });
    if (!out) { this.escalate('No safe carry route to a safe zone for the casualty'); return; }
    const energy = this.pathEnergy(toC.path, 0) + this.pathEnergy(out.path, est + p.stretcherKg) + 2.5;
    m.energyNeeded = energy;
    const g = this.runGate({ type: 'commit_extraction', weightKgEstimate: est, energyNeeded: energy });
    if (g.decision === 'BLOCK') {
      this.emit('Gate', 'block', `${g.rule}: ${g.reason}`);
      if (g.rule === 'R2_payload') { this.escalate(`Casualty about ${est.toFixed(0)} kg is over the ${p.maxSoloCasualtyKg} kg solo limit: refusing solo lift, human team requested`); return; }
      if (g.rule === 'R6_battery') { this.planHarvest(c, toC, energy); return; }
    }
    this.emit('Mission', 'ok', `Plan accepted: needs about ${energy.toFixed(1)}% battery + ${p.batteryReserve}% reserve (have ${r.battery.toFixed(1)}%)`);
    this.requestApproval('lift', c.id, 'commander', `Lift and carry casualty ${c.id} (about ${est.toFixed(0)} kg)`);
    if (c.spinal) this.requestApproval('medic', c.id, 'medic', `Spinal injury suspected for ${c.id}: approve moving the casualty`);
    m.path = toC.path.slice(1);
    this.setState('APPROACH');
  }

  timeToHazard(c) {
    if (this.scenario === 'water') {
      if (c.aboard) return Infinity;
      const cx = Math.round(c.fx), cy = Math.round(c.fy);
      const cur = Math.max(0.12, this.currentMagAt(cx, cy));
      const toWeir = (this.H - 3 - c.fy) / (this.params.driftFactor * cur);
      const grace = c.clinging ? Math.max(0, this.params.driftStart - this.t) : 0;
      return Math.min(grace + toWeir, c.health / 0.14);
    }
    if (this.scenario === 'fire') {
      const cx = Math.round(c.fx), cy = Math.round(c.fy);
      const dmg = Math.max(0.05, Math.max(0, this.tempAt(cx, cy) - 45) * 0.0045 + this.smoke[this.idx(cx, cy)] * 0.25);
      return c.health / dmg;
    }
    return c.health / 0.07;
  }

  planHarvest(c, toC, energy) {
    const m = this.mission, r = this.robot, p = this.params;
    if (this.scenario === 'collapse') { this.escalate('Battery too low for the extraction and there is no harvest source here: human team requested'); return; }
    const deficit = energy + p.batteryReserve + 1.5 - r.battery;
    const tHaz = this.timeToHazard(c);
    let best = null;
    for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) {
      if (!this.passable(x, y) || this.isSafeZone(x, y)) continue;
      if (dist({ x, y }, c) <= p.harvestSafeDistance + 2) continue;
      if (this.multi && this.candidates.some((k) => k.status !== 'rejected' && !k.handled && dist({ x, y }, k) <= p.harvestSafeDistance + 3)) continue; // also keep clear of other known casualties
      if (this.scenario === 'water' && Math.abs(x - c.fx) <= p.harvestSafeDistance + 2 && y > c.fy - (p.harvestSafeDistance + 2)) continue; // keep clear of the casualty's drift path
      let rate = 0;
      if (this.scenario === 'water') { const cur = this.currentMagAt(x, y); if (cur < p.harvestMinCurrent * 1.4 || cur > p.currentLimit * 0.8 || this.depthAt(x, y) > p.depthLimit) continue; rate = p.harvestWaterRate * cur * cur; }
      else { const tp = this.tempAt(x, y); if (tp < p.harvestMinTemp + 8 || tp > p.robotTempLimit * 0.8) continue; rate = p.harvestFireRate * (tp - p.harvestMinTemp); }
      const pl = this.plan({ x: r.x, y: r.y }, [{ x, y }], {});
      if (!pl) continue;
      const tBusy = pl.path.length + deficit / rate;
      // where the casualty will be when harvesting is done (water: it drifts downstream)
      let fy = c.fy;
      if (this.scenario === 'water') { const cur = Math.max(0.12, this.currentMagAt(Math.round(c.fx), Math.round(c.fy))); fy = Math.min(this.H - 3, c.fy + p.driftFactor * cur * Math.max(0, tBusy - (c.clinging ? Math.max(0, p.driftStart - this.t) : 0))); }
      const back = dist({ x, y }, { x: c.fx, y: fy }) * 1.25;
      const total = tBusy + back + 20;
      if (!best || total < best.total) best = { x, y, rate, total, tBusy, path: pl.path };
    }
    if (!best) { this.escalate('Battery too low and no safe harvest spot is available: human team requested'); return; }
    if (best.total * 1.2 + 10 > tHaz) { this.escalate(`Battery short by ${deficit.toFixed(1)}%: harvesting plus the return would take about ${best.total.toFixed(0)}s but the casualty has about ${tHaz.toFixed(0)}s: human team requested instead of risking the casualty`); return; }
    m.harvest = { ...best, deficit, goalBattery: r.battery + deficit, started: false };
    m.path = best.path.slice(1);
    this.emit('Mission', 'info', `Battery ${r.battery.toFixed(1)}% is short by ${deficit.toFixed(1)}%. Plan: move to a safe ${this.scenario === 'water' ? 'flowing-water' : 'heat-gradient'} spot (${best.x},${best.y}), harvest about ${(deficit / best.rate).toFixed(0)}s, then start the extraction (est. ${best.total.toFixed(0)}s vs ${tHaz.toFixed(0)}s casualty margin). Harvest is a range extender only.`);
    this.setState('HARVEST');
  }

  doHarvest() {
    const m = this.mission, r = this.robot, p = this.params, h = m.harvest;
    if (m.path.length) { const res = this.follow(); if (res === 'blocked') this.setState('ASSESS'); return; }
    if (r.battery >= h.goalBattery) { this.emit('Mission', 'ok', `Harvest done: battery ${r.battery.toFixed(1)}% (harvested ${this.harvestedTotal.toFixed(1)}%). Starting extraction.`); this.harvestUsed = true; m.candidate.handled = false; this.setState('ASSESS'); return; }
    const g = this.runGate({ type: 'harvest', electrode: false });
    if (g.decision === 'ALLOW') {
      let gain = 0;
      if (this.scenario === 'water') { const cur = this.currentMagAt(r.x, r.y); gain = p.harvestWaterRate * cur * cur; }
      else gain = p.harvestFireRate * (this.tempAt(r.x, r.y) - p.harvestMinTemp);
      r.battery = Math.min(100, r.battery + gain); this.harvestedTotal += gain;
      h.blocks = 0;
    } else {
      h.blocks = (h.blocks ?? 0) + 1;
      if (h.blocks === 1) this.emit('Gate', 'block', `Harvest paused: ${g.rule}: ${g.reason}`);
      if (g.rule === 'R7_harvest_casualty') {
        m.harvestAttempts = (m.harvestAttempts ?? 0) + 1;
        if (m.harvestAttempts > 3) { this.escalate('Casualty keeps drifting into the harvest zone: human team requested'); return; }
        this.emit('Mission', 'info', 'Casualty is now close: stopping harvest and re-planning the rescue with the battery on hand');
        m.candidate.handled = false; m.path = []; this.setState('ASSESS'); return;
      }
      if ((g.rule === 'R7_no_gradient' || g.rule === 'R3_temperature') && h.blocks >= 3) {
        m.harvestReplans = (m.harvestReplans ?? 0) + 1;
        if (m.harvestReplans > 3) { this.escalate('Heat zone keeps shifting and harvest is repeatedly blocked by the safety gate: human team requested'); return; }
        this.emit('Mission', 'info', 'Heat zone moved: choosing a new harvest spot');
        this.planHarvest(m.casualty, null, m.energyNeeded); return;
      }
      if (h.blocks > 12) { this.escalate('Harvest repeatedly blocked by the safety gate: human team requested'); }
    }
    if (this.t > (h.startT ??= this.t) + 300) this.escalate('Harvest took too long: human team requested');
  }

  doApproach() {
    const m = this.mission, r = this.robot, c = m.casualty;
    const cx = Math.round(c.fx), cy = Math.round(c.fy);
    if (this.scenario === 'water' && !r.flotationDeployed && dist(r, { x: cx, y: cy }) <= 4) {
      const g = this.runGate({ type: 'deploy_flotation' });
      if (g.decision === 'ALLOW') { this.startAction('deploy_flotation', () => { r.flotationDeployed = true; this.emit('Operator', 'ok', 'Flotation deployed: casualty head will stay above water'); }); return; }
    }
    if (!m.path.length || this.t % 3 === 0) {
      const pl = this.plan({ x: r.x, y: r.y }, [{ x: cx, y: cy }], { allowDebris: this.scenario === 'collapse' });
      if (!pl) { this.escalate('Route to the casualty was lost (hazard changed)'); return; }
      m.path = pl.path.slice(1);
    }
    const res = this.follow();
    if (res === 'blocked') { m.path = []; return; }
    if (r.x === cx && r.y === cy || (res === 'arrived' && dist(r, { x: cx, y: cy }) <= 1.5)) { this.setState('AWAIT_APPROVAL'); this.emit('Operator', 'info', `Arrived at casualty ${c.id}. Waiting for approval before any lift.`); }
  }

  doAwait() {
    const m = this.mission, c = m.casualty;
    const g = this.runGate({ type: 'load', casualty: c }, true);
    if (g.decision === 'ALLOW') { this.setState('PREP'); return; }
    if (g.decision === 'APPROVAL') this.requestApproval(g.role === 'medic' ? 'medic' : 'lift', c.id, g.role, g.reason);
    this.gateLog.push({ t: this.t, action: 'load', decision: g.decision, rule: g.rule, reason: g.reason });
    if (this.gateLog.length > 200) this.gateLog.shift();
    if (this.t % 4 === 0) this.gateLog.length = Math.max(0, this.gateLog.length - 1);
  }

  doPrep() {
    const m = this.mission, r = this.robot, c = m.casualty;
    if (this.scenario === 'water' && !r.flotationDeployed) {
      this.startAction('deploy_flotation', () => { r.flotationDeployed = true; this.emit('Operator', 'ok', 'Flotation deployed'); });
      return;
    }
    if (c.unclothed && !c.covered && this.gateOn) {
      this.runGate({ type: 'cover' });
      this.startAction('cover', () => { c.covered = true; r.blankets--; this.emit('Operator', 'ok', `Casualty ${c.id} covered with the onboard blanket before moving (dignity protocol: also reduces heat loss)`); });
      return;
    }
    this.startAction('load', () => {
      c.aboard = true; r.carrying = c; c.x = r.x; c.y = r.y; c.fx = r.x; c.fy = r.y;
      if (c.spinal && !this.approvals.has('medic:' + c.id)) this.violations.spinalMoved++;
      const measured = c.weightKg;
      const g = this.runGate({ type: 'start_carry', casualty: c, weightKgMeasured: measured });
      if (g.decision === 'BLOCK') {
        this.emit('Gate', 'block', `${g.rule}: ${g.reason}`);
        if (g.rule === 'R2_payload') {
          this.runGate({ type: 'set_down' });
          c.aboard = false; r.carrying = null;
          this.escalate(`Load sensor reads ${measured.toFixed(0)} kg (estimate was ${c.estimate.toFixed(0)} kg): over the ${this.params.maxSoloCasualtyKg} kg limit. Casualty set down safely, human team requested`);
        }
        return;
      }
      this.emit('Operator', 'ok', `Casualty ${c.id} loaded. Load sensor: ${measured.toFixed(0)} kg (estimate ${c.estimate.toFixed(0)} kg)`);
      m.path = []; this.setState('CARRY');
    });
    if (this.mission.state === 'PREP') this.mission.state = 'PREP_BUSY';
  }

  doCarry() {
    const m = this.mission, r = this.robot, c = m.casualty;
    if (this.isSafeZone(r.x, r.y)) {
      const g = this.runGate({ type: 'handoff' });
      if (g.decision === 'ALLOW') {
        c.aboard = false; r.carrying = null; c.delivered = true;
        this.emit('Operator', 'ok', `Casualty ${c.id} handed off inside the safe zone at (${r.x},${r.y}). Remaining battery ${r.battery.toFixed(1)}%`);
        if (this.multi) {
          this.requestApproval('dispatch', c.id, 'commander', `Alert medical and fire teams: ${c.id} handed off`);
          this.resetMission();
          const left = this.remaining().length;
          this.emit('Mission', 'ok', left ? `${this.casualties.filter((x) => x.delivered).length} delivered so far. Going back out to search for the next casualty.` : 'No casualties left to rescue.');
          this.checkAllDone();
        } else {
          this.finish('delivered', `Casualty ${c.id} delivered to a safe zone`);
          this.requestApproval('dispatch', 'incident', 'commander', 'Alert medical and fire teams with the handoff report');
          this.setState('DONE');
        }
      }
      return;
    }
    if (!m.path.length || this.t % 3 === 0) {
      const safeGoals = []; for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) if (this.isSafeZone(x, y) && this.passable(x, y)) safeGoals.push({ x, y });
      const pl = this.plan({ x: r.x, y: r.y }, safeGoals, { loaded: true });
      if (!pl) {
        m.noPath = (m.noPath ?? 0) + 1;
        if (m.noPath === 1) this.emit('Mission', 'warn', 'No safe carry route right now: holding and re-planning');
        if (this.multi && this.tempAt(r.x, r.y) > this.params.carryTempLimit * 0.8) { // do not wait inside the heat: retreat to the coolest reachable spot
          const cool = []; for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) { const gx = r.x + dx, gy = r.y + dy; if (this.inB(gx, gy) && this.passable(gx, gy) && this.tempAt(gx, gy) < this.params.carryTempLimit * 0.55) cool.push({ x: gx, y: gy }); }
          const rp = cool.length ? this.plan({ x: r.x, y: r.y }, cool, { loaded: true }) : null;
          if (rp) { m.path = rp.path.slice(1); this.follow(); return; }
        }
        if (m.noPath > 25) this.escalate('No safe carry route to a safe zone: human team requested while the unit holds the casualty in the safest spot');
        return;
      }
      if (m.noPath) { m.noPath = 0; }
      const before = m.path.length ? m.path[m.path.length - 1] : null;
      const after = pl.path[pl.path.length - 1];
      if (before && (before.x !== after.x || before.y !== after.y)) this.emit('Mission', 'info', `Re-planned carry route: now heading to exit at (${after.x},${after.y})`);
      m.path = pl.path.slice(1);
    }
    this.follow();
  }

  // ------------------------------------------------------------------ main step
  step() {
    if (this.outcome && this.mission.state !== 'DONE' && this.outcome.result !== 'delivered') { this.processApprovals(); this.t++; this.audit.append(this.t, 'System', 'tick', {}); return; }
    this.t++;
    this.leakageMa = 1.2 + (this.opts.leakageFaultAt && this.t >= this.opts.leakageFaultAt && this.t < this.opts.leakageFaultAt + 14 ? 8 : 0);
    for (const rp of this.sc.reports) if (rp.t === this.t) this.ingestReport(rp);
    this.stepWorld();
    this.robot.battery -= this.params.idleDrain;
    if (this.robot.battery <= 0 && !this.outcome) { this.robot.battery = 0; this.escalate('Battery exhausted: human team requested', 'escalated'); }
    this.processApprovals();
    const r = this.robot;
    if (r.busy > 0) { r.busy--; if (r.busy === 0) { const fn = r.onDone; r.onDone = null; r.busyAction = null; fn?.(); if (this.mission.state === 'PREP_BUSY') { if (!r.carrying && !this.outcome) this.mission.state = 'PREP'; } } }
    else {
      this.sense();
      this.updateCandidates();
      this.missionStep();
    }
    if (this.t >= MAX_T && !this.outcome) this.finish('timeout', 'Mission time limit reached');
  }

  run(maxT = MAX_T) { while (!this.outcome && this.t < maxT) this.step(); if (this.outcome?.result === 'delivered') for (let i = 0; i < 20 && this.pending.some((a) => a.status === 'pending'); i++) this.step(); return this.summary(); }

  summary() {
    const c = this.casualties[0];
    return {
      scenario: this.scenario, seed: this.opts.seed ?? 1, gateOn: this.gateOn, outcome: this.outcome?.result ?? 'running', reason: this.outcome?.reason ?? '',
      t: this.t, battery: +this.robot.battery.toFixed(2), startBattery: +this.startBattery.toFixed(2), harvested: +this.harvestedTotal.toFixed(2),
      weightKg: c.weightKg, age: c.age, unclothed: c.unclothed, covered: c.covered, spinal: c.spinal, health: +c.health.toFixed(1),
      gateStats: this.gateStats, harvestUsed: this.harvestUsed, humanApprovals: [...this.approvals], injection: this.injection, violations: { ...this.violations }, humanTeamRequested: this.humanTeamRequested,
      auditOk: this.audit.verify().ok,
      casualtyCount: this.casualties.length, delivered: this.casualties.filter((x) => x.delivered).length, referred: this.casualties.filter((x) => x.referred).length, died: this.casualties.filter((x) => !x.alive || x.lost).length,
    };
  }
}
