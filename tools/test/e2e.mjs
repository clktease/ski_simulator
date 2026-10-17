// End-to-end playthrough of a ski day in headless Chrome (needs `npm run dev` running).
// Usage: node tools/test/e2e.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const URL = process.env.SIM_URL ?? 'http://localhost:5173/?quality=low';
const OUT = path.resolve(process.argv[2] ?? 'tools/test/out');
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--window-size=1400,850'],
  defaultViewport: { width: 1400, height: 850 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? '✔' : '✘'} ${msg}`);
  if (!cond) failures++;
};
const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const state = () => page.evaluate(() => {
  const g = window.game;
  const s = g.state;
  return { mode: g.mode, minutes: s.minutes, money: s.money, ticket: s.ticket, rental: s.rental, changed: s.changed, lunch: s.lunchDone, dinner: s.dinnerDone, stats: s.stats, speed: g.ski.telemetry.speed, slope: g.ski.telemetry.slopeDeg, pos: g.body.position.toArray() };
});
async function waitFor(fn, timeout = 60000, label = 'condition') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.evaluate(fn)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log(`  (timeout waiting for ${label})`);
  return false;
}
/** wait for a number of rendered frames (the game polls keys once per frame) */
const frames = (n) => page.evaluate((n) => new Promise((res) => {
  let k = 0;
  const step = () => (++k >= n ? res() : requestAnimationFrame(step));
  requestAnimationFrame(step);
}), n);
async function press(code) {
  await page.keyboard.down(code);
  await frames(3);
  await page.keyboard.up(code);
  await frames(2);
}
/** stand in front of an interaction point (walk mode) */
async function goTo(service, facility) {
  await page.evaluate((service, facility) => {
    const g = window.game;
    const p = g.interaction.points.find((q) => q.service === service && (!facility || q.facility?.id === facility));
    g.teleport(p.position.x, p.position.z, 0);
    if (g.mode === 'ski') g.setMode('walk');
  }, service, facility);
  await frames(3);
}

console.log(`opening ${URL}`);
await page.goto(URL, { waitUntil: 'domcontentloaded' });
check(await waitFor(() => !!window.game && !document.getElementById('loading'), 120000, 'load'), 'game loads');
await frames(5);
await shot('01-start');
let s = await state();
check(s.mode === 'walk' && s.ticket === null, `starts walking at the parking lot (mode=${s.mode})`);

// route guidance points at the first objective
const guideText = await page.$eval('#guide', (e) => (e.hidden ? '' : e.textContent));
check(guideText.includes('售票處'), `guidance shows the way to the ticket office ("${guideText.trim()}")`);
const chevrons = await page.evaluate(() => {
  const m = window.game.guide.chevrons;
  let n = 0;
  const e = m.instanceMatrix.array;
  for (let i = 0; i < m.count; i++) if (e[i * 16] !== 0) n++;
  return n;
});
check(chevrons > 5, `walking trail drawn on the ground (${chevrons} chevrons)`);
await press('KeyG');
check(await page.$eval('#guide', (e) => e.hidden), 'G hides the guidance');
await press('KeyG');

// faster walking: Space dash
await page.keyboard.down('KeyW');
await page.keyboard.down('Space');
await frames(25);
const dashSpeed = await page.evaluate(() => window.game.walk.speed);
await page.keyboard.up('Space');
await page.keyboard.up('KeyW');
check(dashSpeed > 8, `Space dash speed ${dashSpeed.toFixed(1)} m/s`);

// lift is refused without ticket/gear
await page.evaluate(() => {
  const g = window.game;
  const lift = g.interaction.points.find((q) => q.service === 'lift' && /中央/.test(q.label));
  g.teleport(lift.position.x, lift.position.z, 0);
});
await frames(3);
await press('KeyE');
s = await state();
check(s.mode === 'walk', 'lift refuses a player without ticket and gear');

// 1. ticket
await goTo('ticket');
await press('KeyE');
check(await waitFor(() => !document.getElementById('panel').hidden, 10000, 'ticket panel'), 'ticket panel opens with E');
await shot('02-ticket');
await page.click('#panel .option:not([disabled])');
s = await state();
check(s.ticket === 'day' && s.money === 30000 - 5500, `bought a day ticket (¥${s.money})`);

// 2. rental
await goTo('rental');
await press('KeyE');
await waitFor(() => !document.getElementById('panel').hidden, 10000, 'rental panel');
await shot('03-rental');
await page.click('#panel .primary');
s = await state();
check(s.rental?.kind === 'ski' && s.rental.lengthCm === 160, `rented skis ${s.rental?.lengthCm} cm`);

// 3. locker room
await goTo('locker');
await press('KeyE');
await waitFor(() => !document.getElementById('panel').hidden, 10000, 'locker panel');
await page.click('#panel .primary');
check(await waitFor(() => window.game.state.changed && !document.getElementById('fade').classList.contains('on'), 15000, 'change'), 'changed into ski wear');
await frames(3);
await shot('04-changed');

// 4. ride the central quad with fast forward
await page.evaluate(() => {
  const g = window.game;
  const lift = g.interaction.points.find((q) => q.service === 'lift' && /中央/.test(q.label));
  g.teleport(lift.position.x, lift.position.z, 0);
  g.setMode('walk');
});
await frames(3);
await press('KeyE');
s = await state();
check(s.mode === 'lift' && s.stats.liftRides === 1, `boarded the lift (mode=${s.mode})`);
await page.keyboard.down('Space');
await frames(40);
await shot('05-lift');
await page.keyboard.up('Space');
check(await page.$eval('#skip-lift', (e) => !e.hidden), 'skip button shown while riding');
const minutesBefore = (await state()).minutes;
await press('Enter');
check(await waitFor(() => window.game.mode === 'ski', 30000, 'top station'), 'Enter skips to the top station');
check((await state()).minutes - minutesBefore > 10, 'skipping advances the clock by the ride time');
s = await state();
console.log(`  top at y=${s.pos[1].toFixed(0)} m`);

// 5. ski down: glide, tuck, a couple of short turns, glide again.
// Holds are measured in game time: the engine caps a frame at 0.1 s, and swiftshader
// renders ~1 fps, so one frame here ≈ 0.1 s of skiing.
const startY = s.pos[1];
const hold = async (key, gameSeconds) => {
  await page.keyboard.down(key);
  await frames(Math.round(gameSeconds * 10));
  await page.keyboard.up(key);
};
await frames(40);
await hold('KeyW', 3);
await hold('KeyA', 0.3);
await frames(15);
await hold('KeyD', 0.3);
await frames(40);
s = await state();
await shot('06-skiing');
check(s.pos[1] < startY - 5 || s.stats.falls > 0, `skied downhill (Δh=${(s.pos[1] - startY).toFixed(1)} m, speed ${(s.speed * 3.6).toFixed(0)} km/h, falls ${s.stats.falls})`);
check(s.stats.topSpeed > 2, `top speed recorded ${(s.stats.topSpeed * 3.6).toFixed(0)} km/h`);
const hudText = await page.$eval('#ski-readouts', (e) => e.textContent);
check(hudText.includes('海拔') && hudText.includes('雪況'), 'ski HUD shows readouts');

// piste guide and full map
await press('KeyM');
check(await page.evaluate(() => window.game.w.pisteGuide.visible), 'M shows the piste guide');
await press('KeyN');
check(await page.$eval('#bigmap-wrap', (e) => !e.hidden), 'N opens the full map');
await frames(3);
await shot('06c-bigmap');
await press('KeyN');
await press('KeyM');

// NPC skiers: fly the camera next to one that is skiing
const npcCount = await page.evaluate(() => {
  const g = window.game;
  const active = g.npcs.npcs.filter((n) => n.state !== 'gone');
  const skier = active.find((n) => n.state === 'ski') ?? active[0];
  const V = g.body.position.constructor;
  const back = new V(-Math.sin(skier.heading), 0, -Math.cos(skier.heading));
  g.flyTo(skier.pos.clone().addScaledVector(back, 9).add(new V(0, 4, 0)), skier.pos);
  return active.length;
});
await frames(2);
await shot('06b-npcs');
check(npcCount > 0, `${npcCount} NPC skiers active`);
await page.evaluate(() => window.game.setMode('ski'));
await frames(3);

// Phase 2: first person + blizzard + night lighting
await press('KeyV');
await frames(10);
await shot('07-first-person');
await page.evaluate(() => { window.game.weatherAuto = false; window.game.weather.set('blizzard'); });
await frames(60);
await shot('08-blizzard');
await press('KeyV');

// 6. lunch at noon (skis off first)
await page.evaluate(() => { const g = window.game; g.weather.set('clear'); g.state.minutes = 12 * 60; });
await goTo('restaurant', 'center-house');
await press('KeyE');
await waitFor(() => !document.getElementById('panel').hidden, 10000, 'restaurant panel');
await shot('09-restaurant');
await page.click('#panel .option:not([disabled])');
check(await waitFor(() => window.game.state.lunchDone, 15000, 'lunch'), 'had lunch');

// night skiing look
await page.evaluate(() => { const g = window.game; g.state.minutes = 18 * 60; g.weather.set('clear'); });
await page.evaluate(() => {
  const g = window.game;
  const lift = g.interaction.points.find((q) => q.service === 'lift' && /中央/.test(q.label));
  g.teleport(lift.position.x, lift.position.z + 30, 180);
});
await frames(40);
await shot('10-night');

// 7. dinner -> summary
await goTo('dinner');
await press('KeyE');
await waitFor(() => !document.getElementById('panel').hidden, 10000, 'dinner panel');
await page.click('#panel .option:not([disabled])');
check(await waitFor(() => !document.getElementById('summary').hidden, 20000, 'summary'), 'dinner ends the day with a summary');
await shot('11-summary');
s = await state();
console.log(`  stats: ${JSON.stringify(s.stats)}`);

check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''}`);
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
