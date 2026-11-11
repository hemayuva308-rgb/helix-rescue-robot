// Operator voice and text commands: a tiny deterministic grammar (plain code, no model).
// Only four safe intents exist. Anything else is ignored and reported, so speech recognition errors or
// injected text can never make a unit do something outside this list.
const NEG = /\b(don'?t|do not|never|no need to|not)\b/i;
const RULES = [
  ['recall', /\b(come out|get out|come back|pull out|retreat|evacuate|abort( mission)?|leave( the area)?|exit|return( to (base|safe zone))?|back out)\b/i],
  ['hold', /\b(hold( position)?|stop|wait|freeze|stay (there|put))\b/i],
  ['resume', /\b(resume|continue|carry on|proceed|go on)\b/i],
  ['deploy', /\b(deploy|go in|start (the )?(search|mission|rescue)|begin|start)\b/i],
];

export function parseCommand(text) {
  const t = String(text ?? '').trim();
  if (!t) return { intent: 'unknown', text: t };
  for (const [intent, re] of RULES) {
    const m = t.match(re);
    if (m) {
      if (NEG.test(t.slice(0, m.index))) return { intent: 'unknown', text: t, reason: 'negated or unclear' };
      return { intent, text: t, matched: m[0] };
    }
  }
  return { intent: 'unknown', text: t };
}

export const REPLIES = {
  recall: 'Understood. Coming out. Units with a casualty will finish carrying them to the safe zone.',
  hold: 'Understood. Holding position.',
  resume: 'Understood. Resuming.',
  deploy: 'Understood. Deploying.',
  unknown: 'Command not understood. I only accept: come out, hold, resume, deploy.',
  nolink: 'Command not delivered: the operator link is down.',
};
