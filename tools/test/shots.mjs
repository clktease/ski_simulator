// Screenshots of fixed viewpoints on the real GPU (needs `npm run dev`). Usage: node tools/test/shots.mjs [outDir] [quality]
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const OUT = path.resolve(process.argv[2] ?? 'tools/test/out/shots');
const QUALITY = process.argv[3] ?? 'high';
const BASE = process.env.SIM_URL ?? 'http://localhost:5173/';
fs.mkdirSync(OUT, { recursive: true });
const VIEWS = {
  spawn: '',
  lodge: '&cam=-120,470,780,-30,440,700',
  base: '&cam=-200,560,700,-200,420,0',
  summit: '&cam=-600,1250,-1400,0,500,600',
  slope: '&cam=-300,800,-200,-150,600,400',
};
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: 1600, height: 900 } });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console', m.text()));
for (const [name, q] of Object.entries(VIEWS)) {
  await page.goto(`${BASE}?quality=${QUALITY}&dynres=0${q}${process.env.EXTRA ?? ''}`);
  await page.waitForFunction(() => window.game && !document.getElementById('loading'), { timeout: 180000 });
  await new Promise((r) => setTimeout(r, 3500));
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('saved', name);
}
await browser.close();
