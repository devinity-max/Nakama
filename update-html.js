/**
 * update-html.js
 * =====================================================
 * Updates the NAKAMA portfolio HTML file's video configuration (const R)
 * with the verified public Supabase Storage URLs from upload-results.json.
 *
 * Rules:
 *  - Preserves exact project descriptions, ordering, poster base64 data, and layout classes.
 *  - Preserves the external link https://plzfruit.com on Plz fruit.
 *  - Creates a .bak backup file before making any edits.
 *  - Verifies that all 5 projects were updated before saving.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const RESULTS_FILE = path.join(__dirname, 'upload-results.json');
if (!fs.existsSync(RESULTS_FILE)) {
  console.error('[ERROR] upload-results.json not found.');
  console.error('Please run upload-videos.js successfully first.');
  process.exit(1);
}

const results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf8'));
const urls = results.urls || {};

const HTML_FILE = fs.readdirSync(__dirname).find(
  f => f.endsWith('.html') && !f.startsWith('preview') && !f.startsWith('tmp')
);

if (!HTML_FILE) {
  console.error('[ERROR] Target portfolio HTML file not found in workspace.');
  process.exit(1);
}

const htmlPath = path.join(__dirname, HTML_FILE);
const backupPath = htmlPath + '.bak';

console.log('======================================================');
console.log(' NAKAMA — Portfolio HTML Video Config Updater');
console.log('======================================================');
console.log('Target HTML file :', HTML_FILE);
console.log('Backup destination:', path.basename(backupPath));

const rawHtml = fs.readFileSync(htmlPath, 'utf8');
const isCRLF = rawHtml.includes('\r\n');
const lines = rawHtml.split(/\r?\n/);

const TARGET_PROJECTS = [
  { name: 'Saviour', slug: 'saviour' },
  { name: 'Achiever', slug: 'achiever' },
  { name: 'Kirana OS', slug: 'kirana-os' },
  { name: 'Plz fruit', slug: 'plz-fruit' },
  { name: 'Value.net Community', slug: 'value-net' },
];

let updatedCount = 0;

for (const proj of TARGET_PROJECTS) {
  const url = urls[proj.slug];
  if (!url) {
    console.warn(`[SKIP] No uploaded URL found for "${proj.name}" (slug: ${proj.slug})`);
    continue;
  }

  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`name:"${proj.name}"`)) {
      if (lines[i].includes('src:null')) {
        lines[i] = lines[i].replace('src:null', `src:"${url}"`);
        console.log(`  [UPDATED] ${proj.name.padEnd(22)} -> ${url}`);
        updatedCount++;
        found = true;
        break;
      } else if (lines[i].match(/src:"https?:\/\/[^"]+"/)) {
        lines[i] = lines[i].replace(/src:"https?:\/\/[^"]+"/, `src:"${url}"`);
        console.log(`  [REPLACED] ${proj.name.padEnd(22)} -> ${url}`);
        updatedCount++;
        found = true;
        break;
      }
    }
  }

  if (!found) {
    console.error(`  [NOT FOUND] Could not locate entry for "${proj.name}" in HTML.`);
  }
}

if (updatedCount !== TARGET_PROJECTS.length) {
  console.error(`\n[ABORT] Expected to update ${TARGET_PROJECTS.length} projects, but only updated ${updatedCount}.`);
  console.error('HTML was not modified.');
  process.exit(1);
}

// Create backup
fs.copyFileSync(htmlPath, backupPath);
console.log(`\nCreated backup file: ${path.basename(backupPath)}`);

// Save updated HTML
const newContent = lines.join(isCRLF ? '\r\n' : '\n');
fs.writeFileSync(htmlPath, newContent, 'utf8');
console.log(`Successfully updated ${HTML_FILE} with all 5 Supabase Storage video URLs.\n`);
