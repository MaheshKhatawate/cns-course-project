'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { KeyRound, LogOut, Menu, X } from 'lucide-react';
import { api, post, type MeResponse } from '@/lib/api';

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
    api<MeResponse>('/api/users/me')
      .then(setMe)
      .catch(() => setMe(null));
  }, [pathname]);

  async function logout() {
    await post('/api/auth/logout').catch(() => {});
    setMe(null);
    router.push('/login');
  }

  const links: [string, string][] = me
    ? [
        ['/dashboard', 'Dashboard'],
        ['/devices', 'Devices'],
        ['/recovery', 'Recovery'],
        ['/security', 'Security'],
      ]
    : [
        ['/login', 'Log in'],
        ['/link', 'Link device'],
        ['/recovery', 'Recovery'],
        ['/security', 'Security'],
      ];

  const linkClass = (href: string) =>
    `rounded-lg px-3 py-2 text-sm font-medium transition ${
      pathname === href ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
    }`;

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/70 bg-white/70 backdrop-blur-xl">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/30">
            <KeyRound className="h-5 w-5" />
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-bold tracking-tight">Passwordless</span>
            <span className="block text-[11px] text-slate-500">FIDO2 · WebAuthn</span>
          </span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {links.map(([href, label]) => (
            <Link key={href} href={href} className={linkClass(href)}>
              {label}
            </Link>
          ))}
        </div>

        <div className="hidden items-center gap-2 md:flex">
          {me ? (
            <>
              <span className="flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-3 text-sm">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-xs font-bold text-white">
                  {me.user.displayName.slice(0, 1).toUpperCase()}
                </span>
                {me.user.username}
              </span>
              <button onClick={logout} className="btn-ghost btn-sm" aria-label="Log out">
                <LogOut className="h-4 w-4" /> Log out
              </button>
            </>
          ) : (
            <Link href="/register" className="btn-primary btn-sm">
              Get started
            </Link>
          )}
        </div>

        <button className="btn-ghost btn-sm md:hidden" onClick={() => setOpen((v) => !v)} aria-label="Menu">
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </nav>

      {open && (
        <div className="border-t border-slate-200/70 bg-white px-4 py-3 md:hidden">
          <div className="flex flex-col gap-1">
            {links.map(([href, label]) => (
              <Link key={href} href={href} className={linkClass(href)}>
                {label}
              </Link>
            ))}
            {me ? (
              <button onClick={logout} className="btn-secondary mt-2">
                <LogOut className="h-4 w-4" /> Log out @{me.user.username}
              </button>
            ) : (
              <Link href="/register" className="btn-primary mt-2">
                Get started
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
