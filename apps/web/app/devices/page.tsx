'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { startRegistration } from '@simplewebauthn/browser';
import { api, formatDate, webauthnStatus, type Device } from '@/lib/api';
import { Alert } from '@/components/ui';

type RegOptions = Parameters<typeof startRegistration>[0]['optionsJSON'];

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [label, setLabel] = useState('My new device');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  async function refresh() {
    try {
      const res = await api<{ devices: Device[] }>('/api/devices');
      setDevices(res.devices);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load devices.');
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function addDevice(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const w = webauthnStatus();
    if (!w.ok) {
      setError(w.reason ?? 'WebAuthn is not available.');
      return;
    }
    setBusy(true);
    try {
      const options = await api<RegOptions>('/api/devices/options', {
        method: 'POST',
        body: JSON.stringify({ deviceLabel: label }),
      });
      const attResp = await startRegistration({ optionsJSON: options });
      await api('/api/devices/verify', {
        method: 'POST',
        body: JSON.stringify({ attResp, deviceLabel: label }),
      });
      setInfo(`Device “${label}” registered.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add device.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string, name: string) {
    if (!confirm(`Revoke “${name}”? It will no longer be able to log in.`)) return;
    setError(null);
    setInfo(null);
    try {
      const res = await api<{ ok: boolean; warning: string | null }>(`/api/devices/${id}/revoke`, {
        method: 'POST',
      });
      setInfo(res.warning ?? `Device “${name}” revoked.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke device.');
    }
  }

  if (!loaded) return <div className="card">Loading…</div>;
  if (error && devices.length === 0) {
    return (
      <div className="card mx-auto max-w-lg space-y-4">
        <Alert kind="error">{error}</Alert>
        <Link href="/login" className="btn-primary inline-block">Go to login</Link>
      </div>
    );
  }

  const active = devices.filter((d) => !d.revokedAt);
  const revoked = devices.filter((d) => d.revokedAt);

  return (
    <div className="space-y-6">
      <div className="card">
        <h1 className="text-xl font-bold">Manage devices</h1>
        <p className="text-sm text-slate-600">
          Each device holds its own private key. Only public-key material is stored on the server.
        </p>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {info && <Alert kind="success">{info}</Alert>}

      <div className="card">
        <h2 className="font-semibold">Active devices ({active.length})</h2>
        {active.length === 0 && <p className="mt-2 text-sm text-slate-500">No active devices.</p>}
        <ul className="mt-2 divide-y divide-slate-100">
          {active.map((d) => (
            <li key={d.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <span className="font-medium">{d.deviceLabel}</span>
                <span className="text-slate-500">
                  {' '}· registered {formatDate(d.createdAt)} · last used {formatDate(d.lastUsedAt)}
                </span>
              </div>
              <button className="btn-danger" onClick={() => revoke(d.id, d.deviceLabel)}>Revoke</button>
            </li>
          ))}
        </ul>
      </div>

      {revoked.length > 0 && (
        <div className="card">
          <h2 className="font-semibold">Revoked (kept for audit)</h2>
          <ul className="mt-2 divide-y divide-slate-100">
            {revoked.map((d) => (
              <li key={d.id} className="py-2 text-sm text-slate-500">
                {d.deviceLabel} · revoked {formatDate(d.revokedAt)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <h2 className="font-semibold">Add another device</h2>
        <form onSubmit={addDevice} className="mt-2 flex gap-2">
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} required />
          <button className="btn-primary whitespace-nowrap" disabled={busy}>
            {busy ? 'Waiting…' : 'Add device'}
          </button>
        </form>
      </div>
    </div>
  );
}
