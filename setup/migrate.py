#!/usr/bin/env python3
"""
migrate.py — Import CRM contacts from local JSON into Supabase.

Run once after creating the Supabase project and schema:
  python3 setup/migrate.py

Requires:
  pip install supabase
  SUPABASE_URL and SUPABASE_SERVICE_KEY set as environment variables,
  or edit the constants below.
"""

import json
import os
import sys

# ─── Configuration ────────────────────────────────────────────────────────────
# Set these via environment variables or paste them here temporarily.

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

# Path to the local CRM JSON file (relative to repo root)
DATA_FILE = os.path.join(
    os.path.dirname(__file__), "..",
    "Diagonal Thinking CRM Data - DO NOT DELETE.json"
)

# ─── Field conversion ─────────────────────────────────────────────────────────

def camel_to_snake(contact):
    return {
        "id":              contact.get("id"),
        "company":         contact.get("company") or None,
        "contact_name":    contact.get("contactName") or None,
        "email":           contact.get("email") or None,
        "phone":           contact.get("phone") or None,
        "type":            contact.get("type") or "Warm Lead",
        "services":        contact.get("services") or [],
        "projected_value": contact.get("projectedValue") or 0,
        "notes":           contact.get("notes") or None,
        "source":          contact.get("source") or None,
        "date_added":      contact.get("dateAdded") or None,
        "last_updated":    contact.get("lastUpdated") or None,
        "linkedin_url":    contact.get("linkedinUrl") or None,
    }

# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        print("ERROR: Set SUPABASE_URL and SUPABASE_SERVICE_KEY before running.")
        print("  export SUPABASE_URL='https://xxxx.supabase.co'")
        print("  export SUPABASE_SERVICE_KEY='eyJ...'")
        sys.exit(1)

    try:
        from supabase import create_client
    except ImportError:
        print("ERROR: supabase package not installed.")
        print("  pip install supabase")
        sys.exit(1)

    # Load local contacts
    with open(DATA_FILE, encoding="utf-8") as f:
        contacts = json.load(f)

    print(f"Loaded {len(contacts)} contacts from local file")

    # Convert to snake_case
    rows = [camel_to_snake(c) for c in contacts]

    # Connect to Supabase
    sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    # Import in batches of 100
    BATCH = 100
    total_imported = 0
    for i in range(0, len(rows), BATCH):
        batch = rows[i:i + BATCH]
        result = sb.table("contacts").upsert(batch).execute()
        total_imported += len(batch)
        print(f"  Imported {total_imported}/{len(rows)}...")

    print(f"\nDone. {total_imported} contacts imported to Supabase.")
    print("You can now deploy to Vercel and log in.")


if __name__ == "__main__":
    main()
