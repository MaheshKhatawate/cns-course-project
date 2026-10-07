// Shared types/utilities (used by both frontend and backend contracts)
export interface ApiError {
  error: string;
}

export type ActivityType =
  | 'REGISTRATION'
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILED'
  | 'DEVICE_ADDED'
  | 'DEVICE_REVOKED'
  | 'RECOVERY_USED'
  | 'RECOVERY_CODE_ROTATED'
  | 'STEP_UP'
  | 'DEVICE_LINK_CODE'
  | 'SESSION_REVOKED'
  | 'LOGOUT';

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  createdAt: string;
}

export interface PublicCredential {
  id: string;
  deviceLabel: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface PublicActivity {
  id: string;
  type: ActivityType;
  message: string;
  deviceLabel: string | null;
  createdAt: string;
}
