-- NAKAMA Portfolio — Storage Bucket Security Policies
-- Bucket: 'nakama-project-videos'

-- 1. Drop existing policies if any (idempotent)
DROP POLICY IF EXISTS "nakama_videos_public_select" ON storage.objects;
DROP POLICY IF EXISTS "nakama_videos_admin_insert" ON storage.objects;
DROP POLICY IF EXISTS "nakama_videos_admin_update" ON storage.objects;
DROP POLICY IF EXISTS "nakama_videos_admin_delete" ON storage.objects;

-- 2. Public SELECT: Allow any public website visitor to stream videos
CREATE POLICY "nakama_videos_public_select"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'nakama-project-videos');

-- 3. Admin INSERT: Restrict uploading new videos strictly to service_role
CREATE POLICY "nakama_videos_admin_insert"
ON storage.objects
FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'nakama-project-videos');

-- 4. Admin UPDATE: Restrict replacing existing videos strictly to service_role
CREATE POLICY "nakama_videos_admin_update"
ON storage.objects
FOR UPDATE
TO service_role
USING (bucket_id = 'nakama-project-videos')
WITH CHECK (bucket_id = 'nakama-project-videos');

-- 5. Admin DELETE: Restrict deleting videos strictly to service_role
CREATE POLICY "nakama_videos_admin_delete"
ON storage.objects
FOR DELETE
TO service_role
USING (bucket_id = 'nakama-project-videos');
