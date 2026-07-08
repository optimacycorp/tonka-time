import crypto from "node:crypto";

const passwordIterations = 210_000;
const passwordKeyLength = 32;
const passwordDigest = "sha256";

function pbkdf2Async(password: string, salt: string) {
  return new Promise<string>((resolve, reject) => {
    crypto.pbkdf2(password, salt, passwordIterations, passwordKeyLength, passwordDigest, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey.toString("hex"));
    });
  });
}

export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await pbkdf2Async(password, salt);
  return `pbkdf2$${passwordIterations}$${salt}$${derived}`;
}

export async function verifyPassword(password: string, passwordHash: string) {
  const [algorithm, iterationsText, salt, expected] = passwordHash.split("$");
  if (algorithm !== "pbkdf2" || !iterationsText || !salt || !expected) {
    return false;
  }

  const iterations = Number(iterationsText);
  if (!Number.isFinite(iterations) || iterations <= 0) {
    return false;
  }

  const derived = await new Promise<string>((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, passwordKeyLength, passwordDigest, (error, key) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(key.toString("hex"));
    });
  });

  return crypto.timingSafeEqual(Buffer.from(derived, "hex"), Buffer.from(expected, "hex"));
}

export function createSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createPhoneCode() {
  return `${crypto.randomInt(100000, 999999)}`;
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function normalizePhone(phone: string) {
  const digits = phone.replace(/\D+/g, "");
  return digits.startsWith("1") && digits.length === 11 ? `+${digits}` : `+1${digits}`;
}
