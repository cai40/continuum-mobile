-- Run in Supabase SQL Editor if app memory cleanup returns RLS errors.
-- Enables cloud delete via user JWT (no SUPABASE_SERVICE_ROLE_KEY on Render).

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'pinned_memories',
    'episodic_segments',
    'semantic_memories',
    'temporal_events',
    'document_chunks'
  ]
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS "Users delete own %1$s" ON %1$I',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY "Users delete own %1$s" ON %1$I FOR DELETE USING (auth.uid() = user_id)',
      tbl
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS "Users read own %1$s" ON %1$I',
      tbl
    );
    EXECUTE format(
      'CREATE POLICY "Users read own %1$s" ON %1$I FOR SELECT USING (auth.uid() = user_id)',
      tbl
    );
  END LOOP;
END $$;
