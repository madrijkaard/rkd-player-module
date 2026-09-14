const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const testRoot = path.resolve(process.env.LUMEN_TEST_DIR || path.join(root, 'test-results'));
fs.mkdirSync(testRoot, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(testRoot, 'visualizer-'));
fs.writeFileSync(path.join(dataDir, 'library.json'), JSON.stringify({ version: 2, library: [{ id: 'M7lc1UVf-VE', title: 'YouTube API Demo', author: 'Google for Developers' }], settings: {} }));
const env = { ...process.env, LUMEN_DATA_DIR: dataDir, NODE_USE_SYSTEM_CA: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app, page;
const errors = [], diagnostics = [];
async function launch() {
  app = await electron.launch({ args: [root, '--test'], env, timeout: 30000 });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.text().includes('Visualizador')) diagnostics.push(message.text()); });
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.show(); win.focus(); });
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  try {
    await launch();
    assert.equal(await page.locator('.titlebar-caption').count(), 0);
    await page.evaluate(() => {
      window.testStreams = [];
      const capture = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getDisplayMedia = async (...args) => { const stream = await capture(...args); window.testStreams.push(stream); return stream; };
    });
    await page.locator('#library-button').click();
    await page.locator('.card-play').waitFor({ timeout: 45000 });
    await page.locator('.card-play').click();
    await page.locator('.recommendation-card').first().waitFor({ timeout: 45000 });
    assert.equal(await page.locator('#player').getAttribute('src'), null);
    await page.locator('.recommendation-card').first().click();
    await page.waitForFunction(() => ['listening', 'error'].includes(document.querySelector('#audio-visualizer').dataset.state), null, { timeout: 20000 });
    assert.equal(await page.locator('#audio-visualizer').getAttribute('data-state'), 'listening', diagnostics.join('\n'));
    await page.waitForFunction(() => Number(document.querySelector('#audio-visualizer').dataset.level) > .001, null, { timeout: 45000 });
    const level = Number(await page.locator('#audio-visualizer').getAttribute('data-level'));
    assert.ok(level > .001);
    assert.equal(await page.evaluate(() => testStreams[0].getVideoTracks().every(t => t.readyState === 'ended')), true);
    const initial = await page.evaluate(() => window.lumen.init());
    const wrapper = page.frames().find(frame => frame.url().startsWith(initial.playerOrigin));
    assert.equal(await wrapper.evaluate(() => player.getPlayerState()), 1);
    console.log('PASS áudio real do YouTube capturado; energia = ' + level);
    await wrapper.evaluate(() => player.seekTo(30, true));
    await wrapper.waitForFunction(() => player.getCurrentTime() >= 29 && player.getPlayerState() === 1);
    await page.locator('#settings-button').click();
    const playerSource = await page.locator('#player').getAttribute('src');
    for (const theme of ['cyberpunk', 'military', 'space']) {
      await page.locator('#theme').selectOption(theme);
      assert.equal(await page.locator('#player').getAttribute('src'), playerSource);
    }
    await page.locator('#theme').selectOption('space');
    for (const style of ['bars', 'wave', 'aurora', 'helix', 'constellation', 'matrix']) {
      await page.locator(`input[name="visualizer-style"][value="${style}"]`).check();
      assert.equal(await page.locator('#audio-visualizer').getAttribute('data-style'), style);
      await page.locator('#settings-dialog .dialog-actions .primary').click();
      await page.waitForFunction(() => Number(document.querySelector('#audio-visualizer').dataset.level) > .002, null, { timeout: 20000 });
      await page.locator('.titlebar').screenshot({ path: path.join(testRoot, `${style}.png`) });
      await page.locator('#settings-button').click();
    }
    assert.equal(await page.evaluate(() => testStreams.length), 1, 'Trocar estilo deve reutilizar a captura.');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 620));
    await page.screenshot({ path: path.join(testRoot, 'settings-small.png') });
    const bounds = await page.locator('#settings-dialog').boundingBox();
    assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 620);
    await page.locator('#settings-dialog .dialog-actions .primary').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#settings-dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 2), true, 'O modal não deve ter rolagem horizontal.');
    await page.locator('#settings-dialog .dialog-actions .primary').click();
    await wrapper.evaluate(() => player.pauseVideo());
    await page.waitForFunction(() => Number(document.querySelector('#audio-visualizer').dataset.level) < .0005, null, { timeout: 12000 });
    console.log('PASS seis estilos, troca sem recaptura, modal em 900px e silêncio ao pausar.');
    await page.locator('#settings-button').click();
    await page.locator('#visualizer-enabled').uncheck();
    assert.equal(await page.locator('.titlebar-visualizer').isVisible(), false);
    assert.equal(await page.evaluate(() => testStreams[0].getTracks().every(t => t.readyState === 'ended')), true);
    await page.evaluate(() => {
      const capture = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
      let fail = true;
      navigator.mediaDevices.getDisplayMedia = (...args) => { if (fail) { fail = false; return Promise.reject(new DOMException('Test denied', 'NotAllowedError')); } return capture(...args); };
    });
    await page.locator('#visualizer-enabled').check();
    await page.locator('#visualizer-retry').waitFor();
    await page.locator('#visualizer-retry').click();
    await page.waitForFunction(() => document.querySelector('#audio-visualizer').dataset.state === 'listening');
    await page.locator('#visualizer-enabled').uncheck();
    await page.waitForFunction(async () => (await window.lumen.init()).settings.visualizerEnabled === false);
    await app.close(); app = null;
    await launch();
    assert.equal(await page.locator('#visualizer-enabled').isChecked(), false);
    assert.equal(await page.locator('input[name="visualizer-style"]:checked').inputValue(), 'matrix');
    assert.deepEqual(errors, []);
    console.log('PASS liberação da captura, recuperação de falha e preferências após reinício.');
    fs.writeFileSync(path.join(testRoot, 'visualizer-test.json'), JSON.stringify({ passed: true, level, errors, diagnostics }, null, 2));
  } catch (error) {
    console.error(error, diagnostics);
    if (page && !page.isClosed()) { console.error(await page.locator('#visualizer-status').innerText()); await page.screenshot({ path: path.join(testRoot, 'failure.png') }).catch(() => {}); }
    process.exitCode = 1;
  } finally { await app?.close().catch(() => {}); }
})();
