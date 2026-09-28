'use client';

import { useState } from 'react';

export function Alert({ kind, children }: { kind: 'error' | 'success' | 'info'; children: React.ReactNode }) {
  const styles =
    kind === 'error'
      ? 'border-red-200 bg-red-50 text-red-800'
      : kind === 'success'
        ? 'border-green-200 bg-green-50 text-green-800'
        : 'border-slate-200 bg-slate-100 text-slate-700';
  return <div className={`rounded-lg border p-3 text-sm ${styles}`}>{children}</div>;
}

export function useBusy() {
  const [busy, setBusy] = useState(false);
  return { busy, setBusy };
}
