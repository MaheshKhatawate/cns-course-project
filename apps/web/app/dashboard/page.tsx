'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, formatDate, type ActivityItem, type MeResponse } from '@/lib/api';
import { Alert } from '@/components/ui';

export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [meRes, actRes] = await Promise.all([
          api<MeResponse>('/api/users/me'),
          api<{ activity: ActivityItem[] }>('/api/activity?limit=10'),
        ]);
        setMe(meRes);
        setActivity(actRes.activity);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
      }
    })();
  }, []);

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    router.push('/login');
  }

  if (error) {
    return (
      <div className="card mx-auto max-w-lg space-y-4">
        <Alert kind="error">{error}</Alert>
        <Link href="/login" className="btn-primary inline-block">Go to login</Link>
      </div>
    );
  }
  if (!me) return <div className="card">Loading…</div>;

  return (
    <div className="space-y-6">
      <div className="card flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold">Welcome, {me.user.displayName}</h1>
          <p className="text-sm text-slate-600">
            @{me.user.username} · Authenticated via WebAuthn · {me.deviceCount} active device(s)
          </p>
        </div>
        <button className="btn-secondary" onClick={logout}>Log out</button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="card">
          <h2 className="text-sm font-semibold text-slate-500">STATUS</h2>
          <p className="mt-1 font-medium text-green-700">● {me.session.status}</p>
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold text-slate-500">SESSION STARTED</h2>
          <p className="mt-1 text-sm">{formatDate(me.session.issuedAt)}</p>
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold text-slate-500">SESSION EXPIRES</h2>
          <p className="mt-1 text-sm">{formatDate(me.session.expiresAt)}</p>
        </div>
      </div>

      <div className="card">
        <h2 className="font-semibold">Recent activity</h2>
        {activity.length === 0 && <p className="mt-2 text-sm text-slate-500">No activity yet.</p>}
        <ul className="mt-2 divide-y divide-slate-100">
          {activity.map((a) => (
            <li key={a.id} className="py-2 text-sm">
              <span className="font-medium">{a.message}</span>
              <span className="text-slate-500">
                {' '}· {a.deviceLabel ?? '—'} · {formatDate(a.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h2 className="font-semibold">How this login worked (demo walkthrough)</h2>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
{`Registration
  Browser → WebAuthn authenticator → key pair generated
  Public key → server (stored) · Private key → stays on device

Login
  Server → challenge → Browser → Authenticator
  Authenticator signs challenge → assertion → Server verifies
  ✓ Valid signature + fresh challenge + known credential
  → JWT session cookie issued`}
        </pre>
        <div className="mt-3 flex gap-3 text-sm">
          <Link href="/devices" className="underline">Manage devices</Link>
          <Link href="/recovery" className="underline">Recovery</Link>
        </div>
      </div>
    </div>
  );
}
