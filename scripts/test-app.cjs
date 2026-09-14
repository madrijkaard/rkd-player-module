const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const testRoot = process.env.LUMEN_TEST_DIR ? path.resolve(process.env.LUMEN_TEST_DIR) : path.join(root, 'test-results');
fs.mkdirSync(testRoot, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(testRoot, 'app-'));
fs.writeFileSync(path.join(dataDir, 'library.json'), JSON.stringify({ version: 3, library: [{ id: 'UC_x5XG1OV2P6uZZ5FSM9Ttw', title: 'Canal preservado' }], settings: { shell: 'bash', fontSize: 14, mode: 'background', transparency: 20 } }));
const env = { ...process.env, LUMEN_DATA_DIR: dataDir, NODE_USE_SYSTEM_CA: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app, page;
const errors = [];
async function launch() {
  app = await electron.launch({ args: [root, '--test'], env, timeout: 30000 });
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 20000 });
}
async function until(predicate, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await predicate()) return; await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error('A verificação não foi satisfeita dentro do prazo.');
}
(async () => {
  try {
    await launch();
    assert.equal(await page.locator('#terminal-panel, #terminal, #shell').count(), 0);
    assert.equal(await page.evaluate(() => typeof window.lumen.terminalStart), 'undefined');
    assert.equal(await page.locator('#pin, button[data-mode], #open-youtube, #stop-video, .window-actions .icon-button').count(), 0);
    assert.equal(await page.locator('.video-actions #library-button, .video-actions #settings-button').count(), 2);
    assert.equal(await page.locator('.panel-heading #like-video').count(), 1);
    await page.locator('#library-dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.sidebar').count(), 0);
    assert.equal(await page.locator('#recommendations').isVisible(), true);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop()), false);
    await page.locator('#library-button').click();
    assert.equal(await page.locator('#library-dialog').evaluate(el => el.matches(':modal')), true);
    assert.equal(await page.locator('.card-text strong').innerText(), 'Canal preservado');
    await page.waitForFunction(() => document.querySelector('.channel-avatar img')?.naturalWidth > 0, null, { timeout: 45000 });
    const existingAvatar = await page.locator('.channel-avatar img').getAttribute('src');
    await page.locator('.subscriber-count').filter({ hasText: /\d.*inscrit/ }).waitFor({ timeout: 45000 });
    const subscriberCount = await page.locator('.subscriber-count').innerText();
    assert.match(existingAvatar, /^https:\/\/yt3\.(googleusercontent|ggpht)\.com\//);
    assert.equal((await page.evaluate(() => window.lumen.init())).library[0].title, 'Canal preservado');
    console.log('PASS foto real carregada para canal antigo sem alterar seu nome personalizado.');
    assert.equal(await page.locator('#keep-playing').isChecked(), true);
    assert.equal(await page.locator('#transparency').inputValue(), '20');
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getBackgroundThrottling()), false);
    console.log('PASS interface sem terminal e migração da biblioteca de canais/preferências.');
    await page.locator('#add-video').click();
    await page.locator('#video-url').fill('https://youtube.com.evil.test/watch?v=jfKfPfyJRdk');
    await page.locator('#save-video').click();
    await page.locator('#form-error').filter({ hasText: 'youtube.com' }).waitFor();
    await page.locator('#video-url').fill('https://www.youtube.com/@YouTube');
    assert.equal(await page.locator('#video-title').count(), 0);
    await page.locator('#save-video').click();
    await until(() => page.locator('#video-dialog').evaluate((el) => !el.open), 30000);
    assert.equal(await page.locator('.video-card').count(), 2);
    const addedTitle = (await page.evaluate(() => window.lumen.init())).library[0].title;
    await page.waitForFunction(() => [...document.querySelectorAll('.channel-avatar img')].filter(img => img.naturalWidth > 0).length === 2, null, { timeout: 30000 });
    await page.locator('#search').fill('não existe');
    assert.equal(await page.locator('.video-card').count(), 0);
    await page.locator('#search').fill(addedTitle);
    assert.equal(await page.locator('.video-card').count(), 1);
    await page.locator('#search').fill('');
    assert.equal(await page.getByRole('button', { name: /Renomear/ }).count(), 0);
    const removeButton = page.getByRole('button', { name: `Remover ${addedTitle}`, exact: true });
    assert.equal(await removeButton.innerText(), '');
    assert.equal(await removeButton.locator('svg').count(), 1);
    console.log('PASS validação de link, inclusão, busca e ações com ícone de remoção.');
    await page.screenshot({ path: path.join(testRoot, 'library.png') });
    await page.getByRole('button', { name: 'Fechar biblioteca', exact: true }).click();
    await page.locator('#library-dialog').waitFor({ state: 'hidden' });
    await page.locator('#library-button').click();
    assert.equal(await page.locator('#library-button').getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Escape');
    await page.locator('#library-dialog').waitFor({ state: 'hidden' });
    await page.locator('#settings-button').click();
    for (const theme of ['cyberpunk', 'military', 'space']) {
      await page.locator('#theme').selectOption(theme);
      assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
      await page.waitForTimeout(200); // Let existing button color transitions finish for visual review.
      await page.screenshot({ path: path.join(testRoot, `theme-${theme}-settings.png`) });
      await page.locator('#settings-dialog .primary').click();
      await page.screenshot({ path: path.join(testRoot, `theme-${theme}.png`) });
      await page.locator('#library-button').click();
      await page.screenshot({ path: path.join(testRoot, `theme-${theme}-library.png`) });
      await page.getByRole('button', { name: 'Fechar biblioteca', exact: true }).click();
      await page.locator('#settings-button').click();
    }
    await page.locator('#theme').selectOption('space');
    await page.locator('#transparency').fill('35');
    await page.locator('#transparency').dispatchEvent('change');
    await until(async () => Math.abs(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getOpacity()) - .65) < .02);
    await page.locator('#keep-playing').uncheck();
    await until(async () => await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getBackgroundThrottling()));
    await page.screenshot({ path: path.join(testRoot, 'settings.png') });
    await page.locator('#settings-dialog .primary').click();
    await page.screenshot({ path: path.join(testRoot, 'player.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 620));
    await until(async () => await page.evaluate(() => innerWidth === 900));
    const layout = await page.evaluate(() => {
      const surface = document.querySelector('.video-surface').getBoundingClientRect();
      const toolbar = document.querySelector('.workspace-toolbar').getBoundingClientRect();
      return { width: surface.width, height: surface.height, bottom: surface.bottom, viewport: innerHeight, toolbarRight: toolbar.right, viewportWidth: innerWidth };
    });
    assert.ok(layout.width >= 200 && layout.height >= 200);
    assert.ok(layout.bottom <= layout.viewport && layout.toolbarRight <= layout.viewportWidth);
    await page.screenshot({ path: path.join(testRoot, 'player-small.png') });
    await page.locator('#library-button').click();
    await page.screenshot({ path: path.join(testRoot, 'library-small.png') });
    await app.close(); app = null;
    await launch();
    assert.equal(await page.locator('.video-card').count(), 2);
    assert.equal(await page.locator('#transparency').inputValue(), '35');
    assert.equal(await page.locator('#keep-playing').isChecked(), false);
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'space');
    assert.equal(await page.locator('#theme').inputValue(), 'space');
    await page.locator('#library-dialog').waitFor({ state: 'hidden' });
    console.log('PASS Cinema, transparência, opção de minimizar e persistência após reinício.');
    await page.locator('#library-button').click();
    await page.getByRole('button', { name: `Remover ${addedTitle}`, exact: true }).click();
    await page.locator('#confirm-accept').click();
    await until(async () => await page.locator('.video-card').count() === 1);
    const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'library.json'), 'utf8'));
    assert.equal(stored.library[0].title, 'Canal preservado');
    assert.equal(stored.version, 3);
    assert.equal(stored.library[0].avatar, existingAvatar);
    assert.equal(stored.library[0].subscriberCount, subscriberCount);
    await page.route(existingAvatar, route => route.abort());
    await page.locator('#search').fill('inexistente');
    await page.locator('#search').fill('');
    await page.waitForFunction(() => !document.querySelector('.channel-avatar img'));
    assert.equal(await page.locator('.avatar-initial').innerText(), 'C');
    console.log('PASS foto persistida após reinício e inicial preservada quando a imagem falha.');
    assert.equal(stored.settings.shell, undefined);
    assert.deepEqual(errors, []);
    console.log('PASS remoção, biblioteca original preservada e nenhum erro na interface.');
    fs.writeFileSync(path.join(testRoot, 'last-run.json'), JSON.stringify({ passed: true, timestamp: new Date().toISOString(), errors }, null, 2));
  } catch (error) {
    console.error(error);
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(testRoot, 'failure.png') }).catch(() => {});
      console.error('AVISO:', await page.locator('#notice-text').innerText().catch(() => ''));
    }
    process.exitCode = 1;
  } finally { if (app) await app.close().catch(() => {}); }
})();

