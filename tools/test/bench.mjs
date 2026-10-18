// Rendering benchmark on the real GPU (needs `npm run dev` running).
// Usage: node tools/test/bench.mjs [quality=high]   → prints fps / CPU ms / draw calls per viewpoint
import puppeteer from 'puppeteer-core';

const QUALITY = process.argv[2] ?? 'high';
const BASE = process.env.SIM_URL ?? 'http://localhost:5173/';
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SOFTWARE = process.env.SOFTWARE === '1';

// x,y,z,lookX,lookY,lookZ fly-camera viewpoints (null = default walking spawn)
const VIEWS = {
  spawn: null,
  base: '-200,560,700,-200,420,0',
  summit: '-600,1250,-1400,0,500,600',
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    ...(SOFTWARE ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']),
    '--disable-frame-rate-limit',
    '--disable-gpu-vsync',
    '--window-size=1600,900',
  ],
  defaultViewport: { width: 1600, height: 900 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
for (const [name, cam] of Object.entries(VIEWS)) {
  const url = `${BASE}?quality=${QUALITY}&dynres=0${cam ? `&cam=${cam}` : ''}`;
  await page.goto(url);
  await page.waitForFunction(() => window.game && !document.getElementById('loading'), { timeout: 180000 });
  await new Promise((r) => setTimeout(r, 4000)); // shader compile / warm-up
  const samples = [];
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 600));
    samples.push(await page.evaluate(() => ({ ...window.game.engine.perf.stats, gpu: window.game.engine.gpu.name })));
  }
  const avg = (k) => samples.reduce((a, s) => a + s[k], 0) / samples.length;
  const s = samples.at(-1);
  console.log(`${name.padEnd(7)} ${avg('fps').toFixed(0).padStart(4)} fps  CPU ${avg('cpuMs').toFixed(2)} ms (max ${Math.max(...samples.map((x) => x.cpuMax)).toFixed(1)})  calls ${s.calls}  tris ${(s.triangles / 1e6).toFixed(2)}M`);
  if (name === 'spawn') console.log(`  GPU: ${s.gpu}`);
}
await browser.close();
