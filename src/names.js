// Display names for the units. The simulation keeps the ids A, B, C; people see these names.
export const UNIT_NAMES = { A: 'Atlas', B: 'Bolt', C: 'Cinder' };
export const unitName = (id) => UNIT_NAMES[id] ?? `Unit ${id}`;
// "Unit A", "unit B" and "units A and B" in any text become the names.
export function humanize(text) {
  return String(text ?? '')
    .replace(/\b[Uu]nits ([ABC]) and ([ABC])\b/g, (m, a, b) => `${unitName(a)} and ${unitName(b)}`)
    .replace(/\b[Uu]nit ([ABC])\b/g, (m, id) => unitName(id));
}
