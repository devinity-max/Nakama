const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const htmlPath = path.resolve('NAKAMA — Digital Product Studio (2).html');
const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');

const routes = ['welcome', 'home', 'work', 'services', 'capabilities', 'team', 'about', 'contact'];
const outDir = path.resolve('verification_screenshots');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

console.log('Starting headless browser verification across all 8 routes...');

// Desktop verification (1440x900)
for (const r of routes) {
  const url = `${fileUrl}#${r}`;
  const shotPath = path.join(outDir, `desktop_${r}.png`);
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--virtual-time-budget=2000',
    '--window-size=1440,900',
    `--screenshot=${shotPath}`,
    url
  ];
  const res = spawnSync(chromePath, args);
  if (fs.existsSync(shotPath)) {
    const stat = fs.statSync(shotPath);
    console.log(`[PASS] Desktop #${r} -> desktop_${r}.png (${stat.size} bytes)`);
  } else {
    console.error(`[FAIL] Desktop #${r} failed:`, res.stderr.toString());
  }
}

// Mobile verification (390x844)
for (const r of routes) {
  const url = `${fileUrl}#${r}`;
  const shotPath = path.join(outDir, `mobile_${r}.png`);
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--virtual-time-budget=2000',
    '--window-size=390,844',
    `--screenshot=${shotPath}`,
    url
  ];
  const res = spawnSync(chromePath, args);
  if (fs.existsSync(shotPath)) {
    const stat = fs.statSync(shotPath);
    console.log(`[PASS] Mobile #${r} -> mobile_${r}.png (${stat.size} bytes)`);
  } else {
    console.error(`[FAIL] Mobile #${r} failed:`, res.stderr.toString());
  }
}

console.log('Browser verification completed!');
