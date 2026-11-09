/**
 * upload-videos.js — NAKAMA Supabase Storage Uploader
 * =====================================================
 * Uploads all five NAKAMA project showcase recordings to Supabase Storage.
 *
 * Security & Reliability Safeguards:
 *  1. Reads credentials strictly from local `.env` (never hardcoded, never logged).
 *  2. Multi-layer block on the old 'value-net' project (qvqhysrfwdgfsjdwodfh) across URL, project ID, and JWT token payload.
 *  3. Verifies all 5 local files before attempting remote operations.
 *  4. Remote collision check: verifies if object exists before uploading; prevents accidental overwrite.
 *  5. Uses TUS resumable uploads (6 MB chunking) for files > 6 MB.
 *  6. Full HTTP range request verification: verifies HTTP 206, Content-Range headers, and actual byte payload.
 *  7. Never logs, exposes, or writes secret keys to results files or frontend code.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ── 1. LOAD LOCAL .ENV ────────────────────────────────────────────────────────
const ENV_PATH = path.join(__dirname, '.env');

if (fs.existsSync(ENV_PATH)) {
  try {
    if (typeof process.loadEnvFile === 'function') {
      process.loadEnvFile(ENV_PATH);
    } else {
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
  } catch (err) {
    console.error('[CONFIG ERROR] Failed to load .env file:', err.message);
    process.exit(1);
  }
} else {
  console.error('\n[MISSING .ENV] No .env file found in workspace directory.');
  console.error('Please copy .env.example to .env and configure your dedicated NAKAMA project:\n');
  console.error('  Copy-Item .env.example .env\n');
  console.error('Then edit .env with your project URL and service role key.');
  process.exit(1);
}

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.STORAGE_BUCKET_NAME || 'nakama-project-videos';
const ALLOW_OVERWRITE = process.env.OVERWRITE_EXISTING === 'true' || process.argv.includes('--force-overwrite');

// ── 2. MULTI-LAYER SAFETY BLOCK: FORBID VALUE-NET PROJECT ────────────────────
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('\n[CONFIG ERROR] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in .env.');
  process.exit(1);
}

function extractJwtRef(token) {
  try {
    const parts = token.split('.');
    if (parts.length >= 2) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
      return payload.ref || null;
    }
  } catch (_) {}
  return null;
}

const FORBIDDEN_PROJECT_REF = 'qvqhysrfwdgfsjdwodfh';
const tokenRef = extractJwtRef(SERVICE_ROLE_KEY);
const envProjectId = (process.env.SUPABASE_PROJECT_ID || '').trim().toLowerCase();

const isForbidden =
  SUPABASE_URL.toLowerCase().includes(FORBIDDEN_PROJECT_REF) ||
  envProjectId === FORBIDDEN_PROJECT_REF ||
  tokenRef === FORBIDDEN_PROJECT_REF;

if (isForbidden) {
  console.error('\n======================================================');
  console.error(' [SECURITY ABORT] FORBIDDEN PROJECT DETECTED');
  console.error('======================================================');
  console.error(`Target credentials belong to the old "value-net" project (${FORBIDDEN_PROJECT_REF}).`);
  console.error('This project is strictly blocked per safety requirements.');
  console.error('Please provide credentials for your dedicated NAKAMA project.\n');
  process.exit(1);
}

// Extract project ref for logging
let projectRef = envProjectId || tokenRef || 'unknown';
try {
  const host = new URL(SUPABASE_URL).hostname;
  projectRef = host.split('.')[0];
} catch (_) {}

// ── 3. FIVE CONFIRMED LOCAL RECORDINGS ────────────────────────────────────────
const VIDEOS_DIR = path.join(__dirname, 'videos');

const RECORDINGS = [
  {
    num: 1,
    name: 'Saviour',
    slug: 'saviour',
    fileName: 'WhatsApp Video 2026-11-08 at 16.37.30.mp4',
    localPath: path.join(VIDEOS_DIR, 'WhatsApp Video 2026-11-08 at 16.37.30.mp4'),
    storagePath: 'saviour/recording.mp4',
    expectedW: 386,
    expectedH: 850,
    aspect: 'Portrait (~9:20)',
  },
  {
    num: 2,
    name: 'Achiever',
    slug: 'achiever',
    fileName: 'WhatsApp Video 2026-11-08 at 16.36.00.mp4',
    localPath: path.join(VIDEOS_DIR, 'WhatsApp Video 2026-11-08 at 16.36.00.mp4'),
    storagePath: 'achiever/recording.mp4',
    expectedW: 576,
    expectedH: 1280,
    aspect: 'Portrait (9:20)',
  },
  {
    num: 3,
    name: 'Kirana OS',
    slug: 'kirana-os',
    fileName: 'WhatsApp Video 2026-11-08 at 16.33.32.mp4',
    localPath: path.join(VIDEOS_DIR, 'WhatsApp Video 2026-11-08 at 16.33.32.mp4'),
    storagePath: 'kirana-os/recording.mp4',
    expectedW: 720,
    expectedH: 1584,
    aspect: 'Portrait (9:20)',
  },
  {
    num: 4,
    name: 'Plz fruit',
    slug: 'plz-fruit',
    fileName: 'Video Project 1.mp4',
    localPath: path.join(VIDEOS_DIR, 'Video Project 1.mp4'),
    storagePath: 'plz-fruit/recording.mp4',
    expectedW: 1920,
    expectedH: 1080,
    aspect: 'Landscape (16:9)',
  },
  {
    num: 5,
    name: 'Value.net Community',
    slug: 'value-net',
    fileName: 'value-net-recording.mp4',
    localPath: path.join(VIDEOS_DIR, 'value-net-recording.mp4'),
    storagePath: 'value-net/recording.mp4',
    expectedW: 1920,
    expectedH: 1080,
    aspect: 'Landscape (16:9)',
  },
];

function getIntrinsicDimensions(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    for (let i = 0; i < buf.length - 84; i++) {
      if (buf.toString('ascii', i, i + 4) === 'tkhd') {
        const ver = buf[i + 4];
        let p = i + 8;
        if (ver === 1) p += 32; else p += 20;
        p += 8 + 2 + 2 + 2 + 2 + 36;
        if (p + 8 <= buf.length) {
          const w = (buf[p] << 8) | buf[p + 1];
          const h = (buf[p + 4] << 8) | buf[p + 5];
          if (w > 0 && h > 0) return { w, h };
        }
      }
    }
  } catch (_) {}
  return null;
}

// ── 4. PRE-FLIGHT VERIFICATION OF LOCAL FILES ─────────────────────────────────
function verifyLocalFiles() {
  console.log('\n======================================================');
  console.log(' NAKAMA — Pre-Flight Local Files Verification');
  console.log('======================================================');

  let allValid = true;
  for (const item of RECORDINGS) {
    if (!fs.existsSync(item.localPath)) {
      console.error(`  [MISSING] Project ${item.num}: ${item.name} (${item.fileName})`);
      allValid = false;
      continue;
    }
    const stat = fs.statSync(item.localPath);
    const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
    const dims = getIntrinsicDimensions(item.localPath);
    const dimStr = dims ? `${dims.w}x${dims.h}` : 'unverified';
    const dimMatch = dims && dims.w === item.expectedW && dims.h === item.expectedH;

    console.log(`  [OK] Project ${item.num}: ${item.name.padEnd(20)} | ${sizeMB.padStart(6)} MB | ${dimStr.padEnd(10)} | ${item.aspect}`);
    if (!dimMatch && dims) {
      console.warn(`       WARNING: Expected ${item.expectedW}x${item.expectedH}, found ${dims.w}x${dims.h}`);
    }
  }

  if (!allValid) {
    console.error('\nPre-flight verification failed. Missing files must be resolved before proceeding.');
    process.exit(1);
  }
  console.log('All 5 local files verified successfully.\n');
}

// ── 5. AUTH & STORAGE HELPERS ────────────────────────────────────────────────
function authHeaders(extra) {
  return Object.assign({
    apikey: SERVICE_ROLE_KEY,
    Authorization: 'Bearer ' + SERVICE_ROLE_KEY,
  }, extra || {});
}

function getPublicUrl(storagePath) {
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;
}

// ── 6. ENSURE BUCKET EXISTS ───────────────────────────────────────────────────
async function ensureBucket() {
  console.log('------------------------------------------------------');
  console.log(` Checking Storage Bucket: "${BUCKET}"`);
  console.log('------------------------------------------------------');

  const listRes = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    headers: authHeaders(),
  });

  if (!listRes.ok) {
    throw new Error(`Failed to list buckets: ${listRes.status} ${await listRes.text()}`);
  }

  const buckets = await listRes.json();
  const existing = buckets.find(b => b.name === BUCKET);

  if (existing) {
    console.log(`  Bucket exists: ID="${existing.id}", Public=${existing.public}`);
    return existing;
  }

  console.log(`  Bucket "${BUCKET}" not found. Creating with public read access...`);
  const createRes = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      id: BUCKET,
      name: BUCKET,
      public: true,
      file_size_limit: 52428800, // 50 MB (Free tier limit, largest video is 29.82 MB)
      allowed_mime_types: ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'],
    }),
  });

  if (!createRes.ok) {
    throw new Error(`Failed to create bucket: ${createRes.status} ${await createRes.text()}`);
  }

  console.log(`  Bucket "${BUCKET}" created successfully.`);
}

// ── 7. REMOTE OBJECT COLLISION CHECK ─────────────────────────────────────────
async function checkRemoteExists(storagePath) {
  const publicHead = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;
  const res = await fetch(publicHead, { method: 'HEAD' });
  if (res.ok) return true;

  const authHead = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`;
  const authRes = await fetch(authHead, { method: 'HEAD', headers: authHeaders() });
  return authRes.ok;
}

// ── 8. UPLOAD LOGIC (TUS RESUMABLE FOR LARGE FILES) ─────────────────────────
const CHUNK_SIZE = 6 * 1024 * 1024; // 6 MB chunks

async function uploadRecording(item) {
  const { name, localPath, storagePath } = item;
  const stat = fs.statSync(localPath);
  const fileSize = stat.size;
  const sizeMB = (fileSize / 1024 / 1024).toFixed(2);

  console.log(`\nUploading [${item.num}/5] ${name}:`);
  console.log(`  Source: ${path.basename(localPath)} (${sizeMB} MB)`);
  console.log(`  Target: ${BUCKET}/${storagePath}`);

  // Remote collision check
  const existsRemotely = await checkRemoteExists(storagePath);
  if (existsRemotely) {
    if (!ALLOW_OVERWRITE) {
      console.log(`  [EXISTS] Remote file already exists. Skipping (safe mode).`);
      console.log(`           To overwrite existing files, run with --force-overwrite or set OVERWRITE_EXISTING=true.`);
      return { success: true, skipped: true, storagePath, sizeMB, fileSize, publicUrl: getPublicUrl(storagePath) };
    } else {
      console.log(`  [OVERWRITE] Remote file exists; overwriting as requested.`);
    }
  }

  if (fileSize <= CHUNK_SIZE) {
    const fileBuf = fs.readFileSync(localPath);
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`;
    const res = await fetch(uploadUrl, {
      method: 'POST',
      headers: authHeaders({
        'Content-Type': 'video/mp4',
        'x-upsert': 'true',
      }),
      body: fileBuf,
    });
    if (!res.ok) {
      throw new Error(`Direct upload failed for ${name}: ${res.status} ${await res.text()}`);
    }
    console.log(`  [COMPLETE] Direct upload successful.`);
    return { success: true, storagePath, sizeMB, fileSize, publicUrl: getPublicUrl(storagePath) };
  }

  // TUS Resumable Upload
  console.log(`  Initiating TUS resumable upload (file size: ${fileSize} bytes)...`);
  const tusUrl = `${SUPABASE_URL}/storage/v1/upload/resumable`;
  const initRes = await fetch(tusUrl, {
    method: 'POST',
    headers: authHeaders({
      'Content-Type': 'application/offset+octet-stream',
      'Upload-Length': String(fileSize),
      'Upload-Metadata': [
        'bucketName ' + Buffer.from(BUCKET).toString('base64'),
        'objectName ' + Buffer.from(storagePath).toString('base64'),
        'contentType ' + Buffer.from('video/mp4').toString('base64'),
        'cacheControl ' + Buffer.from('3600').toString('base64'),
      ].join(','),
      'Tus-Resumable': '1.0.0',
      'x-upsert': 'true',
    }),
  });

  if (!initRes.ok && initRes.status !== 201) {
    throw new Error(`TUS init failed for ${name}: ${initRes.status} ${await initRes.text()}`);
  }

  const location = initRes.headers.get('Location');
  if (!location) {
    throw new Error(`TUS init failed for ${name}: missing Location header`);
  }

  const fd = fs.openSync(localPath, 'r');
  let offset = 0;
  try {
    while (offset < fileSize) {
      const end = Math.min(offset + CHUNK_SIZE, fileSize);
      const chunkSize = end - offset;
      const chunkBuf = Buffer.alloc(chunkSize);
      fs.readSync(fd, chunkBuf, 0, chunkSize, offset);

      const patchRes = await fetch(location, {
        method: 'PATCH',
        headers: authHeaders({
          'Content-Type': 'application/offset+octet-stream',
          'Content-Length': String(chunkSize),
          'Upload-Offset': String(offset),
          'Tus-Resumable': '1.0.0',
        }),
        body: chunkBuf,
      });

      if (!patchRes.ok) {
        throw new Error(`TUS chunk upload failed at offset ${offset}: ${patchRes.status} ${await patchRes.text()}`);
      }

      offset = end;
      const pct = ((offset / fileSize) * 100).toFixed(1);
      process.stdout.write(`\r  Progress: ${pct}% (${(offset / 1024 / 1024).toFixed(1)} / ${sizeMB} MB)`);
    }
    process.stdout.write('\n');
  } finally {
    fs.closeSync(fd);
  }

  console.log(`  [COMPLETE] TUS resumable upload finished.`);
  return { success: true, storagePath, sizeMB, fileSize, publicUrl: getPublicUrl(storagePath) };
}

// ── 9. THOROUGH HTTP RANGE & PARTIAL-CONTENT VERIFICATION ────────────────────
async function verifyRangeSupport(publicUrl, fileSize) {
  // Test 1: Initial byte range request (0-1023)
  const rangeHeader = 'bytes=0-1023';
  const headRes = await fetch(publicUrl, { method: 'HEAD' });
  const acceptsRanges = headRes.headers.get('accept-ranges');

  const rangeRes = await fetch(publicUrl, {
    headers: { Range: rangeHeader },
  });

  if (rangeRes.status !== 206) {
    return {
      pass: false,
      reason: `Expected HTTP 206 Partial Content, received HTTP ${rangeRes.status}`,
    };
  }

  const contentRange = rangeRes.headers.get('content-range') || '';
  if (!contentRange.startsWith('bytes 0-1023/')) {
    return {
      pass: false,
      reason: `Invalid Content-Range header: "${contentRange}"`,
    };
  }

  const initialBuffer = await rangeRes.arrayBuffer();
  if (initialBuffer.byteLength !== 1024) {
    return {
      pass: false,
      reason: `Byte length mismatch: requested 1024 bytes, received ${initialBuffer.byteLength}`,
    };
  }

  // Test 2: Mid-stream seeking range request
  const midStart = Math.min(2000000, Math.floor(fileSize / 2));
  const midEnd = midStart + 1023;
  const midRes = await fetch(publicUrl, {
    headers: { Range: `bytes=${midStart}-${midEnd}` },
  });

  if (midRes.status !== 206) {
    return {
      pass: false,
      reason: `Mid-stream seek failed: HTTP ${midRes.status}`,
    };
  }

  const midBuffer = await midRes.arrayBuffer();
  if (midBuffer.byteLength !== 1024) {
    return {
      pass: false,
      reason: `Mid-stream seek byte length mismatch: received ${midBuffer.byteLength}`,
    };
  }

  return {
    pass: true,
    contentRange,
    acceptsRanges,
    bytesVerified: initialBuffer.byteLength + midBuffer.byteLength,
  };
}

// ── 10. MAIN CONTROLLER ──────────────────────────────────────────────────────
async function main() {
  console.log('\n======================================================');
  console.log(' NAKAMA — Supabase Storage Upload Pipeline');
  console.log('======================================================');
  console.log(`Target Supabase URL : ${SUPABASE_URL}`);
  console.log(`Target Project ID   : ${projectRef}`);
  console.log(`Storage Bucket      : ${BUCKET}`);
  console.log(`Safety Overwrite    : ${ALLOW_OVERWRITE ? 'ENABLED (Force)' : 'DISABLED (Safe Mode)'}`);

  // Step A: Local verification
  verifyLocalFiles();

  // Step B: Ensure bucket exists
  await ensureBucket();

  // Step C: Upload all 5 files
  console.log('------------------------------------------------------');
  console.log(' Starting Video Uploads');
  console.log('------------------------------------------------------');

  const uploadResults = [];
  for (const item of RECORDINGS) {
    const res = await uploadRecording(item);
    uploadResults.push(Object.assign({ item }, res));
  }

  // Step D: Verify range requests and partial content
  console.log('\n------------------------------------------------------');
  console.log(' Verifying HTTP 206 Range Responses & Byte Integrity');
  console.log('------------------------------------------------------');

  const verifiedUrls = {};
  let allVerified = true;

  for (const res of uploadResults) {
    const rCheck = await verifyRangeSupport(res.publicUrl, res.fileSize);
    if (rCheck.pass) {
      console.log(`  [PASS] ${res.item.name.padEnd(20)} | HTTP 206 OK | Range: ${rCheck.contentRange} | Seeking: Verified`);
      verifiedUrls[res.item.slug] = res.publicUrl;
    } else {
      console.error(`  [FAIL] ${res.item.name.padEnd(20)} | ${rCheck.reason}`);
      allVerified = false;
    }
  }

  if (!allVerified) {
    console.error('\nRange verification failed for one or more files.');
    process.exit(1);
  }

  // Step E: Save results for HTML injection
  const resultsData = {
    projectId: projectRef,
    supabaseUrl: SUPABASE_URL,
    bucket: BUCKET,
    completedAt: new Date().toISOString(),
    urls: verifiedUrls,
  };

  fs.writeFileSync(path.join(__dirname, 'upload-results.json'), JSON.stringify(resultsData, null, 2));
  console.log('\n======================================================');
  console.log(' Upload & Verification Complete');
  console.log(' Results written to: upload-results.json');
  console.log(' Next step: run "node update-html.js" to patch portfolio HTML.');
  console.log('======================================================\n');
}

main().catch(err => {
  console.error('\n[FATAL ERROR]', err.message || err);
  process.exit(1);
});
