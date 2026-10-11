import { isValidNik, createToken } from '@/lib/adminAuth';

export async function POST(req: Request) {
  const { nik } = await req.json();
  if (isValidNik(nik)) {
    const token = createToken(nik);
    return Response.json({ success: true, token });
  }
  return Response.json({ success: false, message: 'Invalid NIK' }, { status: 401 });
}
