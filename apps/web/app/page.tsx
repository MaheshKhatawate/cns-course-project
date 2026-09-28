import Link from 'next/link';

const steps = [
  { title: 'No passwords', text: 'Nothing to phish, leak, or reuse. The server never sees a password because there is none.' },
  { title: 'Public-key cryptography', text: 'Each device creates a key pair. The private key never leaves the authenticator; only the public key is stored on the server.' },
  { title: 'FIDO2 / WebAuthn', text: 'Registration and login use the browser WebAuthn API with a platform authenticator or security key.' },
  { title: 'Challenge–response', text: 'The server sends a fresh random challenge; the authenticator signs it. Used challenges cannot be replayed.' },
];

export default function LandingPage() {
  return (
    <div className="space-y-8">
      <section className="card">
        <h1 className="text-2xl font-bold tracking-tight">
          Passwordless Authentication Using Public-Key Cryptography
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          A Cryptography and Network Security course project demonstrating FIDO2/WebAuthn:
          register a passkey, sign in with a challenge–response ceremony, manage multiple
          devices, and recover with a one-time code. No passwords — anywhere.
        </p>
        <div className="mt-4 flex gap-3">
          <Link href="/register" className="btn-primary">Register a passkey</Link>
          <Link href="/login" className="btn-secondary">Log in</Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {steps.map((s) => (
          <div key={s.title} className="card">
            <h2 className="font-semibold">{s.title}</h2>
            <p className="mt-1 text-sm text-slate-600">{s.text}</p>
          </div>
        ))}
      </section>

      <section className="card">
        <h2 className="font-semibold">Why replace passwords?</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li>Passwords are phishable, reusable across sites, and leak in database breaches.</li>
          <li>Public-key credentials are bound to this site (RP ID), so a fake site cannot reuse them.</li>
          <li>Each login signs a fresh server challenge, so captured responses cannot be replayed.</li>
          <li>Revoking one device does not affect your other devices.</li>
        </ul>
        <div className="mt-4 text-sm">
          <Link href="/recovery" className="underline">Lost your device? Use account recovery →</Link>
        </div>
      </section>
    </div>
  );
}
