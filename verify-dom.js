const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Run a headless browser test evaluating JS expressions directly in Chrome
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const htmlPath = path.resolve('NAKAMA \u2014 Digital Product Studio (2).html');
const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');

console.log('Running DOM Verification in Headless Chrome...');

// Test DOM inspection via --dump-dom
const dumpRes = spawnSync(chromePath, [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--virtual-time-budget=2000',
  '--dump-dom',
  fileUrl
]);

const dom = dumpRes.stdout.toString();

// --- Checks: ripple must be ABSENT ---
const rippleAbsent = [
  { name: 'bg-ripple-container div ABSENT',      pass: !dom.includes('id="bg-ripple-container"') },
  { name: 'bg-ripple-grid div ABSENT',           pass: !dom.includes('class="bg-ripple-grid"') },
  { name: 'bg-ripple-cell ABSENT',               pass: !dom.includes('bg-ripple-cell') },
  { name: 'ripple script tag ABSENT',            pass: !dom.includes('background-ripple-effect.js') },
  { name: 'ripple keyframes ABSENT',             pass: !dom.includes('@keyframes ripple-a') && !dom.includes('@keyframes ripple-b') },
  { name: 'BackgroundRippleEffect class ABSENT', pass: !dom.includes('BackgroundRippleEffect') },
];

// --- Checks: original structure must be PRESENT ---
const structurePresent = [
  { name: '#welcome section present',            pass: dom.includes('id="welcome"') },
  { name: 'Welcome CSS grid background present', pass: dom.includes('repeating-linear-gradient') },
  { name: 'Nav element present',                 pass: dom.includes('id="nav"') },
  { name: 'Footer element present',              pass: dom.includes('<footer') },
  { name: 'Contact form present',               pass: dom.includes('id="contact"') },
  { name: 'Work section present',                pass: dom.includes('id="work"') },
  { name: 'Team section present',                pass: dom.includes('id="team"') },
  { name: 'Footer original CSS intact',          pass: dom.includes('border-top:1px solid var(--ln)') },
  { name: 'Nav z-index:10 preserved',            pass: dom.includes('z-index:10') },
];

const checks = [...rippleAbsent, ...structurePresent];

let allPassed = true;
console.log('\n--- Ripple removal checks (must be ABSENT) ---');
rippleAbsent.forEach(c => {
  console.log(`${c.pass ? '[PASS]' : '[FAIL]'} ${c.name}`);
  if (!c.pass) allPassed = false;
});
console.log('\n--- Structure preservation checks (must be PRESENT) ---');
structurePresent.forEach(c => {
  console.log(`${c.pass ? '[PASS]' : '[FAIL]'} ${c.name}`);
  if (!c.pass) allPassed = false;
});

if (!allPassed) {
  console.error('\nSome checks FAILED.');
  process.exit(1);
} else {
  console.log('\nAll DOM verifications PASSED!');
}
