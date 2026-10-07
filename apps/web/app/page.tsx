import Link from 'next/link';
import {
  ArrowRight,
  Ban,
  Database,
  Fingerprint,
  KeyRound,
  Laptop,
  Lock,
  RefreshCw,
  Server,
  ShieldCheck,
  Smartphone,
  Zap,
} from 'lucide-react';

const features = [
  { icon: Ban, title: 'No shared secrets', text: 'Nothing to phish, leak, reuse or reset. There is no password column in the database.' },
  { icon: KeyRound, title: 'Public-key cryptography', text: 'Every device creates its own ECDSA P-256 key pair. The private key never leaves the authenticator.' },
  { icon: RefreshCw, title: 'Challenge–response', text: 'Each login signs a fresh 32-byte challenge that works once and expires in 5 minutes.' },
  { icon: Smartphone, title: 'Multi-device', text: 'Link laptops, phones and security keys to one account, and revoke a lost device instantly.' },
  { icon: Database, title: 'Breach-proof storage', text: 'The server keeps only public keys and bcrypt hashes. A stolen database cannot log anyone in.' },
  { icon: ShieldCheck, title: 'Attack-tested', text: '16 live attack scenarios, including phishing, replay, MITM and cloning, are blocked automatically.' },
];

const steps = [
  { icon: Fingerprint, title: 'Register', text: 'Your device generates a key pair after a fingerprint, face or PIN check. Only the public key is uploaded.' },
  { icon: Server, title: 'Challenge', text: 'At login the server sends a random challenge bound to this website and this login attempt.' },
  { icon: Lock, title: 'Sign & verify', text: 'The authenticator signs the challenge; the server verifies the signature with your public key.' },
];

const stats = [
  ['0', 'passwords stored'],
  ['~0.1 ms', 'to verify a login'],
  ['128-bit', 'ECDSA P-256 security'],
  ['16/16', 'attacks blocked'],
];

function FlowVisual() {
  return (
    <div className="card relative overflow-hidden p-6 sm:p-8">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(99,102,241,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(99,102,241,0.06)_1px,transparent_1px)] bg-[size:24px_24px]" />
      <div className="relative flex items-center justify-between gap-4">
        <div className="flex w-32 flex-col items-center gap-2 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/30">
            <Laptop className="h-8 w-8" />
          </span>
          <p className="text-sm font-semibold">Your device</p>
          <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700 ring-1 ring-rose-200">🔒 private key</span>
        </div>

        <div className="relative flex-1 space-y-6 py-4">
          <div className="relative h-px bg-gradient-to-r from-indigo-200 via-violet-300 to-indigo-200">
            <span className="absolute -top-3 animate-flow-rtl rounded-full bg-white px-2 py-0.5 font-mono text-[10px] text-indigo-700 shadow ring-1 ring-indigo-200">
              challenge
            </span>
          </div>
          <div className="relative h-px bg-gradient-to-r from-violet-200 via-indigo-300 to-violet-200">
            <span className="absolute -top-3 animate-flow-ltr rounded-full bg-white px-2 py-0.5 font-mono text-[10px] text-violet-700 shadow ring-1 ring-violet-200 [animation-delay:1.2s]">
              signature
            </span>
          </div>
        </div>

        <div className="flex w-32 flex-col items-center gap-2 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg">
            <Server className="h-8 w-8" />
          </span>
          <p className="text-sm font-semibold">Server</p>
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200">public key only</span>
        </div>
      </div>
      <p className="relative mt-6 text-center font-mono text-xs text-slate-500">
        verify(publicKey, authData ‖ SHA-256(clientData), signature) = ✓
      </p>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="space-y-20">
      <section className="grid animate-fade-up items-center gap-10 lg:grid-cols-2">
        <div className="space-y-6">
          <span className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white/70 px-3 py-1 text-xs font-medium text-indigo-700">
            <Zap className="h-3.5 w-3.5" /> CNS course project · Team 14 · KLE Tech
          </span>
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
            Sign in with a key, <span className="gradient-text">not a password.</span>
          </h1>
          <p className="max-w-xl text-lg text-slate-600">
            Passwordless authentication using public-key cryptography. Your device proves who you are by signing a one-time
            challenge, and no secret is ever typed, transmitted or stored.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/register" className="btn-primary px-5 py-3">
              Create a passkey <ArrowRight className="h-4 w-4" />
            </Link>
            <Link href="/login" className="btn-secondary px-5 py-3">
              Log in
            </Link>
            <Link href="/security" className="btn-ghost px-5 py-3">
              <ShieldCheck className="h-4 w-4" /> Attack simulator
            </Link>
          </div>
        </div>
        <FlowVisual />
      </section>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map(([v, l]) => (
          <div key={l} className="card p-5 text-center">
            <p className="text-2xl font-extrabold tracking-tight gradient-text">{v}</p>
            <p className="mt-1 text-xs font-medium uppercase tracking-wider text-slate-500">{l}</p>
          </div>
        ))}
      </section>

      <section className="space-y-8">
        <div className="text-center">
          <p className="eyebrow">How it works</p>
          <h2 className="mt-1 text-3xl font-bold tracking-tight">Three steps, zero secrets</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {steps.map((s, i) => (
            <div key={s.title} className="card card-hover relative">
              <span className="absolute right-5 top-5 text-5xl font-black text-slate-100">{i + 1}</span>
              <span className="icon-tile">
                <s.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 font-semibold">{s.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-8">
        <div className="text-center">
          <p className="eyebrow">Why it matters</p>
          <h2 className="mt-1 text-3xl font-bold tracking-tight">Built to fix what passwords break</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-slate-600">
            39% of breaches involve credential abuse (Verizon DBIR). Public-key credentials remove the shared secret that attackers steal.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="card card-hover">
              <span className="icon-tile">
                <f.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="card overflow-hidden bg-gradient-to-br from-indigo-600 to-violet-700 p-10 text-center text-white">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">See it resist real attacks</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-indigo-100">
          Run phishing, replay, man-in-the-middle, credential stuffing and cloned-key attacks against the live server, and watch every one fail.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/security" className="btn bg-white text-indigo-700 hover:bg-indigo-50">
            Open attack simulator <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="/register" className="btn border border-white/30 text-white hover:bg-white/10">
            Try it yourself
          </Link>
        </div>
      </section>
    </div>
  );
}
