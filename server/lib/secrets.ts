// AES-256-GCM encryption for third-party secrets stored in the database
// (Google refresh tokens, AI provider API keys). Moved from server.ts
// unchanged, so values encrypted before the move still decrypt.
import crypto from "crypto";

let fallbackMaterial = "";

/** Called once at boot with the JWT secret, used when INTEGRATION_ENCRYPTION_KEY is unset. */
export function initSecrets(jwtSecret: string) {
  fallbackMaterial = jwtSecret;
}

function integrationKey(): Buffer {
  if (!process.env.INTEGRATION_ENCRYPTION_KEY && !fallbackMaterial) throw new Error("Secrets not initialised");
  const material = process.env.INTEGRATION_ENCRYPTION_KEY || `inkwell-integrations:${fallbackMaterial}`;
  return crypto.createHash("sha256").update(material).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", integrationKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const [v, iv, tag, enc] = payload.split(":");
  if (v !== "v1" || !iv || !tag || !enc) throw new Error("Unknown secret format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", integrationKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(enc, "base64")), decipher.final()]).toString("utf8");
}
