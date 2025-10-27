export function isAuthorizedCron(request) {
  const secret = process.env.OUTLOOK_SYNC_JOB_SECRET;
  if (!secret) {
    return true;
  }

  const vercelCronHeader = request.headers.get('x-vercel-cron');
  if (vercelCronHeader) {
    // Requests triggered by Vercel Cron include this header automatically.
    // Since cron definitions are managed in code (vercel.json), we accept it as proof of origin.
    return true;
  }

  const bearer = request.headers.get('authorization');
  if (bearer === `Bearer ${secret}`) {
    return true;
  }

  const legacySecret = request.headers.get('x-outlook-sync-secret');
  return legacySecret === secret;
}
