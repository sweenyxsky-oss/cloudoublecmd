import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE = 'cdc_session';
const MAX_AGE = 12 * 60 * 60;

export function createSessions(password, { now = () => Date.now(), maxAttempts = 5, windowMs = 60_000 } = {}) {
  if (typeof password !== 'string' || password.length < 12) throw new Error('UI password must contain at least 12 characters');
  const expectedHash = createHash('sha256').update(password, 'utf8').digest();
  const key = randomBytes(32); // Restarting the service signs everyone out.
  const attempts = new Map();
  const sign = value => createHmac('sha256', key).update(value).digest('base64url');

  function limited(ip) {
    const recent = (attempts.get(ip) ?? []).filter(time => now() - time < windowMs);
    attempts.set(ip, recent);
    if (attempts.size > 10_000) attempts.clear();
    return recent.length >= maxAttempts;
  }

  return {
    login(ip, candidate) {
      if (limited(ip)) return { ok: false, limited: true };
      const hash = createHash('sha256').update(typeof candidate === 'string' ? candidate : '', 'utf8').digest();
      if (!timingSafeEqual(hash, expectedHash)) { attempts.get(ip).push(now()); return { ok: false, limited: false }; }
      attempts.delete(ip);
      const payload = `${Math.floor(now() / 1000) + MAX_AGE}.${randomBytes(12).toString('base64url')}`;
      return { ok: true, cookie: `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE}` };
    },
    valid(header = '') {
      const raw = header.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
      if (!raw) return false;
      const index = raw.lastIndexOf('.');
      if (index < 0) return false;
      const payload = raw.slice(0, index);
      const provided = Buffer.from(raw.slice(index + 1));
      const expected = Buffer.from(sign(payload));
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return false;
      return Number(payload.split('.')[0]) * 1000 > now();
    },
    clearCookie: `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
  };
}
