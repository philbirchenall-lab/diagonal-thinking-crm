-- ============================================================
-- Migration: add LinkedIn sweep columns to contacts
-- Run manually in Supabase SQL Editor
-- Project: unphfgcjfncnqhpvmrvf
-- Created: 2026-04-12
-- Purpose: supports daily LinkedIn sweep task
-- ============================================================

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS linkedin_request_sent_at TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS linkedin_connected BOOLEAN DEFAULT FALSE;
