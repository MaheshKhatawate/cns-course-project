import { startAuthentication } from '@simplewebauthn/browser';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      ...init,
    });
  } catch {
    throw new ApiError(`Cannot reach the authentication server at ${API_BASE}. Is it running?`, 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data as { error?: string; code?: string };
    throw new ApiError(d.error ?? `Request failed (${res.status}).`, res.status, d.code);
  }
  return data as T;
}

export function post<T>(path: string, body: unknown = {}) {
  return api<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

type AuthOptions = Parameters<typeof startAuthentication>[0]['optionsJSON'];

// Step-up re-authentication: sign a fresh challenge with any of the user's passkeys.
export async function reauthenticate() {
  const options = await post<AuthOptions>('/api/auth/reauth-options');
  const assertionResponse = await startAuthentication({ optionsJSON: options });
  return post<{ verified: boolean; freshUntil: string }>('/api/auth/reauth-verify', { assertionResponse });
}

// Runs a sensitive action; if the server asks for a fresh passkey check, does the
// step-up ceremony and retries once.
export async function withStepUp<T>(action: () => Promise<T>, onStepUp?: () => void): Promise<T> {
  try {
    return await action();
  } catch (err) {
    if (err instanceof ApiError && err.code === 'REAUTH_REQUIRED') {
      onStepUp?.();
      await reauthenticate();
      return action();
    }
    throw err;
  }
}

export interface MeResponse {
  user: { id: string; username: string; displayName: string; createdAt: string };
  deviceCount: number;
  hasRecoveryCode: boolean;
  recovery: { createdAt: string | null; lastUsedAt: string | null };
  session: {
    id: string;
    status: string;
    issuedAt: string;
    expiresAt: string;
    lastAuthAt: string;
    freshUntil: string;
    deviceLabel: string | null;
  };
}

export interface Device {
  id: string;
  deviceLabel: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  transports: string[];
  deviceType: string | null;
  backedUp: boolean;
  aaguid: string | null;
  counter: number;
  isCurrent: boolean;
  publicKey: { algorithm: number | null; algorithmName: string; fingerprint: string; pem: string | null };
}

export interface SessionInfo {
  id: string;
  deviceLabel: string | null;
  createdAt: string;
  expiresAt: string;
  lastAuthAt: string;
  ip: string | null;
  userAgent: string | null;
  isCurrent: boolean;
}

export interface ActivityItem {
  id: string;
  type: string;
  message: string;
  deviceLabel: string | null;
  createdAt: string;
}

export interface LoginVerification {
  credentialId: string;
  deviceLabel: string;
  algorithm: number | null;
  previousCounter: number;
  newCounter: number;
  userVerified: boolean;
  deviceType: string;
  backedUp: boolean;
  origin: string;
  rpID: string;
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    // WebAuthn DOMExceptions from the browser / authenticator.
    if (err.name === 'NotAllowedError') return 'The passkey prompt was cancelled or timed out.';
    if (err.name === 'InvalidStateError') return 'This authenticator is already registered for this account.';
    if (err.name === 'SecurityError') return 'WebAuthn security error: check that WEBAUTHN_RP_ID / origin match this site.';
    return err.message || fallback;
  }
  return fallback;
}

// WebAuthn is only available in secure contexts with a supported authenticator.
export function webauthnStatus(): { ok: boolean; reason?: string } {
  if (typeof window === 'undefined') return { ok: false, reason: 'Not in a browser.' };
  if (!window.isSecureContext) return { ok: false, reason: 'WebAuthn needs HTTPS or localhost.' };
  if (!window.PublicKeyCredential) return { ok: false, reason: 'This browser does not support WebAuthn.' };
  return { ok: true };
}
