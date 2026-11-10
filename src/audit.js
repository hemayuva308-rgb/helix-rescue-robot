// Hash-chained audit log: every entry commits to the previous one, so any later edit is detectable.
import { sha256 } from './util.js';

export class AuditLog {
  constructor() { this.entries = []; }
  append(t, actor, type, data = {}) {
    const prev = this.entries.length ? this.entries[this.entries.length - 1].hash : 'GENESIS';
    const body = JSON.stringify({ i: this.entries.length, t, actor, type, data, prev });
    const entry = { i: this.entries.length, t, actor, type, data, prev, hash: sha256(body) };
    this.entries.push(entry);
    return entry;
  }
  verify() { return verifyChain(this.entries); }
}

export function verifyChain(entries) {
  let prev = 'GENESIS';
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const body = JSON.stringify({ i: e.i, t: e.t, actor: e.actor, type: e.type, data: e.data, prev });
    if (e.prev !== prev || e.hash !== sha256(body) || e.i !== i) return { ok: false, brokenAt: i };
    prev = e.hash;
  }
  return { ok: true, length: entries.length };
}
