// A person's name in parts — first, middle (optional), last — as the server
// keeps it (backend app/domain/contact.py), with the full name built from them.

export interface NameParts {
  first: string;
  middle: string;
  last: string;
}

export const NAME_PART_MAX = 60;

export function fullName({ first, middle, last }: NameParts): string {
  return [first, middle, last].map((p) => p.trim()).filter(Boolean).join(' ');
}

/** What the profile endpoints take: the parts, and the full name for older servers. */
export function namePayload(parts: NameParts) {
  return {
    name: fullName(parts),
    first_name: parts.first.trim(),
    middle_name: parts.middle.trim(),
    last_name: parts.last.trim(),
  };
}

/** First and last given — the middle one is optional. */
export const hasFullName = ({ first, last }: NameParts) => !!first.trim() && !!last.trim();
