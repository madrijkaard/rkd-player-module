const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createServers } = require('../src/server.cjs');
const root = path.resolve(__dirname, '..');

(async () => {
  const servers = await createServers(root);
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 1200, height: 780 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(`${servers.main.origin}/app.js`, route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.goto(servers.main.origin);
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'military';
      window.radar = new LumenRadarBackground(document.querySelector('#radar-background'), { radar: async () => ({ status: 'live', flights: [], timestamp: Date.now(), location: { status: 'available', lat: -23.55, lon: -46.63 } }) });
      radar.configure('military', false);
    });
    await page.waitForFunction(() => radar.cityLabels.length > 10);
    async function checkLayout() {
      const labels = await page.evaluate(() => radar.cityLabels);
      for (let i = 0; i < labels.length; i++) {
        const a = labels[i].box;
        for (const other of labels.slice(i + 1)) {
          const b = other.box;
          assert.ok(!(a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top), 'City labels must not overlap');
        }
      }
      return labels.map(label => label.name);
    }
    const brazil = await checkLayout();
    assert.ok(brazil.includes('SÃO PAULO'));
    assert.ok(brazil.some(name => ['GUARULHOS', 'OSASCO', 'SANTO ANDRÉ'].includes(name)));
    const output = path.join(root, 'work/radar-cities-validation');
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'nearby-cities.png') });
    await page.evaluate(() => document.querySelector('#settings-dialog').showModal());
    await page.waitForFunction(() => radar.container.parentElement.id === 'settings-dialog');
    await checkLayout();
    await page.screenshot({ path: path.join(output, 'modal-cities.png') });
    await page.evaluate(() => {
      document.querySelector('#settings-dialog').close();
      radar.bounds = { south: -35.87, north: -31.87, west: 148.21, east: 154.21 };
      radar.location = { status: 'available', lat: -33.87, lon: 151.21 };
      radar.draw();
    });
    await page.waitForFunction(() => radar.container.parentElement === radar.home);
    const australia = await checkLayout();
    assert.ok(australia.includes('SYDNEY'));
    assert.ok(!australia.includes('SÃO PAULO'));
    await page.setViewportSize({ width: 800, height: 600 });
    await page.waitForFunction(() => radar.width === radar.container.getBoundingClientRect().width);
    await checkLayout();
    await page.evaluate(() => radar.configure('cyberpunk', false));
    assert.equal(await page.locator('#radar-background').isVisible(), false);
    assert.deepEqual(errors, []);
    console.log(`City labels verified in Brazil (${brazil.length}), Australia (${australia.length}), modals and a smaller viewport.`);
  } finally { await browser?.close(); servers.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
