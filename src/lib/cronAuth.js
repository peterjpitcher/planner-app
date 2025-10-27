export function isAuthorizedCron(request) {
  const secret = process.env.OUTLOOK_SYNC_JOB_SECRET;
  if (!secret) {
    return true;
  }

  const bearer = request.headers.get('authorization');
  if (bearer === `Bearer ${secret}`) {
    return true;
  }

  const legacySecret = request.headers.get('x-outlook-sync-secret');
  return legacySecret === secret;
}
