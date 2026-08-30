// Locked to light mode regardless of the device's system theme — see
// use-color-scheme.ts (the native counterpart) for why.
export function useColorScheme(): 'light' | 'dark' {
  return 'light';
}
