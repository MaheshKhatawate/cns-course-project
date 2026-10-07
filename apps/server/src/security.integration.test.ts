// Full end-to-end runs of every security scenario: real HTTP server, real
// PostgreSQL, real ECDSA signatures from the software authenticator.
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { prisma } from './db.js';
import { runScenarios, scenarios } from './security/scenarios.js';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.close();
  await prisma.$disconnect();
});

describe('security scenarios (end-to-end)', () => {
  for (const s of scenarios) {
    it(`${s.expected === 'blocked' ? 'blocks' : 'allows'}: ${s.title}`, async () => {
      const [result] = await runScenarios(baseUrl, { only: [s.id] });
      expect(result.outcome, result.evidence).toBe(s.expected);
    });
  }
});
