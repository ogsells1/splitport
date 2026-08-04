/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // @metamask/sdk pulls in an optional React Native storage dep that isn't
    // used on the web; alias it to false to silence the build-time warning.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@react-native-async-storage/async-storage": false,
    };
    return config;
  },

  // Baseline security headers. No Content-Security-Policy yet: Privy and Stripe
  // inject their own scripts and iframes, so a policy has to enumerate their
  // origins or it breaks sign-in outright - tracked separately in
  // SECURITY_AUDIT.md rather than shipped half-configured.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // The app moves money; it must never be wrapped in someone's iframe.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          // Vercel terminates TLS, so HSTS is safe to assert here.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
