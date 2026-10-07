// Runs every security scenario against a fresh in-process server using the
// configured DATABASE_URL and prints a report.  Usage: npm run demo:attacks
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { runScenarios } from '../src/security/scenarios.js';

async function main() {
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address() as AddressInfo;
  console.log('\nPasswordless authentication — attack simulation\n');
  const results = await runScenarios(`http://127.0.0.1:${port}`);
  for (const r of results) {
    const mark = r.passed ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    const outcome = r.outcome === 'blocked' ? 'BLOCKED' : r.outcome === 'allowed' ? 'ALLOWED' : 'ERROR';
    console.log(`${mark}  [${r.threat}] ${r.title}\n      → ${outcome} (expected ${r.expected}) · ${r.evidence}\n`);
  }
  const passed = results.filter((r) => r.passed).length;
  console.log(`${passed}/${results.length} scenarios behaved as expected.\n`);
  server.close();
  await prisma.$disconnect();
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
