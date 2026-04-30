import type { NextConfig } from "next";

/**
 * SEC-AI-003: clickjacking + MIME-sniff hardening.
 *
 * The AI-Intel app embeds /wiki.html inside WikiShell.tsx via an
 * iframe. Both are served from the same origin, so SAMEORIGIN /
 * frame-ancestors 'self' permits the legitimate embed while blocking
 * any third-party site from framing the app.
 *
 * X-Frame-Options is being phased out in favour of CSP frame-ancestors,
 * but is still honoured by current browsers and adds defence-in-depth.
 */
const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
