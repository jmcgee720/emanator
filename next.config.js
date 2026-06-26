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
          // CORS for /api/* is handled by /app/middleware.js — it picks
          // exactly ONE allowed origin from CORS_ORIGINS based on the
          // request's Origin header. Setting a comma-separated value
          // here would break every fetch (browsers reject multi-origin
          // ACAO). For non-API routes, we explicitly do NOT set
          // Access-Control-Allow-Origin since they're not CORS-relevant.
        ],
      },
      // Aggressive cache-busting for client components (aurora customizer, etc.)
      {
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        source: "/dashboard/:path*",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
      {
        source: "/projects/:path*",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
      // NOTE (Feb 2026 rewrite): COEP/COOP/CORP headers were removed
      // alongside WebContainers. The Fly preview iframe doesn't need
      // cross-origin isolation, and Firefox's "security configuration
      // doesn't match" block goes away once the parent stops setting
      // COEP. If we ever re-introduce SharedArrayBuffer features, gate
      // them on the specific route (not site-wide) to keep the preview
      // iframe loading cleanly.
    ];
  },
};

module.exports = nextConfig;
