'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { startRegistration } from '@simplewebauthn/browser';
import { CheckCircle2, Fingerprint, Link2 } from 'lucide-react';
import { errorMessage, post, webauthnStatus } from '@/lib/api';
import { Alert, AuthCard, Steps } from '@/components/ui';

type RegOptions = Parameters<typeof startRegistration>[0]['optionsJSON'];

// Runs on the NEW device: approve with the one-time code, then create a key pair here.
export default function LinkDevicePage() {
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [deviceLabel, setDeviceLabel] = useState('New device');

  useEffect(() => setDeviceLabel(guessDeviceName()), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sameAuthenticator, setSameAuthenticator] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  async function link(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSameAuthenticator(false);
    const w = webauthnStatus();
    if (!w.ok) {
      setError(w.reason ?? 'WebAuthn is not available.');
      return;
    }
    setBusy(true);
    try {
      const options = await post<RegOptions>('/api/link/options', { username, code });
      const attResp = await startRegistration({ optionsJSON: options });
      await post('/api/link/verify', { username, attResp, deviceLabel });
      setDone(deviceLabel);
    } catch (err) {
      // InvalidStateError = this authenticator already holds one of the account's passkeys
      // (WebAuthn excludeCredentials). Common on one Mac: Safari and Chrome both use iCloud
      // Keychain / Google Password Manager, so a "different browser" is the same authenticator.
      if (err instanceof Error && err.name === 'InvalidStateError') setSameAuthenticator(true);
      else setError(errorMessage(err, 'Could not link this device.'));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthCard icon={CheckCircle2} title="Device linked" subtitle={<>“{done}” now has its own key pair and you are signed in on it.</>}>
        <Steps steps={['Approve', 'Create key', 'Done']} current={3} />
        <Alert kind="success">The private key was created on this device and never left it. The other device can see it in its device list.</Alert>
        <Link href="/dashboard" className="btn-primary w-full">Go to dashboard</Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      icon={Link2}
      title="Link this device"
      subtitle="On a device that is already signed in, go to Devices → Link a new device to get a one-time code."
    >
      <Steps steps={['Approve', 'Create key', 'Done']} current={busy ? 1 : 0} />
      {error && <Alert kind="error">{error}</Alert>}
      {sameAuthenticator && <SameAuthenticatorHelp />}
      <form onSubmit={link} className="space-y-4">
        <div>
          <label className="label" htmlFor="username">Username</label>
          <input id="username" className="input" value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="username" />
        </div>
        <div>
          <label className="label" htmlFor="code">One-time link code</label>
          <input
            id="code"
            className="input text-center font-mono text-lg tracking-[0.3em] uppercase"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            placeholder="XXXX-XXXX"
            autoComplete="one-time-code"
          />
        </div>
        <div>
          <label className="label" htmlFor="deviceLabel">Name this device</label>
          <input id="deviceLabel" className="input" value={deviceLabel} onChange={(e) => setDeviceLabel(e.target.value)} required maxLength={64} />
        </div>
        <button className="btn-primary w-full py-3" disabled={busy}>
          <Fingerprint className="h-4 w-4" /> {busy ? 'Waiting for your authenticator…' : 'Create passkey on this device'}
        </button>
      </form>
      <p className="text-center text-xs text-slate-500">Codes are single-use, expire after 10 minutes and lock after 5 wrong attempts.</p>
    </AuthCard>
  );
}

function SameAuthenticatorHelp() {
  return (
    <Alert kind="warning">
      <p className="font-semibold">This browser is not a separate device.</p>
      <p className="mt-1">
        It shares its passkey store (iCloud Keychain or Google Password Manager) with the browser you registered on, so it already holds
        a passkey for this account. WebAuthn refuses to register the same authenticator twice; this is the duplicate-device protection
        working. Your code is still valid. Pick a genuinely different authenticator and try again:
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          <strong>Demo on one laptop:</strong> open this page in a Chrome <strong>Incognito</strong> window → DevTools (⌥⌘I) → ⋮ → More
          tools → <strong>WebAuthn</strong> → tick &quot;Enable virtual authenticator environment&quot; → <strong>Add</strong>. Then
          click the button below.
        </li>
        <li>A USB/NFC security key (e.g. YubiKey).</li>
        <li>A second computer or phone that is not signed into the same Apple/Google account.</li>
      </ul>
    </Alert>
  );
}

function guessDeviceName(): string {
  if (typeof navigator === 'undefined') return 'New device';
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'device';
  return `${browser} on ${os}`;
}
