'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { startAuthentication } from '@simplewebauthn/browser';
import { errorMessage, post, webauthnStatus, type LoginVerification } from '@/lib/api';
import { inspectAssertion, saveCeremony } from '@/lib/inspect';
import { KeyRound, ScanFace } from 'lucide-react';
import { Alert, AuthCard, Divider } from '@/components/ui';

type AuthOptions = Parameters<typeof startAuthentication>[0]['optionsJSON'];

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState<'username' | 'passkey' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(withUsername: boolean) {
    setError(null);
    const w = webauthnStatus();
    if (!w.ok) {
      setError(w.reason ?? 'WebAuthn is not available.');
      return;
    }
    setBusy(withUsername ? 'username' : 'passkey');
    try {
      // 1. Server issues a fresh, single-use, time-limited challenge.
      const { flowId, options } = await post<{ flowId: string; options: AuthOptions }>(
        '/api/auth/login-options',
        withUsername ? { username } : {},
      );
      // 2. The authenticator asks for user verification and signs the challenge.
      const assertionResponse = await startAuthentication({ optionsJSON: options });
      // 3. Server verifies the signature with the stored public key and starts a session.
      const res = await post<{ verification: LoginVerification }>('/api/auth/login-verify', { flowId, assertionResponse });
      saveCeremony(inspectAssertion(assertionResponse, res.verification as unknown as Record<string, unknown>));
      router.push('/dashboard');
    } catch (err) {
      setError(errorMessage(err, 'Login failed.'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <AuthCard icon={KeyRound} title="Welcome back" subtitle="No password. The server sends a one-time challenge and your device signs it.">
      {error && <Alert kind="error">{error}</Alert>}
      <button type="button" className="btn-primary w-full py-3" onClick={() => signIn(false)} disabled={busy !== null}>
        <ScanFace className="h-4 w-4" /> {busy === 'passkey' ? 'Waiting for your authenticator…' : 'Sign in with a passkey'}
      </button>
      <Divider label="or use your username" />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          signIn(true);
        }}
        className="space-y-3"
      >
        <div>
          <label className="label" htmlFor="username">Username</label>
          <input id="username" className="input" value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="username webauthn" placeholder="your username" />
        </div>
        <button className="btn-secondary w-full py-3" disabled={busy !== null}>
          {busy === 'username' ? 'Waiting for your authenticator…' : 'Continue with username'}
        </button>
      </form>
      <div className="flex justify-between text-sm">
        <Link href="/register" className="font-medium text-indigo-600 hover:underline">Create an account</Link>
        <Link href="/recovery" className="text-slate-500 hover:text-slate-800 hover:underline">Lost your device?</Link>
      </div>
    </AuthCard>
  );
}
