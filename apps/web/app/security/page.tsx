'use client';

import { useState } from 'react';
import { ApiError, errorMessage, post } from '@/lib/api';
import { Ban, CheckCircle2, Play, ShieldCheck, ShieldAlert, XCircle } from 'lucide-react';
import { Alert, Badge, PageHeader } from '@/components/ui';

interface Result {
  id: string;
  title: string;
  threat: string;
  expected: 'allowed' | 'blocked';
  outcome: 'allowed' | 'blocked' | 'error';
  passed: boolean;
  evidence: string;
  durationMs: number;
}

const THREATS: [string, string, string][] = [
  ['Phishing & spoofing', 'Fake login page relays the challenge to the victim', 'The browser writes the real origin into clientDataJSON and the authenticator hashes the RP ID into authenticatorData; both are covered by the signature and checked by the server.'],
  ['Replay', 'Attacker resubmits a captured login response', 'Every challenge is 32 random bytes, bound to one login flow, expires after 5 minutes and is deleted on first use.'],
  ['Man-in-the-middle', 'Response is modified in transit', 'Any change to clientDataJSON or authenticatorData breaks the ECDSA signature. In production, TLS also protects the channel.'],
  ['Credential stuffing & reuse', 'Leaked credentials replayed across sites', 'There is no shared secret to reuse. Each site gets its own key pair, and keys are scoped to their RP ID.'],
  ['Brute force', 'Guessing secrets online', 'Forging an ECDSA P-256 signature is computationally infeasible (~128-bit security). Recovery codes have ~79 bits of entropy, are bcrypt-hashed and rate-limited.'],
  ['Server database breach', 'Attacker dumps the users table', 'The DB holds only public keys and bcrypt hashes. A public key cannot be used to sign a challenge.'],
  ['Cloned authenticator', 'Private key copied to a second device', 'The signature counter must strictly increase; a regressing counter is rejected and logged.'],
  ['Lost / stolen device', 'Someone else has a registered device', 'Revoking the device rejects its key and immediately ends every session it created.'],
  ['Session hijacking', 'Stolen session cookie', 'HttpOnly + SameSite cookie, short expiry, server-side session check (logout really ends it), and a fresh passkey check before sensitive actions.'],
  ['CSRF', 'Another site triggers state-changing requests', 'SameSite=Lax cookies, a strict CORS allow-list, and Origin-header checks on every POST.'],
];

export default function SecurityPage() {
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function simulate() {
    setBusy(true);
    setError(null);
    try {
      const res = await post<{ results: Result[] }>('/api/demo/attacks');
      setResults(res.results);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? 'The attack simulator is disabled on this server (set ENABLE_DEMO_ROUTES=true).'
          : errorMessage(err, 'Simulation failed.'),
      );
    } finally {
      setBusy(false);
    }
  }

  const passed = results?.filter((r) => r.passed).length ?? 0;
  const blocked = results?.filter((r) => r.outcome === 'blocked').length ?? 0;

  return (
    <div className="space-y-8">
      <PageHeader icon={ShieldCheck} eyebrow="Security analysis" title="Threat model & live attack simulator">
        How the system meets Objective 4 (resist common attacks) and the security NFR. Every threat below is also checked automatically
        by the integration test suite.
      </PageHeader>

      <section className="card space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="icon-tile"><ShieldAlert className="h-5 w-5" /></span>
            <div>
              <h2 className="font-semibold">Live attack simulator</h2>
              <p className="max-w-2xl text-sm text-slate-600">
                The server plays the attacker against its own API with a software FIDO2 authenticator. It uses real ECDSA signatures and
                throwaway accounts, which are deleted afterwards.
              </p>
            </div>
          </div>
          <button className="btn-primary px-5 py-3" onClick={simulate} disabled={busy}>
            <Play className="h-4 w-4" /> {busy ? 'Running attacks…' : results ? 'Run again' : 'Run all attacks'}
          </button>
        </div>

        {busy && (
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full w-1/3 animate-[flow-ltr_1.2s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" style={{ position: 'relative' }} />
          </div>
        )}
        {error && <Alert kind="error">{error}</Alert>}

        {results && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className={`rounded-2xl p-5 text-white ${passed === results.length ? 'bg-gradient-to-br from-emerald-500 to-teal-600' : 'bg-gradient-to-br from-rose-500 to-red-600'}`}>
              <p className="text-xs font-semibold uppercase tracking-wider opacity-80">Behaved as expected</p>
              <p className="mt-1 text-3xl font-extrabold">{passed}/{results.length}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white/80 p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Attacks blocked</p>
              <p className="mt-1 text-3xl font-extrabold text-slate-900">{blocked}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white/80 p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Legit flows allowed</p>
              <p className="mt-1 text-3xl font-extrabold text-slate-900">{results.length - blocked}</p>
            </div>
          </div>
        )}

        {results && (
          <ul className="space-y-2">
            {results.map((r) => (
              <li key={r.id} className="animate-fade-up rounded-xl border border-slate-200 bg-white/80 p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  {r.passed ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <XCircle className="h-5 w-5 text-rose-600" />}
                  <span className="font-semibold">{r.title}</span>
                  <Badge tone={r.outcome === 'blocked' ? 'amber' : r.outcome === 'allowed' ? 'blue' : 'red'}>
                    {r.outcome === 'blocked' && <Ban className="h-3 w-3" />}
                    {r.outcome.toUpperCase()}
                  </Badge>
                  <span className="text-xs text-slate-500">{r.threat} · {r.durationMs} ms</span>
                </div>
                <p className="mt-2 break-words rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600">{r.evidence}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Threat model</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {THREATS.map(([t, a, m]) => (
            <div key={t} className="card card-hover p-5">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-indigo-600" />
                <h3 className="font-semibold">{t}</h3>
              </div>
              <p className="mt-2 text-xs font-medium uppercase tracking-wider text-rose-600">Attack</p>
              <p className="text-sm text-slate-600">{a}</p>
              <p className="mt-2 text-xs font-medium uppercase tracking-wider text-emerald-600">Mitigation</p>
              <p className="text-sm text-slate-600">{m}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
