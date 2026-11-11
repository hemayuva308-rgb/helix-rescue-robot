// Browser side of the optional advisory language model (see src/llm.js). Never required: every call has an offline answer.
import { templateBrief, templateReport } from '/src/llm.js';
import { parseCommand } from '/src/command.js';

export async function askAi(task, data) {
  try {
    const r = await fetch('/api/llm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task, data }) });
    if (!r.ok) throw new Error('status ' + r.status);
    return await r.json();
  } catch (e) {
    if (task === 'brief') return { mode: 'template', text: templateBrief(data) };
    if (task === 'report') return { mode: 'template', text: templateReport(data) };
    const g = parseCommand(String(data?.text ?? '')).intent;
    return { mode: 'grammar', intent: g === 'unknown' ? 'none' : g, reason: 'offline' };
  }
}
