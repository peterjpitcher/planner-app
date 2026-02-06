import { getServerSession } from 'next-auth/next';
import { getToken } from 'next-auth/jwt';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

function parseAdminList(value) {
  return (value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function isAdminSession(session) {
  const adminIds = parseAdminList(process.env.ADMIN_USER_IDS);
  const adminEmails = parseAdminList(process.env.ADMIN_EMAILS);
  const userId = session?.user?.id || '';
  const email = session?.user?.email || '';
  return adminIds.includes(userId) || adminEmails.includes(email);
}

export function isDevelopment() {
  return process.env.NODE_ENV === 'development';
}

export async function getAuthContext(request, { requireAccessToken = true } = {}) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { session: null, accessToken: null };
  }

  if (!requireAccessToken) {
    return { session, accessToken: null };
  }

  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  const accessToken = token?.accessToken || null;

  return { session, accessToken };
}
