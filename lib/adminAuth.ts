import { createHmac } from 'crypto';

const TOKEN_TTL_MS = 8 * 3600 * 1000; // 8 jam

function getSecret(): string {
  return process.env.ADMIN_SECRET || process.env.ADMIN_NIKS || '2510009,2511008';
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64');
}

export function isValidNik(nik: string): boolean {
  const raw = process.env.ADMIN_NIKS || '2510009,2511008';
  const allowed = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return allowed.includes(String(nik || '').trim());
}

export function createToken(nik: string): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ nik, exp: Date.now() + TOKEN_TTL_MS }));
  const sig = base64url(createHmac('sha256', getSecret()).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

export function verifyAdminToken(req: Request): boolean {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
    const token = authHeader.substring(7);
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [header, payload, sig] = parts;
    const expected = base64url(createHmac('sha256', getSecret()).update(`${header}.${payload}`).digest());
    if (sig.length !== expected.length) return false;
    let valid = true;
    for (let i = 0; i < sig.length; i++) {
      if (sig[i] !== expected[i]) valid = false;
    }
    if (!valid) return false;
    const data = JSON.parse(base64urlDecode(payload).toString());
    if (!data.nik || !isValidNik(data.nik)) return false;
    if (!data.exp || Date.now() > data.exp) return false;
    return true;
  } catch {
    return false;
  }
}
