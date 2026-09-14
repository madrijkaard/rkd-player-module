const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const testRoot = process.env.LUMEN_TEST_DIR ? path.resolve(process.env.LUMEN_TEST_DIR) : path.join(root, 'test-results');
fs.mkdirSync(testRoot, { recursive: true });
const data = fs.mkdtempSync(path.join(testRoot, 'youtube-'));
const env = { ...process.env, LUMEN_DATA_DIR: data, NODE_USE_SYSTEM_CA: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await fn()) return; await sleep(100); }
  throw new Error('Tempo esgotado aguardando o estado esperado.');
}
(async () => {
  const results = [];
  try {
    app = await electron.launch({ args: [root, '--test'], env, timeout: 30000 });
    const page = await app.firstWindow();
    await page.waitForFunction(() => document.body.dataset.ready === 'true');
    const initial = await page.evaluate(() => window.lumen.init());
    for (const channel of ['GoogleDevelopers', 'YouTube']) {
      if (!await page.locator('#library-dialog').isVisible()) await page.locator('#library-button').click();
      await page.locator('#add-video').click();
      await page.locator('#video-url').fill('https://www.youtube.com/@' + channel);
      await page.locator('#save-video').click();
      await page.waitForFunction(() => !document.querySelector('#video-dialog').open, null, { timeout: 30000 });
      const priorSource = await page.locator('#player').getAttribute('src');
      await page.locator('.card-play').first().click();
      await page.locator('.recommendation-card').first().waitFor({ timeout: 45000 });
      assert.equal(await page.locator('#player').getAttribute('src'), priorSource);
      const id = await page.locator('.recommendation-card').first().getAttribute('data-id');
      await page.locator('.recommendation-card').first().click();
      await page.waitForFunction(() => /REPRODUZINDO|INDISPONÍVEL/.test(document.querySelector('#video-label').textContent), null, { timeout: 30000 }).catch(() => {});
      const wrapper = page.frames().find((frame) => frame.url().startsWith(initial.playerOrigin));
      const info = wrapper ? await wrapper.evaluate(() => ({ ready, state: player?.getPlayerState?.(), time: player?.getCurrentTime?.(), bridge: typeof window.lumen })).catch(() => ({})) : {};
      const result = { id, label: await page.locator('#video-label').innerText(), ...info };
      results.push(result);
      console.log(JSON.stringify(result));
      if (info.state !== 1) continue;
      assert.equal(info.bridge, 'undefined');
      await page.locator('#settings-button').click();
      await page.locator('#transparency').fill('30');
      await page.locator('#transparency').dispatchEvent('change');
      await until(async () => Math.abs(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getOpacity()) - .7) < .02);
      await page.locator('#settings-dialog .primary').click();
      await page.screenshot({ path: path.join(testRoot, 'video-playing.png') });
      await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.show(); win.minimize(); });
      await until(async () => await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()));
      const before = await wrapper.evaluate(() => player.getCurrentTime());
      await sleep(4500);
      const after = await wrapper.evaluate(() => ({ time: player.getCurrentTime(), state: player.getPlayerState() }));
      assert.equal(after.state, 1);
      assert.ok(after.time - before > 2, 'O tempo do vídeo deve avançar com a janela realmente minimizada.');
      result.minimizedPlayback = { before, after: after.time, advancedSeconds: after.time - before, nativeMinimized: true };
      console.log('PASS vídeo continuou tocando com janela realmente minimizada: +' + (after.time - before).toFixed(2) + 's.');
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
      await until(async () => !await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()));
      await page.locator('#settings-button').click();
      await page.locator('#keep-playing').uncheck();
      await until(async () => await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getBackgroundThrottling()));
      await page.locator('#settings-dialog .primary').click();
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
      await until(async () => await wrapper.evaluate(() => player.getPlayerState() === 2));
      const pausedTime = await wrapper.evaluate(() => player.getCurrentTime());
      await sleep(1500);
      assert.ok(Math.abs(await wrapper.evaluate(() => player.getCurrentTime()) - pausedTime) < .3);
      result.pauseWhenDisabled = true;
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
      await sleep(500);
      assert.equal(await wrapper.evaluate(() => player.getPlayerState()), 2);
      console.log('PASS opção desativada pausa o player; restaurar não retoma um vídeo pausado.');
      await page.locator('#settings-button').click();
      await page.locator('#keep-playing').check();
      await page.locator('#settings-dialog .primary').click();
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
      await sleep(500);
      assert.equal(await wrapper.evaluate(() => player.getPlayerState()), 2);
      console.log('PASS ativar a opção e minimizar não inicia vídeo pausado.');
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
      result.passed = true;
      break;
    }
    assert.ok(results.some((item) => item.passed), 'Nenhum vídeo pôde ser validado com reprodução minimizada.');
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally {
    fs.writeFileSync(path.join(testRoot, 'youtube-live-test.json'), JSON.stringify(results, null, 2));
    await app?.close();
  }
})();

