// Security scenarios: each one plays an attacker (or a legitimate user) against the
// real HTTP API using the software authenticator, and records whether the server
// allowed or blocked it. Used by the integration tests, `npm run demo:attacks`
// and the "Attack simulator" on the web app's Security page.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { SoftAuthenticator } from './softAuthenticator.js';
import { SIMULATOR_HEADER, SIMULATOR_TOKEN } from './simulatorToken.js';

export interface ApiResult {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export class ApiClient {
  cookie: string | null = null;
  constructor(
    private baseUrl: string,
    public origin: string = config.webOrigin,
  ) {}

  async call(method: string, path: string, body?: unknown, extra: { origin?: string; cookie?: string | null } = {}): Promise<ApiResult> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Origin: extra.origin ?? this.origin,
      [SIMULATOR_HEADER]: SIMULATOR_TOKEN,
    };
    const cookie = extra.cookie !== undefined ? extra.cookie : this.cookie;
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(this.baseUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      if (pair.startsWith('session=')) this.cookie = pair === 'session=' ? null : pair;
    }
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }
  post(path: string, body?: unknown, extra?: { origin?: string; cookie?: string | null }) {
    return this.call('POST', path, body ?? {}, extra);
  }
  get(path: string) {
    return this.call('GET', path);
  }
}

export interface ScenarioResult {
  id: string;
  title: string;
  threat: string;
  expected: 'allowed' | 'blocked';
  outcome: 'allowed' | 'blocked' | 'error';
  passed: boolean;
  evidence: string;
  durationMs: number;
}

interface Ctx {
  baseUrl: string;
  newClient(): ApiClient;
  newAuthenticator(): SoftAuthenticator;
}

interface Scenario {
  id: string;
  title: string;
  threat: string;
  expected: 'allowed' | 'blocked';
  run(ctx: Ctx): Promise<{ outcome: 'allowed' | 'blocked'; evidence: string }>;
}

const uname = (p: string) => `${p}-${crypto.randomBytes(4).toString('hex')}`;
const blockedIf = (cond: boolean) => (cond ? 'blocked' : 'allowed') as 'allowed' | 'blocked';
const fmt = (r: ApiResult) => `HTTP ${r.status}${r.body?.error ? ` — "${r.body.error}"` : ''}`;

function expectOk(r: ApiResult, step: string) {
  if (r.status >= 400) throw new Error(`${step} failed unexpectedly: ${fmt(r)}`);
  return r;
}

// Usernames created by scenarios, so the simulator can clean up after itself.
const created = new Set<string>();

export async function registerUser(client: ApiClient, auth: SoftAuthenticator, username = uname('sim'), deviceLabel = 'Laptop') {
  created.add(username);
  const opts = expectOk(await client.post('/api/auth/register-options', { username }), 'register-options');
  const attResp = auth.create(opts.body);
  const v = expectOk(await client.post('/api/auth/register-verify', { username, attResp, deviceLabel }), 'register-verify');
  return { username, recoveryCode: v.body.recoveryCode as string, credentialId: attResp.id };
}

export async function login(client: ApiClient, auth: SoftAuthenticator, username?: string, overrides = {}) {
  const opts = expectOk(await client.post('/api/auth/login-options', username ? { username } : {}), 'login-options');
  const assertionResponse = auth.get(opts.body.options, overrides);
  return client.post('/api/auth/login-verify', { flowId: opts.body.flowId, assertionResponse });
}

export const scenarios: Scenario[] = [
  {
    id: 'baseline-login',
    title: 'Legitimate registration and passkey login',
    threat: 'Baseline: the honest user must still get in',
    expected: 'allowed',
    async run(ctx) {
      const c = ctx.newClient();
      const a = ctx.newAuthenticator();
      const { username } = await registerUser(c, a);
      await c.post('/api/auth/logout');
      const r = await login(c, a, username);
      const me = await c.get('/api/users/me');
      return {
        outcome: blockedIf(r.status !== 200 || me.status !== 200),
        evidence: `login ${fmt(r)}, /api/users/me ${fmt(me)}, counter ${r.body?.verification?.previousCounter}→${r.body?.verification?.newCounter}`,
      };
    },
  },
  {
    id: 'usernameless-login',
    title: 'Usernameless login with a discoverable passkey',
    threat: 'Baseline: usability without typing anything',
    expected: 'allowed',
    async run(ctx) {
      const c = ctx.newClient();
      const a = ctx.newAuthenticator();
      const { username } = await registerUser(c, a);
      await c.post('/api/auth/logout');
      const r = await login(c, a);
      return {
        outcome: blockedIf(r.status !== 200 || r.body?.user?.username !== username),
        evidence: `${fmt(r)}; server identified the user from the signed userHandle as "${r.body?.user?.username}"`,
      };
    },
  },
  {
    id: 'db-leak',
    title: 'Server database leak reveals no usable secret',
    threat: 'Server-side breach',
    expected: 'blocked',
    async run(ctx) {
      const c = ctx.newClient();
      const a = ctx.newAuthenticator();
      const { username, recoveryCode } = await registerUser(c, a);
      const user = await prisma.user.findUniqueOrThrow({ where: { username }, include: { credentials: true } });
      const dump = JSON.stringify(user, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
      const leakedRecovery = dump.includes(recoveryCode) || dump.includes(recoveryCode.replace(/-/g, ''));
      const hasPrivateKeyField = /"d"\s*:|PRIVATE KEY/.test(dump);
      // An attacker holding only the DB row still cannot log in: they cannot sign the challenge.
      const attacker = ctx.newClient();
      const attackerAuth = ctx.newAuthenticator();
      const opts = await attacker.post('/api/auth/login-options', { username });
      attackerAuth.create({
        challenge: 'AA',
        rp: { id: config.rpID, name: 'attacker' },
        user: { id: user.webauthnUserId, name: username, displayName: username },
        pubKeyCredParams: [],
      });
      const forged = attackerAuth.get({ ...opts.body.options, allowCredentials: [] });
      forged.id = forged.rawId = user.credentials[0].credentialID; // claim to be the victim's credential
      const r = await attacker.post('/api/auth/login-verify', { flowId: opts.body.flowId, assertionResponse: forged });
      return {
        outcome: blockedIf(!leakedRecovery && !hasPrivateKeyField && r.status === 401),
        evidence: `DB holds only a COSE public key (${user.credentials[0].publicKey.length} b64 chars) and a bcrypt hash (${user.recoveryCodeHash?.slice(0, 7)}…); login with a forged signature: ${fmt(r)}`,
      };
    },
  },
  {
    id: 'phishing-origin',
    title: 'Phishing: assertion relayed from a look-alike site',
    threat: 'Phishing & spoofing',
    expected: 'blocked',
    async run(ctx) {
      const c = ctx.newClient();
      const a = ctx.newAuthenticator();
      const { username } = await registerUser(c, a);
      const attacker = ctx.newClient();
      const r = await login(attacker, a, username, { origin: 'https://login-secure-bank.example' });
      return { outcome: blockedIf(r.status === 401), evidence: `clientDataJSON.origin = https://login-secure-bank.example → ${fmt(r)}` };
    },
  },
  {
    id: 'phishing-rpid',
    title: 'Phishing: key scoped to a different RP ID',
    threat: 'Phishing & spoofing',
    expected: 'blocked',
    async run(ctx) {
      const c = ctx.newClient();
      const a = ctx.newAuthenticator();
      const { username } = await registerUser(c, a);
      const r = await login(ctx.newClient(), a, username, { rpId: 'evil.example' });
      return { outcome: blockedIf(r.status === 401), evidence: `authenticatorData.rpIdHash = SHA-256("evil.example") → ${fmt(r)}` };
    },
  },
  {
    id: 'replay',
    title: 'Replay: resubmitting a captured login response',
    threat: 'Replay attack',
    expected: 'blocked',
    async run(ctx) {
      const c = ctx.newClient();
      const a = ctx.newAuthenticator();
      const { username } = await registerUser(c, a);
      const opts = await c.post('/api/auth/login-options', { username });
      const body = { flowId: opts.body.flowId, assertionResponse: a.get(opts.body.options) };
      const first = await c.post('/api/auth/login-verify', body);
      const replay = await ctx.newClient().post('/api/auth/login-verify', body);
      return { outcome: blockedIf(first.status === 200 && replay.status >= 400), evidence: `original ${fmt(first)}; replay ${fmt(replay)}` };
    },
  },
  {
    id: 'mitm-challenge-swap',
    title: 'Man-in-the-middle swaps the challenge in a signed response',
    threat: 'Man-in-the-middle tampering',
    expected: 'blocked',
    async run(ctx) {
      const c = ctx.newClient();
      const a = ctx.newAuthenticator();
      const { username } = await registerUser(c, a);
      const victim = await c.post('/api/auth/login-options', { username });
      const signed = a.get(victim.body.options);
      const attacker = ctx.newClient();
      const fresh = await attacker.post('/api/auth/login-options', { username });
      const cd = JSON.parse(Buffer.from(signed.response.clientDataJSON, 'base64url').toString());
      cd.challenge = fresh.body.options.challenge;
      signed.response.clientDataJSON = Buffer.from(JSON.stringify(cd)).toString('base64url');
      const r = await attacker.post('/api/auth/login-verify', { flowId: fresh.body.flowId, assertionResponse: signed });
      return { outcome: blockedIf(r.status === 401), evidence: `edited clientDataJSON no longer matches the ECDSA signature → ${fmt(r)}` };
    },
  },
  {
    id: 'forged-signature',
    title: 'Forged / tampered signature',
    threat: 'Brute-force & forgery',
    expected: 'blocked',
    async run(ctx) {
      const c = ctx.newClient();
      const a = ctx.newAuthenticator();
      const { username } = await registerUser(c, a);
      const opts = await c.post('/api/auth/login-options', { username });
      const resp = a.get(opts.body.options);
      const sig = Buffer.from(resp.response.signature, 'base64url');
      sig[sig.length - 1] ^= 0xff;
      resp.response.signature = sig.toString('base64url');
      const r = await c.post('/api/auth/login-verify', { flowId: opts.body.flowId, assertionResponse: resp });
      return { outcome: blockedIf(r.status === 401), evidence: `one flipped signature byte → ${fmt(r)}` };
    },
  },
  {
    id: 'credential-stuffing',
    title: "Credential stuffing: logging into a victim's account with the attacker's key",
    threat: 'Credential stuffing & reuse',
    expected: 'blocked',
    async run(ctx) {
      const victim = await registerUser(ctx.newClient(), ctx.newAuthenticator());
      const attacker = ctx.newClient();
      const attackerAuth = ctx.newAuthenticator();
      await registerUser(attacker, attackerAuth);
      const opts = await attacker.post('/api/auth/login-options', { username: victim.username });
      const resp = attackerAuth.get({ ...opts.body.options, allowCredentials: [] });
      const r = await attacker.post('/api/auth/login-verify', { flowId: opts.body.flowId, assertionResponse: resp });
      return { outcome: blockedIf(r.status === 401), evidence: `attacker's valid passkey presented for "${victim.username}" → ${fmt(r)}` };
    },
  },
  {
    id: 'cloned-authenticator',
    title: 'Cloned authenticator detected by the signature counter',
    threat: 'Key extraction / device cloning',
    expected: 'blocked',
    async run(ctx) {
      const c = ctx.newClient();
      const a = ctx.newAuthenticator();
      const { username } = await registerUser(c, a);
      const clone = a.clone();
      const genuine = await login(c, a, username); // counter → 1
      const second = await login(c, a, username); // counter → 2
      const cloned = await login(ctx.newClient(), clone, username); // clone sends counter 1
      return {
        outcome: blockedIf(genuine.status === 200 && second.status === 200 && cloned.status === 401),
        evidence: `genuine counter 1, 2 accepted; clone presents counter 1 → ${fmt(cloned)}`,
      };
    },
  },
  {
    id: 'revoked-device',
    title: 'Lost device is revoked and can no longer sign in',
    threat: 'Lost / stolen device',
    expected: 'blocked',
    async run(ctx) {
      const c = ctx.newClient();
      const laptop = ctx.newAuthenticator();
      const phone = ctx.newAuthenticator();
      const { username } = await registerUser(c, laptop);
      const addOpts = expectOk(await c.post('/api/devices/options', {}), 'add-device options');
      const att = phone.create(addOpts.body);
      expectOk(await c.post('/api/devices/verify', { attResp: att, deviceLabel: 'Phone' }), 'add-device verify');
      const phoneClient = ctx.newClient();
      expectOk(await login(phoneClient, phone, username), 'phone login');
      const devices = await c.get('/api/devices');
      const phoneDev = devices.body.devices.find((d: { deviceLabel: string }) => d.deviceLabel === 'Phone');
      const rev = expectOk(await c.post(`/api/devices/${phoneDev.id}/revoke`), 'revoke');
      const phoneSession = await phoneClient.get('/api/users/me');
      // The server no longer lists the revoked key, so the thief tries the usernameless flow.
      const r = await login(ctx.newClient(), phone);
      return {
        outcome: blockedIf(r.status === 401 && phoneSession.status === 401),
        evidence: `revoke ended ${rev.body.endedSessions} session(s); stolen phone's open session → ${fmt(phoneSession)}; new login with phone → ${fmt(r)}`,
      };
    },
  },
  {
    id: 'session-after-logout',
    title: 'Stolen session cookie reused after logout',
    threat: 'Session hijacking',
    expected: 'blocked',
    async run(ctx) {
      const c = ctx.newClient();
      await registerUser(c, ctx.newAuthenticator());
      const stolen = c.cookie;
      await c.post('/api/auth/logout');
      const thief = ctx.newClient();
      thief.cookie = stolen;
      const r = await thief.get('/api/users/me');
      return { outcome: blockedIf(r.status === 401), evidence: `JWT still unexpired, but its server-side session is revoked → ${fmt(r)}` };
    },
  },
  {
    id: 'step-up',
    title: 'Stale session cannot revoke devices without a fresh passkey check',
    threat: 'Session hijacking (unattended device)',
    expected: 'blocked',
    async run(ctx) {
      const c = ctx.newClient();
      const a = ctx.newAuthenticator();
      await registerUser(c, a);
      const me = await c.get('/api/users/me');
      await prisma.session.update({ where: { id: me.body.session.id }, data: { lastAuthAt: new Date(Date.now() - 60 * 60 * 1000) } });
      const devices = await c.get('/api/devices');
      const r = await c.post(`/api/devices/${devices.body.devices[0].id}/revoke`);
      const ro = await c.post('/api/auth/reauth-options');
      const rv = await c.post('/api/auth/reauth-verify', { assertionResponse: a.get(ro.body) });
      return {
        outcome: blockedIf(r.status === 403 && r.body.code === 'REAUTH_REQUIRED' && rv.status === 200),
        evidence: `revoke with 1-hour-old auth → ${fmt(r)}; after signing a step-up challenge → HTTP ${rv.status}`,
      };
    },
  },
  {
    id: 'username-takeover',
    title: 'Attaching a new passkey to an existing username',
    threat: 'Account takeover',
    expected: 'blocked',
    async run(ctx) {
      const victim = await registerUser(ctx.newClient(), ctx.newAuthenticator());
      const r = await ctx.newClient().post('/api/auth/register-options', { username: victim.username });
      return { outcome: blockedIf(r.status === 409), evidence: `register-options for "${victim.username}" → ${fmt(r)}` };
    },
  },
  {
    id: 'recovery-bruteforce',
    title: 'Brute-forcing the recovery code',
    threat: 'Brute-force',
    expected: 'blocked',
    async run(ctx) {
      const { username } = await registerUser(ctx.newClient(), ctx.newAuthenticator());
      const attacker = ctx.newClient();
      const statuses: number[] = [];
      for (let i = 0; i < config.recoveryAttemptsPer15Min + 2; i++) {
        const r = await attacker.post('/api/recovery/verify', { username, recoveryCode: `GUES-S${i}AA-AAAA-AAAA` });
        statuses.push(r.status);
      }
      return {
        outcome: blockedIf(statuses.includes(429) && !statuses.includes(200)),
        evidence: `responses: ${statuses.join(', ')} (~79-bit code + ${config.recoveryAttemptsPer15Min} guesses / 15 min)`,
      };
    },
  },
  {
    id: 'recovery-reuse',
    title: 'Reusing a recovery code after it was used',
    threat: 'Recovery abuse',
    expected: 'blocked',
    async run(ctx) {
      const { username, recoveryCode } = await registerUser(ctx.newClient(), ctx.newAuthenticator());
      const c = ctx.newClient();
      const v = expectOk(await c.post('/api/recovery/verify', { username, recoveryCode }), 'recovery verify');
      const token = v.body.recoveryToken;
      const ro = expectOk(await c.post('/api/recovery/register-options', { username, recoveryToken: token }), 'recovery options');
      const newAuth = ctx.newAuthenticator();
      const rv = expectOk(
        await c.post('/api/recovery/register-verify', { username, recoveryToken: token, attResp: newAuth.create(ro.body), deviceLabel: 'New phone' }),
        'recovery verify',
      );
      const again = await ctx.newClient().post('/api/recovery/verify', { username, recoveryCode });
      const tokenAgain = await ctx.newClient().post('/api/recovery/register-options', { username, recoveryToken: token });
      return {
        outcome: blockedIf(again.status === 401 && tokenAgain.status === 401 && typeof rv.body.recoveryCode === 'string'),
        evidence: `recovery succeeded and issued a new code; old code → ${fmt(again)}; old recovery token → ${fmt(tokenAgain)}`,
      };
    },
  },
  {
    id: 'device-link',
    title: 'Linking a second device with a one-time code',
    threat: 'Baseline: multi-device enrolment (FR-4)',
    expected: 'allowed',
    async run(ctx) {
      const laptop = ctx.newClient();
      const { username } = await registerUser(laptop, ctx.newAuthenticator());
      const code = expectOk(await laptop.post('/api/devices/link-code'), 'link-code');
      const phone = ctx.newClient();
      const phoneAuth = ctx.newAuthenticator();
      const opts = expectOk(await phone.post('/api/link/options', { username, code: code.body.code }), 'link options');
      const v = await phone.post('/api/link/verify', { username, attResp: phoneAuth.create(opts.body), deviceLabel: 'Phone' });
      const reuse = await ctx.newClient().post('/api/link/options', { username, code: code.body.code });
      const devices = await laptop.get('/api/devices');
      return {
        outcome: blockedIf(v.status !== 200 || devices.body.devices.length !== 2 || reuse.status !== 401),
        evidence: `link ${fmt(v)}; account now has ${devices.body.devices.length} devices with separate key pairs; reusing the code → ${fmt(reuse)}`,
      };
    },
  },
  {
    id: 'link-code-guess',
    title: 'Guessing a device link code to add an attacker device',
    threat: 'Account takeover',
    expected: 'blocked',
    async run(ctx) {
      const victim = ctx.newClient();
      const { username } = await registerUser(victim, ctx.newAuthenticator());
      expectOk(await victim.post('/api/devices/link-code'), 'link-code');
      const attacker = ctx.newClient();
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) statuses.push((await attacker.post('/api/link/options', { username, code: `ZZZZ-ZZZ${i}` })).status);
      return {
        outcome: blockedIf(!statuses.includes(200)),
        evidence: `guesses → ${statuses.join(', ')} (code invalidated after 5 wrong attempts; ~39-bit code, 10-min lifetime)`,
      };
    },
  },
  {
    id: 'csrf',
    title: 'Cross-site request forgery with the victim’s cookie',
    threat: 'CSRF',
    expected: 'blocked',
    async run(ctx) {
      const c = ctx.newClient();
      await registerUser(c, ctx.newAuthenticator());
      const r = await c.post('/api/sessions/revoke-others', {}, { origin: 'https://evil.example' });
      return { outcome: blockedIf(r.status === 403), evidence: `POST from Origin https://evil.example → ${fmt(r)}` };
    },
  },
];

export async function runScenarios(baseUrl: string, opts: { only?: string[]; cleanup?: boolean } = {}): Promise<ScenarioResult[]> {
  const { only, cleanup = true } = opts;
  const ctx: Ctx = {
    baseUrl,
    newClient: () => new ApiClient(baseUrl),
    newAuthenticator: () => new SoftAuthenticator({ origin: config.origin, rpId: config.rpID }),
  };
  const results: ScenarioResult[] = [];
  for (const s of scenarios.filter((x) => !only || only.includes(x.id))) {
    const started = performance.now();
    try {
      const { outcome, evidence } = await s.run(ctx);
      results.push({ id: s.id, title: s.title, threat: s.threat, expected: s.expected, outcome, passed: outcome === s.expected, evidence, durationMs: Math.round(performance.now() - started) });
    } catch (err) {
      results.push({ id: s.id, title: s.title, threat: s.threat, expected: s.expected, outcome: 'error', passed: false, evidence: err instanceof Error ? err.message : String(err), durationMs: Math.round(performance.now() - started) });
    }
  }
  if (cleanup && created.size > 0) {
    await prisma.user.deleteMany({ where: { username: { in: [...created] } } });
    created.clear();
  }
  return results;
}
