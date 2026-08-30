// Locked to light mode regardless of the device's system theme — most
// established apps do the same for launch rather than fully supporting
// dynamic dark mode. Every screen reads through this one hook, so this is
// the single place that needs to change to flip that back on later.
// Typed as the wider union (not the literal 'light') so every existing
// `=== 'dark'` comparison across the app still type-checks instead of
// TypeScript flagging them as impossible.
export function useColorScheme(): 'light' | 'dark' {
  return 'light';
}
