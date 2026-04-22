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
      // ── WebContainer cross-origin isolation (Session 7/7) ──
      // StackBlitz WebContainers need SharedArrayBuffer, which the browser
      // only exposes to cross-origin-isolated contexts. We scope these to
      // the project dashboard + API so the public marketing pages still
      // load any third-party script (fonts, analytics, etc.).
      ...(process.env.NEXT_PUBLIC_WEBCONTAINERS_ENABLED === '1' ? [{
        source: "/project/(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      }] : []),
    ];
  },
};

module.exports = nextConfig;
