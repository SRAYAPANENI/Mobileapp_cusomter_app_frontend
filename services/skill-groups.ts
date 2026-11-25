import { JobSkill, SkillPricing, Where, formPricing, notBookable } from './job-shape';

// Which chosen skills can share one job — the server's rules
// (skofy-backend/app/domain/skill_groups.py; keep the two alike, the server
// refuses anything else):
//   - priced the same way: set prices add up, time is charged at the highest;
//   - a quoted skill with set-price ones: the provider quotes the whole job;
//   - and at least one place all of them are done.
// Anything else is a job of its own: posted together, booked separately.

export interface SkillGroup {
  /** Its first skill's id: what its answers are kept under. */
  key: string;
  skills: JobSkill[];
  /** As the server names it. */
  pricing: string | null;
  places: Where[];
}

const CODE: Record<string, Where> = { C: 'MY_PLACE', P: 'THEIR_PLACE', O: 'ONLINE', R: 'MY_PLACE' };
const ANYWHERE: Where[] = ['MY_PLACE', 'THEIR_PLACE', 'ONLINE'];
const elsewhere = (places: Where[]) => places.filter((p) => p !== 'THEIR_PLACE');

function placesOf(skill: JobSkill, hosting: boolean): Where[] {
  const done = [...new Set((skill.venues ?? '').split(',').map((c) => CODE[c.trim()]).filter(Boolean))];
  const places = done.length ? done : ANYWHERE;
  // Hosting off: their place isn't a choice, unless it's the only one (which is explained).
  return !hosting && elsewhere(places).length ? elsewhere(places) : places;
}

/** A quote is given after seeing the job, so never at the provider's place. */
const bookable = (pricing: string | null, places: Where[]) =>
  (pricing === 'QUOTE' ? elsewhere(places) : places).length > 0;

function pricingOfBoth(a: string | null, b: string | null): { pricing: string | null } | null {
  if (a === b || b === null) return { pricing: a };
  if (a === null) return { pricing: b };
  return [a, b].sort().join() === 'QUOTE,VISIT' ? { pricing: 'QUOTE' } : null;
}

function join(group: SkillGroup, skill: JobSkill, places: Where[]): SkillGroup | null {
  const both = pricingOfBoth(group.pricing, skill.pricing);
  if (!both) return null;
  const shared = group.places.filter((p) => places.includes(p));
  if (!shared.length) return null;
  if (!bookable(both.pricing, shared) && (bookable(group.pricing, group.places) || bookable(skill.pricing, places))) return null;
  return { ...group, skills: [...group.skills, skill], pricing: both.pricing, places: shared };
}

/** The jobs these skills make, in the order they were chosen. */
export function groupSkills(skills: JobSkill[], hosting = true): SkillGroup[] {
  const groups: SkillGroup[] = [];
  for (const skill of skills) {
    const places = placesOf(skill, hosting);
    const at = groups.findIndex((g) => join(g, skill, places) !== null);
    if (at >= 0) groups[at] = join(groups[at], skill, places)!;
    else groups.push({ key: skill.id, skills: [skill], pricing: skill.pricing, places });
  }
  return groups;
}

const WHERE_CODE: Record<Where, string> = { MY_PLACE: 'C', THEIR_PLACE: 'P', ONLINE: 'O' };

/** What the form asks by (services/job-shape.ts). */
export const groupPricing = (g: SkillGroup): SkillPricing | null => formPricing(g.pricing);
export const groupVenues = (g: SkillGroup): string | null => (
  g.skills.every((s) => !s.venues) ? null : g.places.map((p) => WHERE_CODE[p]).join(','));
export const groupNotBookable = (g: SkillGroup, hosting: boolean) => notBookable(g.pricing, groupVenues(g), hosting);

export const groupName = (g: SkillGroup) => g.skills.map((s) => s.name).join(', ');

/** How one job's price is made up, when it has several skills. */
export function groupPriceNote(g: SkillGroup): string | null {
  if (g.skills.length < 2) return null;
  switch (g.pricing) {
    case 'QUOTE': return g.skills.some((s) => s.pricing === 'VISIT') ? 'One quote covers everything here.' : null;
    case 'VISIT': return 'Each skill’s price is added up. Only providers who do all of these can take it.';
    case 'HOUR': case 'DAY': case 'NIGHT':
      return 'Charged once, at the provider’s highest price among these. Only providers who do all of these can take it.';
    default: return null;
  }
}
