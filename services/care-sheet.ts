// What the customer tells the provider about what they leave in their care —
// each pet's needs, or the item — sent with the job's shape. The same rules
// as the server's (skofy-backend/app/domain/care_sheet.py), checked here so
// what's missing shows before posting.

export type PetKind = 'DOG' | 'CAT' | 'BIRD' | 'SMALL_PET' | 'REPTILE' | 'FISH' | 'OTHER';
export type DogSize = 'SMALL' | 'MEDIUM' | 'LARGE' | 'GIANT';
export type ItemSize = 'SMALL' | 'MEDIUM' | 'LARGE' | 'BULKY';
export type Answer = 'YES' | 'NO' | 'UNSURE';

export const PET_KINDS: { value: PetKind; label: string }[] = [
  { value: 'DOG', label: 'Dog' }, { value: 'CAT', label: 'Cat' }, { value: 'BIRD', label: 'Bird' },
  { value: 'SMALL_PET', label: 'Small pet' }, { value: 'REPTILE', label: 'Reptile' },
  { value: 'FISH', label: 'Fish' }, { value: 'OTHER', label: 'Other' },
];
export const DOG_SIZES: { value: DogSize; label: string; hint: string }[] = [
  { value: 'SMALL', label: 'Small', hint: 'under 22 lb' }, { value: 'MEDIUM', label: 'Medium', hint: '22–55 lb' },
  { value: 'LARGE', label: 'Large', hint: '55–100 lb' }, { value: 'GIANT', label: 'Giant', hint: 'over 100 lb' },
];
export const ITEM_SIZES: { value: ItemSize; label: string; hint: string }[] = [
  { value: 'SMALL', label: 'Small', hint: 'fits a bag' }, { value: 'MEDIUM', label: 'Medium', hint: 'a box' },
  { value: 'LARGE', label: 'Large', hint: 'a car trunk' }, { value: 'BULKY', label: 'Bulky', hint: 'needs a van' },
];
export const ANSWERS: { value: Answer; label: string }[] = [
  { value: 'YES', label: 'Yes' }, { value: 'NO', label: 'No' }, { value: 'UNSURE', label: 'Not sure' },
];

export interface Pet {
  kind: PetKind | null;
  name: string;
  breed: string;
  size: DogSize | null;
  age: string;
  vaccinated: Answer | null;
  spayed_neutered: Answer | null;
  good_with_dogs: Answer | null;
  good_with_cats: Answer | null;
  good_with_kids: Answer | null;
  notes: string;
}

export interface Contact { name: string; phone: string }

export interface PetSheet {
  pets: Pet[];
  food: { by: 'OWNER' | 'HOST' | null; what: string; schedule: string };
  medication: string;
  walks: string;
  vet: Contact;
  emergency: Contact;
  notes: string;
}

export interface ItemSheet {
  what: string;
  count: number;
  size: ItemSize | null;
  value: string;
  fragile: boolean;
  notes: string;
}

export interface CareSheet { pet: PetSheet; item: ItemSheet }

export const MAX_PETS = 6;
export const MAX_ITEMS = 50;
export const MAX_ITEM_VALUE = 100_000;

export const newPet = (): Pet => ({
  kind: null, name: '', breed: '', size: null, age: '', vaccinated: null, spayed_neutered: null,
  good_with_dogs: null, good_with_cats: null, good_with_kids: null, notes: '',
});

export const EMPTY_CARE_SHEET: CareSheet = {
  pet: { pets: [newPet()], food: { by: null, what: '', schedule: '' }, medication: '', walks: '', vet: { name: '', phone: '' }, emergency: { name: '', phone: '' }, notes: '' },
  item: { what: '', count: 1, size: null, value: '', fragile: false, notes: '' },
};

const PHONE = /^\+?[0-9 ()\-.]{7,20}$/;

/** What's still missing, in words fit to show — or null when it's complete. */
export function careSheetProblem(custody: string, sheet: CareSheet): string | null {
  if (custody === 'LIVING_BEING') {
    const { pets, food, vet, emergency } = sheet.pet;
    for (const [i, p] of pets.entries()) {
      const who = p.name.trim() || `pet ${i + 1}`;
      if (!p.kind) return `Choose what kind of animal ${who} is.`;
      if (!p.name.trim()) return `Add pet ${i + 1}'s name.`;
      if (p.kind === 'DOG' && !p.size) return `Choose ${who}'s size.`;
      if (!p.vaccinated) return `Say whether ${who}'s vaccinations are up to date.`;
    }
    if (!food.by) return 'Say who brings the food — you, or the provider.';
    for (const c of [vet, emergency]) {
      if (c.phone.trim() && !PHONE.test(c.phone.trim())) return `${c.phone.trim()} doesn't look like a phone number.`;
    }
    return null;
  }
  if (custody === 'ITEM') {
    const { what, count, size, value } = sheet.item;
    if (!what.trim()) return "Say what you're leaving.";
    if (count < 1 || count > MAX_ITEMS) return `Between 1 and ${MAX_ITEMS} items.`;
    if (!size) return 'Choose how big it is.';
    if (value.trim() && !(Number(value) >= 0)) return "Enter what it's worth in dollars, like 200.";
    if (Number(value) > MAX_ITEM_VALUE) return `What it's worth can be up to $${MAX_ITEM_VALUE.toLocaleString()}.`;
    return null;
  }
  return null;
}

const trimmed = (o: object): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== '' && v !== undefined)
    .map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));

/** What to send for this custody (the server tidies it again). */
export function careSheetPayload(custody: string, sheet: CareSheet): Record<string, unknown> | undefined {
  if (custody === 'LIVING_BEING') {
    const { pets, food, medication, walks, vet, emergency, notes } = sheet.pet;
    return trimmed({
      pets: pets.map((p) => trimmed({ ...p, size: p.kind === 'DOG' ? p.size : null })),
      food: trimmed(food), medication, walks, notes,
      vet: (vet.name.trim() || vet.phone.trim()) ? trimmed(vet) : null,
      emergency: (emergency.name.trim() || emergency.phone.trim()) ? trimmed(emergency) : null,
    });
  }
  if (custody === 'ITEM') {
    const { what, count, size, value, fragile, notes } = sheet.item;
    return trimmed({ what, count, size, value: value.trim() ? Number(value) : null, fragile, notes });
  }
  return undefined;
}
