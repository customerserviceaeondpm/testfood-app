const activeTokens = new Map<string, { nik: string; expiresAt: number }>();

export function isValidNik(nik: string): boolean {
  const raw = process.env.ADMIN_NIKS || '2510009,2511008';
  const allowed = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return allowed.includes(String(nik || '').trim());
}

export function createToken(nik: string): string {
  const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
  const expiresAt = Date.now() + 8 * 3600 * 1000; // 8 jam
  activeTokens.set(token, { nik, expiresAt });
  return token;
}

export function verifyAdminToken(req: Request): boolean {
  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.substring(7);
  const session = activeTokens.get(token);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    activeTokens.delete(token);
    return false;
  }
  return true;
}
