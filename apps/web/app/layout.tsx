import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Passwordless Auth — FIDO2/WebAuthn Demo',
  description: 'Academic CNS project: passwordless authentication using public-key cryptography.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-slate-200 bg-white">
          <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link href="/" className="text-sm font-bold tracking-tight">
              Passwordless<span className="text-slate-500"> · WebAuthn Demo</span>
            </Link>
            <div className="flex gap-4 text-sm">
              <Link href="/register" className="hover:underline">Register</Link>
              <Link href="/login" className="hover:underline">Login</Link>
              <Link href="/dashboard" className="hover:underline">Dashboard</Link>
              <Link href="/devices" className="hover:underline">Devices</Link>
              <Link href="/recovery" className="hover:underline">Recovery</Link>
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 pb-8 text-xs text-slate-500">
          Academic CNS prototype — not a production authentication system.
        </footer>
      </body>
    </html>
  );
}
