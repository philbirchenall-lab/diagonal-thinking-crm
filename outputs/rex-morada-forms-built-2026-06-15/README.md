# Morada AI for Contractors - built forms (brand + functional review artefacts)

The two Squarespace Code Block embeds, one per form. Each `.html` is a single
self-contained block: markup + scoped CSS (`.dtf*` classes) + the JS that POSTs
to the Supabase Edge Function. Nothing external to load.

```
form-1-webinar/morada-webinar-embed-v1-2026-06-15.html   Form 1, free webinar -> /morada-ai-webinar
form-2-course/morada-course-embed-v1-2026-06-15.html     Form 2, paid course  -> /ai-for-contractors-course
```

## How to view / render
- Open either `.html` directly in a browser to see the rendered form.
- The snippet deliberately omits a `<meta name="viewport">` tag (the Squarespace
  page supplies it). To preview true mobile stacking standalone, add
  `<meta name="viewport" content="width=device-width, initial-scale=1">` to the
  `<head>`; on the live page it is responsive automatically.

## How to publish
Paste the whole file into a Squarespace Code Block on the matching page slug.
Set the CONFIG block at the top of the `<script>` if anything changed
(`FUNCTION_URL`, `PRIVACY_URL`, `BOOKING_TERMS_URL`).

## Brand + accessibility
DT Brand Guidelines v1. Typography inherits the live site theme
(`font-family: inherit`); DT brand colours applied (brand `#305DAB`, hover
`#2A528E`, ink `#111111`, brandSoft `#E7EEF8`, stone `#A7A59F`). WCAG 2.1 AA:
labelled fields, 3px focus outlines, inline `role="alert"` errors, honeypot
off-screen. Em-dash zero.

## Backend
Supabase Edge Functions on project `unphfgcjfncnqhpvmrvf`:
`morada-webinar-register`, `morada-course-book`, `morada-course-poll-paid`.
CORS is origin-allowlisted to the DT site (no wildcard). Full build and
decisions: `outputs/morada-forms-build-notes-2026-06-15.md`.
Branch: `rex/morada-forms-12-2026-06-15`.
