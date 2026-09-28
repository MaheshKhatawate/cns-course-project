import jwt from 'jsonwebtoken';
import { config } from './config.js';

export interface SessionClaims {
  sub: string; // user id
  username: string;
}

export interface RecoveryClaims {
  sub: string;
  username: string;
  purpose: 'recovery';
}

export function signSession(userId: string, username: string): string {
  return jwt.sign({ sub: userId, username } satisfies SessionClaims, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  } as jwt.SignOptions);
}

export function verifySession(token: string): SessionClaims {
  return jwt.verify(token, config.jwtSecret) as SessionClaims;
}

export function signRecoveryToken(userId: string, username: string): string {
  return jwt.sign(
    { sub: userId, username, purpose: 'recovery' } satisfies RecoveryClaims,
    config.jwtSecret,
    { expiresIn: config.recoveryTokenExpiresIn } as jwt.SignOptions,
  );
}

export function verifyRecoveryToken(token: string): RecoveryClaims {
  const decoded = jwt.verify(token, config.jwtSecret) as RecoveryClaims;
  if (decoded.purpose !== 'recovery') throw new jwt.JsonWebTokenError('Not a recovery token');
  return decoded;
}
