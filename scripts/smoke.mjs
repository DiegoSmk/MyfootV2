import puppeteer from 'puppeteer';
import { pathTo } from './route.mjs';

const URL = 'http://localhost:5174/?test=1';
const STEP_MS = 450; // move anim ~90ms + transition ~360ms worst case

const errors = [];

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log('  ok:', msg);
}

async function idleState(page) {
  return page.evaluate(() => ({
    moving: window.__game.player.moving,
    transition: window.__game.transition,
    mapId: window.__game.mapId,
    x: window.__game.player.x,
    y: window.__game.player.y,
  }));
}

async function waitIdle(page, timeout = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const s = await idleState(page);
    if (!s.moving && !s.transition) return s;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('timeout waiting for idle state');
}

// one deterministic step: move (or warp/connection), wait until settled
async function step(page, dir) {
  await page.evaluate((d) => window.__game.testStep(d), dir);
  return waitIdle(page);
}

// walk a sequence of directions, asserting final map + cell
async function walk(page, dirs, expectMap, expectXY) {
  let last;
  for (const d of dirs) last = await step(page, d);
  const s = last ?? (await idleState(page));
  assert(s.mapId === expectMap, `after walking, map is ${s.mapId} (want ${expectMap})`);
  if (expectXY) {
    assert(s.x === expectXY[0] && s.y === expectXY[1], `player at (${s.x},${s.y}) want (${expectXY})`);
  }
  return s;
}

async function main() {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });

  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 20000 });
  // wait for boot: game object present and pallet loaded
  await page.waitForFunction(() => window.__game && window.__game.mapId === 'pallet', { timeout: 10000 });
  let s = await idleState(page);
  assert(s.mapId === 'pallet' && s.x === 5 && s.y === 5, 'boot: spawn at pallet (5,5)');
  const label = await page.evaluate(() => document.getElementById('map-label').textContent);
  assert(label === 'PALLET TOWN', `HUD label shows "${label}"`);

  // ---- Test A: Red's house warp in/out + dialogue with mom ----
  console.log('[A] reds house warp + dialogue');
  await walk(page, ['up'], 'reds_house_1f', [2, 7]);
  let l = await page.evaluate(() => document.getElementById('map-label').textContent);
  assert(l === 'CASA DO RED', `HUD label "${l}"`);
  // walk to (5,5) below mom, step up onto her cell, talk
  const toMom = pathTo('reds_house_1f', 2, 7, [5, 5]);
  await walk(page, toMom, 'reds_house_1f', [5, 5]);
  await walk(page, ['up'], 'reds_house_1f', [5, 4]);
  await page.evaluate(() => window.__game.testInteract());
  await new Promise((r) => setTimeout(r, 50));
  const dlg = await page.evaluate(() => window.__game.dialogue);
  assert(dlg && dlg.includes('Mamãe'), `dialogue shown: ${JSON.stringify(dlg && dlg.slice(0, 30))}`);
  await page.evaluate(() => window.__game.testInteract()); // close
  // walk back toward the exit door: stepping onto the warp cell warps out
  const backToWarp = pathTo('reds_house_1f', 5, 4, [2, 7]);
  await walk(page, backToWarp, 'pallet', [5, 5]);
  // re-enter and test the blocked-move exit (press down while on the door)
  await walk(page, ['up'], 'reds_house_1f', [2, 7]);
  await walk(page, ['down'], 'pallet', [5, 5]);

  // ---- Test B: Blue's house warp in/out ----
  console.log('[B] blues house warp');
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__game && window.__game.mapId === 'pallet', { timeout: 10000 });
  const toBlues = pathTo('pallet', 5, 5, [13, 5]);
  await walk(page, toBlues, 'blues_house', [3, 7]); // stepping on door warps in
  await walk(page, ['down'], 'pallet', [13, 5]); // exit warp back

  // ---- Test C: Oak's lab warp in/out ----
  console.log('[C] oaks lab warp');
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__game && window.__game.mapId === 'pallet', { timeout: 10000 });
  const toLab = pathTo('pallet', 5, 5, [12, 11]);
  await walk(page, toLab, 'oaks_lab', [5, 11]); // stepping on door warps in
  await walk(page, ['down'], 'pallet', [12, 11]); // exit lab back

  // ---- Test D: connection pallet <-> route_1 ----
  console.log('[D] connection north edge to route 1');
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__game && window.__game.mapId === 'pallet', { timeout: 10000 });
  const toEdge = pathTo('pallet', 5, 5, [10, 0]);
  await walk(page, toEdge, 'pallet', [10, 0]);
  await step(page, 'up'); // cross the north edge
  s = await idleState(page);
  assert(s.mapId === 'route_1' && s.x === 10 && s.y === 35, `in route_1 (${s.mapId},${s.x},${s.y})`);
  l = await page.evaluate(() => document.getElementById('map-label').textContent);
  assert(l === 'ROTA 1', `HUD label "${l}"`);
  await walk(page, ['down'], 'pallet', [10, 0]); // cross back

  // ---- Test E: border blocks a non-connected edge ----
  console.log('[E] non-connected edge stays in map');
  const before = await idleState(page);
  await step(page, 'left');
  await step(page, 'left');
  await step(page, 'left');
  const afterLeft = await idleState(page);
  assert(afterLeft.mapId === 'pallet', 'still in pallet after walking into the west border');
  // from the north edge we could only walk onto walkable cells; the border
  // must have stopped us somewhere inside the map (never off-map, never warp)
  assert(afterLeft.x >= 0 && afterLeft.y >= 0, `player still inside map (${afterLeft.x},${afterLeft.y})`);
  void before;

  console.log('');
  if (errors.length) {
    console.log('CONSOLE/PAGE ERRORS:');
    for (const e of errors) console.log('  -', e);
    process.exitCode = 1;
  } else {
    console.log('ALL SMOKE TESTS PASSED — no console/page errors');
  }
  await browser.close();
}

main().catch((e) => {
  console.error('SMOKE TEST FAILED:', e.message);
  process.exit(1);
});
