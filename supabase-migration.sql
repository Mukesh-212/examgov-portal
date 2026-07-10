-- ============================================================================
-- ExamGov Portal - Production Database Migration
-- Run this in Supabase SQL Editor
-- ============================================================================

-- 1. sent_reminders table (dedup: prevents sending same reminder twice)
CREATE TABLE IF NOT EXISTS sent_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  subscriber_email TEXT NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(exam_id, subscriber_email)
);

CREATE INDEX IF NOT EXISTS idx_sent_reminders_exam_id ON sent_reminders(exam_id);

COMMENT ON TABLE sent_reminders IS 'Tracks which reminders have been sent to prevent duplicates';
COMMENT ON COLUMN sent_reminders.exam_id IS 'FK to exams.id';
COMMENT ON COLUMN sent_reminders.subscriber_email IS 'Recipient email address';
COMMENT ON COLUMN sent_reminders.sent_at IS 'When the reminder was dispatched';

-- 2. Performance index on exams.end_date (speeds up the daily cron query)
CREATE INDEX IF NOT EXISTS idx_exams_end_date ON exams(end_date);

-- 3. Unique constraint on tracked_sources.url (required for upsert to work)
--    Only adds if the constraint does not already exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tracked_sources_url_key'
  ) THEN
    ALTER TABLE tracked_sources ADD CONSTRAINT tracked_sources_url_key UNIQUE (url);
  END IF;
END $$;

-- 4. RLS policies for anon role (optional but recommended for dev)
--    If you want the ANON key to work without SERVICE_ROLE_KEY,
--    uncomment these policies:
--
-- CREATE POLICY "anon_can_select_exams" ON exams FOR SELECT TO anon USING (true);
-- CREATE POLICY "anon_can_select_subscribers" ON subscribers FOR SELECT TO anon USING (true);
-- CREATE POLICY "anon_can_select_sources" ON tracked_sources FOR SELECT TO anon USING (true);
