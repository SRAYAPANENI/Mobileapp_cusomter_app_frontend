// Before a customer hires a provider, the server doesn't send the provider's
// name (security: nobody can look them up, contact them outside the app, or
// find out who they are before they've been booked). These helpers decide
// what to show instead, so every screen says the same thing.

/** True when the server withheld this provider's name. */
export function isNameHidden(name?: string | null): boolean {
  return !name || !name.trim();
}

/** The heading for a provider: their name once hired, else their profession. */
export function providerTitle(name?: string | null, profession?: string | null): string {
  return isNameHidden(name) ? (profession?.trim() || 'Service provider') : name!.trim();
}

/** Short form for pins, chips and buttons: first name, else the profession. */
export function providerShortTitle(name?: string | null, profession?: string | null): string {
  return isNameHidden(name) ? (profession?.trim() || 'Provider') : name!.trim().split(' ')[0];
}

/** The letter for an avatar without a photo. */
export function providerInitial(name?: string | null, profession?: string | null): string {
  return (providerTitle(name, profession)[0] ?? '?').toUpperCase();
}

export const NAME_AFTER_HIRING = 'Name shared after hiring';
