import React from 'react';
import {
  Baby, Bike, Briefcase, Bug, Camera, Car, Cctv, ChefHat, Dog, Droplets, Dumbbell, Fan,
  GraduationCap, Hammer, HardHat, Key, Laptop, Lightbulb, LucideIcon, Music, Package,
  PaintRoller, Palette, Scissors, Shirt, Snowflake, Sofa, Sparkles, Stethoscope, Trees,
  Truck, WashingMachine, Wrench, Zap,
} from 'lucide-react-native';

// A provider without a photo — and, before hiring, without a name — shows
// an icon for their trade instead of a bare letter. First match wins, so the
// more specific words come first ("water purifier" before "water").
const TRADE_ICONS: [string[], LucideIcon][] = [
  [['cctv', 'security', 'camera install'], Cctv],
  [['ac ', 'ac technician', 'air condition', 'refrigerat', 'hvac', 'fridge'], Snowflake],
  [['purifier', 'ro ', 'plumb', 'water', 'pipe', 'tank'], Droplets],
  [['electric', 'wiring', 'inverter', 'solar'], Zap],
  [['appliance', 'washing', 'microwave', 'geyser', 'chimney'], WashingMachine],
  [['clean', 'maid', 'housekeep', 'sanitiz', 'janitor'], Sparkles],
  [['pest', 'termite', 'fumigat'], Bug],
  [['carpent', 'furniture', 'wood'], Hammer],
  [['sofa', 'upholster', 'curtain'], Sofa],
  [['paint', 'wall', 'waterproof'], PaintRoller],
  [['salon', 'beaut', 'hair', 'barber', 'makeup', 'spa', 'grooming', 'nail'], Scissors],
  [['tutor', 'teach', 'coach', 'lesson', 'exam'], GraduationCap],
  [['design', 'artist', 'illustrat'], Palette],
  [['photo', 'video'], Camera],
  [['car', 'mechanic', 'auto', 'vehicle', 'tyre'], Car],
  [['bike', 'cycle'], Bike],
  [['pickup', 'drop', 'deliver', 'courier', 'errand'], Package],
  [['mov', 'packer', 'shift', 'truck'], Truck],
  [['garden', 'lawn', 'landscap', 'tree'], Trees],
  [['pet', 'dog', 'vet'], Dog],
  [['fan', 'ventilat'], Fan],
  [['light', 'lamp'], Lightbulb],
  [['lock', 'key'], Key],
  [['cook', 'chef', 'cater', 'baker'], ChefHat],
  [['laundry', 'iron', 'tailor', 'stitch', 'dry clean'], Shirt],
  [['computer', 'laptop', 'it ', 'software', 'developer', 'web', 'mobile repair', 'phone repair'], Laptop],
  [['fitness', 'trainer', 'yoga', 'gym'], Dumbbell],
  [['music', 'guitar', 'piano', 'dj'], Music],
  [['nurse', 'care', 'physio', 'doctor', 'elder'], Stethoscope],
  [['baby', 'nanny', 'child'], Baby],
  [['mason', 'construct', 'civil', 'tile', 'renovat', 'contractor'], HardHat],
  [['consult', 'account', 'legal', 'tax'], Briefcase],
];

export function iconForProfession(profession?: string | null): LucideIcon {
  const p = ` ${(profession ?? '').toLowerCase()} `;
  for (const [words, Icon] of TRADE_ICONS) {
    if (words.some(w => p.includes(w))) return Icon;
  }
  return Wrench;
}

export function ProfessionIcon({ profession, size = 20, color = '#fff' }: {
  profession?: string | null; size?: number; color?: string;
}) {
  const Icon = iconForProfession(profession);
  return <Icon size={size} color={color} strokeWidth={2.2} />;
}
