'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { startAuthentication } from '@simplewebauthn/browser';
import { api, webauthnStatus } from '@/lib/api';
import { Alert } from '@/components/ui';

type AuthOptions = Parameters<typeof startAuthentication>[0]['optionsJSON'];

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const w = webauthnStatus();
    if (!w.ok) {
      setError(w.reason ?? 'WebAuthn is not available.');
      return;
    }
    setBusy(true);
    try {
      // 1–2. Identify account, get a fresh server challenge.
      const options = await api<AuthOptions>('/api/auth/login-options', {
        method: 'POST',
        body: JSON.stringify({ username }),
      });
      // 3–4. Browser invokes the authenticator; user verifies; assertion is signed.
      const assertion = await startAuthentication({ optionsJSON: options });
      // 5. Server verifies the assertion and sets the JWT session cookie.
      await api('/api/auth/login-verify', {
        method: 'POST',
        body: JSON.stringify({ username, assertionResponse: assertion }),
      });
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mx-auto max-w-lg space-y-4">
      <h1 className="text-xl font-bold">Log in with your passkey</h1>
      <p className="text-sm text-slate-600">
        No password. The server sends a one-time challenge; your authenticator signs it.
      </p>
      {error && <Alert kind="error">{error}</Alert>}
      <form onSubmit={onLogin} className="space-y-3">
        <div>
          <label className="label" htmlFor="username">Username</label>
          <input id="username" className="input" value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="username" />
        </div>
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Waiting for your authenticator…' : 'Log in with WebAuthn'}
        </button>
      </form>
      <div className="flex justify-between text-sm">
        <Link href="/register" className="underline">New here? Register</Link>
        <Link href="/recovery" className="underline">Lost your device?</Link>
      </div>
    </div>
  );
}
