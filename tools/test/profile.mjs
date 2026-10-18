import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-frame-rate-limit', '--disable-gpu-vsync'], defaultViewport: { width: 1600, height: 900 } });
const page = await browser.newPage();
await page.goto('http://localhost:5173/?quality=high&dynres=0' + (process.argv[2] ? '&cam=' + process.argv[2] : ''));
await page.waitForFunction(() => window.game && !document.getElementById('loading'), { timeout: 180000 });
await new Promise((r) => setTimeout(r, 4000));
const cdp = await page.createCDPSession();
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
await new Promise((r) => setTimeout(r, 5000));
const { profile } = await cdp.send('Profiler.stop');
const self = new Map();
const dt = profile.timeDeltas; const counts = new Map();
profile.samples.forEach((id, i) => counts.set(id, (counts.get(id) ?? 0) + (dt[i] ?? 0)));
let total = 0;
for (const n of profile.nodes) {
  const t = (counts.get(n.id) ?? 0) / 1000;
  total += t;
  const cf = n.callFrame; const key = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber}`;
  self.set(key, (self.get(key) ?? 0) + t);
}
console.log('total ms', total.toFixed(0));
[...self].sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, v]) => console.log(v.toFixed(1).padStart(8), k));
await browser.close();
