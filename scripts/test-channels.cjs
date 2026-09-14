const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.resolve(process.env.LUMEN_TEST_DIR || path.join(root, 'test-results'));
fs.mkdirSync(output, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(output, 'channels-'));
const ids = ['UCaaaaaaaaaaaaaaaaaaaaaa', 'UCbbbbbbbbbbbbbbbbbbbbbb', 'UCcccccccccccccccccccccc'];
fs.writeFileSync(path.join(dataDir, 'library.json'), JSON.stringify({ version: 3, library: ids.map((id, i) => ({ id, title: ['Canal A', 'Canal B', 'Canal vazio'][i] })), settings: { visualizerEnabled: false } }));
const env = { ...process.env, LUMEN_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
let app, page;
(async () => {
  try {
    app = await electron.launch({ args: [root, '--test'], env });
    page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => document.body.dataset.ready === 'true');
    // Exercise real IPC/storage/rendering with deterministic public-data responses.
    await app.evaluate((_, ids) => {
      globalThis.fixture = { offline: false, delayed: false, completed: false };
      globalThis.fetch = async input => {
        const url = new URL(input);
        if (fixture.offline) throw new Error('Test offline');
        const id = url.searchParams.get('channel_id') || ids[0];
        if (url.pathname.includes('/feeds/')) {
          if (fixture.delayed && id === ids[0]) { await new Promise(resolve => setTimeout(resolve, 1500)); fixture.completed = true; }
          const videoId = id === ids[0] ? 'M7lc1UVf-VE' : 'CBzLIKfWpdg';
          return new Response(`<feed><yt:channelId>${id}</yt:channelId><title>Canal</title>${id === ids[2] ? '' : `<entry><yt:videoId>${videoId}</yt:videoId><yt:channelId>${id}</yt:channelId><title>Vídeo do canal</title></entry>`}</feed>`);
        }
        return new Response(`var ytInitialData = ${JSON.stringify({ metadata: { channelMetadataRenderer: { externalId: ids[0], title: 'Canal A' } } })};`);
      };
    }, ids);
    await page.route('https://www.youtube.com/**', route => route.abort());
    const select = async id => { await page.locator('#library-button').click(); await page.locator(`.video-card[data-id="${id}"] .card-play`).click(); };
    await app.evaluate(() => { fixture.offline = true; });
    await select(ids[0]);
    await page.locator('#recommendations-retry').waitFor();
    assert.equal(await page.locator('#player').getAttribute('src'), null);
    await app.evaluate(() => { fixture.offline = false; fixture.delayed = true; });
    await page.locator('#recommendations-retry').click();
    await select(ids[1]);
    await page.locator(`.recommendation-card[data-channel-id="${ids[1]}"]`).waitFor();
    await app.evaluate(async () => { while (!fixture.completed) await new Promise(resolve => setTimeout(resolve, 30)); });
    assert.deepEqual(await page.locator('.recommendation-card').evaluateAll(nodes => nodes.map(n => n.dataset.channelId)), [ids[1]]);
    assert.equal(await page.locator('#player').getAttribute('src'), null);
    await page.locator('.recommendation-card').click();
    assert.match(await page.locator('#player').getAttribute('src'), /video=CBzLIKfWpdg/);
    assert.equal((await page.evaluate(() => window.lumen.init())).library.length, 3);
    const playingSource = await page.locator('#player').getAttribute('src');
    const playingTitle = await page.locator('#now-title').innerText();
    await select(ids[0]);
    await page.locator(`.recommendation-card[data-channel-id="${ids[0]}"]`).waitFor();
    assert.equal(await page.locator('#player').getAttribute('src'), playingSource);
    assert.equal(await page.locator('#now-title').innerText(), playingTitle);
    assert.equal(await page.locator('#player').isVisible(), true);
    await page.locator('.recommendation-card').click();
    const nextSource = await page.locator('#player').getAttribute('src');
    assert.match(nextSource, /video=M7lc1UVf-VE/);
    assert.notEqual(nextSource, playingSource);
    await select(ids[2]);
    await page.locator('#recommendations-status').filter({ hasText: 'Nenhum vídeo público' }).waitFor();
    assert.equal(await page.locator('#player').getAttribute('src'), nextSource);
    assert.equal(await page.locator('.recommendation-card').count(), 0);
    assert.equal(await page.locator('#recommendations-retry').isVisible(), false);
    await page.keyboard.press('Control+k');
    await page.locator('#video-url').fill('https://youtube.com/watch?v=M7lc1UVf-VE');
    await page.locator('#save-video').click();
    await page.locator('#form-error').filter({ hasText: 'canal' }).waitFor();
    await page.locator('#video-url').fill('https://youtube.com/@alias');
    await page.locator('#save-video').click();
    await page.locator('#form-error').filter({ hasText: 'já está' }).waitFor();
    await page.locator('#video-dialog [data-close]').first().click();
    await page.locator('#library-button').click();
    await page.getByRole('button', { name: 'Remover Canal vazio', exact: true }).click();
    await page.locator('#confirm-accept').click();
    await page.waitForFunction(() => document.querySelectorAll('.video-card').length === 2);
    await page.getByRole('button', { name: 'Fechar biblioteca', exact: true }).click();
    assert.match(await page.locator('#recommendations-status').innerText(), /Selecione um canal/);
    assert.equal(await page.locator('#player').getAttribute('src'), nextSource);
    assert.deepEqual(errors, []);
    console.log('PASS falha/retry, troca rápida sem resposta atrasada, canal vazio, seleção sem autoplay, reprodução por clique, rejeição de vídeos, canais duplicados e remoção.');
    fs.writeFileSync(path.join(output, 'channels-test.json'), JSON.stringify({ passed: true, errors }, null, 2));
  } catch (error) {
    console.error(error); process.exitCode = 1;
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'channels-failure.png') }).catch(() => {});
  } finally { await app?.close().catch(() => {}); }
})();
