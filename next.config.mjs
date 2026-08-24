/** @type {import('next').NextConfig} */

// Baseline security headers. The app holds a Microsoft OAuth integration and
// renders user-authored content, and shipped with none of these set.
//
// A Content-Security-Policy is deliberately NOT here: Next's App Router emits
// inline bootstrap scripts, so a useful policy needs per-request nonces and
// route-by-route testing. Adding a broken one is worse than adding none, so it
// stays a separate piece of work.
const securityHeaders = [
  // No third party has any reason to frame this app, and framing it is how a
  // clickjack against the one-click email action pages would start.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Send the origin to other sites, the full path only to ourselves, so a signed
  // email action token in a URL never leaves in a Referer header.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  // Two years, matching the preload list's minimum. Vercel serves HTTPS only.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
];

const nextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
