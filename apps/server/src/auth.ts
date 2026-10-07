import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

export interface SessionClaims {
  sub: string; // user id
  username: string;
  jti: string; // server-side session id
  iat?: number;
  exp?: number;
}

export interface RecoveryClaims {
  sub: string;
  username: string;
  purpose: 'recovery';
  // Binds the token to the recovery code that was verified. Once the code is
  // rotated (after a successful recovery) the token stops working.
  gen: string;
}

const ALGORITHM = 'HS256';

export function signSession(userId: string, username: string, sessionId: string): string {
  return jwt.sign({ sub: userId, username, purpose: 'session' }, config.jwtSecret, {
    algorithm: ALGORITHM,
    expiresIn: config.jwtExpiresIn,
    jwtid: sessionId,
  } as jwt.SignOptions);
}

export function verifySession(token: string): SessionClaims {
  const decoded = jwt.verify(token, config.jwtSecret, { algorithms: [ALGORITHM] }) as SessionClaims & { purpose?: string };
  if (decoded.purpose !== 'session' || !decoded.jti) throw new jwt.JsonWebTokenError('Not a session token');
  return decoded;
}

export function recoveryGeneration(recoveryCodeHash: string): string {
  return crypto.createHash('sha256').update(recoveryCodeHash).digest('base64url').slice(0, 16);
}

export function signRecoveryToken(userId: string, username: string, recoveryCodeHash: string): string {
  return jwt.sign(
    { sub: userId, username, purpose: 'recovery', gen: recoveryGeneration(recoveryCodeHash) } satisfies RecoveryClaims,
    config.jwtSecret,
    { algorithm: ALGORITHM, expiresIn: config.recoveryTokenExpiresIn } as jwt.SignOptions,
  );
}

export function verifyRecoveryToken(token: string): RecoveryClaims {
  const decoded = jwt.verify(token, config.jwtSecret, { algorithms: [ALGORITHM] }) as RecoveryClaims;
  if (decoded.purpose !== 'recovery') throw new jwt.JsonWebTokenError('Not a recovery token');
  return decoded;
}
