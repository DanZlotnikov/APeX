-- Managers can already read a teammate's `sessions` rows (see
-- "manager reads team sessions" in 001_schema.sql), but there was no
-- equivalent Storage policy for the processed two-panel video file itself —
-- a manager opening an athlete's history detail screen (mobile's
-- AthleteDetailPreview "History" tab) could see the biomechanics report but
-- the two-panel video player above it would fail to load (signed-URL
-- request rejected by RLS: "athlete reads own processed videos" in
-- 009_video_jobs_pipeline.sql only matches auth.uid() against the storage
-- path's athlete-id folder). This adds the manager-side equivalent, scoped
-- by team membership instead of self, mirroring that policy exactly.
CREATE POLICY "manager reads team processed videos" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'exercise-videos'
    AND (storage.foldername(name))[1] = 'processed'
    AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'manager'
    AND (SELECT team_id FROM public.profiles WHERE id = ((storage.foldername(name))[2])::uuid)
        = public.my_team_id()
  );
