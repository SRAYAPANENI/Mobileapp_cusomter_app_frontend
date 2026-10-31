import { useQuery } from '@tanstack/react-query';
import { SkoFyApi } from '@/services/api';
import { qk } from './keys';

// The customer's own data: profile and saved addresses — read by Home, the
// bottom bar and more, now fetched once and shared between them.

export function useCustomerProfile() {
  return useQuery({ queryKey: qk.customer.profile, queryFn: () => SkoFyApi.customers.getProfile() });
}

export type SavedAddress = { id: string; label: string; full_address: string; lat?: number; lng?: number };

export function useSavedAddresses() {
  return useQuery({
    queryKey: qk.customer.addresses,
    queryFn: async (): Promise<SavedAddress[]> => ((await SkoFyApi.addresses.list()) as any[] ?? []).map((a: any) => ({
      id: a.id, label: a.label, full_address: a.full_address,
      lat: a.lat ?? undefined, lng: a.lng ?? undefined,
    })),
  });
}

/** Jobs not yet finished (the dashboard's list). */
export function useActiveJobs() {
  return useQuery({ queryKey: qk.jobs.active, queryFn: () => SkoFyApi.dashboard.getActiveJobs() as Promise<any[]> });
}
