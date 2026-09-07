/**
 * SkoFy Customer App — API Client
 *
 * Real HTTP calls to the FastAPI backend.
 * - Tokens stored securely via expo-secure-store
 * - Bearer token auto-attached to every authenticated request
 * - Auto-refreshes access token on 401
 * - Consistent error format matches backend: { success, error_code, message }
 *
 * BASE_URL:
 *   Local dev on emulator  → http://10.0.2.2:8000/v1   (Android emulator localhost)
 *   Local dev on simulator → http://localhost:8000/v1   (iOS simulator)
 *   Physical device        → http://<YOUR_LAN_IP>:8000/v1  ← update DEV_LAN_IP below
 *   Production             → https://api.skofy.com/v1
 */

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// ─── CONFIG ─────────────────────────────────────────────────────────────────
const DEV_LAN_IP = '192.168.1.6'; // Your machine's LAN IP for physical device testing

// const DEV_URL = `http://${DEV_LAN_IP}:8000/v1`;

// TEMPORARY ngrok tunnel — lets the release APK reach the local backend over
// mobile data/any network, not just the same WiFi as DEV_LAN_IP. Free-tier
// ngrok URLs are NOT stable: every time the tunnel restarts (PC reboot, ngrok
// crash, etc.) this changes and both apps need a fresh release build with the
// new URL pasted in here. Switch to a real deployed backend domain (and the
// __DEV__ check, see git history) once one exists.
// Previous account's URL — hit its monthly bandwidth cap (ERR_NGROK_725):
// const NGROK_URL = 'https://lavender-strife-monopoly.ngrok-free.dev/v1';
const NGROK_URL = 'https://underrate-snowfield-chemist.ngrok-free.dev/v1';
export const BASE_URL = NGROK_URL;
if (__DEV__) console.log('[SkoFyApi] BASE_URL:', BASE_URL, '__DEV__:', __DEV__);

// Publishable keys are safe to ship in client code (unlike the secret key,
// which only ever lives in the backend's STRIPE_SECRET_KEY) — same
// same-file-constant convention as BASE_URL above. Replace with the real
// key from the Stripe dashboard (test mode: pk_test_...) before testing
// payments end-to-end.
export const STRIPE_PUBLISHABLE_KEY = 'pk_test_51TvsauRyqsQEDt0RCd5L6d51XipE7Ho1736WFkgfx3Qc2XgyDHkSMekLyCphMszlUpZhO9gaH6b5QVujtIdB24Yv00k8dcwdlg';

// ─── TOKEN STORAGE ───────────────────────────────────────────────────────────
const TOKEN_KEY = 'skofy_access_token';
const REFRESH_KEY = 'skofy_refresh_token';
const USER_KEY = 'skofy_user';

export const TokenStore = {
  async setTokens(access: string, refresh: string) {
    await SecureStore.setItemAsync(TOKEN_KEY, access);
    await SecureStore.setItemAsync(REFRESH_KEY, refresh);
  },
  async getAccessToken(): Promise<string | null> {
    return SecureStore.getItemAsync(TOKEN_KEY);
  },
  async getRefreshToken(): Promise<string | null> {
    return SecureStore.getItemAsync(REFRESH_KEY);
  },
  async setUser(user: AuthUser) {
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
  },
  async getUser(): Promise<AuthUser | null> {
    const raw = await SecureStore.getItemAsync(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  },
  async clear() {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(REFRESH_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
  },
};

// ─── TYPES ───────────────────────────────────────────────────────────────────
export interface AuthUser {
  user_id: string;
  role: 'customer' | 'provider';
  is_new_user: boolean;
  // True whenever this phone's Customer profile was just created — true for
  // a brand-new account, but ALSO true for an existing account (registered
  // as a Provider) that's now getting a Customer profile added for the
  // first time (dual-role support, same identity/phone). Screens deciding
  // whether to route into profile-completion should key off this, not
  // is_new_user — is_new_user alone can't distinguish those two cases.
  is_new_role: boolean;
  profile_complete: boolean;
}

export interface ApiError {
  success: false;
  error_code: string;
  message: string;
  details: Record<string, any>;
}

// ─── CORE REQUEST ────────────────────────────────────────────────────────────
let isRefreshing = false;
let refreshPromise: Promise<string | null> | null = null;
let _onSessionExpired: (() => void) | null = null;

export function setSessionExpiredHandler(fn: () => void): void {
  _onSessionExpired = fn;
}

async function request<T = any>(
  endpoint: string,
  options: RequestInit & { skipAuth?: boolean } = {}
): Promise<T> {
  const { skipAuth = false, ...fetchOptions } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
    ...((fetchOptions.headers as Record<string, string>) || {}),
  };

  if (!skipAuth) {
    const token = await TokenStore.getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const fullUrl = `${BASE_URL}${endpoint}`;
  if (__DEV__) console.log('[fetch]', fetchOptions.method || 'GET', fullUrl);
  let response: Response;
  try {
    response = await fetch(fullUrl, { ...fetchOptions, headers });
    if (__DEV__) console.log('[fetch RESPONSE]', response.status, fullUrl);
  } catch (networkErr: any) {
    if (__DEV__) console.error('[fetch ERROR]', fullUrl, networkErr?.message ?? networkErr);
    throw networkErr;
  }

  // Auto-refresh on 401
  if (response.status === 401 && !skipAuth) {
    const newToken = await _refreshAccessToken();
    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`;
      const retried = await fetch(`${BASE_URL}${endpoint}`, { ...fetchOptions, headers });
      return _parseResponse<T>(retried);
    }
    // Refresh failed → clear tokens and force back to login
    await TokenStore.clear();
    _onSessionExpired?.();
    throw { success: false, error_code: 'SESSION_EXPIRED', message: 'Please log in again.' } as ApiError;
  }

  return _parseResponse<T>(response);
}

async function _parseResponse<T>(response: Response): Promise<T> {
  const json = await response.json();
  if (!response.ok) {
    throw json as ApiError;
  }
  // Backend wraps all responses in { success: true, data: ... }
  return json.data !== undefined ? json.data : json;
}

async function _refreshAccessToken(): Promise<string | null> {
  if (isRefreshing) return refreshPromise;
  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const refreshToken = await TokenStore.getRefreshToken();
      if (!refreshToken) return null;
      const response = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!response.ok) return null;
      const json = await response.json();
      const newToken: string = json.data?.access_token;
      if (newToken) {
        await SecureStore.setItemAsync(TOKEN_KEY, newToken);
      }
      return newToken ?? null;
    } catch {
      return null;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

// ─── API SURFACE ─────────────────────────────────────────────────────────────
export const SkoFyApi = {

  // ── Auth ──────────────────────────────────────────────────────────────────
  auth: {
    /**
     * Send OTP to phone number.
     * In dev mode (OTP_MOCK_MODE=true on backend) returns mock_otp: "123456".
     */
    sendOTP: async (phone: string): Promise<{ message: string; expires_in_seconds: number; mock_otp?: string }> => {
      const normalised = phone.startsWith('+1') ? phone : `+1${phone.replace(/[\s\-\(\)\.]/g, '')}`;
      return request('/auth/send-otp', {
        method: 'POST',
        body: JSON.stringify({ phone: normalised, role: 'customer' }),
        skipAuth: true,
      });
    },

    /**
     * Verify OTP. Returns tokens + user info.
     * Automatically stores tokens and user in SecureStore.
     */
    verifyOTP: async (phone: string, otp: string): Promise<AuthUser> => {
      const normalised = phone.startsWith('+1') ? phone : `+1${phone.replace(/[\s\-\(\)\.]/g, '')}`;
      const data = await request<{
        tokens: { access_token: string; refresh_token: string };
        user_id: string;
        role: string;
        is_new_user: boolean;
        is_new_role: boolean;
        profile_complete: boolean;
      }>('/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ phone: normalised, otp, role: 'customer' }),
        skipAuth: true,
      });
      // Defensive only — the backend already grants exactly the role
      // requested (or auto-adds a Customer profile to an existing
      // Provider-only account and returns 'customer' either way), so this
      // should never actually fire. Kept as a safety net in case the
      // contract ever changes.
      if (data.role !== 'customer') {
        throw { success: false, error_code: 'WRONG_APP', message: 'This number is registered as a Service Provider account. Please use the Dodorez Provider app.' } as ApiError;
      }
      await TokenStore.setTokens(data.tokens.access_token, data.tokens.refresh_token);
      const user: AuthUser = {
        user_id: data.user_id,
        role: 'customer',
        is_new_user: data.is_new_user,
        is_new_role: data.is_new_role,
        profile_complete: data.profile_complete,
      };
      await TokenStore.setUser(user);
      return user;
    },

    /** Login with phone number OR email + password. Stores tokens on success. */
    loginWithPassword: async (identifier: string, password: string): Promise<AuthUser> => {
      const isEmail = identifier.includes('@');
      const normalised = isEmail
        ? identifier.trim().toLowerCase()
        : (identifier.startsWith('+1') ? identifier : `+1${identifier.replace(/[\s\-\(\)\.]/g, '')}`);
      const data = await request<{
        tokens: { access_token: string; refresh_token: string };
        user_id: string;
        role: string;
        is_new_user: boolean;
        is_new_role: boolean;
        profile_complete: boolean;
      }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: normalised, password, role: 'customer' }),
        skipAuth: true,
      });
      if (data.role !== 'customer') {
        throw { success: false, error_code: 'WRONG_APP', message: 'This number is registered as a Service Provider account. Please use the Dodorez Provider app.' } as ApiError;
      }
      await TokenStore.setTokens(data.tokens.access_token, data.tokens.refresh_token);
      const user: AuthUser = {
        user_id: data.user_id,
        role: 'customer',
        is_new_user: data.is_new_user,
        is_new_role: data.is_new_role,
        profile_complete: data.profile_complete,
      };
      await TokenStore.setUser(user);
      return user;
    },

    /** Set or update password for the logged-in user. currentPassword is
     * required when actually changing an existing password (not needed for
     * first-time setup, e.g. right after registration). */
    setPassword: async (password: string, currentPassword?: string) =>
      request('/auth/set-password', {
        method: 'POST',
        body: JSON.stringify({ password, current_password: currentPassword }),
      }),

    /**
     * Forgot password, step 1 — separate from sendOTP (shared with login/
     * registration) because this one confirms an account exists before
     * sending anything, rather than silently allowing "no account yet"
     * the way first-time signup needs to.
     */
    sendResetOTP: async (phone: string): Promise<{ message: string; expires_in_seconds: number; mock_otp?: string }> => {
      const normalised = phone.startsWith('+1') ? phone : `+1${phone.replace(/[\s\-\(\)\.]/g, '')}`;
      return request('/auth/send-reset-otp', {
        method: 'POST',
        body: JSON.stringify({ phone: normalised, role: 'customer' }),
        skipAuth: true,
      });
    },

    /**
     * Forgot password, step 2: no auth required — the freshly-sent OTP
     * stands in for the current password. Send it with sendResetOTP
     * first, then submit the code and the new password together here.
     */
    resetPassword: async (phone: string, otp: string, newPassword: string) => {
      const normalised = phone.startsWith('+1') ? phone : `+1${phone.replace(/[\s\-\(\)\.]/g, '')}`;
      return request('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ phone: normalised, otp, role: 'customer', new_password: newPassword }),
        skipAuth: true,
      });
    },

    /** Complete profile after first login. */
    updateProfile: async (data: { name: string; email?: string; id_number?: string }) =>
      request('/auth/profile/customer', { method: 'POST', body: JSON.stringify(data) }),

    /** Register FCM push token for this device. */
    registerFCMToken: async (token: string, platform: 'IOS' | 'ANDROID') =>
      request('/auth/fcm-token', {
        method: 'POST',
        body: JSON.stringify({ token, platform }),
      }),

    logout: async () => {
      try {
        await request('/auth/logout', { method: 'POST' });
      } finally {
        await TokenStore.clear();
      }
    },
  },

  // ── Customer Profile ──────────────────────────────────────────────────────
  customers: {
    getProfile: async (): Promise<{
      user_id: string;
      name: string;
      phone: string;
      email?: string;
      profile_image_url?: string;
      id_number?: string;
      id_document_url?: string;
      created_at: string;
      avg_overall_rating: number | null;
      review_count: number;
    }> => request('/customers/me'),

    updateProfile: async (data: { name?: string; email?: string; id_number?: string; id_document_url?: string; profile_image_url?: string }) =>
      request('/customers/me', { method: 'PATCH', body: JSON.stringify(data) }),
  },

  // ── Dashboard ─────────────────────────────────────────────────────────────
  dashboard: {
    getNearbyProviders: async (lat: number, lon: number, radiusKm?: number, includeAll?: boolean): Promise<Array<{
      provider_id: string;
      name: string;
      lat: number | null;
      lng: number | null;
      distance_km: number;
      avg_rating: number;
      jobs_completed: number;
      hci_score: number;
      is_available: boolean;
      profile_image_url?: string;
      profession?: string | null;
    }>> => {
      let url = `/providers/nearby?lat=${lat}&lon=${lon}`;
      if (radiusKm != null) url += `&radius_km=${radiusKm}`;
      if (includeAll) url += `&include_all=true`;
      return request(url);
    },

    getActiveJobs: async (): Promise<any[]> =>
      request('/jobs'),
  },

  // ── Jobs ──────────────────────────────────────────────────────────────────
  jobs: {
    create: async (payload: {
      title: string;
      description: string;
      skill_id?: string;
      skill_ids?: string[];
      address_id?: string;
      urgency?: 'LOW' | 'MEDIUM' | 'HIGH' | 'EMERGENCY';
      budget_min?: number;
      budget_max?: number;
      scheduled_at?: string;
      inspection_fee?: number;
      notes?: string;
      lat?: number;
      lng?: number;
      search_radius_km?: number;
      images?: string[];
      target_provider_id?: string;
      // Backup providers asked in order if target_provider_id declines or
      // doesn't respond within the timeout. Ignored unless target_provider_id is set.
      direct_request_queue?: string[];
      posted_via?: 'MANUAL' | 'VOICE';
      // "STANDARD" (default) or "PICKUP_DROPOFF" — see dropoff_lat/lng and
      // pickup_place_id/pickup_place_type below. lat/lng above is the
      // pickup point for a PICKUP_DROPOFF job.
      job_type?: 'STANDARD' | 'PICKUP_DROPOFF';
      dropoff_lat?: number;
      dropoff_lng?: number;
      pickup_place_id?: string;
      pickup_place_type?: string;
      // "ON_SITE" (default) or "REMOTE" — no physical location/distance
      // matching at all (e.g. hiring a developer/consultant).
      service_mode?: 'ON_SITE' | 'REMOTE';
    }) => request('/jobs', { method: 'POST', body: JSON.stringify(payload) }),

    /** The server-side allowlist of Google Places types a PICKUP_DROPOFF
     * job's pickup location may be — the actual enforcement happens on the
     * backend at create() time; this is just so the app doesn't hand-
     * maintain a duplicate list that could drift from what's accepted. */
    getPickupPlaceTypes: async (): Promise<string[]> =>
      request('/jobs/pickup-place-types'),

    uploadMedia: async (files: Array<{ uri: string; type: string; name: string }>): Promise<string[]> => {
      const form = new FormData();
      for (const f of files) {
        form.append('files', { uri: f.uri, type: f.type, name: f.name } as any);
      }
      const token = await TokenStore.getAccessToken();
      const res = await fetch(`${BASE_URL}/jobs/upload-media`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!res.ok) return [];
      const json = await res.json();
      return json?.data ?? [];
    },

    list: async (status?: string) =>
      request(`/jobs${status ? `?status=${status}` : ''}`),

    /**
     * Purpose-built for the profile screen — an accurate total job count
     * (list()'s backend query caps at 50, undercounting anyone with more)
     * plus a lightweight completed/cancelled history, instead of fetching
     * every job fully hydrated just to compute a count and filter it down.
     */
    getSummary: async (): Promise<{
      total_jobs: number;
      history: Array<{
        id: string; title: string; status: string;
        inspection_fee: number; budget_min: number | null;
        created_at: string; updated_at: string;
        provider_name: string | null;
        review: { skill_rating: number; punctuality_rating: number; behaviour_rating: number; communication_rating: number; overall_rating: number; comment: string | null } | null;
        customer_review: { payment_rating: number; behaviour_rating: number; negotiation_rating: number; environment_rating: number; overall_rating: number; comment: string | null } | null;
      }>;
    }> => request('/jobs/summary'),

    get: async (jobId: string) =>
      request(`/jobs/${jobId}`),

    // Only allowed before a provider is hired (status POSTED/DISTRIBUTED) —
    // the backend rejects this once the job has moved past that.
    update: async (jobId: string, payload: {
      title?: string;
      description?: string;
      urgency?: 'LOW' | 'MEDIUM' | 'HIGH' | 'EMERGENCY';
      budget_min?: number;
      budget_max?: number;
      scheduled_at?: string;
      notes?: string;
      skill_ids?: string[];
      images?: string[];
    }) => request(`/jobs/${jobId}`, { method: 'PATCH', body: JSON.stringify(payload) }),

    getApplicants: async (jobId: string) => {
      const job = await request(`/jobs/${jobId}`);
      return (job as any)?.applicants ?? [];
    },

    hireApplicant: async (jobId: string, applicationId: string) =>
      request(`/jobs/${jobId}/hire`, {
        method: 'POST',
        body: JSON.stringify({ application_id: applicationId }),
      }),

    rejectApplicant: async (jobId: string, applicationId: string) =>
      request(`/jobs/${jobId}/applications/${applicationId}/reject`, { method: 'POST' }),

    dismiss: async (jobId: string) =>
      request(`/jobs/${jobId}/dismiss`, { method: 'POST' }),

    cancel: async (jobId: string, reason: string) =>
      request(`/jobs/${jobId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),

    complete: async (jobId: string) =>
      request(`/jobs/${jobId}/complete`, { method: 'POST' }),

    submitReview: async (jobId: string, review: {
      behaviour_rating: number;
      skill_rating: number;
      punctuality_rating: number;
      communication_rating: number;
      comment?: string;
    }) => request(`/jobs/${jobId}/review`, { method: 'POST', body: JSON.stringify(review) }),

    broadcast: async (jobId: string) =>
      request(`/jobs/${jobId}/broadcast`, { method: 'POST' }),

    // Manually skip the current direct-request target and advance to the
    // next provider in the shortlist (or broadcast if none left).
    skipDirect: async (jobId: string) =>
      request(`/jobs/${jobId}/skip-direct`, { method: 'POST' }),

    // ── On-site inspection + invoice (bidding is retired — price is only
    // ever set after the provider inspects the job in person) ─────────────

    /** The 4-digit code to read aloud to the provider — fetched here rather
     * than relying solely on the push notification, which can be missed. */
    getInspectionOtp: async (jobId: string): Promise<{ otp: string | null; expires_in_seconds: number | null }> =>
      request(`/jobs/${jobId}/inspection/otp`),

    respondToInvoice: async (jobId: string, action: 'ACCEPT' | 'REJECT' | 'COUNTER', counterAmount?: number, counterNote?: string) =>
      request(`/jobs/${jobId}/invoice/respond`, {
        method: 'POST',
        body: JSON.stringify({ action, counter_amount: counterAmount, counter_note: counterNote }),
      }),

    /** Creates the job-cost escrow for whatever amount was actually agreed
     * (the invoice, or a counter-offer) — call once invoice.status is
     * ACCEPTED, before presenting the PaymentSheet. */
    payInvoice: async (jobId: string): Promise<{
      requires_payment: boolean; client_secret: string | null; payment_intent_id: string | null; amount: number;
    }> => request(`/jobs/${jobId}/invoice/pay`, { method: 'POST' }),

    /** Confirms the job-cost payment landed and starts the job. Self-heals
     * against Stripe directly if the webhook hasn't arrived yet. */
    confirmJobCostPayment: async (jobId: string) =>
      request(`/jobs/${jobId}/confirm-job-cost-payment`, { method: 'POST' }),
  },

  // ── Addresses ─────────────────────────────────────────────────────────────
  addresses: {
    list: async () => request('/customers/me/addresses'),
    add: async (address: {
      label: string;
      full_address: string;
      lat?: number;
      lng?: number;
      city?: string;
      zip_code?: string;
      is_default?: boolean;
    }) => request('/customers/me/addresses', { method: 'POST', body: JSON.stringify(address) }),
    update: async (id: string, data: { label?: string; full_address?: string }) =>
      request(`/customers/me/addresses/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    setDefault: async (id: string) =>
      request(`/customers/me/addresses/${id}/default`, { method: 'PATCH' }),
    delete: async (id: string) =>
      request(`/customers/me/addresses/${id}`, { method: 'DELETE' }),
  },

  // ── Tracking ──────────────────────────────────────────────────────────────
  tracking: {
    track: async (jobId: string): Promise<{
      job_status: string;
      provider_lat: number | null;
      provider_lng: number | null;
      heading: number | null;
      destination_lat: number | null;
      destination_lng: number | null;
      distance_km: number | null;
      eta_minutes: number | null;
    }> => request(`/jobs/${jobId}/track`),
  },

  // ── Chat ──────────────────────────────────────────────────────────────────
  chat: {
    send: async (jobId: string, message: string, messageType: string = 'TEXT', imageUrl?: string) =>
      request(`/jobs/${jobId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ message, message_type: messageType, image_url: imageUrl }),
      }),
    getMessages: async (jobId: string, before?: string) =>
      request(`/jobs/${jobId}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`),
    // Caller owns the WebSocket lifecycle (open/onmessage/close). No token in
    // the URL — RN's WebSocket can't set headers, and query params tend to
    // end up in proxy/tunnel access logs, so the caller must send
    // {type:'auth', token: await TokenStore.getAccessToken()} as the very
    // first message right after the socket opens instead.
    getSocketUrl: async (jobId: string): Promise<string> => {
      const wsBase = BASE_URL.replace(/^http/, 'ws');
      return `${wsBase}/ws/jobs/${jobId}`;
    },
  },

  // ── Push notifications ──────────────────────────────────────────────────
  fcm: {
    registerToken: async (token: string, platform: 'IOS' | 'ANDROID') =>
      request('/auth/fcm-token', {
        method: 'POST',
        body: JSON.stringify({ token, platform }),
      }),
  },

  // ── Payments ──────────────────────────────────────────────────────────────
  payments: {
    /** Creates the (usually small) inspection-fee escrow — call right after
     * hireApplicant() succeeds, before the provider can request the
     * inspection OTP. Bidding is retired: there's no agreed job cost yet at
     * hire time, only this fee. requires_payment is false for a "Free
     * Inspection" ($0) job — skip PaymentSheet entirely in that case. */
    createInspectionFeeIntent: async (jobId: string): Promise<{
      requires_payment: boolean; client_secret: string | null; payment_intent_id: string | null; amount: number;
    }> => request('/payments/inspection-intent', {
      method: 'POST',
      body: JSON.stringify({ job_id: jobId }),
    }),
    createEphemeralKey: async (): Promise<{ ephemeral_key_secret: string; stripe_customer_id: string }> =>
      request('/payments/ephemeral-key', { method: 'POST' }),
    getStatus: async (jobId: string, purpose: 'INSPECTION_FEE' | 'JOB_COST' = 'JOB_COST'): Promise<{
      status: 'PENDING_CAPTURE' | 'HELD' | 'RELEASED' | 'REFUNDED' | 'FAILED';
      amount: number;
      held_at: string | null;
      released_at: string | null;
      refunded_at: string | null;
    }> => request(`/payments/${jobId}?purpose=${purpose}`),
  },

  // ── Skills ────────────────────────────────────────────────────────────────
  skills: {
    professions: async (): Promise<string[]> => request('/skills/professions'),
    list: async (profession?: string) =>
      request(`/skills${profession ? `?profession=${encodeURIComponent(profession)}` : ''}`),
  },

  // ── Providers (public profile — viewing an applicant's full details) ────────
  providers: {
    getDetail: async (providerId: string) => request(`/providers/${providerId}`),
    getDocuments: async (providerId: string, docType?: string) =>
      request(`/providers/${providerId}/documents${docType ? `?doc_type=${encodeURIComponent(docType)}` : ''}`),
    getReviews: async (providerId: string) => request(`/providers/${providerId}/reviews`),
    getHistory: async (providerId: string) => request(`/providers/${providerId}/history`),
  },

  // ── AI ────────────────────────────────────────────────────────────────────
  ai: {
    analyzeProblem: async (images: string[], description: string): Promise<{
      problem_summary: string;
      profession: string;
      skills: string[];
      urgency: string;
    }> => request('/ai/analyze-problem', {
      method: 'POST',
      body: JSON.stringify({ images, description }),
    }) as any,

    voiceChat: async (messages: { role: string; content: string }[]): Promise<{
      reply: string;
      is_complete: boolean;
      job_data: {
        title: string;
        description: string;
        profession?: string;
        skill_name: string;
        skill_names?: string[];
        skill_id: string;
        skill_ids: string[];
        urgency: string;
        scheduled_at: string | null;
        notes: string;
      } | null;
      // True on the turn where the assistant states its own diagnosis
      // (profession/skill inferred from the problem) and asks the customer
      // to confirm it, or asks whether they'd like to add a photo/video —
      // the frontend surfaces quick-tap buttons for these instead of
      // relying purely on speech recognition for a yes/no.
      diagnosis_check: boolean;
      ask_photo: boolean;
    }> => request('/ai/voice-chat', {
      method: 'POST',
      body: JSON.stringify({ messages }),
    }) as any,

    // language: an ISO-639-1 code (e.g. "en", "te") echoed back from a PRIOR
    // call's response — pins Whisper to that language instead of letting it
    // re-guess from scratch on every short clip, which could (and did) flip
    // languages mid-conversation. Omit on the first call of a session.
    transcribe: async (audioUri: string, language?: string): Promise<{ text: string; language: string | null }> => {
      const token = await TokenStore.getAccessToken();
      const form = new FormData();
      form.append('file', { uri: audioUri, name: 'audio.m4a', type: 'audio/m4a' } as any);
      if (language) form.append('language', language);
      const res = await fetch(`${BASE_URL}/ai/transcribe`, {
        method: 'POST',
        headers: {
          'ngrok-skip-browser-warning': 'true',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: form,
      });
      if (!res.ok) {
        // Previously threw a bare Error with no error_code at all — every
        // failure (a real rate limit, a Groq outage, an actual network drop)
        // looked identical to the caller, which is why a 429 got shown to
        // the customer as "check your internet" instead of the real reason.
        const body = await res.json().catch(() => null);
        throw {
          success: false,
          error_code: body?.error_code ?? 'UNKNOWN_ERROR',
          message: body?.message ?? `Transcription failed: ${res.status}`,
        } as ApiError;
      }
      const json = await res.json();
      return json.data;
    },
  },

  // ── Notifications ─────────────────────────────────────────────────────────
  notifications: {
    list: async (): Promise<Array<{
      id: string;
      title: string;
      body: string;
      notif_type: string;
      job_id: string | null;
      is_read: boolean;
      created_at: string;
    }>> => request('/notifications'),
    unreadCount: async (): Promise<number> => {
      const data: any = await request('/notifications/unread-count');
      return data?.unread_count ?? 0;
    },
    readAll: async () => request('/notifications/read-all', { method: 'POST' }),
  },

  // ── Job rating status ─────────────────────────────────────────────────────
  ratingStatus: {
    get: async (jobId: string): Promise<{ customer_has_rated: boolean; provider_has_rated: boolean }> =>
      request(`/jobs/${jobId}/rating-status`),
  },
};
