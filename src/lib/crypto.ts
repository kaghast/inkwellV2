/**
 * Note password hashing and verification using Web Crypto API (SHA-256 + Salt)
 */

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Generates a salted SHA-256 hash for password verification.
 * Format: saltHex:hashHex
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = bufferToHex(salt.buffer);

  const enc = new TextEncoder();
  const passBuffer = enc.encode(saltHex + ":" + password);

  const hashBuffer = await crypto.subtle.digest("SHA-256", passBuffer);
  const hashHex = bufferToHex(hashBuffer);

  return `${saltHex}:${hashHex}`;
}

/**
 * Verifies a plain password against a stored salted hash.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash || !password) return false;
  const parts = storedHash.split(":");
  if (parts.length !== 2) return false;

  const [saltHex, expectedHashHex] = parts;
  const enc = new TextEncoder();
  const passBuffer = enc.encode(saltHex + ":" + password);

  const hashBuffer = await crypto.subtle.digest("SHA-256", passBuffer);
  const hashHex = bufferToHex(hashBuffer);

  return hashHex === expectedHashHex;
}
