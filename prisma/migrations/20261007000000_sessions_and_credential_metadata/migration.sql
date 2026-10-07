-- Stable WebAuthn user handle per user (backfilled with random base64url values).
ALTER TABLE "User" ADD COLUMN "webauthnUserId" TEXT;
UPDATE "User"
SET "webauthnUserId" = translate(encode(decode(md5(random()::text || "id"), 'hex'), 'base64'), '+/=', '-_')
WHERE "webauthnUserId" IS NULL;
ALTER TABLE "User" ALTER COLUMN "webauthnUserId" SET NOT NULL;
CREATE UNIQUE INDEX "User_webauthnUserId_key" ON "User"("webauthnUserId");
DROP INDEX IF EXISTS "User_username_idx";

-- Credential metadata (algorithm, authenticator model, synced vs device-bound).
ALTER TABLE "Credential" ADD COLUMN "algorithm" INTEGER;
ALTER TABLE "Credential" ADD COLUMN "aaguid" TEXT;
ALTER TABLE "Credential" ADD COLUMN "deviceType" TEXT;
ALTER TABLE "Credential" ADD COLUMN "backedUp" BOOLEAN NOT NULL DEFAULT false;
DROP INDEX IF EXISTS "Credential_credentialID_idx";

-- Server-side sessions (JWT jti) for logout, revocation and step-up re-authentication.
CREATE TABLE "Session" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "credentialId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastAuthAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "ip" TEXT,
  "userAgent" TEXT,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Session_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "Credential"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "Session_userId_idx" ON "Session"("userId");
