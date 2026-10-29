import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export function randomId(length = 12): string {
  const bytes = randomBytes(length);
  let id = "";
  for (const byte of bytes) id += ALPHABET[byte % ALPHABET.length];
  return id;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function loadMasterKey(dataDir: string): string {
  const fromEnv = process.env.OPEN_SILA_KEY?.trim();
  if (fromEnv) {
    if (!/^[0-9a-fA-F]{64}$/.test(fromEnv)) throw new Error("OPEN_SILA_KEY must be 64 hex characters (32 bytes).");
    return fromEnv.toLowerCase();
  }
  const file = join(dataDir, "master.key");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  mkdirSync(dataDir, { recursive: true });
  const key = randomBytes(32).toString("hex");
  writeFileSync(file, `${key}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  return key;
}
