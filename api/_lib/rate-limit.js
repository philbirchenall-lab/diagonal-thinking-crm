// In-memory per-IP rate limiter for Vercel serverless API routes.
//
// SEC-API-002 (risk register 2026-04-30). Modelled on the Supabase
// contact-form edge function rate limiter (supabase/functions/contact-form/
// index.ts:13-50). Same caveat applies: the store lives in module scope, so
// each Vercel function instance has its own counters and a cold start resets
// them. That is acceptable for a stop-gap because magic-link sends and
// registrations are low-volume and an attacker who somehow round-robins across
// every warm instance is still bounded by Vercel's per-instance concurrency.
// Switching to a persistent store (Upstash Redis / Vercel KV) is filed as a
// follow-up.
//
// The limiter is a fixed-window counter: first request inside a window starts
// the window, subsequent requests increment the counter, and once `max` is
// reached every further request inside the window is rejected. This is the
// same shape as the contact-form helper.

const stores = new Map();

function getStore(name) {
  let store = stores.get(name);
  if (!store) {
    store = new Map();
    stores.set(name, store);
  }
  return store;
}

export function getClientIp(req) {
  // Vercel sets x-forwarded-for with the real client IP first.
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const first = String(forwarded).split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers["x-real-ip"];
  if (real) return String(real).trim();
  return req.socket?.remoteAddress || "unknown";
}

/**
 * Check and consume one token for `ip` under the named bucket.
 *
 * @param {object} opts
 * @param {string} opts.bucket - Logical bucket name (one per endpoint).
 * @param {string} opts.ip
 * @param {number} opts.max - Max requests per window.
 * @param {number} opts.windowMs - Window length in milliseconds.
 * @returns {{ allowed: boolean, retryAfterSeconds: number }}
 */
export function checkRateLimit({ bucket, ip, max, windowMs }) {
  const store = getStore(bucket);
  const now = Date.now();

  // Probabilistic cleanup of expired entries to keep the map bounded.
  if (Math.random() < 0.1) {
    for (const [key, entry] of store.entries()) {
      if (now > entry.resetAt) store.delete(key);
    }
  }

  const entry = store.get(ip);
  if (!entry || now > entry.resetAt) {
    store.set(ip, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (entry.count >= max) {
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  entry.count++;
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Convenience wrapper. Applies the limiter and writes a 429 response if the
 * caller is over the limit. Returns true when the request was rate-limited
 * (caller should stop processing) and false when the request is allowed.
 *
 * The 429 body is intentionally opaque ("Too many requests"). Do not echo
 * the limit or window back to the client.
 */
export function applyRateLimit(req, res, opts) {
  const ip = getClientIp(req);
  const { allowed, retryAfterSeconds } = checkRateLimit({ ...opts, ip });
  if (allowed) return false;
  res.setHeader("Retry-After", String(retryAfterSeconds));
  res.status(429).json({ error: "Too many requests. Please try again later." });
  return true;
}
