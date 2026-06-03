/**
 * Tests for the one-shot proposal follow-up gates (PROP-011 nudge, PROP-013 chase).
 * Run with: node --test
 *
 * These exercise the pure decision predicates and the Resend payload builder.
 * No network or database calls are made.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nudgeDue,
  chaseDue,
  workingDaysBetween,
  buildResendPayload,
  buildChaseEmail,
  buildNudgeEmail,
} from "./proposal-followup-cron.js";

// Reference dates. Time of day is irrelevant: workingDaysBetween zeroes it.
// workingDaysBetween counts weekdays in the half-open-then-inclusive range,
// so Mon 2026-06-01 to Fri 2026-06-05 is 4 working days and to Mon 2026-06-08 is 5.
const MON_JUN1 = new Date("2026-06-01T09:00:00Z");
const WED_JUN3 = new Date("2026-06-03T09:00:00Z"); // 2 working days after Jun1
const FRI_JUN5 = new Date("2026-06-05T09:00:00Z"); // 4 working days after Jun1
const MON_JUN8 = new Date("2026-06-08T09:00:00Z"); // 5 working days after Jun1

function baseProposal(overrides = {}) {
  return {
    id: "p1",
    sentAt: MON_JUN1.toISOString(),
    replyReceived: false,
    nudgedAt: null,
    chasedAt: null,
    views: 0,
    firstOpenedAt: null,
    ...overrides,
  };
}

// --- workingDaysBetween sanity ------------------------------------------------

test("workingDaysBetween skips weekends", () => {
  assert.equal(workingDaysBetween(MON_JUN1, FRI_JUN5), 4);
  assert.equal(workingDaysBetween(MON_JUN1, MON_JUN8), 5);
  // Friday to Monday is one working day (Sat and Sun skipped).
  assert.equal(workingDaysBetween(FRI_JUN5, MON_JUN8), 1);
});

// --- PROP-011 nudge gates -----------------------------------------------------

test("nudge fires after 4 working days while unopened, unreplied, never nudged", () => {
  assert.equal(nudgeDue(baseProposal(), FRI_JUN5), true);
});

test("nudge does not fire before 4 working days", () => {
  assert.equal(nudgeDue(baseProposal(), WED_JUN3), false);
});

test("nudge does not fire when sent_at is null", () => {
  assert.equal(nudgeDue(baseProposal({ sentAt: null }), MON_JUN8), false);
});

test("nudge does not fire when already nudged (one-shot)", () => {
  assert.equal(nudgeDue(baseProposal({ nudgedAt: WED_JUN3.toISOString() }), MON_JUN8), false);
});

test("nudge does not fire when the client has replied (status changed)", () => {
  assert.equal(nudgeDue(baseProposal({ replyReceived: true }), MON_JUN8), false);
});

test("nudge does not fire once the proposal has been opened", () => {
  assert.equal(
    nudgeDue(baseProposal({ views: 1, firstOpenedAt: MON_JUN1.toISOString() }), MON_JUN8),
    false
  );
});

// --- PROP-013 chase gates -----------------------------------------------------

test("RUTH-SHAPED BUG: chase must NOT fire when sent_at is null, even if viewed and unreplied", () => {
  const ruth = baseProposal({
    sentAt: null,
    views: 1,
    firstOpenedAt: MON_JUN1.toISOString(),
    replyReceived: false,
    chasedAt: null,
  });
  assert.equal(chaseDue(ruth, MON_JUN8), false);
});

test("chase fires 5 working days after first open, viewed, unreplied, never chased", () => {
  const p = baseProposal({ views: 1, firstOpenedAt: MON_JUN1.toISOString() });
  assert.equal(chaseDue(p, MON_JUN8), true);
});

test("chase does not fire before 5 working days post-open", () => {
  const p = baseProposal({ views: 1, firstOpenedAt: MON_JUN1.toISOString() });
  assert.equal(chaseDue(p, FRI_JUN5), false); // only 4 working days
});

test("chase does not fire when never opened", () => {
  assert.equal(chaseDue(baseProposal({ views: 0, firstOpenedAt: null }), MON_JUN8), false);
});

test("chase does not fire when already chased (one-shot)", () => {
  const p = baseProposal({
    views: 1,
    firstOpenedAt: MON_JUN1.toISOString(),
    chasedAt: WED_JUN3.toISOString(),
  });
  assert.equal(chaseDue(p, MON_JUN8), false);
});

test("chase does not fire when the client has replied (status changed)", () => {
  const p = baseProposal({
    views: 1,
    firstOpenedAt: MON_JUN1.toISOString(),
    replyReceived: true,
  });
  assert.equal(chaseDue(p, MON_JUN8), false);
});

// --- Reply-To and brand (no em-dash) ------------------------------------------

test("every send sets Reply-To to phil@diagonalthinking.co", () => {
  const payload = buildResendPayload({
    to: "prospect@example.com",
    subject: "s",
    text: "t",
    html: "<p>t</p>",
  });
  assert.equal(payload.reply_to, "phil@diagonalthinking.co");
  assert.ok(payload.from.includes("phil@diagonalthinking.co"));
  assert.deepEqual(payload.to, ["prospect@example.com"]);
});

test("email copy contains no em-dash (brand rule)", () => {
  const EM_DASH = "\u2014";
  const proposal = { clientName: "Sam", programTitle: "The AI Advantage", proposalCode: "ABC123" };
  for (const built of [buildChaseEmail(proposal), buildNudgeEmail(proposal)]) {
    for (const field of [built.subject, built.text, built.html]) {
      assert.ok(!field.includes(EM_DASH), `em-dash found in: ${field}`);
    }
  }
});
