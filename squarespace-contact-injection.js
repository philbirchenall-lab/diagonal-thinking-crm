/**
 * DIAGONAL THINKING — Squarespace Contact Form → CRM Integration
 * =============================================================
 * INSTALLATION:
 *   1. In Squarespace, go to:
 *      Pages → [contact page] → gear icon → Advanced → Page Header Code Injection
 *   2. Paste this entire script (including <script> tags) into the injection box.
 *   3. Save. No other changes needed.
 *
 * WHAT THIS DOES:
 *   Listens for Squarespace's native form-submit success event (sqsp:submitSuccess),
 *   then POSTs the submission data to the Supabase Edge Function. The Edge Function:
 *     - Upserts the contact into the Supabase CRM
 *     - Syncs to Mailchimp
 *     - Sends a notification email to phil@diagonalthinking.co
 *
 * FIELD MAPPING:
 *   This script looks for fields whose *label* or *name* attribute contains the
 *   keywords below (case-insensitive). If your Squarespace form uses different
 *   labels, update FIELD_KEYWORDS accordingly.
 *
 *   | CRM field | Squarespace label keywords     | Required? |
 *   |-----------|-------------------------------|-----------|
 *   | name      | "name"                         | Yes       |
 *   | email     | "email"                        | Yes       |
 *   | company   | "company", "organisation"      | No        |
 *   | message   | "message", "enquiry", "comment"| Yes       |
 *
 * EDGE FUNCTION URL:
 *   https://unphfgcjfncnqhpvmrvf.supabase.co/functions/v1/contact-form
 *
 * DEBUGGING:
 *   Open the browser console on the contact page. After a successful form
 *   submit you should see either "CRM sync OK" or an error message.
 */

<script>
(function () {
  "use strict";

  var EDGE_FUNCTION_URL =
    "https://unphfgcjfncnqhpvmrvf.supabase.co/functions/v1/contact-form";

  // Keywords used to identify each field from its label text or name attribute.
  // Extend these arrays if your form uses different label wording.
  var FIELD_KEYWORDS = {
    name:    ["name"],
    email:   ["email"],
    company: ["company", "organisation", "organization"],
    message: ["message", "enquiry", "inquiry", "comment"],
  };

  /**
   * Extract a named field value from the Squarespace form event detail.
   *
   * Squarespace 7.1 passes event.detail as an object where keys are the
   * field's internal name and values are the submitted strings. Older
   * versions may pass an array of { label, value } pairs. This function
   * handles both shapes.
   *
   * @param {Object|Array} fields - The fields payload from event.detail
   * @param {string[]} keywords   - Label keywords to match (case-insensitive)
   * @returns {string}
   */
  function extractField(fields, keywords) {
    if (!fields) return "";

    // Shape A: array of { label, value } or { name, value }
    if (Array.isArray(fields)) {
      for (var i = 0; i < fields.length; i++) {
        var f = fields[i];
        var key = (f.label || f.name || "").toLowerCase();
        for (var k = 0; k < keywords.length; k++) {
          if (key.indexOf(keywords[k]) !== -1) {
            return (f.value || "").trim();
          }
        }
      }
      return "";
    }

    // Shape B: plain object — try each keyword as a possible key
    var allKeys = Object.keys(fields);
    for (var k = 0; k < keywords.length; k++) {
      for (var i = 0; i < allKeys.length; i++) {
        if (allKeys[i].toLowerCase().indexOf(keywords[k]) !== -1) {
          return (fields[allKeys[i]] || "").trim();
        }
      }
    }
    return "";
  }

  /**
   * Post a form submission to the Supabase Edge Function.
   * Failures are logged to console but never surface to the user —
   * the native Squarespace "thank you" message is unaffected.
   *
   * @param {Object} payload - { name, email, company, message }
   */
  function syncToCRM(payload) {
    fetch(EDGE_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        if (res.ok) {
          console.log("CRM sync OK — contact saved:", payload.email);
        } else {
          res.text().then(function (body) {
            console.warn("CRM sync failed (" + res.status + "):", body);
          });
        }
      })
      .catch(function (err) {
        console.error("CRM sync error:", err);
      });
  }

  /**
   * Handle the Squarespace form success event.
   * sqsp:submitSuccess fires on window after the native AJAX submit succeeds.
   */
  window.addEventListener("sqsp:submitSuccess", function (event) {
    var detail = (event && event.detail) || {};

    // Squarespace may nest fields under detail.fields or pass them at the top level
    var fields = detail.fields || detail;

    var name    = extractField(fields, FIELD_KEYWORDS.name);
    var email   = extractField(fields, FIELD_KEYWORDS.email);
    var company = extractField(fields, FIELD_KEYWORDS.company);
    var message = extractField(fields, FIELD_KEYWORDS.message);

    // Silently skip if required fields are missing (e.g., event from a different form)
    if (!name || !email || !message) {
      console.log(
        "CRM sync skipped — missing required fields (name/email/message).",
        { name: !!name, email: !!email, message: !!message }
      );
      return;
    }

    syncToCRM({ name: name, email: email, company: company, message: message });
  });
})();
</script>
