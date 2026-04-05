// @type {import('next').NextConfig}
const path = require('path');

const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../'),
  // Next.js 16 uses Turbopack by default. The `@` alias is handled by
  // tsconfig paths — no custom webpack/turbopack config needed.
  turbopack: {},
  async rewrites() {
    const gatewayUrl = process.env.GATEWAY_URL;
    if (!gatewayUrl) return [];
    return [
      {
        source: '/api/v1/:path*',
        destination: `${gatewayUrl}/api/v1/:path*`,
      },
    ];
  },
};
module.exports = nextConfig;
