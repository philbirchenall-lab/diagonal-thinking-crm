// Form 2: Morada / Steve "AI for Contractors" paid course booking.
//   Product: 3-session block, Thu 3/10/17 Sep 2026, 15:00-16:00 BST.
//   Price: GBP 300 ex-VAT (GBP 360 inc VAT at 20%) per seat.
//   Spec: outputs/tes-spec-morada-forms-1-and-2-2026-06-15.md section 3.
//
// PAYMENT ARCHITECTURE (Phil pivot, 15 Jun 2026): FreeAgent-driven, NOT direct
// Stripe. On submit this:
//   1. Finds or creates the FreeAgent contact (dedup on email).
//   2. Creates a FreeAgent invoice (course line items, 20% VAT, 0-day terms),
//      enables Stripe online payment, marks it sent, and emails the customer the
//      invoice with a "Pay now" button.
//   3. Writes the CRM contact (Warm Lead) + a PENDING course_invoice_created
//      activity carrying the FreeAgent invoice URL. The morada-course-poll-paid
//      function polls that invoice and, when Paid, upgrades the contact to Client
//      and fires the "payment received" email.
//
// No Stripe code, no Stripe keys. FreeAgent has no webhooks, hence the poll.
//
// If FreeAgent OAuth is not yet provisioned, this still records the booking and
// returns success with a "your invoice will follow" message (manual fallback:
// Phil raises the invoice from FreeAgent by hand). Spec 3.4 authorises this.
//
// BLOCKED ON PHIL (surfaced to Dot, defaults flagged in source):
//   D9 pricing (GBP 360 inc VAT/seat, 6+ to enquiry), M1 cap, M2 MVC fallback.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import {
  badRequest,
  checkRateLimit,
  corsHeaders,
  createAndSendFreeAgentInvoice,
  findOrCreateFreeAgentContact,
  freeAgentAccessToken,
  freeAgentConfig,
  getClientIp,
  json,
  parseUtm,
  routeFromUtm,
  serviceClient,
  syncToMailchimp,
  validateCommon,
} from "../_shared/forms.ts";

// === Pricing config (D9, PROVISIONAL - Phil to ratify) ======================
const NET_PER_SEAT = 300; // GBP ex-VAT per seat
const VAT_RATE = 20; // percent
const UNIT_INC_VAT = 360; // GBP inc VAT per seat (display + GA value)
const MAX_SELF_SERVE_SEATS = 5; // 6+ routes to Phil as an enquiry
const COHORT_HARD_CAP: number | null = null; // M1: null = manual cap (blocks launch only)
const COHORT_LABEL = "AI for Contractors - Sep 2026 beginner cohort (3 sessions)";
// Booking/invoice date is "today"; Deno date is fine here (not in a workflow).
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const clientIp = getClientIp(req);
  if (!checkRateLimit(clientIp)) {
    return json({ error: "Too many requests. Please try again later." }, 429);
  }

  try {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return badRequest("Invalid JSON body");
    }

    if (body._gotcha) return json({ success: true }, 200);

    const fields = {
      first_name: String(body.first_name ?? "").trim(),
      last_name: String(body.last_name ?? "").trim(),
      email: String(body.email ?? "").trim().toLowerCase(),
      company: String(body.company ?? "").trim(),
      role: String(body.role ?? "").trim(),
    };
    const billingAddress = String(body.billing_address ?? "").trim();
    const vatNumber = String(body.vat_number ?? "").trim().slice(0, 32);
    const acceptTerms = body.accept_terms === true || body.accept_terms === "true";
    const marketingConsent = body.marketing_consent === true || body.marketing_consent === "true";
    const howHeard = String(body.how_heard ?? "").trim().slice(0, 100);
    const seats = Math.floor(Number(body.seats ?? 1));

    const validationError = validateCommon(fields);
    if (validationError) return badRequest(validationError);
    if (!billingAddress) return badRequest("A billing address is required for the invoice.");
    if (!acceptTerms) return badRequest("Please accept the booking terms to continue.");
    if (!Number.isFinite(seats) || seats < 1) return badRequest("Please choose a valid number of seats.");

    // Seat-count routing (D9). 6+ seats are an enquiry, not an invoice.
    if (seats > MAX_SELF_SERVE_SEATS) {
      return json({
        success: true,
        route: "enquiry",
        message:
          "For 6 or more seats we arrange a private cohort. We have logged your interest and Phil will be in touch to confirm pricing.",
      }, 200);
    }
    if (COHORT_HARD_CAP !== null && seats > COHORT_HARD_CAP) {
      return badRequest("That exceeds the seats available in this cohort. Please contact us.");
    }

    const utm = parseUtm(body);
    const route = routeFromUtm(utm);
    const totalIncVat = UNIT_INC_VAT * seats;

    const supabase = serviceClient();

    // 1. FreeAgent invoice (or manual fallback if OAuth not provisioned).
    const faCfg = freeAgentConfig();
    let invoiceUrl: string | null = null;
    let invoiceRef: string | null = null;
    let faError: string | null = null;
    if (faCfg) {
      try {
        const token = await freeAgentAccessToken(faCfg);
        const contactUrl = await findOrCreateFreeAgentContact(token, {
          email: fields.email,
          firstName: fields.first_name,
          lastName: fields.last_name,
          company: fields.company,
        });
        const seatWord = seats === 1 ? "seat" : "seats";
        const created = await createAndSendFreeAgentInvoice(token, {
          contactUrl,
          datedOn: todayIso(),
          paymentTermsDays: 0,
          reference: "",
          comments: `Billing address: ${billingAddress}${vatNumber ? ` | VAT: ${vatNumber}` : ""}`,
          items: [{
            description: `${COHORT_LABEL} - ${seats} ${seatWord}`,
            quantity: seats,
            price: NET_PER_SEAT,
            sales_tax_rate: VAT_RATE,
          }],
          toEmail: fields.email,
          emailSubject: "Your invoice: AI for Contractors course (Sep 2026)",
          emailBody:
            `Hi ${fields.first_name},\n\n` +
            `Thank you for booking the AI for Contractors course. Your invoice for ${seats} ${seatWord} is below. ` +
            `You can pay securely by card using the button.\n\n[online_payment_link]\n\n` +
            `As soon as you have paid, your place is confirmed. You will get a payment receipt from the secure payment page, ` +
            `and Phil will be in touch with the joining details and course materials before each session ` +
            `(Thursdays 3, 10 and 17 September 2026, 3:00pm to 4:00pm BST).\n\n` +
            `Phil\nDiagonal Thinking`,
        });
        invoiceUrl = created.url;
        invoiceRef = created.reference;
      } catch (e) {
        // Do not fail the booking: record it and fall back to a manual invoice.
        faError = String(e);
        console.error("FreeAgent invoice flow error:", faError);
      }
    } else {
      console.log(
        `[freeagent] OAuth not provisioned. MANUAL FALLBACK: raise an invoice by hand for ` +
        `${fields.email} (${fields.company}), ${seats} seat(s), total inc VAT GBP ${totalIncVat}.`,
      );
    }

    // 2. CRM: upsert contact (Warm Lead) + reliable PENDING activity the poll reads.
    const { data: contactRow, error: contactError } = await supabase
      .from("contacts")
      .upsert(
        {
          contact_name: `${fields.first_name} ${fields.last_name}`,
          email: fields.email,
          company: fields.company,
          type: "Warm Lead",
          source: route.source,
        },
        { onConflict: "email", ignoreDuplicates: false },
      )
      .select("id")
      .maybeSingle();
    if (contactError) {
      console.error("Supabase contact upsert error:", contactError);
      return json({ error: "Failed to save your booking. Please try again." }, 500);
    }

    if (contactRow?.id) {
      const { error: actError } = await supabase.from("contact_activities").insert({
        contact_id: contactRow.id,
        activity_type: "course_invoice_created",
        subject: `Course invoice issued: ${seats} seat(s)${invoiceRef ? ` (${invoiceRef})` : ""}`,
        body: JSON.stringify({
          seats,
          role: fields.role,
          billing_address: billingAddress,
          vat_number: vatNumber,
          net_per_seat: NET_PER_SEAT,
          total_inc_vat: totalIncVat,
          freeagent_invoice_url: invoiceUrl,
          freeagent_reference: invoiceRef,
          manual_fallback: !invoiceUrl,
          freeagent_error: faError,
          marketing_consent: marketingConsent,
          how_heard: howHeard,
          ...utm,
          opp_route: route.oppRoute,
          confirmation_sent: false,
        }),
        // "pending" = awaiting payment; the poll flips it to "paid".
        status: "pending",
      });
      if (actError) console.error("contact_activities insert error:", actError);
    }

    // 3. Mailchimp at booking: Warm Lead + booked tag (paid tag added on payment).
    const mailchimpKey = Deno.env.get("MAILCHIMP_API_KEY");
    if (mailchimpKey) {
      syncToMailchimp(
        {
          email: fields.email,
          firstName: fields.first_name,
          lastName: fields.last_name,
          company: fields.company,
          type: "Warm Lead",
          tags: ["morada-ai-2026", "morada-course-2026-09-booked"],
          marketingTag: "morada-ai-2026-marketing",
          marketingConsent,
        },
        mailchimpKey,
      ).catch((err) => console.error("Mailchimp sync error:", err));
    }

    // Return success. The embed shows the "check your email" panel and fires GA4
    // generate_lead (the client-side named event for the paid course; the real
    // purchase is sent server-side by the poll via Measurement Protocol).
    return json({
      success: true,
      route: "invoice_sent",
      invoice_emailed: !!invoiceUrl,
      total_inc_vat: totalIncVat,
      seats,
      campaign: utm.utm_campaign,
    }, 200);
  } catch (err) {
    console.error("Unexpected error:", err);
    return json({ error: "An unexpected error occurred." }, 500);
  }
});
