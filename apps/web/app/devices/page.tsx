'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { startRegistration } from '@simplewebauthn/browser';
import { Eye, EyeOff, KeyRound, Laptop, Link2, Pencil, Plus, ShieldOff, Smartphone, Trash2, Usb } from 'lucide-react';
import { api, ApiError, errorMessage, formatDate, post, webauthnStatus, withStepUp, type Device } from '@/lib/api';
import { Alert, Badge, CopyButton, PageHeader } from '@/components/ui';

type RegOptions = Parameters<typeof startRegistration>[0]['optionsJSON'];

function deviceIcon(d: Device) {
  if (d.transports.includes('usb') || d.transports.includes('nfc')) return Usb;
  if (d.transports.includes('hybrid')) return Smartphone;
  return Laptop;
}

function DeviceCard({ d, busy, onRevoke, onRename }: { d: Device; busy: boolean; onRevoke: () => void; onRename: (name: string) => void }) {
  const [showKey, setShowKey] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(d.deviceLabel);
  const Icon = deviceIcon(d);
  return (
    <li className="rounded-2xl border border-slate-200 bg-white/80 p-4 transition hover:border-indigo-200">
      <div className="flex flex-wrap items-start gap-4">
        <span className={`icon-tile h-12 w-12 ${d.isCurrent ? 'bg-gradient-to-br from-indigo-600 to-violet-600 text-white ring-0' : ''}`}>
          <Icon className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1 space-y-1.5">
          {editing ? (
            <form
              className="flex max-w-sm gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                onRename(name);
                setEditing(false);
              }}
            >
              <input className="input h-9" value={name} onChange={(e) => setName(e.target.value)} maxLength={64} required autoFocus />
              <button className="btn-primary btn-sm">Save</button>
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{d.deviceLabel}</span>
              {d.isCurrent && <Badge tone="blue">this session</Badge>}
              <Badge tone={d.deviceType === 'multiDevice' ? 'green' : 'slate'}>{d.deviceType === 'multiDevice' ? 'synced passkey' : 'device-bound key'}</Badge>
              {d.backedUp && <Badge tone="green">backed up</Badge>}
              {d.transports.map((t) => (
                <Badge key={t} tone="violet">{t}</Badge>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-500">
            {d.publicKey.algorithmName} · added {formatDate(d.createdAt)} · last used {formatDate(d.lastUsedAt)} · sign count {d.counter}
          </p>
          <p className="truncate text-xs text-slate-500">
            fingerprint <code className="text-slate-700">{d.publicKey.fingerprint}</code>
          </p>
        </div>
        <div className="flex gap-1">
          <button className="btn-ghost btn-sm" onClick={() => setShowKey((v) => !v)} title="View public key">
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />} <span className="hidden sm:inline">{showKey ? 'Hide key' : 'Public key'}</span>
          </button>
          <button className="btn-ghost btn-sm" onClick={() => setEditing((v) => !v)} title="Rename">
            <Pencil className="h-4 w-4" />
          </button>
          <button className="btn-danger btn-sm" onClick={onRevoke} disabled={busy} title="Revoke">
            <Trash2 className="h-4 w-4" /> Revoke
          </button>
        </div>
      </div>
      {showKey && (
        <div className="mt-3 animate-fade-up overflow-hidden rounded-xl bg-slate-950">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
            <span className="text-xs text-slate-400">Stored public key (SPKI / PEM)</span>
            {d.publicKey.pem && <CopyButton value={d.publicKey.pem} />}
          </div>
          <pre className="overflow-x-auto p-4 text-xs leading-relaxed text-emerald-300">{d.publicKey.pem ?? 'Unable to render key.'}</pre>
          <p className="border-t border-white/10 px-4 py-2 text-xs text-slate-400">
            This is everything the server knows about this device&apos;s key. The private key never left the authenticator.
          </p>
        </div>
      )}
    </li>
  );
}

function LinkDevicePanel({ onLinked, deviceCount }: { onLinked: () => Promise<void>; deviceCount: number }) {
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const startCount = useRef(deviceCount);
  const linkUrl = typeof window !== 'undefined' ? `${window.location.origin}/link` : '/link';

  useEffect(() => {
    if (!code) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => void onLinked(), 3000);
    return () => {
      clearInterval(t);
      clearInterval(poll);
    };
  }, [code, onLinked]);

  useEffect(() => {
    if (code && deviceCount > startCount.current) setCode(null);
  }, [deviceCount, code]);

  const remaining = code ? Math.max(0, Math.floor((new Date(code.expiresAt).getTime() - now) / 1000)) : 0;
  useEffect(() => {
    if (code && remaining === 0) setCode(null);
  }, [code, remaining]);

  async function generate() {
    setError(null);
    setBusy(true);
    try {
      startCount.current = deviceCount;
      setCode(await withStepUp(() => post<{ code: string; expiresAt: string }>('/api/devices/link-code')));
      setNow(Date.now());
    } catch (err) {
      setError(errorMessage(err, 'Could not create a link code.'));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    await api('/api/devices/link-code', { method: 'DELETE' }).catch(() => {});
    setCode(null);
  }

  return (
    <section className="card space-y-4">
      <div className="flex items-start gap-3">
        <span className="icon-tile"><Link2 className="h-5 w-5" /></span>
        <div>
          <h2 className="font-semibold">Link a new device <Badge tone="green">recommended</Badge></h2>
          <p className="mt-0.5 text-sm text-slate-600">
            Generate a one-time code, open this site on the other device or browser, and enter it there. That device then creates its
            <strong> own key pair</strong>.
          </p>
        </div>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {code ? (
        <div className="animate-fade-up rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-violet-50 p-5 text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-indigo-700">Your one-time link code</p>
          <p className="mt-2 select-all font-mono text-3xl font-bold tracking-[0.25em] text-slate-900">{code.code}</p>
          <p className="mt-2 text-xs text-slate-600">
            expires in {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')} · single use · waiting for the new device…
          </p>
          <div className="mt-4 rounded-xl bg-white/80 p-3 text-left text-sm text-slate-700">
            On the new device or browser, open <code className="text-indigo-700">{linkUrl}</code>, then enter your username and this code.
          </div>
          <div className="mt-3 flex justify-center gap-2">
            <CopyButton value={code.code} label="Copy code" />
            <CopyButton value={linkUrl} label="Copy link" />
            <button className="btn-ghost btn-sm" onClick={cancel}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="btn-primary" onClick={generate} disabled={busy}>
          <Link2 className="h-4 w-4" /> {busy ? 'Generating…' : 'Generate link code'}
        </button>
      )}
      <p className="text-xs text-slate-500">
        <strong>Demo on one laptop:</strong> open <strong>{linkUrl}</strong> in a Chrome <em>Incognito</em> window, then open DevTools →
        ⋮ → More tools → <em>WebAuthn</em> → enable the virtual authenticator → <em>Add</em>. That gives the window its own separate
        authenticator. Safari and other Chrome profiles usually share your passkeys through iCloud Keychain or Google Password Manager, so
        they count as the same device.
      </p>
    </section>
  );
}

export default function DevicesPage() {
  const router = useRouter();
  const [devices, setDevices] = useState<Device[]>([]);
  const [label, setLabel] = useState('Security key');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<React.ReactNode | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [authFailed, setAuthFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await api<{ devices: Device[] }>('/api/devices');
      setDevices(res.devices);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setAuthFailed(true);
      setError(errorMessage(err, 'Failed to load devices.'));
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
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

  const addHere = (e: React.FormEvent) => {
    e.preventDefault();
    const w = webauthnStatus();
    if (!w.ok) {
      setError(w.reason ?? 'WebAuthn is not available.');
      return;
    }
    setError(null);
    setInfo(null);
    setBusy(true);
    (async () => {
      try {
        const options = await withStepUp(() => post<RegOptions>('/api/devices/options'));
        const attResp = await startRegistration({ optionsJSON: options });
        await post('/api/devices/verify', { attResp, deviceLabel: label });
        setInfo(`“${label}” registered with its own key pair.`);
        await refresh();
      } catch (err) {
        const name = err instanceof Error ? err.name : '';
        if (name === 'NotAllowedError' || name === 'InvalidStateError') {
          setError(
            <>
              <strong>No second authenticator was available.</strong> This browser already holds a passkey for your account, so it
              offered the phone/QR option, which needs Bluetooth on both devices. Use <strong>Link a new device</strong> below instead,
              or plug in a USB/NFC security key and try again.
            </>,
          );
        } else {
          setError(errorMessage(err, 'Could not add device.'));
        }
      } finally {
        setBusy(false);
      }
    })();
  };

  const revoke = (d: Device) =>
    run(async () => {
      if (!confirm(`Revoke “${d.deviceLabel}”? Its key will never be accepted again and its sessions end now.`)) return;
      const res = await withStepUp(() =>
        post<{ ok: boolean; warning: string | null; endedSessions: number; signedOut: boolean }>(`/api/devices/${d.id}/revoke`),
      );
      if (res.signedOut) {
        router.push('/login');
        return;
      }
      setInfo(res.warning ?? `“${d.deviceLabel}” revoked; ${res.endedSessions} session(s) ended.`);
      await refresh();
    });

  const rename = (d: Device, deviceLabel: string) =>
    run(async () => {
      await api(`/api/devices/${d.id}`, { method: 'PATCH', body: JSON.stringify({ deviceLabel }) });
      await refresh();
    });

  if (!loaded) return <div className="card animate-pulse text-sm text-slate-500">Loading devices…</div>;
  if (authFailed) {
    return (
      <div className="card mx-auto max-w-lg space-y-4">
        <Alert kind="error">{error}</Alert>
        <Link href="/login" className="btn-primary">Go to login</Link>
      </div>
    );
  }

  const active = devices.filter((d) => !d.revokedAt);
  const revoked = devices.filter((d) => d.revokedAt);

  return (
    <div className="space-y-8">
      <PageHeader icon={Smartphone} eyebrow="Devices" title="Your devices & keys">
        Every device has its own key pair (FR-4). The server stores only public keys, so revoking one device never affects the others
        (FR-5). Adding or revoking a device needs a recent passkey check.
      </PageHeader>

      {error && <Alert kind="error">{error}</Alert>}
      {info && <Alert kind="success">{info}</Alert>}

      <section className="card">
        <h2 className="font-semibold">
          Active devices <span className="text-slate-400">({active.length})</span>
        </h2>
        {active.length === 0 && <p className="mt-3 text-sm text-slate-500">No active devices.</p>}
        <ul className="mt-4 space-y-3">
          {active.map((d) => (
            <DeviceCard key={d.id} d={d} busy={busy} onRevoke={() => revoke(d)} onRename={(n) => rename(d, n)} />
          ))}
        </ul>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <LinkDevicePanel onLinked={refresh} deviceCount={active.length} />

        <section className="card space-y-4">
          <div className="flex items-start gap-3">
            <span className="icon-tile"><KeyRound className="h-5 w-5" /></span>
            <div>
              <h2 className="font-semibold">Add a security key here</h2>
              <p className="mt-0.5 text-sm text-slate-600">
                Register another authenticator from <em>this</em> browser: a USB/NFC security key (e.g. YubiKey), or a phone via QR
                code (needs Bluetooth on both devices).
              </p>
            </div>
          </div>
          <form onSubmit={addHere} className="flex gap-2">
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={64} aria-label="Device name" />
            <button className="btn-secondary whitespace-nowrap" disabled={busy}>
              <Plus className="h-4 w-4" /> {busy ? 'Waiting…' : 'Add'}
            </button>
          </form>
        </section>
      </div>

      {revoked.length > 0 && (
        <section className="card">
          <h2 className="flex items-center gap-2 font-semibold">
            <ShieldOff className="h-4 w-4 text-slate-400" /> Revoked <span className="font-normal text-slate-400">(kept for audit)</span>
          </h2>
          <ul className="mt-3 divide-y divide-slate-100">
            {revoked.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm text-slate-500">
                <span className="line-through">{d.deviceLabel}</span>
                <span className="text-xs">
                  revoked {formatDate(d.revokedAt)} · <code>{d.publicKey.fingerprint.slice(0, 23)}…</code>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
