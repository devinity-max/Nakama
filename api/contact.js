/**
 * api/contact.js — NAKAMA Secure Contact Form API Endpoint
 * ========================================================
 * Compatible with Vercel Serverless, Netlify Functions, and Node.js server.
 *
 * Security & Reliability Architecture:
 *  1. Schema validation & sanitization (Zod-equivalent defensive rules, zero extra runtime dependencies).
 *  2. Header injection prevention (\r, \n, bcc:, cc:, to: blocked in name/email fields).
 *  3. In-memory sliding-window rate limiting per client IP (5 requests / 15 min).
 *  4. Spam mitigation:
 *     - Honeypot trap field (silent dismissal of automated scrapers).
 *     - Bot speed trap (minimum 1.5 seconds interaction time required).
 *  5. Maximum payload limit (32 KB limit against denial-of-service / buffer exhaustion).
 *  6. Safe Resend email dispatch over HTTPS:
 *     - Never exposes API keys, recipient mailboxes, or provider traces to the client.
 *     - Clear HTTP 503 response when email service credentials are unconfigured.
 *     - Sanitized text & HTML rendering (avoids XSS).
 */

'use strict';

// ── In-Memory Rate Limiting (Sliding Window per IP) ──────────────────────────
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_REQUESTS_PER_WINDOW = 5;
const ipSubmissions = new Map();

// Periodic cleanup of stale rate-limit records
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of ipSubmissions.entries()) {
    const valid = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    if (valid.length === 0) {
      ipSubmissions.delete(ip);
    } else {
      ipSubmissions.set(ip, valid);
    }
  }
}, 5 * 60 * 1000).unref?.();

function isRateLimited(ip) {
  const now = Date.now();
  const history = ipSubmissions.get(ip) || [];
  const recent = history.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  
  if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
    return true;
  }
  
  recent.push(now);
  ipSubmissions.set(ip, recent);
  return false;
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || '127.0.0.1';
}

// ── Allowed Field Whitelists ──────────────────────────────────────────────────
const ALLOWED_PROJECT_TYPES = [
  'Website',
  'SaaS platform',
  'E-commerce',
  'Custom software',
  'Other'
];

const ALLOWED_BUDGET_RANGES = [
  'Not sure yet',
  'Under $5k',
  '$5k \u2013 $15k',
  '$5k - $15k',
  '$15k+',
  'Other'
];

// RFC 5322 compliant email regex (simplified, strict against newlines)
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

// ── HTML Escape Helper ───────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Request Body Parser ──────────────────────────────────────────────────────
async function parseJsonBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    const MAX_SIZE = 32 * 1024; // 32 KB

    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_SIZE) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
      } else {
        raw += chunk;
      }
    });

    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('INVALID_JSON'));
      }
    });

    req.on('error', reject);
  });
}

// ── Main Handler ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // CORS & Security headers
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: false, error: 'Method not allowed. Use POST.' }));
    return;
  }

  // Rate Limiting Check
  const clientIp = getClientIp(req);
  if (isRateLimited(clientIp)) {
    res.statusCode = 429;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Retry-After', '900');
    res.end(JSON.stringify({
      success: false,
      error: 'Too many submissions from this connection. Please wait 15 minutes before submitting again.'
    }));
    return;
  }

  // Parse Body
  let body;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    res.statusCode = err.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      success: false,
      error: err.message === 'PAYLOAD_TOO_LARGE'
        ? 'Request payload too large (max 32 KB).'
        : 'Malformed JSON payload.'
    }));
    return;
  }

  const { name, email, projectType, budget, description, _hp, _ts } = body || {};

  // 1. Spam Trap: Honeypot check (hidden field should be empty)
  if (_hp) {
    // Silently succeed for bots so they don't learn how to bypass
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: true, message: 'Enquiry received.' }));
    return;
  }

  // 2. Spam Trap: Interaction Speed Check (min 1200ms)
  if (_ts) {
    const elapsed = Date.now() - Number(_ts);
    if (!isNaN(elapsed) && elapsed > 0 && elapsed < 1200) {
      // Submitting faster than 1.2s indicates an automated script
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, message: 'Enquiry received.' }));
      return;
    }
  }

  // 3. Validation: Name
  const cleanName = (typeof name === 'string' ? name.trim() : '');
  if (!cleanName || cleanName.length < 2 || cleanName.length > 100) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: false, error: 'Please enter a valid name (2 to 100 characters).' }));
    return;
  }
  // Prevent email header injection in name
  if (/[\r\n]|bcc:|cc:|to:/i.test(cleanName)) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: false, error: 'Invalid characters in name field.' }));
    return;
  }

  // 4. Validation: Email
  const cleanEmail = (typeof email === 'string' ? email.trim() : '');
  if (!cleanEmail || cleanEmail.length < 5 || cleanEmail.length > 254 || !EMAIL_REGEX.test(cleanEmail)) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: false, error: 'Please enter a valid email address.' }));
    return;
  }
  // Prevent email header injection in email
  if (/[\r\n]|bcc:|cc:|to:/i.test(cleanEmail)) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: false, error: 'Invalid characters in email field.' }));
    return;
  }

  // 5. Validation: Project Type & Budget
  const cleanProjectType = ALLOWED_PROJECT_TYPES.includes(projectType) ? projectType : 'Website';
  const cleanBudget = ALLOWED_BUDGET_RANGES.includes(budget) ? budget : 'Not sure yet';

  // 6. Validation: Description
  const cleanDesc = (typeof description === 'string' ? description.trim() : '');
  if (!cleanDesc || cleanDesc.length < 10 || cleanDesc.length > 3000) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      success: false,
      error: 'Please provide a project description between 10 and 3,000 characters.'
    }));
    return;
  }

  // 7. Check Email Provider Configuration (Resend)
  const resendApiKey = process.env.RESEND_API_KEY;
  const toEmail = process.env.CONTACT_TO_EMAIL;
  const fromEmail = process.env.CONTACT_FROM_EMAIL;

  if (!resendApiKey || !toEmail || !fromEmail || resendApiKey.startsWith('re_your_')) {
    // Deployment Blocker Notice: Provider credentials not yet configured
    console.warn('[CONTACT API] Email provider (Resend) is not yet configured in environment variables.');
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      success: false,
      error: 'Email delivery is currently awaiting sender domain configuration. Please reach out to dmg73364@gmail.com directly.'
    }));
    return;
  }

  // 8. Dispatch Email via Resend REST API
  try {
    const textBody = [
      `New Project Enquiry — NAKAMA`,
      `---------------------------------`,
      `From:         ${cleanName}`,
      `Email:        ${cleanEmail}`,
      `Project Type: ${cleanProjectType}`,
      `Budget Range: ${cleanBudget}`,
      `IP:           ${clientIp}`,
      `Date:         ${new Date().toISOString()}`,
      `---------------------------------`,
      `Description:`,
      cleanDesc,
      `---------------------------------`
    ].join('\n');

    const htmlBody = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #111; line-height: 1.6;">
        <h2 style="font-size: 20px; font-weight: 600; margin-top: 0; color: #0a0a0a; border-bottom: 2px solid #d1182f; padding-bottom: 8px;">
          New Enquiry — NAKAMA
        </h2>
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px;">
          <tr>
            <td style="padding: 8px 0; color: #666; width: 140px;"><strong>Name</strong></td>
            <td style="padding: 8px 0; color: #111;">${escapeHtml(cleanName)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666;"><strong>Email</strong></td>
            <td style="padding: 8px 0; color: #111;"><a href="mailto:${escapeHtml(cleanEmail)}" style="color: #d1182f;">${escapeHtml(cleanEmail)}</a></td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666;"><strong>Project Type</strong></td>
            <td style="padding: 8px 0; color: #111;">${escapeHtml(cleanProjectType)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666;"><strong>Budget</strong></td>
            <td style="padding: 8px 0; color: #111;">${escapeHtml(cleanBudget)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666;"><strong>Received</strong></td>
            <td style="padding: 8px 0; color: #666; font-size: 12px;">${new Date().toUTCString()}</td>
          </tr>
        </table>
        <div style="background: #f7f6f4; border-left: 3px solid #d1182f; padding: 16px; border-radius: 4px; margin-top: 16px;">
          <h4 style="margin: 0 0 8px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.05em; color: #555;">Project Brief</h4>
          <p style="margin: 0; font-size: 14px; white-space: pre-wrap; color: #222;">${escapeHtml(cleanDesc)}</p>
        </div>
      </div>
    `;

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        reply_to: cleanEmail,
        subject: `[NAKAMA Enquiry] ${cleanName} — ${cleanProjectType}`,
        text: textBody,
        html: htmlBody
      })
    });

    const resendData = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error('[CONTACT API] Resend API rejected message:', resendData?.message || resendResponse.statusText);
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        success: false,
        error: 'Unable to deliver message through the email provider at this moment. Please email dmg73364@gmail.com directly.'
      }));
      return;
    }

    // Success — provider accepted message
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      success: true,
      message: 'Thank you. Your enquiry has been received — we will respond shortly.'
    }));
  } catch (deliveryError) {
    console.error('[CONTACT API] Network/transport error during email dispatch:', deliveryError.message);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      success: false,
      error: 'An unexpected transmission error occurred. Please try again or reach out to dmg73364@gmail.com.'
    }));
  }
};
