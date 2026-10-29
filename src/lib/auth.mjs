// Authentifizierung: scrypt-Passworthashes, serverseitige Sitzungen, TOTP-MFA (RFC 6238).
import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { config } from '../config.mjs';

export function hashPassword(pw) {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(pw, stored) {
  if (!stored || typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false; // Konto ohne Passwort (z. B. Einladung offen)
  const [alg, s, h] = String(stored || '').split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(h, 'base64');
  const got = scryptSync(String(pw), Buffer.from(s, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(expected, got);
}

// ---- TOTP ----
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Decode(str) {
  let bits = '';
  for (const c of str.replace(/=+$/, '').toUpperCase()) {
    const v = B32.indexOf(c);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
export function newTotpSecret() {
  const b = randomBytes(20); let out = '';
  for (let i = 0; i < 32; i++) out += B32[b[i % 20] % 32];
  return out;
}
export function totp(secret, t = Date.now(), step = 30) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(t / 1000 / step)));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const o = mac[mac.length - 1] & 0xf;
  const code = ((mac.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
  return code;
}
export function verifyTotp(secret, code) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  return [-1, 0, 1].some((w) => totp(secret, Date.now() + w * 30000) === c);
}

// ---- Sitzungen: verschlüsselte Cookies (AES-256-GCM) ----
// Instanzunabhängig (mehrere Serverless-Instanzen). Der Schlüssel liegt nur im privaten Zustand (meta.sessionKey).
// Abmelden/Sperren trägt die Sitzungs-ID in die Sperrliste "revoked" ein (serverseitig wirksam).
import { createCipheriv, createDecipheriv } from 'node:crypto';
import { getDb, persist } from './store.mjs';

const key = () => Buffer.from(getDb().meta.sessionKey, 'base64');
export function seal(obj, purpose) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  c.setAAD(Buffer.from(purpose));
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64url');
}
export function unseal(token, purpose) {
  try {
    const b = Buffer.from(String(token || ''), 'base64url');
    if (b.length < 29) return null;
    const d = createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
    d.setAAD(Buffer.from(purpose)); d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
  } catch { return null; }
}
export const isRevoked = (id) => getDb().revoked.some((r) => r.id === id);
export function revoke(id, ttlMs) {
  const db = getDb(); const t = Date.now();
  db.revoked = db.revoked.filter((r) => r.exp > t);
  if (!isRevoked(id)) db.revoked.push({ id, exp: t + ttlMs });
  persist();
}

export function createSession(userId, { mfaPending }) {
  return { id: randomBytes(18).toString('base64url'), userId, mfaPending, csrf: randomBytes(24).toString('base64url'), created: Date.now(), seen: Date.now() };
}
// Liefert die Sitzung oder null; "refresh" = Cookie mit neuem Leerlaufzeitpunkt nötig.
export function getSession(token) {
  const s = unseal(token, 'sid');
  if (!s) return null;
  const t = Date.now();
  if (t - s.created > config.sessionTtlMs || t - s.seen > config.idleTtlMs || isRevoked(s.id)) return null;
  s.refresh = t - s.seen > 15000;
  s.seen = t;
  return s;
}
export const destroySession = (s) => s && revoke(s.id, config.sessionTtlMs);

export function sessionCookie(s, maxAgeSec) {
  const v = s ? seal({ ...s, refresh: undefined }, 'sid') : '';
  return `bess_sid=${v}; Path=/; HttpOnly; SameSite=Strict${config.secureCookies ? '; Secure' : ''}${maxAgeSec != null ? `; Max-Age=${maxAgeSec}` : ''}`;
}
