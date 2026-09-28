const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `Request failed (${res.status}).`);
  }
  return data as T;
}

export interface MeResponse {
  user: { id: string; username: string; displayName: string; createdAt: string };
  deviceCount: number;
  hasRecoveryCode: boolean;
  session: { issuedAt: string | null; expiresAt: string | null; status: string };
}

export interface Device {
  id: string;
  deviceLabel: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ActivityItem {
  id: string;
  type: string;
  message: string;
  deviceLabel: string | null;
  createdAt: string;
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

// WebAuthn is only available in secure contexts with a supported authenticator.
export function webauthnStatus(): { ok: boolean; reason?: string } {
  if (typeof window === 'undefined') return { ok: false, reason: 'Not in a browser.' };
  if (!window.isSecureContext) return { ok: false, reason: 'WebAuthn needs HTTPS or localhost.' };
  if (!window.PublicKeyCredential) return { ok: false, reason: 'This browser does not support WebAuthn.' };
  return { ok: true };
}
