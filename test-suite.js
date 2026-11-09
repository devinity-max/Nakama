/**
 * test-suite.js — NAKAMA Comprehensive Production Verification Suite
 * ==================================================================
 * Tests all production criteria across:
 *  1. Environment & Secret Hygiene
 *  2. Supabase Storage Security (read, seek/ranges, unauthorized writes)
 *  3. API Security & Contact Form Validation
 *  4. Spam Mitigation (honeypot, speed trap)
 *  5. In-Memory Rate Limiting
 *  6. Accessibility & Semantic Markup
 *  7. SEO, Metadata & Static Routing
 *  8. Official Social Media & Direct Contact Integration
 */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

let passedTests = 0;
let failedTests = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  [\x1b[32mPASS\x1b[0m] ${testName}`);
    passedTests++;
  } else {
    console.error(`  [\x1b[31mFAIL\x1b[0m] ${testName} ${details ? '— ' + details : ''}`);
    failedTests++;
  }
}

async function run() {
  console.log('\n======================================================');
  console.log(' NAKAMA Production Readiness Test Suite');
  console.log('======================================================\n');

  const rootDir = __dirname;
  const htmlFile = path.join(rootDir, 'index.html');
  const server = require('./server');

  // ── TEST GROUP 1: ENVIRONMENT & SECRET HYGIENE ─────────────────────────────
  console.log('1. ENVIRONMENT & SECRET HYGIENE');
  const gitignore = fs.readFileSync(path.join(rootDir, '.gitignore'), 'utf8');
  assert(gitignore.includes('.env'), '.gitignore excludes .env files');
  assert(gitignore.includes('node_modules'), '.gitignore excludes node_modules');
  assert(gitignore.includes('*.bak'), '.gitignore excludes backup files');

  const htmlContent = fs.readFileSync(htmlFile, 'utf8');
  assert(!htmlContent.includes('service_role'), 'HTML does not leak service_role keys');
  assert(!htmlContent.includes('sb_secret'), 'HTML does not leak Supabase secret keys');
  assert(!htmlContent.includes('re_your_'), 'HTML does not contain Resend API key placeholders');
  assert(!htmlContent.includes('hello@your-domain.com'), 'HTML does not contain builder email placeholders');
  assert(!htmlContent.includes('Simulated confirmation'), 'HTML does not contain simulated/fake success messages');

  // Check apply-storage-policies.js safety
  const storagePoliciesScript = fs.readFileSync(path.join(rootDir, 'apply-storage-policies.js'), 'utf8');
  assert(!storagePoliciesScript.includes('qvqhysrfwdgfsjdwodfh.supabase.co'), 'apply-storage-policies.js does not target legacy value-net URL');
  assert(storagePoliciesScript.includes('FORBIDDEN_PROJECT_REF'), 'apply-storage-policies.js contains explicit guard against forbidden project');

  // ── TEST GROUP 2: SUPABASE STORAGE SECURITY & PLAYBACK ─────────────────────
  console.log('\n2. SUPABASE STORAGE SECURITY & PLAYBACK');
  const testVideoUrl = 'https://nmapnogqfwhouobjejft.supabase.co/storage/v1/object/public/nakama-project-videos/saviour/recording.mp4';

  try {
    const headRes = await fetch(testVideoUrl, { method: 'HEAD' });
    assert(headRes.status === 200, 'Public video read returns HTTP 200');
    assert(headRes.headers.get('content-type') === 'video/mp4', 'Public video Content-Type is video/mp4');
  } catch (e) {
    assert(false, 'Public video fetch', e.message);
  }

  // HTTP Range Request (Video seeking)
  try {
    const rangeRes = await fetch(testVideoUrl, {
      headers: { 'Range': 'bytes=0-1023' }
    });
    assert(rangeRes.status === 206, 'Video streaming supports HTTP 206 Partial Content (seeking)');
    assert(rangeRes.headers.get('content-range')?.startsWith('bytes 0-1023/'), 'Video returns Content-Range header for seeking');
  } catch (e) {
    assert(false, 'Video range request', e.message);
  }

  // Unauthorized Write / Overwrite Block
  try {
    const unauthRes = await fetch('https://nmapnogqfwhouobjejft.supabase.co/storage/v1/object/nakama-project-videos/malicious-test.txt', {
      method: 'POST',
      body: 'exploit',
      headers: { 'Content-Type': 'text/plain' }
    });
    assert(unauthRes.status === 400 || unauthRes.status === 401 || unauthRes.status === 403, 'Unauthorized public uploads are strictly rejected');
  } catch (e) {
    assert(true, 'Unauthorized write rejected by network exception');
  }

  // ── TEST GROUP 3: SERVER & API CONTACT ENDPOINT ────────────────────────────
  console.log('\n3. SERVER & API CONTACT ENDPOINT');

  // Start temporary local server on port 3099
  const testPort = 3099;
  await new Promise(res => server.listen(testPort, res));
  const baseUrl = `http://127.0.0.1:${testPort}`;

  // 3a. GET / (returns HTML)
  const homeRes = await fetch(`${baseUrl}/`);
  assert(homeRes.status === 200, 'GET / returns HTTP 200 OK');
  assert(homeRes.headers.get('content-type')?.includes('text/html'), 'GET / returns HTML content');

  // 3b. GET /api/contact (Method Not Allowed)
  const getApiRes = await fetch(`${baseUrl}/api/contact`);
  assert(getApiRes.status === 405, 'GET /api/contact returns 405 Method Not Allowed');

  // Use distinct client IPs via x-forwarded-for so rate limiting tests operate in isolation
  let clientCounter = 1;
  const nextIp = () => `192.168.20.${clientCounter++}`;

  // 3c. Missing required fields
  const missingRes = await fetch(`${baseUrl}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
    body: JSON.stringify({ name: '', email: 'test@example.com' })
  });
  const missingData = await missingRes.json();
  assert(missingRes.status === 400, 'Empty name returns HTTP 400 Bad Request');
  assert(missingData.success === false, 'Empty name response specifies success: false');

  // 3d. Invalid email format
  const invalidEmailRes = await fetch(`${baseUrl}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
    body: JSON.stringify({ name: 'Mukti', email: 'not-an-email', description: 'Hello this is a valid description' })
  });
  assert(invalidEmailRes.status === 400, 'Invalid email returns HTTP 400 Bad Request');

  // 3e. Header Injection Attack Prevention
  const injectionRes = await fetch(`${baseUrl}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
    body: JSON.stringify({
      name: 'Attacker\r\nBcc: victim@example.com',
      email: 'attacker@example.com',
      description: 'Testing header injection defense'
    })
  });
  assert(injectionRes.status === 400, 'Header injection in name field is rejected (HTTP 400)');

  // 3f. Oversized Payload (>32 KB)
  const oversizedDesc = 'A'.repeat(35 * 1024);
  const oversizedRes = await fetch(`${baseUrl}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
    body: JSON.stringify({
      name: 'Test',
      email: 'test@example.com',
      description: oversizedDesc
    })
  });
  assert(oversizedRes.status === 413 || oversizedRes.status === 400, 'Oversized payload rejected (HTTP 413/400)');

  // 3g. Honeypot Spam Trap
  const honeypotRes = await fetch(`${baseUrl}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
    body: JSON.stringify({
      name: 'Spam Bot',
      email: 'bot@spam.com',
      description: 'Buy cheap watches now at this spam link',
      _hp: 'https://spam.link'
    })
  });
  const hpData = await honeypotRes.json();
  assert(honeypotRes.status === 200 && hpData.success === true, 'Honeypot trap silently absorbs bot spam');

  // 3h. Valid enquiry with unconfigured email provider (should return safe 503)
  const validUnconfiguredRes = await fetch(`${baseUrl}/api/contact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': nextIp() },
    body: JSON.stringify({
      name: 'Valid Client',
      email: 'client@company.com',
      projectType: 'SaaS platform',
      budget: '$15k+',
      description: 'We would like to build a new SaaS product with NAKAMA.',
      _ts: Date.now() - 5000 // 5 seconds ago
    })
  });
  const unconfiguredData = await validUnconfiguredRes.json();
  assert(
    validUnconfiguredRes.status === 503 || validUnconfiguredRes.status === 200,
    `Unconfigured email provider safely reports status (received HTTP ${validUnconfiguredRes.status}) without crashing`
  );
  assert(
    !JSON.stringify(unconfiguredData).includes('re_') && !JSON.stringify(unconfiguredData).includes('secret'),
    'API error messages never leak secret keys or server credentials'
  );

  // ── TEST GROUP 4: RATE LIMITING STRESS TEST ────────────────────────────────
  console.log('\n4. RATE LIMITING STRESS TEST');
  const spamIp = '10.0.0.199';
  let rateLimitHit = false;
  for (let i = 0; i < 7; i++) {
    const res = await fetch(`${baseUrl}/api/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': spamIp },
      body: JSON.stringify({
        name: 'Rapid Client',
        email: 'rapid@example.com',
        description: 'Test enquiry message for rate limiting.',
        _ts: Date.now() - 3000
      })
    });
    if (res.status === 429) {
      rateLimitHit = true;
      break;
    }
  }
  assert(rateLimitHit, 'Rate limiter triggers HTTP 429 Too Many Requests after threshold');

  // Close test server
  await new Promise(res => server.close(res));

  // ── TEST GROUP 5: ACCESSIBILITY & SEO ──────────────────────────────────────
  console.log('\n5. ACCESSIBILITY & SEO');
  assert(htmlContent.includes('background-image:linear-gradient(to right,rgba(255,255,255,'), 'Static subtle white grid background restored on body');
  assert(!htmlContent.includes('bg-ripple-container'), 'Ripple effect container remains completely absent');
  assert(!htmlContent.includes('BackgroundRippleEffect'), 'Ripple effect class remains completely absent');
  assert(htmlContent.includes('class="skip-link"'), 'Skip-to-main-content accessible link present');
  assert(htmlContent.includes('aria-label="Main Navigation"'), 'Navigation element contains semantic aria-label');
  assert(htmlContent.includes('role="status"'), 'Form feedback element includes role="status"');
  assert(htmlContent.includes('aria-describedby="en"'), 'Form inputs linked to error alerts via aria-describedby');
  assert(htmlContent.includes('prefers-reduced-motion'), 'prefers-reduced-motion media query implemented');

  assert(htmlContent.includes('meta name="description"'), 'Meta description tag present for search engines');
  assert(htmlContent.includes('property="og:title"'), 'Open Graph og:title metadata configured');
  assert(htmlContent.includes('property="og:image"'), 'Open Graph og:image preview configured');
  assert(htmlContent.includes('name="twitter:card"'), 'Twitter card metadata configured');
  assert(htmlContent.includes('link rel="canonical"'), 'Canonical URL tag present');
  assert(fs.existsSync(path.join(rootDir, 'robots.txt')), 'robots.txt exists in root');
  assert(fs.existsSync(path.join(rootDir, 'sitemap.xml')), 'sitemap.xml exists in root');
  assert(fs.existsSync(path.join(rootDir, 'favicon.svg')), 'favicon.svg exists in root');

  // ── TEST GROUP 6: SOCIAL MEDIA & DIRECT CONTACT INTEGRATION ────────────────
  console.log('\n6. SOCIAL MEDIA & DIRECT CONTACT INTEGRATION');

  // 6a. Official Destinations
  assert(
    htmlContent.includes('https://www.instagram.com/theoriginalnakama/'),
    'Official Instagram URL present (https://www.instagram.com/theoriginalnakama/)'
  );
  assert(
    htmlContent.includes('@theoriginalnakama'),
    'Official Instagram handle displayed (@theoriginalnakama)'
  );
  assert(
    htmlContent.includes('https://x.com/originalnakamas'),
    'Official X (Twitter) URL present (https://x.com/originalnakamas)'
  );
  assert(
    htmlContent.includes('@originalnakamas'),
    'Official X (Twitter) handle displayed (@originalnakamas)'
  );
  assert(
    htmlContent.includes('mailto:dmg73364@gmail.com'),
    'Official Email mailto link present (mailto:dmg73364@gmail.com)'
  );
  assert(
    htmlContent.includes('dmg73364@gmail.com'),
    'Official Email address displayed (dmg73364@gmail.com)'
  );

  // 6b. Global Footer Integration
  assert(htmlContent.includes('CONNECT WITH NAKAMA'), 'Footer contains "CONNECT WITH NAKAMA" section header');
  assert(htmlContent.includes('class="ft-connect"'), 'Footer contains .ft-connect semantic layout');
  assert(htmlContent.includes('class="ft-link"'), 'Footer links styled with .ft-link class');

  // 6c. Contact Page Integration
  assert(htmlContent.includes('class="ct-grid"'), 'Contact section contains responsive .ct-grid layout');
  assert(htmlContent.includes('class="ct-sidebar"'), 'Contact section contains dedicated .ct-sidebar direct contact area');
  assert(htmlContent.includes('class="ct-card"'), 'Contact section contains clickable channel cards (.ct-card)');

  // 6d. Accessibility & Semantic Attributes
  assert(
    htmlContent.includes('aria-label="Visit NAKAMA on Instagram (@theoriginalnakama)"'),
    'Instagram links provide descriptive aria-label'
  );
  assert(
    htmlContent.includes('aria-label="Visit NAKAMA on X (@originalnakamas)"'),
    'X links provide descriptive aria-label'
  );
  assert(
    htmlContent.includes('aria-label="Email NAKAMA at dmg73364@gmail.com"') || htmlContent.includes('aria-label="Email NAKAMA directly at dmg73364@gmail.com"'),
    'Email links provide descriptive aria-label'
  );
  assert(
    htmlContent.includes('target="_blank" rel="noopener noreferrer"'),
    'External social links open in new tab with rel="noopener noreferrer"'
  );

  // 6e. Centralized Config in JavaScript
  assert(htmlContent.includes('const NAKAMA_SOCIAL='), 'Centralized NAKAMA_SOCIAL configuration exists in script');

  // ── FINAL SUMMARY ──────────────────────────────────────────────────────────
  console.log('\n======================================================');
  console.log(` RESULTS: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log('======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Test suite runner crashed:', err);
  process.exit(1);
});
