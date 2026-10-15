import { Text, TextInput } from '@/components/scaled-text';
import { Fonts } from '@/constants/theme';
import {
  IF_UNAVAILABLE_LABELS, IfUnavailable, MAX_SHOPPING_ITEMS, ShoppingItem, newShoppingItem,
} from '@/services/pickupOptions';
import { Minus, Plus, X } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

interface Props {
  items: ShoppingItem[];
  onChange: (items: ShoppingItem[]) => void;
  editable: boolean;
}

const CHOICES = Object.keys(IF_UNAVAILABLE_LABELS) as IfUnavailable[];

// Buy it for me: what to buy, how many, and what to do if it's out of stock.
// Controlled — the list's rules are in services/pickupOptions.ts.
export function ShoppingListEditor({ items, onChange, editable }: Props) {
  const update = (i: number, patch: Partial<ShoppingItem>) =>
    onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const remove = (i: number) => onChange(items.length > 1 ? items.filter((_, j) => j !== i) : [newShoppingItem()]);

  return (
    <View style={s.wrap}>
      <Text style={s.label}>Shopping list</Text>
      {items.map((item, i) => (
        <View key={i} style={s.row}>
          <View style={s.topLine}>
            <TextInput
              style={s.name}
              value={item.name}
              onChangeText={t => update(i, { name: t })}
              placeholder={i === 0 ? 'e.g. Whole milk, 1 gallon' : 'Another item'}
              placeholderTextColor="#9CA3AF"
              maxLength={120}
              editable={editable}
            />
            <View style={s.stepper}>
              <TouchableOpacity
                disabled={!editable || item.quantity <= 1}
                onPress={() => update(i, { quantity: item.quantity - 1 })}
                hitSlop={8}
                accessibilityLabel="Fewer"
              >
                <Minus size={14} color={item.quantity <= 1 ? '#D1D5DB' : '#374151'} />
              </TouchableOpacity>
              <Text style={s.qty}>{item.quantity}</Text>
              <TouchableOpacity
                disabled={!editable || item.quantity >= 99}
                onPress={() => update(i, { quantity: item.quantity + 1 })}
                hitSlop={8}
                accessibilityLabel="More"
              >
                <Plus size={14} color="#374151" />
              </TouchableOpacity>
            </View>
            <TouchableOpacity disabled={!editable} onPress={() => remove(i)} hitSlop={8} accessibilityLabel="Remove item">
              <X size={16} color="#9CA3AF" />
            </TouchableOpacity>
          </View>
          <View style={s.choices}>
            <Text style={s.ifOut}>If it's out:</Text>
            {CHOICES.map(c => (
              <TouchableOpacity
                key={c}
                disabled={!editable}
                style={[s.choice, item.if_unavailable === c && s.choiceOn]}
                onPress={() => update(i, { if_unavailable: c })}
              >
                <Text style={[s.choiceText, item.if_unavailable === c && s.choiceTextOn]}>{IF_UNAVAILABLE_LABELS[c]}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}
      {items.length < MAX_SHOPPING_ITEMS && (
        <TouchableOpacity disabled={!editable} style={s.add} onPress={() => onChange([...items, newShoppingItem()])}>
          <Plus size={14} color="#111827" />
          <Text style={s.addText}>Add item</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 8 },
  label: { fontSize: 13, lineHeight: 18, fontFamily: Fonts.poppinsSemiBold, color: '#374151', marginTop: 4 },
  row: { borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 12, padding: 8, gap: 6 },
  topLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontSize: 13.5, fontFamily: Fonts.poppins, color: '#111827', paddingVertical: 4 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F3F4F6', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  qty: { minWidth: 16, textAlign: 'center', fontSize: 13, fontFamily: Fonts.poppinsSemiBold, color: '#111827' },
  choices: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5 },
  ifOut: { fontSize: 11.5, lineHeight: 15, fontFamily: Fonts.poppins, color: '#6B7280' },
  choice: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1, borderColor: '#E5E7EB' },
  choiceOn: { backgroundColor: '#FFCE48', borderColor: '#FFCE48' },
  choiceText: { fontSize: 11.5, lineHeight: 15, fontFamily: Fonts.poppins, color: '#374151' },
  choiceTextOn: { fontFamily: Fonts.poppinsSemiBold, color: '#111827' },
  add: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: '#E5E7EB', borderStyle: 'dashed' },
  addText: { fontSize: 12.5, lineHeight: 17, fontFamily: Fonts.poppinsSemiBold, color: '#111827' },
});
