# @dt/brand-tokens

Shared Diagonal Thinking brand tokens. Single source of truth for palette, typography, spacing, motion, focus rings, and CTA copy across every surface (CRM, AI-Intel, client-area, Proposals).

**Canon:** `wiki/strategy/brand-guidelines-v1.md` (v1.2, Phil-approved 17 Apr 2026) and `wiki/strategy/dt-format-standards-v1.md` (v1.0).

## Why it exists

Before Phase 1 of the Brand Audit rebrand, every surface redeclared navy, Oswald, spacing, and focus rings on its own. One surface drifted to `#3B5CB5` (legacy navy deprecated by Mae in v1.0), another to `#17324D`, another to `#1B4F8A`. Typography fallback stacks disagreed. Focus rings were reinvented per-app. This package stops that.

## What it ships

- `src/tokens.css` — every brand CSS custom property (`--brand-navy`, `--dt-space-*`, `--dt-focus-ring`, etc.)
- `src/typography.css` — heading + body reset (Oswald H1/H2/H3 UPPERCASE, Source Sans 3 body)
- `src/index.js` — JS constants: `COLOURS`, `FONTS`, `SPACING`, `RADIUS`, `BORDER`, `MOTION`, `TYPE_SCALE`, `CTA_COPY`, `LOGO_ALT`, plus a `DEPRECATED_HEX` list for future lint rules

## How to consume

Plain relative path imports. No workspace tooling, no build step, no Vercel reconfig.

### CSS — any app (Vite or Next)

In the app's global stylesheet, import tokens before everything else:

```css
/* ai-intel/src/app/globals.css */
@import "../../../../packages/brand/src/tokens.css";
@import "../../../../packages/brand/src/typography.css";
```

```css
/* src/index.css (CRM / Vite) */
@import "../packages/brand/src/tokens.css";
@import "../packages/brand/src/typography.css";
```

The `--font-display` and `--font-body` variables are expected to be set by the app (via `next/font` in Next, or an `@import url()` in Vite). If unset, both stylesheets fall back to the canonical fallback stacks baked into `tokens.css`.

### JS / TS — any app

```js
import { COLOURS, CTA_COPY, LOGO_ALT } from "../packages/brand/src/index.js";
// or, from a nested app:
import { COLOURS, CTA_COPY } from "../../../packages/brand/src/index.js";
```

TypeScript apps do not need a `.d.ts` — the module is plain JS with `Object.freeze` constants; TS infers readonly string literal types.

## Updating a token

1. Edit `src/tokens.css` **and** `src/index.js`. Keep them in sync.
2. Open a PR titled `brand-tokens: <what changed>`.
3. After merge, every surface picks up the change on the next deploy. No per-app follow-up.

## Deprecated hexes

`DEPRECATED_HEX` lists the off-brand navies that must not ship. Add to the list whenever a new deprecated variant is identified. A future em-dash-style pre-commit hook (Phase 3) will fail the commit on any file that ships these literals.

## Adding a new token

Prefer CSS custom properties over JS constants. Add the JS constant only when a non-CSS context (React inline style computed from logic, PDF generator, etc.) needs it.

Each token needs a Format Standards or Brand v1 citation in a `/* */` comment next to the definition. No undocumented tokens.
