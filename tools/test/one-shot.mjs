// One screenshot of a URL query (needs `npm run dev`). Usage: [EVAL=js] node tools/test/one-shot.mjs "<query>" out.png
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: 1600, height: 900 } });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('console', (m) => ['error', 'warn'].includes(m.type()) && console.log(m.type(), m.text().slice(0, 300)));
await page.goto(`${process.env.SIM_URL ?? 'http://localhost:5173/'}?${process.argv[2]}`);
await page.waitForFunction(() => window.game && !document.getElementById('loading'), { timeout: 180000 });
// optional setup, e.g. EVAL="game.state.minutes = 19 * 60"
if (process.env.EVAL) await page.evaluate(process.env.EVAL);
await new Promise((r) => setTimeout(r, 3500));
await page.screenshot({ path: process.argv[3] });
await browser.close();
