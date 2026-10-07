'use client';

import { useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, Copy, Download, Info, XCircle, type LucideIcon } from 'lucide-react';
import type { CeremonyInspection } from '@/lib/inspect';

export function Alert({ kind, children }: { kind: 'error' | 'success' | 'info' | 'warning'; children: React.ReactNode }) {
  const { style, Icon } = {
    error: { style: 'border-rose-200 bg-rose-50/80 text-rose-800', Icon: XCircle },
    success: { style: 'border-emerald-200 bg-emerald-50/80 text-emerald-800', Icon: CheckCircle2 },
    warning: { style: 'border-amber-200 bg-amber-50/80 text-amber-900', Icon: AlertTriangle },
    info: { style: 'border-indigo-100 bg-indigo-50/60 text-indigo-900', Icon: Info },
  }[kind];
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`flex animate-fade-up gap-2.5 rounded-xl border p-3.5 text-sm ${style}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Badge({ tone = 'slate', children }: { tone?: 'slate' | 'green' | 'red' | 'amber' | 'blue' | 'violet'; children: React.ReactNode }) {
  const styles = {
    slate: 'bg-slate-100 text-slate-700 ring-slate-200',
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    red: 'bg-rose-50 text-rose-700 ring-rose-200',
    amber: 'bg-amber-50 text-amber-800 ring-amber-200',
    blue: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
    violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${styles}`}>{children}</span>;
}

export function PageHeader({ icon: Icon, eyebrow, title, children, actions }: { icon?: LucideIcon; eyebrow?: string; title: string; children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex animate-fade-up flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex items-start gap-4">
        {Icon && (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/25">
            <Icon className="h-6 w-6" />
          </span>
        )}
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
          {children && <p className="mt-1 max-w-2xl text-sm text-slate-600">{children}</p>}
        </div>
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ icon: Icon, label, children, footer }: { icon: LucideIcon; label: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="card flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</span>
        <span className="icon-tile h-8 w-8 rounded-lg">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div>{children}</div>
      {footer && <div className="mt-auto text-xs text-slate-500">{footer}</div>}
    </div>
  );
}

export function Steps({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2">
      {steps.map((s, i) => (
        <li key={s} className="flex flex-1 items-center gap-2">
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
              i < current ? 'bg-emerald-500 text-white' : i === current ? 'bg-indigo-600 text-white ring-4 ring-indigo-100' : 'bg-slate-100 text-slate-400'
            }`}
          >
            {i < current ? <Check className="h-4 w-4" /> : i + 1}
          </span>
          <span className={`hidden text-xs font-medium sm:block ${i <= current ? 'text-slate-800' : 'text-slate-400'}`}>{s}</span>
          {i < steps.length - 1 && <span className={`h-px flex-1 ${i < current ? 'bg-emerald-300' : 'bg-slate-200'}`} />}
        </li>
      ))}
    </ol>
  );
}

export function AuthCard({ icon: Icon, title, subtitle, children }: { icon: LucideIcon; title: string; subtitle: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md animate-fade-up">
      <div className="card space-y-5 p-8">
        <div className="space-y-3 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-500/30">
            <Icon className="h-7 w-7" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="text-sm text-slate-600">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 text-xs text-slate-400">
      <div className="h-px flex-1 bg-slate-200" /> {label} <div className="h-px flex-1 bg-slate-200" />
    </div>
  );
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn-secondary btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? 'Copied' : label}
    </button>
  );
}

export function RecoveryCodeBox({ code, username }: { code: string; username: string }) {
  function download() {
    const text = `Passwordless Demo (CNS) — recovery code\n\nUsername: ${username}\nRecovery code: ${code}\nCreated: ${new Date().toLocaleString()}\n\nUse this one-time code at /recovery to register a new passkey if you lose all your devices.\nIt stops working after it is used; a new one is issued then.\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `recovery-code-${username}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="animate-fade-up rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-5">
      <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
        <AlertTriangle className="h-4 w-4" /> Save your recovery code. It is shown only once.
      </p>
      <p className="mt-3 select-all rounded-xl border border-amber-200 bg-white/80 py-3 text-center font-mono text-xl font-bold tracking-[0.2em] text-slate-900">
        {code}
      </p>
      <div className="mt-3 flex justify-center gap-2">
        <CopyButton value={code} />
        <button type="button" className="btn-secondary btn-sm" onClick={download}>
          <Download className="h-3.5 w-3.5" /> Download
        </button>
      </div>
      <p className="mt-3 text-xs text-amber-900/70">
        The server keeps only a bcrypt hash. Use the code at <strong>Recovery</strong> to register a new passkey if you lose every
        device. It works once, then a new code is issued.
      </p>
    </div>
  );
}

function Flag({ on, name, title }: { on: boolean; name: string; title: string }) {
  return (
    <span
      title={title}
      className={`rounded-md px-1.5 py-0.5 font-mono text-xs ring-1 ring-inset ${on ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-50 text-slate-400 line-through ring-slate-200'}`}
    >
      {name}
    </span>
  );
}

export function CeremonyInspector({ ceremony }: { ceremony: CeremonyInspection }) {
  const s = ceremony.server as Record<string, unknown> | undefined;
  const short = (v: string, n = 28) => (v.length > n ? `${v.slice(0, n)}…` : v);
  const mono = (v: string, title?: string) => (
    <code title={title} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-slate-800">
      {v}
    </code>
  );
  const client: [string, React.ReactNode][] = [
    ['type', mono(ceremony.clientData.type)],
    ['challenge', mono(short(ceremony.clientData.challenge), ceremony.clientData.challenge)],
    ['origin', mono(ceremony.clientData.origin)],
  ];
  const auth: [string, React.ReactNode][] = [['credential id', mono(short(ceremony.credentialId), ceremony.credentialId)]];
  if (ceremony.authData) {
    auth.push(
      ['rpIdHash', mono(short(ceremony.authData.rpIdHash), ceremony.authData.rpIdHash)],
      [
        `flags ${ceremony.authData.flagsByte}`,
        <span key="f" className="flex flex-wrap gap-1">
          <Flag on={ceremony.authData.flags.UP} name="UP" title="User Present" />
          <Flag on={ceremony.authData.flags.UV} name="UV" title="User Verified (biometric / PIN)" />
          <Flag on={ceremony.authData.flags.BE} name="BE" title="Backup Eligible (synced passkey)" />
          <Flag on={ceremony.authData.flags.BS} name="BS" title="Backed up" />
          <Flag on={ceremony.authData.flags.AT} name="AT" title="Attested credential data included" />
        </span>,
      ],
      ['signCount', mono(String(ceremony.authData.signCount))],
    );
  }
  if (ceremony.signature) auth.push(['signature', <span key="s">{mono(short(ceremony.signature), ceremony.signature)} <span className="text-xs text-slate-500">DER · {ceremony.signature.length / 2} bytes</span></span>]);
  const checks: [string, string][] = s
    ? [
        ['Origin matches', String(s.origin)],
        ['RP ID hash matches', `SHA-256("${String(s.rpID)}")`],
        ['Signature valid', 'ECDSA verify with stored public key'],
        ['Counter increased', `${String(s.previousCounter)} → ${String(s.newCounter)}`],
        ['User verified', s.userVerified ? 'biometric / PIN' : 'presence only'],
        ['Challenge single-use', 'deleted after this login'],
      ]
    : [];

  const Section = ({ title, rows }: { title: string; rows: [string, React.ReactNode][] }) => (
    <div className="rounded-xl border border-slate-200 bg-white/70 p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</p>
      <dl className="space-y-2 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex flex-wrap items-center justify-between gap-2">
            <dt className="text-slate-500">{k}</dt>
            <dd className="break-all text-right">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <Section title="clientDataJSON (from the browser)" rows={client} />
        <Section title="authenticatorData + signature (from the key)" rows={auth} />
      </div>
      {checks.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {checks.map(([k, v]) => (
            <div key={k} className="flex items-start gap-2 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3 text-sm">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <div>
                <p className="font-medium text-emerald-900">{k}</p>
                <p className="break-all text-xs text-emerald-800/80">{v}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      {ceremony.kind === 'login' && (
        <p className="text-xs text-slate-500">
          Your authenticator signed <code>authenticatorData ‖ SHA-256(clientDataJSON)</code> with its private key. Changing any byte above
          would make the signature invalid.
        </p>
      )}
    </div>
  );
}
