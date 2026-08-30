import {
  AlertCircle,
  Bug,
  Car,
  CloudSnow,
  Droplet,
  Snowflake,
  Zap,
} from 'lucide-react-native';
import React from 'react';

// "Super Fast" quick-need types — shown as tiles directly in the home
// screen's Explore Services row (not a separate picker screen) and posted
// via QuickNeedModal. Title/description/skill are all predefined here; the
// only thing the customer supplies is location (and optionally a photo/
// note) — see quick-need-modal.tsx. profession/skillName must match a real
// seeded skill row (skofy-backend/scripts/seed_skills.py) — resolved to a
// live skill_id at tap time via GET /skills?profession=X, the same lookup
// step2.tsx already uses for manually-chosen skills.
export interface QuickNeed {
  id: string;
  label: string;
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  profession: string;
  skillName: string;
  title: string;
  description: string;
}

export const QUICK_NEEDS: QuickNeed[] = [
  {
    id: 'flat_tire', label: 'Flat Tire', Icon: Car,
    profession: 'Vehicle Mechanic', skillName: 'Puncture Repair',
    title: 'Flat tire — need roadside help',
    description: "My tire is flat and I need it repaired or replaced as soon as possible.",
  },
  {
    id: 'power_outage', label: 'Power Outage', Icon: Zap,
    profession: 'Electrician', skillName: 'Short Circuit Fix',
    title: 'Power outage / electrical emergency',
    description: "The power has gone out or there's an electrical fault at my home that needs urgent attention.",
  },
  {
    id: 'burst_pipe', label: 'Burst Pipe / Leak', Icon: Droplet,
    profession: 'Plumber', skillName: 'Pipe Leak Fix',
    title: 'Burst pipe / water leak',
    description: "There's a water leak or burst pipe at my home that needs to be fixed urgently.",
  },
  {
    id: 'ac_emergency', label: 'AC Not Cooling', Icon: Snowflake,
    profession: 'AC Technician', skillName: 'Cooling Fix',
    title: 'AC not cooling — urgent',
    description: "My AC has stopped cooling and needs urgent repair.",
  },
  {
    id: 'snow_removal', label: 'Snow & Ice Removal', Icon: CloudSnow,
    profession: 'Snow & Ice Removal', skillName: 'Driveway Snow Plowing',
    title: 'Snow / ice removal needed',
    description: "I need snow or ice cleared from my driveway or walkway as soon as possible.",
  },
  {
    id: 'pest_emergency', label: 'Pest Emergency', Icon: Bug,
    profession: 'Pest Control', skillName: 'Rodent Control',
    title: 'Pest emergency',
    description: "I have an urgent pest issue at home that needs immediate attention.",
  },
  {
    id: 'appliance_emergency', label: 'Appliance Emergency', Icon: AlertCircle,
    profession: 'Appliance Repair', skillName: 'Refrigerator Repair',
    title: 'Appliance emergency',
    description: "An essential appliance has stopped working and I need urgent repair.",
  },
];
