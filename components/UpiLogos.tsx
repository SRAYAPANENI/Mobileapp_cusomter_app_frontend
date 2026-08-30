/**
 * UpiLogos.tsx
 * Renders real app icons (PNGs) for UPI apps and wallets.
 * Images are located in assets/images/payment/.
 */
import React from 'react';
import { Image, ImageStyle, StyleProp } from 'react-native';

const SIZE = 44;

interface LogoProps {
  size?: number;
  style?: StyleProp<ImageStyle>;
}

function RemoteLogo({ source, size = SIZE, style }: { source: any } & LogoProps) {
  return (
    <Image
      source={source}
      style={[
        {
          width: size,
          height: size,
          resizeMode: 'contain',
        },
        style,
      ]}
    />
  );
}

// ─── PhonePe ──────────────────────────────────────────────────────────────────
export function PhonePeLogo(props: LogoProps) {
  return <RemoteLogo source={require('../assets/images/payment/phonepe.png')} {...props} />;
}

// ─── Google Pay ───────────────────────────────────────────────────────────────
export function GPayLogo(props: LogoProps) {
  return <RemoteLogo source={require('../assets/images/payment/gpay.png')} {...props} />;
}

// ─── Paytm ────────────────────────────────────────────────────────────────────
export function PaytmLogo(props: LogoProps) {
  return <RemoteLogo source={require('../assets/images/payment/paytm.png')} {...props} />;
}

// ─── BHIM ─────────────────────────────────────────────────────────────────────
export function BhimLogo(props: LogoProps) {
  return <RemoteLogo source={require('../assets/images/payment/bhim.png')} {...props} />;
}

// ─── Amazon Pay ───────────────────────────────────────────────────────────────
export function AmazonPayLogo(props: LogoProps) {
  return <RemoteLogo source={require('../assets/images/payment/amazonpay.png')} {...props} />;
}

// ─── MobiKwik ─────────────────────────────────────────────────────────────────
export function MobiKwikLogo(props: LogoProps) {
  return <RemoteLogo source={require('../assets/images/payment/mobikwik.png')} {...props} />;
}

// ─── FreeCharge ───────────────────────────────────────────────────────────────
export function FreeChargeLogo(props: LogoProps) {
  return <RemoteLogo source={require('../assets/images/payment/freecharge.png')} {...props} />;
}
