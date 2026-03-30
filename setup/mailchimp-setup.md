# Mailchimp Sync — Setup Guide

This guide covers everything needed to activate the Mailchimp sync for the Diagonal Thinking CRM. Changes to contacts in Supabase (insert, update, delete) will automatically be reflected in your Mailchimp audience.

---

## Architecture overview

```
CRM (Vercel) → Supabase contacts table
                        │
               Database Webhook (INSERT/UPDATE/DELETE)
                        │
               Supabase Edge Function: mailchimp-sync
                        │
               Mailchimp API → Audience d89fc8d69c
```

---

## Step 1 — Add custom merge fields in Mailchimp

Mailchimp only has `FNAME`, `LNAME`, `ADDRESS`, `PHONE` by default. You need to add two more.

1. Log in to Mailchimp → **Audience** → **All contacts**
2. Click **Settings** → **Audience fields and \*|MERGE|\* tags**
3. Add the following two fields:

| Field label | Field tag | Field type |
|-------------|-----------|------------|
| Company     | `COMPANY` | Text       |
| Type        | `TYPE`    | Text       |

4. Save changes.

> These tag names must match exactly (`COMPANY`, `TYPE`) — the edge function uses them as-is.

---

## Step 2 — Install the Supabase CLI

```bash
brew install supabase/tap/supabase
```

Then log in:

```bash
supabase login
```

---

## Step 3 — Link your project

From the repo root:

```bash
supabase link --project-ref unphfgcjfncnqhpvmrvf
```

You'll be prompted for your database password.

---

## Step 4 — Set the API key secret

Store the Mailchimp API key as an encrypted Supabase secret (never commit it to source):

```bash
supabase secrets set MAILCHIMP_API_KEY=<your-mailchimp-api-key>
```

Verify it was saved:

```bash
supabase secrets list
```

---

## Step 5 — Deploy the edge function

```bash
supabase functions deploy mailchimp-sync --no-verify-jwt
```

The `--no-verify-jwt` flag is intentional: the function is called by the Supabase internal webhook infrastructure, not by a user session.

After deploying, the function URL will be:

```
https://unphfgcjfncnqhpvmrvf.supabase.co/functions/v1/mailchimp-sync
```

---

## Step 6 — Create the Database Webhook in Supabase

1. Go to [Supabase Dashboard](https://supabase.com/dashboard/project/unphfgcjfncnqhpvmrvf) → **Database** → **Webhooks**
2. Click **Create a new hook**
3. Configure it:

| Setting         | Value                                                                           |
|-----------------|---------------------------------------------------------------------------------|
| Name            | `mailchimp-sync`                                                                |
| Table           | `contacts`                                                                      |
| Events          | `INSERT`, `UPDATE`, `DELETE` (check all three)                                  |
| Type            | Supabase Edge Functions                                                         |
| Edge Function   | `mailchimp-sync`                                                                |
| HTTP Method     | POST                                                                            |

4. Click **Create webhook**.

> Supabase will automatically pass the changed row data in the request body in the format the edge function expects.

---

## Step 7 — Test the sync

Add or edit a contact in the CRM, then check your Mailchimp audience to confirm the subscriber appeared or was updated.

To view edge function logs for debugging:

```bash
supabase functions logs mailchimp-sync --tail
```

Or in the dashboard: **Edge Functions** → `mailchimp-sync` → **Logs**.

---

## Field mapping reference

| CRM field (`contacts` table) | Mailchimp merge field |
|------------------------------|-----------------------|
| `contact_name` (first word)  | `FNAME`               |
| `contact_name` (rest)        | `LNAME`               |
| `company`                    | `COMPANY` *(custom)*  |
| `phone`                      | `PHONE`               |
| `type`                       | `TYPE` *(custom)*     |
| `email`                      | subscriber email      |

Contacts without an email address are skipped (Mailchimp requires an email).

On DELETE, the subscriber is **archived** in Mailchimp (reversible), not permanently deleted.

---

## Updating the function

After making changes to `supabase/functions/mailchimp-sync/index.ts`, redeploy:

```bash
supabase functions deploy mailchimp-sync --no-verify-jwt
```
