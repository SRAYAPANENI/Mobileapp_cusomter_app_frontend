// The "Select Profession" search while posting a job. People often type the
// work they need ("appointment companion", "leak repair") rather than the
// profession it sits under, so skills are searched too: a skill's match brings
// up its profession, with the skill shown under it.

export interface CatalogSkill { id: string; name: string; profession: string }

export interface ProfessionMatch {
  profession: string;
  /** The skills that matched — empty when the profession's own name did. */
  skills: { id: string; name: string }[];
}

/** How many matched skills are named under a profession before "and N more". */
export const SKILLS_SHOWN = 2;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Professions for `query`: every profession when it's empty; otherwise those
 * whose name matches first, then those reached through a matching skill. */
export function searchProfessions(query: string, professions: string[], skills: CatalogSkill[]): ProfessionMatch[] {
  const q = norm(query);
  if (!q) return professions.map((profession) => ({ profession, skills: [] }));

  const byName = professions.filter((p) => norm(p).includes(q));
  const named = new Set(byName);
  const bySkill = new Map<string, { id: string; name: string }[]>();
  for (const s of skills) {
    if (named.has(s.profession) || !norm(s.name).includes(q)) continue;
    const list = bySkill.get(s.profession) ?? [];
    list.push({ id: s.id, name: s.name });
    bySkill.set(s.profession, list);
  }
  return [
    ...byName.map((profession) => ({ profession, skills: [] })),
    ...[...bySkill.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([profession, matched]) => ({ profession, skills: matched })),
  ];
}
