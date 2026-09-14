const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createServers } = require('../src/server.cjs');
const root = path.resolve(__dirname, '..');
const ids = ['AAAAAAAAAAA', 'BBBBBBBBBBB', 'CCCCCCCCCCC', 'DDDDDDDDDDD'];

(async () => {
  const servers = await createServers(root);
  let browser, releaseLate;
  try {
    browser = await chromium.launch({
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
      headless: true
    });
    const page = await browser.newPage({ viewport: { width: 1200, height: 780 }, reducedMotion: 'reduce' });
    const errors = [], requested = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ ids, playerOrigin }) => {
      let history = ids.map((id, i) => ({ id, title: `Vídeo ${i + 1}`, thumbnail: '', liked: false }));
      let settings = { theme: 'cyberpunk', visualizerEnabled: false, visualizerStyle: 'bars', videoTint: 'none', transparency: 0 };
      const channel = { id: 'UCaaaaaaaaaaaaaaaaaaaaaa', title: 'Canal de teste' };
      window.lumen = {
        init: async () => ({ library: [], history, settings, playerOrigin, minimized: false }),
        migrateLibrary: async () => ({ library: [], pending: 0 }),
        onVisibility() {}, onLibraryUpdate() {},
        settings: async patch => (settings = { ...settings, ...patch }),
        historyChannel: async () => channel,
        recommendations: async () => ({ channel, items: [], total: 0 }),
        recordHistory: async video => {
          history = [video, ...history.filter(item => item.id !== video.id)];
          return history;
        }
      };
    }, { ids, playerOrigin: servers.player.origin });
    // Exercise real app events and CSP without desktop APIs or remote playback.
    for (const [file, name] of [['visualizer', 'LumenVisualizer'], ['space-background', 'LumenSpaceBackground'], ['radar-background', 'LumenRadarBackground']]) {
      await page.route(`${servers.main.origin}/${file}.js`, route => route.fulfill({
        contentType: 'application/javascript',
        body: `window.${name}=class {constructor(){return new Proxy({}, {get:()=>()=>{}})}};`
      }));
    }
    await page.route(`${servers.player.origin}/player.html*`, route => route.fulfill({
      contentType: 'text/html',
      body: `<script>window.testEmit=(type,value,session=location.search)=>parent.postMessage({source:'lumen-player',session,type,value},${JSON.stringify(servers.main.origin)});</script>`
    }));
    const late = new Promise(resolve => { releaseLate = resolve; });
    await page.route('https://i.ytimg.com/vi/**', async route => {
      const url = route.request().url(); requested.push(url);
      if (url.includes(ids[2])) await late;
      const fallback = url.includes(ids[1]) && url.includes('maxresdefault');
      const width = fallback ? 120 : 1280, height = fallback ? 90 : 720;
      await route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g"><stop stop-color="#155b70"/><stop offset=".5" stop-color="#8a2468"/><stop offset="1" stop-color="#b88426"/></linearGradient></defs><path fill="url(#g)" d="M0 0h${width}v${height}H0z"/></svg>` });
    });
    await page.goto(servers.main.origin);
    await page.waitForFunction(() => document.body.dataset.ready === 'true');
    const background = page.locator('#cyberpunk-background');
    await page.waitForFunction(id => document.querySelector('#cyberpunk-background').dataset.videoId === id, ids[0]);
    assert.equal(await background.isVisible(), true, 'History supplies the initial slideshow cover');
    async function select(id) {
      await page.locator('#history-button').click();
      await page.locator(`.history-entry[data-id="${id}"]`).click();
      await page.waitForFunction(id => document.querySelector('#player').src.includes(`video=${id}`), id);
      const frame = await (await page.locator('#player').elementHandle()).contentFrame();
      assert.ok(frame);
      await frame.waitForURL(url => url.searchParams.get('video') === id);
      await frame.waitForFunction(() => typeof testEmit === 'function');
      return (type, value, session) => frame.evaluate(({ type, value, session }) => testEmit(type, value, session), { type, value, session });
    }
    let emit = await select(ids[0]);
    await emit('state', 5);
    assert.equal(await background.getAttribute('data-video-id'), ids[0]);
    await emit('state', 1, '?stale');
    assert.equal(requested.length, 1);
    await emit('state', 1);
    await page.waitForFunction(id => document.querySelector('#cyberpunk-background').dataset.videoId === id, ids[0]);
    assert.equal(await background.isVisible(), true);
    for (const state of [2, 0, 1]) await emit('state', state);
    assert.equal(requested.length, 1, 'Pause, end and resume must reuse the same cover');
    emit = await select(ids[1]);
    await emit('state', 5);
    assert.equal(await background.getAttribute('data-video-id'), ids[0]);
    await emit('state', 1);
    await page.waitForFunction(id => document.querySelector('#cyberpunk-background').dataset.videoId === id, ids[1]);
    assert.ok(requested.some(url => url.endsWith(`${ids[1]}/hqdefault.jpg`)));
    emit = await select(ids[2]);
    const lateRequest = page.waitForRequest(request => request.url().includes(ids[2]));
    await emit('state', 1); await lateRequest;
    emit = await select(ids[3]); await emit('state', 1);
    await page.waitForFunction(id => document.querySelector('#cyberpunk-background').dataset.videoId === id, ids[3]);
    const lateResponse = page.waitForResponse(response => response.url().includes(ids[2]));
    releaseLate(); await lateResponse;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await background.getAttribute('data-video-id'), ids[3], 'Late covers must not replace the current video');
    const dialogs = ['#library-dialog', '#video-dialog', '#settings-dialog', '#history-dialog'];
    for (const selector of dialogs) {
      assert.ok((await page.locator(selector).evaluate(n => n.style.getPropertyValue('--cyberpunk-cover'))).includes(ids[3]));
    }
    await page.locator('#settings-button').click();
    for (const theme of ['military', 'space']) {
      await page.locator('#theme').selectOption(theme);
      assert.equal(await background.isVisible(), false);
      assert.ok(!(await page.locator('#settings-dialog').evaluate(n => getComputedStyle(n).backgroundImage)).includes(ids[3]));
    }
    const count = requested.length;
    await page.locator('#theme').selectOption('cyberpunk');
    await page.keyboard.press('Escape');
    assert.equal(await background.isVisible(), true);
    assert.equal(requested.length, count);
    // Stopping keeps the last cover; the empty player can return over it.
    await emit('state', 0);
    assert.equal(await background.getAttribute('data-video-id'), ids[3]);
    const out = path.join(root, 'work', 'cyberpunk-background-validation');
    fs.mkdirSync(out, { recursive: true });
    await page.screenshot({ path: path.join(out, 'background.png') });
    for (const [button, dialog] of [['#library-button', '#library-dialog'], ['#settings-button', '#settings-dialog'], ['#history-button', '#history-dialog']]) {
      await page.locator(button).click();
      assert.ok((await page.locator(dialog).evaluate(n => getComputedStyle(n).backgroundImage)).includes(ids[3]));
      assert.equal(await background.isVisible(), true, 'The main wallpaper stays in place behind open dialogs');
      await page.screenshot({ path: path.join(out, `${dialog.slice(1)}.png`) });
      if (dialog === '#library-dialog') {
        await page.locator('#add-video').click();
        assert.ok((await page.locator('#video-dialog').evaluate(n => getComputedStyle(n).backgroundImage)).includes(ids[3]));
        await page.screenshot({ path: path.join(out, 'video-dialog.png') });
        await page.locator('#video-dialog .dialog-actions [data-close]').click();
        assert.equal(await page.locator('#library-dialog').isVisible(), true);
      }
      await page.keyboard.press('Escape');
    }
    assert.deepEqual(errors, []);
    console.log('PASS: playback cover lifecycle, fallback/races, all four modal wallpapers including nested Add Channel, theme isolation and real app/CSP integration. Desktop APIs, video and images mocked.');
  } finally {
    releaseLate?.();
    await browser?.close();
    servers.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
