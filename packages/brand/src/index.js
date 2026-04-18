/**
 * @dt/brand-tokens — JS exports
 *
 * Plain .js (not .ts) so both the Vite CRM (no TS step) and the
 * Next.js TypeScript apps can import via a relative path without
 * needing a build step or a tsconfig.paths alias.
 *
 * Canon: Brand Guidelines v1.2 + Format Standards v1.
 * If a surface drifts, update HERE FIRST, then every surface rebuilds.
 */

// ---------------- Palette ----------------

export const COLOURS = Object.freeze({
  brandNavy: "#305DAB",
  brandNavyHover: "#2A528E",
  ink: "#111111",
  inkSoft: "#2A2A2A",
  paper: "#FFFFFF",
  stone: "#A7A59F",
  bg: "#F7F8FA",
  border: "#E5E7EB",
  muted: "#5A6372",
  high: "#B91C1C",
  medium: "#B45309",
  low: "#2F855A",
});

// Legacy hexes that MUST NOT ship. Import and assert on these in
// build-time lints if/when the em-dash tooling lands.
export const DEPRECATED_HEX = Object.freeze([
  "#3B5CB5", // Legacy navy — Mae deprecated in Brand v1.0 §8 Open Q2.
  "#17324D", // Proposal steel-navy.
  "#163F6E", // Proposal button navy.
  "#1B4F8A", // Proposal H2 navy.
  "#183A73", // CRM body-gradient navy.
]);

// ---------------- Typography ----------------

export const FONTS = Object.freeze({
  display: "Oswald",
  displayStack:
    '"Oswald", "Bebas Neue", Impact, "Arial Narrow", sans-serif',
  body: "Source Sans 3",
  bodyStack:
    '"Source Sans 3", Inter, "Helvetica Neue", Helvetica, Arial, sans-serif',
});

// ---------------- Spacing (Format Standards §2.1) ----------------

export const SPACING = Object.freeze({
  tight: 4,
  compact: 8,
  default: 12,
  comfortable: 16,
  section: 24,
  generous: 28,
  hero: 40,
});

// ---------------- Radius + border ----------------

export const RADIUS = Object.freeze({ sm: 4, md: 6, lg: 8 });
export const BORDER = Object.freeze({ hairline: 1, accent: 3 });

// ---------------- Motion ----------------

export const MOTION = Object.freeze({
  transitionFast: "150ms ease-out",
  hoverElevation: "translateY(-1px)",
  focusRing: "0 0 0 2px #305DAB",
  focusOffset: "2px",
});

// ---------------- Touch target ----------------

export const TOUCH_MIN = 44;

// ---------------- Type scale ----------------

export const TYPE_SCALE = Object.freeze({
  h1HeroDesktop: 40,
  h1HeroMobile: 30,
  h1SessionDesktop: 48, // Pix §10.7.2
  h1Reading: 30,
  h2: 22,
  h3: 18,
  body: 16,
  small: 14,
  eyebrow: 11,
  eyebrowTracking: "0.09em",
});

// ---------------- CTA copy (Brand v1 §3.10, Format Standards §13.5) ----------------

export const CTA_COPY = Object.freeze({
  signIn: "Sign in",
  signingIn: "Signing in.",
  forgotPassword: "Forgot password?",
  viewResource: "View resource",
  viewDetails: "View details",
  viewProposal: "View proposal",
  openLink: "Open link",
  viewDocument: "View document",
  checking: "Checking.",
  signInSubline: "Sign in to continue.",
  loginFailedGeneric: "That did not work. Check your details and try again.",
});

// ---------------- Alt-text canon ----------------

export const LOGO_ALT = "Diagonal Thinking";
