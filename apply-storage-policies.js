/**
 * apply-storage-policies.js
 * =====================================================
 * Sets up Supabase Storage RLS policies for the nakama-project-videos bucket.
 * - Public: SELECT (read) on all objects
 * - Authenticated admin role only: INSERT / UPDATE / DELETE
 * Run AFTER the bucket is created.
 * 
 * Usage:
 *   node apply-storage-policies.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── 1. LOAD LOCAL .ENV ────────────────────────────────────────────────────────
const ENV_PATH = path.join(__dirname, '.env');
if (fs.existsSync(ENV_PATH)) {
  const lines = fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://nmapnogqfwhouobjejft.supabase.co').replace(/\/+$/, '');
const BUCKET = process.env.STORAGE_BUCKET_NAME || 'nakama-project-videos';

// ── SAFETY BLOCK: NEVER TARGET LEGACY VALUE-NET PROJECT ───────────────────────
const FORBIDDEN_PROJECT_REF = 'qvqhysrfwdgfsjdwodfh';
if (SUPABASE_URL.includes(FORBIDDEN_PROJECT_REF)) {
  console.error('[SECURITY BLOCK] Attempted to target forbidden legacy project:', FORBIDDEN_PROJECT_REF);
  process.exit(1);
}

if (!SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY not set.');
  process.exit(1);
}

const policies = `
-- Enable RLS on storage.objects (already enabled by default in Supabase Storage)

-- Drop existing policies if any (idempotent)
DROP POLICY IF EXISTS "nakama_videos_public_select" ON storage.objects;
DROP POLICY IF EXISTS "nakama_videos_admin_insert" ON storage.objects;
DROP POLICY IF EXISTS "nakama_videos_admin_update" ON storage.objects;
DROP POLICY IF EXISTS "nakama_videos_admin_delete" ON storage.objects;

-- 1. Public SELECT: anyone can read videos from this bucket
CREATE POLICY "nakama_videos_public_select"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = '${BUCKET}');

-- 2. Admin INSERT: only service_role can upload
CREATE POLICY "nakama_videos_admin_insert"
ON storage.objects
FOR INSERT
TO service_role
WITH CHECK (bucket_id = '${BUCKET}');

-- 3. Admin UPDATE: only service_role can replace
CREATE POLICY "nakama_videos_admin_update"
ON storage.objects
FOR UPDATE
TO service_role
USING (bucket_id = '${BUCKET}')
WITH CHECK (bucket_id = '${BUCKET}');

-- 4. Admin DELETE: only service_role can delete
CREATE POLICY "nakama_videos_admin_delete"
ON storage.objects
FOR DELETE
TO service_role
USING (bucket_id = '${BUCKET}');
`;

console.log('SQL to run via Supabase SQL Editor:');
console.log(policies);
