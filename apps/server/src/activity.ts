import type { Request } from 'express';
import { prisma } from './db.js';

export async function logActivity(
  userId: string,
  type: string,
  message: string,
  opts: { deviceLabel?: string | null; req?: Request } = {},
) {
  try {
    await prisma.activityLog.create({
      data: {
        userId,
        type,
        message,
        deviceLabel: opts.deviceLabel ?? null,
        ip: opts.req?.ip ?? null,
      },
    });
  } catch {
    // Logging must never break authentication flows.
  }
}
