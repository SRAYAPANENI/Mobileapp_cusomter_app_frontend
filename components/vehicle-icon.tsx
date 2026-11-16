import { Bus, Car, CarFront, Truck, Van } from 'lucide-react-native';
import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

// One icon per kind of vehicle (skofy-backend app/domain/vehicles.py
// VehicleType). Lucide has no pickup truck, so it's drawn here on the same
// 24-unit grid and 2-unit rounded stroke as the rest, to sit beside them.
// The provider app keeps an identical copy (components/vehicles/vehicle-icon.tsx).

export type VehicleKind = 'CAR' | 'SUV' | 'MINIVAN' | 'PICKUP_TRUCK' | 'CARGO_VAN' | 'BOX_TRUCK';

interface IconProps { size?: number; color?: string; strokeWidth?: number }

export function PickupTruckIcon({ size = 24, color = '#111827', strokeWidth = 2 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round">
      {/* The open bed, then the cab with its window. */}
      <Path d="M5 17H3a1 1 0 0 1-1-1v-4h10V8h5.5L21 12v4a1 1 0 0 1-1 1h-1" />
      <Path d="M14 8v4h6" />
      <Path d="M9 17h6" />
      <Circle cx={7} cy={17} r={2} />
      <Circle cx={17} cy={17} r={2} />
    </Svg>
  );
}

const ICONS: Record<VehicleKind, React.ComponentType<IconProps>> = {
  CAR: Car,
  SUV: CarFront,
  MINIVAN: Bus,
  PICKUP_TRUCK: PickupTruckIcon,
  CARGO_VAN: Van,
  BOX_TRUCK: Truck,
};

/** The icon for a kind of vehicle — a plain car for anything unknown. */
export function VehicleIcon({ type, ...props }: IconProps & { type: string | null | undefined }) {
  const Icon = ICONS[type as VehicleKind] ?? Car;
  return <Icon {...props} />;
}
