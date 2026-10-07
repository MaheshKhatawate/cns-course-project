import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { Nav } from '@/components/Nav';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });

export const metadata: Metadata = {
  title: 'Passwordless Auth — FIDO2/WebAuthn',
  description: 'CNS course project: passwordless authentication using public-key cryptography (FIDO2/WebAuthn).',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="flex flex-col">
        <Nav />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">{children}</main>
        <footer className="border-t border-slate-200/70 bg-white/60 backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <span>
              <span className="font-semibold text-slate-700">Passwordless</span> · Cryptography &amp; Network Security course project · Team 14 · KLE Tech
            </span>
            <span>FIDO2 / WebAuthn · ECDSA P-256 · Academic prototype</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
