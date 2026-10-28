import { ThemedText } from '@/components/themed-text';
import { TextInput } from '@/components/scaled-text';
import { Fonts } from '@/constants/theme';
import {
  ANSWERS, Answer, CareSheet, DOG_SIZES, ITEM_SIZES, MAX_ITEMS, MAX_PETS, PET_KINDS, Pet, PetSheet, ItemSheet, newPet,
} from '@/services/care-sheet';
import { Minus, Plus, X } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, Switch, TouchableOpacity, View } from 'react-native';

interface Props {
  custody: string;
  value: CareSheet;
  onChange: (next: CareSheet) => void;
}

// "Tell them about your pet / item" — what the provider needs to look after
// it, under the where / how long / in care questions (services/care-sheet.ts).
// The vet and emergency contact only reach the provider you book.
export function CareSheetForm({ custody, value, onChange }: Props) {
  if (custody === 'LIVING_BEING') {
    return <PetForm sheet={value.pet} onChange={(pet) => onChange({ ...value, pet })} />;
  }
  if (custody === 'ITEM') {
    return <ItemForm sheet={value.item} onChange={(item) => onChange({ ...value, item })} />;
  }
  return null;
}

function Chips<T extends string>({ options, value, onPick }: {
  options: { value: T; label: string; hint?: string }[]; value: T | null; onPick: (v: T) => void;
}) {
  return (
    <View style={s.chips}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <TouchableOpacity key={o.value} style={[s.chip, on && s.chipOn]} onPress={() => onPick(o.value)}>
            <ThemedText style={[s.chipText, on && s.chipTextOn]}>{o.label}</ThemedText>
            {!!o.hint && <ThemedText style={s.chipHint}>{o.hint}</ThemedText>}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function Field({ label, value, onChange, placeholder, multiline, keyboardType }: {
  label: string; value: string; onChange: (t: string) => void; placeholder?: string; multiline?: boolean;
  keyboardType?: 'default' | 'phone-pad' | 'decimal-pad';
}) {
  return (
    <View style={{ gap: 4 }}>
      <ThemedText style={s.label}>{label}</ThemedText>
      <TextInput
        style={[s.input, multiline && { minHeight: 64, textAlignVertical: 'top' }]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#9CA3AF"
        multiline={multiline}
        keyboardType={keyboardType}
      />
    </View>
  );
}

function AnswerRow({ label, value, onPick }: { label: string; value: Answer | null; onPick: (a: Answer) => void }) {
  return (
    <View style={{ gap: 4 }}>
      <ThemedText style={s.label}>{label}</ThemedText>
      <Chips options={ANSWERS} value={value} onPick={onPick} />
    </View>
  );
}

function PetForm({ sheet, onChange }: { sheet: PetSheet; onChange: (next: PetSheet) => void }) {
  const setPet = (i: number, patch: Partial<Pet>) =>
    onChange({ ...sheet, pets: sheet.pets.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  return (
    <View style={s.wrap}>
      <ThemedText style={s.question}>Tell them about your pet</ThemedText>
      {sheet.pets.map((pet, i) => (
        <View key={i} style={s.card}>
          <View style={s.cardHead}>
            <ThemedText style={s.cardTitle}>{pet.name.trim() || (sheet.pets.length > 1 ? `Pet ${i + 1}` : 'Your pet')}</ThemedText>
            {sheet.pets.length > 1 && (
              <TouchableOpacity hitSlop={8} onPress={() => onChange({ ...sheet, pets: sheet.pets.filter((_, j) => j !== i) })}>
                <X size={18} color="#6B7280" />
              </TouchableOpacity>
            )}
          </View>
          <Chips options={PET_KINDS} value={pet.kind} onPick={(kind) => setPet(i, { kind })} />
          <Field label="Name" value={pet.name} onChange={(name) => setPet(i, { name })} placeholder="e.g. Rex" />
          <Field label="Breed (optional)" value={pet.breed} onChange={(breed) => setPet(i, { breed })} placeholder="e.g. Labrador" />
          {pet.kind === 'DOG' && (
            <View style={{ gap: 4 }}>
              <ThemedText style={s.label}>Size</ThemedText>
              <Chips options={DOG_SIZES} value={pet.size} onPick={(size) => setPet(i, { size })} />
            </View>
          )}
          <Field label="Age (optional)" value={pet.age} onChange={(age) => setPet(i, { age })} placeholder="e.g. 3 years" />
          <AnswerRow label="Vaccinations up to date?" value={pet.vaccinated} onPick={(vaccinated) => setPet(i, { vaccinated })} />
          <AnswerRow label="Spayed or neutered?" value={pet.spayed_neutered} onPick={(spayed_neutered) => setPet(i, { spayed_neutered })} />
          <AnswerRow label="Good with other dogs?" value={pet.good_with_dogs} onPick={(good_with_dogs) => setPet(i, { good_with_dogs })} />
          <AnswerRow label="Good with cats?" value={pet.good_with_cats} onPick={(good_with_cats) => setPet(i, { good_with_cats })} />
          <AnswerRow label="Good with children?" value={pet.good_with_kids} onPick={(good_with_kids) => setPet(i, { good_with_kids })} />
          <Field label="Anything else about them" value={pet.notes} onChange={(notes) => setPet(i, { notes })}
            placeholder="Habits, fears, what calms them…" multiline />
        </View>
      ))}
      {sheet.pets.length < MAX_PETS && (
        <TouchableOpacity style={s.add} onPress={() => onChange({ ...sheet, pets: [...sheet.pets, newPet()] })}>
          <Plus size={16} color="#111827" />
          <ThemedText style={s.addText}>Add another pet</ThemedText>
        </TouchableOpacity>
      )}

      <View style={s.card}>
        <ThemedText style={s.cardTitle}>Food</ThemedText>
        <Chips
          options={[{ value: 'OWNER' as const, label: "I'll bring it" }, { value: 'HOST' as const, label: 'Provider supplies it' }]}
          value={sheet.food.by}
          onPick={(by) => onChange({ ...sheet, food: { ...sheet.food, by } })}
        />
        <Field label="What they eat" value={sheet.food.what} onChange={(what) => onChange({ ...sheet, food: { ...sheet.food, what } })}
          placeholder="e.g. Dry food, 2 cups" />
        <Field label="When" value={sheet.food.schedule} onChange={(schedule) => onChange({ ...sheet, food: { ...sheet.food, schedule } })}
          placeholder="e.g. 8 am and 6 pm" />
      </View>

      <View style={s.card}>
        <ThemedText style={s.cardTitle}>Care</ThemedText>
        <Field label="Medicines (optional)" value={sheet.medication} onChange={(medication) => onChange({ ...sheet, medication })}
          placeholder="What, how much and when" multiline />
        <Field label="Walks and exercise (optional)" value={sheet.walks} onChange={(walks) => onChange({ ...sheet, walks })}
          placeholder="e.g. Twice a day, 30 minutes, on a leash" />
        <Field label="Anything else" value={sheet.notes} onChange={(notes) => onChange({ ...sheet, notes })}
          placeholder="House rules, toys, bedtime…" multiline />
      </View>

      <View style={s.card}>
        <ThemedText style={s.cardTitle}>If something happens</ThemedText>
        <ThemedText style={s.hint}>Only the provider you book sees these.</ThemedText>
        <Field label="Vet's name (optional)" value={sheet.vet.name} onChange={(name) => onChange({ ...sheet, vet: { ...sheet.vet, name } })} />
        <Field label="Vet's phone" value={sheet.vet.phone} onChange={(phone) => onChange({ ...sheet, vet: { ...sheet.vet, phone } })}
          keyboardType="phone-pad" />
        <Field label="Someone else to call if you can't be reached" value={sheet.emergency.name}
          onChange={(name) => onChange({ ...sheet, emergency: { ...sheet.emergency, name } })} placeholder="Name" />
        <Field label="Their phone" value={sheet.emergency.phone}
          onChange={(phone) => onChange({ ...sheet, emergency: { ...sheet.emergency, phone } })} keyboardType="phone-pad" />
      </View>
    </View>
  );
}

function ItemForm({ sheet, onChange }: { sheet: ItemSheet; onChange: (next: ItemSheet) => void }) {
  return (
    <View style={s.wrap}>
      <ThemedText style={s.question}>Tell them what you're leaving</ThemedText>
      <View style={s.card}>
        <Field label="What is it" value={sheet.what} onChange={(what) => onChange({ ...sheet, what })} placeholder="e.g. A bike, two suitcases" />
        <View style={s.stepRow}>
          <ThemedText style={[s.label, { flex: 1 }]}>How many</ThemedText>
          <TouchableOpacity style={s.step} onPress={() => onChange({ ...sheet, count: Math.max(1, sheet.count - 1) })}>
            <Minus size={16} color="#111827" />
          </TouchableOpacity>
          <ThemedText style={s.stepValue}>{sheet.count}</ThemedText>
          <TouchableOpacity style={s.step} onPress={() => onChange({ ...sheet, count: Math.min(MAX_ITEMS, sheet.count + 1) })}>
            <Plus size={16} color="#111827" />
          </TouchableOpacity>
        </View>
        <View style={{ gap: 4 }}>
          <ThemedText style={s.label}>How big</ThemedText>
          <Chips options={ITEM_SIZES} value={sheet.size} onPick={(size) => onChange({ ...sheet, size })} />
        </View>
        <Field label="What it's worth, $ (optional)" value={sheet.value} keyboardType="decimal-pad"
          onChange={(t) => onChange({ ...sheet, value: t.replace(/[^0-9.]/g, '') })} placeholder="e.g. 300" />
        <View style={s.stepRow}>
          <ThemedText style={[s.label, { flex: 1 }]}>Fragile</ThemedText>
          <Switch value={sheet.fragile} onValueChange={(fragile) => onChange({ ...sheet, fragile })}
            trackColor={{ false: '#D1D5DB', true: '#FFCE48' }} thumbColor="#fff" />
        </View>
        <Field label="Anything else" value={sheet.notes} onChange={(notes) => onChange({ ...sheet, notes })}
          placeholder="How to handle it, keys, where it goes…" multiline />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 10 },
  question: { fontSize: 14, lineHeight: 19, fontFamily: Fonts.poppinsSemiBold, color: '#111827', marginTop: 4 },
  card: { gap: 10, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#fff' },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 14, lineHeight: 19, fontFamily: Fonts.poppinsBold, color: '#111827' },
  label: { fontSize: 12.5, lineHeight: 17, fontFamily: Fonts.poppinsSemiBold, color: '#374151' },
  hint: { fontSize: 12, lineHeight: 17, fontFamily: Fonts.poppins, color: '#6B7280' },
  input: {
    borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, fontFamily: Fonts.poppins, color: '#111827', backgroundColor: '#F9FAFB',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 9, paddingHorizontal: 12,
    borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', backgroundColor: '#fff',
  },
  chipOn: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  chipText: { fontSize: 12.5, lineHeight: 17, fontFamily: Fonts.poppins, color: '#374151', textAlign: 'center' },
  chipTextOn: { color: '#111827', fontFamily: Fonts.poppinsBold },
  chipHint: { fontSize: 10.5, lineHeight: 14, fontFamily: Fonts.poppins, color: '#6B7280' },
  add: {
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 11,
    borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: '#D1D5DB',
  },
  addText: { fontSize: 13, lineHeight: 18, fontFamily: Fonts.poppinsSemiBold, color: '#111827' },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  step: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: '#E5E7EB', alignItems: 'center', justifyContent: 'center' },
  stepValue: { fontSize: 16, lineHeight: 21, fontFamily: Fonts.poppinsBold, color: '#111827', minWidth: 24, textAlign: 'center' },
});
