// Every cached read's key, in one place (docs/APP_DATA_ARCHITECTURE.md):
// a write refreshes by these (services/queries/invalidate.ts).
export const qk = {
  customer: {
    all: ['customer'] as const,
    profile: ['customer', 'profile'] as const,
    addresses: ['customer', 'addresses'] as const,
  },
  jobs: {
    all: ['jobs'] as const,
    active: ['jobs', 'active'] as const,
  },
};
