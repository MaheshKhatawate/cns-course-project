'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  api,
  ApiError,
  errorMessage,
  formatDate,
  post,
  reauthenticate,
  withStepUp,
  type ActivityItem,
  type MeResponse,
  type SessionInfo,
} from '@/lib/api';
import { loadCeremony, type CeremonyInspection } from '@/lib/inspect';
import {
  Activity,
  ArrowRight,
  Clock,
  KeyRound,
  LifeBuoy,
  LayoutDashboard,
  Monitor,
  ShieldCheck,
  Smartphone,
  Unlock,
} from 'lucide-react';
import { Alert, Badge, CeremonyInspector, PageHeader, RecoveryCodeBox, StatCard } from '@/components/ui';

const ACTIVITY_TONE: Record<string, 'green' | 'red' | 'amber' | 'blue' | 'slate'> = {
  LOGIN_SUCCESS: 'green',
  REGISTRATION: 'green',
  DEVICE_ADDED: 'blue',
  LOGIN_FAILED: 'red',
  DEVICE_REVOKED: 'amber',
  SESSION_REVOKED: 'amber',
  RECOVERY_USED: 'amber',
  RECOVERY_CODE_ROTATED: 'amber',
  STEP_UP: 'blue',
  LOGOUT: 'slate',
};

function useNow(intervalMs = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export default function DashboardPage() {
  const router = useRouter();
  const now = useNow();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [ceremony, setCeremony] = useState<CeremonyInspection | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [meRes, actRes, sesRes] = await Promise.all([
        api<MeResponse>('/api/users/me'),
        api<{ activity: ActivityItem[] }>('/api/activity?limit=15'),
        api<{ sessions: SessionInfo[] }>('/api/sessions'),
      ]);
      setMe(meRes);
      setActivity(actRes.activity);
      setSessions(sesRes.sessions);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace('/login');
      setLoadError(errorMessage(err, 'Failed to load dashboard.'));
    }
  }, [router]);

  useEffect(() => {
    setCeremony(loadCeremony());
    refresh();
  }, [refresh]);

  async function run(fn: () => Promise<void>) {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err, 'Something went wrong.'));
    } finally {
      setBusy(false);
    }
  }

  const regenerateCode = () =>
    run(async () => {
      if (!confirm('Generate a new recovery code? The current one will stop working.')) return;
      const res = await withStepUp(() => post<{ recoveryCode: string }>('/api/users/me/recovery-code'));
      setNewCode(res.recoveryCode);
      await refresh();
    });

  const confirmIdentity = () =>
    run(async () => {
      await reauthenticate();
      setInfo('Identity confirmed. Sensitive actions are unlocked for the next few minutes.');
      await refresh();
    });

  const revokeSession = (s: SessionInfo) =>
    run(async () => {
      const res = await post<{ signedOut: boolean }>(`/api/sessions/${s.id}/revoke`);
      if (res.signedOut) {
        router.push('/login');
        return;
      }
      setInfo('Session signed out.');
      await refresh();
    });

  const revokeOthers = () =>
    run(async () => {
      const res = await post<{ count: number }>('/api/sessions/revoke-others');
      setInfo(`Signed out ${res.count} other session(s).`);
      await refresh();
    });

  if (loadError && !me) {
    return (
      <div className="card mx-auto max-w-lg space-y-4">
        <Alert kind="error">{loadError}</Alert>
        <Link href="/login" className="btn-primary">Go to login</Link>
      </div>
    );
  }
  if (!me) return <div className="card animate-pulse text-sm text-slate-500">Loading your dashboard…</div>;

  const freshMs = new Date(me.session.freshUntil).getTime() - now;
  const expiresMin = Math.max(0, Math.round((new Date(me.session.expiresAt).getTime() - now) / 60_000));

  return (
    <div className="space-y-8">
      <PageHeader
        icon={LayoutDashboard}
        eyebrow="Dashboard"
        title={`Welcome, ${me.user.displayName}`}
        actions={
          <Link href="/devices" className="btn-secondary">
            <Smartphone className="h-4 w-4" /> Manage devices
          </Link>
        }
      >
        @{me.user.username} · signed in with a passkey{me.session.deviceLabel ? ` from “${me.session.deviceLabel}”` : ''} · member since{' '}
        {new Date(me.user.createdAt).toLocaleDateString()}
      </PageHeader>

      {error && <Alert kind="error">{error}</Alert>}
      {info && <Alert kind="success">{info}</Alert>}
      {newCode && <RecoveryCodeBox code={newCode} username={me.user.username} />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Clock} label="Session" footer={formatDate(me.session.expiresAt)}>
          <p className="flex items-center gap-2 font-semibold text-emerald-700">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            Authenticated
          </p>
          <p className="mt-1 text-sm text-slate-600">expires in {expiresMin} min</p>
        </StatCard>
        <StatCard
          icon={Unlock}
          label="Step-up"
          footer={
            freshMs > 0 ? 'Device changes allowed' : (
              <button className="btn-secondary btn-sm" onClick={confirmIdentity} disabled={busy}>
                <ShieldCheck className="h-3.5 w-3.5" /> Confirm with passkey
              </button>
            )
          }
        >
          {freshMs > 0 ? (
            <p className="font-semibold text-emerald-700">Unlocked · {Math.ceil(freshMs / 60_000)} min</p>
          ) : (
            <p className="font-semibold text-amber-700">Locked</p>
          )}
        </StatCard>
        <StatCard icon={Smartphone} label="Active devices" footer={<Link href="/devices" className="font-medium text-indigo-600 hover:underline">Add or revoke →</Link>}>
          <p className="text-3xl font-bold tracking-tight">{me.deviceCount}</p>
        </StatCard>
        <StatCard
          icon={LifeBuoy}
          label="Recovery code"
          footer={
            <button className="btn-secondary btn-sm" onClick={regenerateCode} disabled={busy}>
              Generate new code
            </button>
          }
        >
          {me.hasRecoveryCode ? <Badge tone="green">Active</Badge> : <Badge tone="red">Not set</Badge>}
          <p className="mt-1 text-xs text-slate-500">created {formatDate(me.recovery.createdAt)}</p>
        </StatCard>
      </div>

      <section className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className="icon-tile"><KeyRound className="h-5 w-5" /></span>
            <div>
              <h2 className="font-semibold">Last ceremony: what was actually signed</h2>
              <p className="text-xs text-slate-500">
                {ceremony ? `${ceremony.kind === 'login' ? 'Login assertion' : 'Registration'} at ${formatDate(ceremony.at)} · decoded in your browser` : 'Decoded WebAuthn data from your latest login'}
              </p>
            </div>
          </div>
        </div>
        {ceremony ? (
          <CeremonyInspector ceremony={ceremony} />
        ) : (
          <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            Log out and log in again to see the decoded challenge, flags, counter and signature here.
          </p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <span className="icon-tile"><Monitor className="h-5 w-5" /></span>
              <h2 className="font-semibold">Active sessions <span className="text-slate-400">({sessions.length})</span></h2>
            </div>
            {sessions.length > 1 && (
              <button className="btn-secondary btn-sm" onClick={revokeOthers} disabled={busy}>Sign out others</button>
            )}
          </div>
          <ul className="mt-4 space-y-2">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/70 p-3 text-sm">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {s.deviceLabel ?? 'Unknown device'} {s.isCurrent && <Badge tone="blue">this session</Badge>}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    since {formatDate(s.createdAt)}
                    {s.userAgent ? ` · ${s.userAgent.replace(/^Mozilla\/5\.0 /, '').slice(0, 48)}` : ''}
                  </p>
                </div>
                <button className="btn-ghost btn-sm shrink-0" onClick={() => revokeSession(s)} disabled={busy}>
                  {s.isCurrent ? 'Sign out' : 'Revoke'}
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <div className="flex items-center gap-3">
            <span className="icon-tile"><Activity className="h-5 w-5" /></span>
            <h2 className="font-semibold">Recent activity</h2>
          </div>
          {activity.length === 0 && <p className="mt-4 text-sm text-slate-500">No activity yet.</p>}
          <ol className="relative mt-4 space-y-3 border-l border-slate-200 pl-5">
            {activity.map((a) => (
              <li key={a.id} className="relative text-sm">
                <span
                  className={`absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white ${
                    { green: 'bg-emerald-500', red: 'bg-rose-500', amber: 'bg-amber-500', blue: 'bg-indigo-500', violet: 'bg-violet-500', slate: 'bg-slate-400' }[ACTIVITY_TONE[a.type] ?? 'slate']
                  }`}
                />
                <p className="text-slate-800">{a.message}</p>
                <p className="text-xs text-slate-500">
                  {a.type.replace(/_/g, ' ').toLowerCase()} · {a.deviceLabel ? `${a.deviceLabel} · ` : ''}
                  {formatDate(a.createdAt)}
                </p>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <section className="card">
        <h2 className="font-semibold">How this login worked</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          {[
            ['1', 'Challenge', 'Server sends 32 random bytes, single-use, valid 5 min.'],
            ['2', 'User verification', 'Fingerprint / face / PIN unlocks the private key on the device.'],
            ['3', 'Signature', 'ECDSA-Sign(privateKey, authData ‖ SHA-256(clientData)).'],
            ['4', 'Verification', 'Server checks origin, RP ID hash, signature and counter → session.'],
          ].map(([n, t, d]) => (
            <div key={n} className="rounded-xl border border-slate-200 bg-white/70 p-4">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">{n}</span>
              <p className="mt-3 text-sm font-semibold">{t}</p>
              <p className="mt-1 text-xs text-slate-600">{d}</p>
            </div>
          ))}
        </div>
        <Link href="/security" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline">
          See how it resists attacks <ArrowRight className="h-4 w-4" />
        </Link>
      </section>
    </div>
  );
}
