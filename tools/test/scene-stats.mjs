// Count meshes per top-level scene child (needs `npm run dev`). Usage: node tools/test/scene-stats.mjs
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu'], defaultViewport: { width: 1600, height: 900 } });
const page = await browser.newPage();
await page.goto((process.env.SIM_URL ?? 'http://localhost:5173/') + '?quality=high');
await page.waitForFunction(() => window.game && !document.getElementById('loading'), { timeout: 180000 });
console.log(await page.evaluate(() => {
  const scene = window.game.engine.scene;
  return scene.children.map((c, i) => {
    let meshes = 0, casters = 0;
    c.traverseVisible((o) => { if (o.isMesh || o.isPoints || o.isLine) { meshes++; if (o.castShadow) casters++; } });
    return `${i} ${c.type} ${c.name || ''} meshes=${meshes} casters=${casters}`;
  }).join('\n');
}));
await browser.close();
