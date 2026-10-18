// Screenshot while skiing fast down a run (needs `npm run dev`). Usage: node tools/test/ski-shot.mjs out.png [seconds] [query]
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'], defaultViewport: { width: 1600, height: 900 } });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${process.env.SIM_URL ?? 'http://localhost:5173/'}?quality=high&${process.argv[4] ?? ''}`);
await page.waitForFunction(() => window.game && !document.getElementById('loading'), { timeout: 180000 });
await page.evaluate(() => {
  const g = window.game;
  const l = g.w.lifts.find((x) => /中央/.test(x.data.name ?? '')) ?? g.w.lifts[0];
  // start a little below the top station, facing down the lift line
  const x = l.top.x - l.topDir.x * 40, z = l.top.z - l.topDir.z * 40;
  g.body.heading = Math.atan2(-l.topDir.x, -l.topDir.z);
  g.body.position.set(x, g.w.hm.heightAt(x, z), z);
  g.cam.reset(g.body.position, g.body.heading);
  g.setMode('ski');
  g.ski.start(g.body);
});
await page.keyboard.down('KeyW');
await new Promise((r) => setTimeout(r, (Number(process.argv[3]) || 6) * 1000));
console.log(await page.evaluate(() => `speed ${(window.game.ski.telemetry.speed * 3.6).toFixed(0)} km/h, fx ${window.game.engine.speedFx.toFixed(2)}, fallen ${window.game.ski.fallen}`));
await page.screenshot({ path: process.argv[2] });
await browser.close();
