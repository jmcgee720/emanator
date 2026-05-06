const nextConfig = {
  output: 'standalone',
  images: {
    unoptimized: true,
  },
  experimental: {
    serverMinification: false,
  },
  webpack(config, { dev }) {
    if (dev) {
      config.watchOptions = {
        poll: 3000,
        aggregateTimeout: 500,
        ignored: ['**/node_modules', '**/.next', '**/.git', '**/test_reports'],
      };
      config.cache = { type: 'filesystem' };
    }
    return config;
  },
  onDemandEntries: {
    maxInactiveAge: 30000,
    pagesBufferLength: 3,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "ALLOWALL" },
          { key: "Content-Security-Policy", value: "frame-ancestors *;" },
          { key: "Access-Control-Allow-Origin", value: process.env.CORS_ORIGINS || "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, PUT, DELETE, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "*" },
        ],
      },
      // ── WebContainer cross-origin isolation ──
      // StackBlitz WebContainers need SharedArrayBuffer, which the browser
      // only exposes to cross-origin-isolated contexts.
      // We use COEP: credentialless so existing third-party resources
      // (fonts, analytics, embedded iframes from auroraly's preview snapshots)
      // continue to load without requiring CORP headers on every resource.
      // Scoped to the entire site since the dashboard lives at "/" and
      // the route guards via NEXT_PUBLIC_WEBCONTAINERS_ENABLED let us roll
      // this out behind a flag.
      ...(process.env.NEXT_PUBLIC_WEBCONTAINERS_ENABLED === '1' ? [{
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
          // Resource policy for our own assets so cross-isolated pages can use them
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
        ],
      }] : []),
    ];
  },
};

module.exports = nextConfig;
