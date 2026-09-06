/**
 * The client holds no secrets and makes no authorization decisions. Only the API base URL is
 * exposed to the browser, and no third-party origin is reachable from the page, which is what makes
 * holding the access token in memory defensible.
 *
 * The content security policy is not here. A deployed policy carries a per-request nonce, which a
 * static header cannot express, so it is built in `src/middleware.ts` instead. The headers below
 * are the ones that are the same on every response.
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          // Member data is on these pages; nothing here should sit in a cache.
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ];
  },
};

export default nextConfig;
