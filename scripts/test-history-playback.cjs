const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.resolve(process.env.LUMEN_TEST_DIR || path.join(root, 'test-results'));
fs.mkdirSync(out, { recursive: true });
const data = fs.mkdtempSync(path.join(out, 'history-playback-'));
const channelA = 'UCaaaaaaaaaaaaaaaaaaaaaa', channelB = 'UCbbbbbbbbbbbbbbbbbbbbbb';
fs.writeFileSync(path.join(data, 'library.json'), JSON.stringify({
  library: [{ id: channelB, title: 'Canal B', profileUpdatedAt: Date.now(), bannerUpdatedAt: Date.now() }],
  history: [{ id: 'M7lc1UVf-VE', title: 'Vídeo A', watchedAt: 2 }, { id: 'CBzLIKfWpdg', title: 'Vídeo B', watchedAt: 1 }],
  settings: { theme: 'space', visualizerEnabled: false }
}));
const env = { ...process.env, LUMEN_DATA_DIR: data }; delete env.ELECTRON_RUN_AS_NODE;
(async () => { let app; try {
  app = await electron.launch({ args: [root, '--test'], env });
  const page = await app.firstWindow();
  await page.waitForFunction(() => document.body.dataset.ready === 'true');
  const origin = (await page.evaluate(() => window.lumen.init())).playerOrigin;
  await page.route(`${origin}/player.js`, route => route.fulfill({ contentType: 'application/javascript', body: `
    addEventListener('message', e => { if(e.source !== parent || e.data.type !== 'load') return;
      window.loadedVideo = e.data.id;
      for(const [type,value] of [['video',{id:e.data.id,title:'Assistindo '+e.data.id,author:'Autor'}],['state',1]])
        parent.postMessage({source:'lumen-player',session:location.search,type,value},e.origin);
    });` }));
  await app.evaluate((_, { channelA, channelB }) => {
    globalThis.failHistoryLookup = true;
    globalThis.fetch = async input => {
      const url = new URL(input);
      if (url.pathname === '/watch') {
        const id = url.searchParams.get('v');
        if (id === 'M7lc1UVf-VE') await new Promise(resolve => { globalThis.releaseHistoryLookup = resolve; });
        else if (globalThis.failHistoryLookup) throw new Error('Offline');
        return new Response('var ytInitialPlayerResponse = ' + JSON.stringify({ videoDetails: { videoId: id, channelId: id === 'M7lc1UVf-VE' ? channelA : channelB, author: 'Canal do histórico' } }) + ';');
      }
      if (url.pathname === '/oembed') throw new Error('Offline');
      if (url.pathname.includes('/feeds/')) {
        const channel = url.searchParams.get('channel_id');
        return new Response(`<feed><yt:channelId>${channel}</yt:channelId><title>${channel === channelA ? 'Canal A' : 'Canal B'}</title>${Array.from({ length: 40 }, (_, i) => `<entry><yt:videoId>${channel === channelA ? 'a' : 'b'}${String(i).padStart(10,'0')}</yt:videoId><yt:channelId>${channel}</yt:channelId><title>Vídeo ${i}</title></entry>`).join('')}</feed>`);
      }
      return new Response('var ytInitialData = {};');
    };
  }, { channelA, channelB });
  const openVideo = async id => {
    await page.locator('#history-button').click();
    await page.locator(`.history-entry[data-id="${id}"]`).click();
    await page.locator('#history-dialog').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('#video-label').textContent.includes('REPRODUZINDO'));
    assert.ok((await page.locator('#player').getAttribute('src')).includes(id));
  };
  const checkChannel = async id => {
    await page.locator(`.recommendation-card[data-channel-id="${id}"]`).first().waitFor();
    assert.ok(await page.locator('.recommendation-card').evaluateAll((nodes, id) => nodes.every(n => n.dataset.channelId === id), id));
  };
  // Playback starts before channel lookup finishes. A newer library selection wins.
  await openVideo('M7lc1UVf-VE');
  await page.locator('#library-button').click(); await page.locator('.card-play').click(); await checkChannel(channelB);
  await app.evaluate(() => releaseHistoryLookup());
  await page.evaluate(() => window.lumen.historyChannel('M7lc1UVf-VE'));
  await checkChannel(channelB);
  // The channel need not be saved in the library. Every replay gets a fresh sample.
  await openVideo('M7lc1UVf-VE'); await checkChannel(channelA);
  const before = await page.locator('.recommendation-card').evaluateAll(nodes => nodes.map(n => n.dataset.id));
  await openVideo('M7lc1UVf-VE'); await checkChannel(channelA);
  const after = await page.locator('.recommendation-card').evaluateAll(nodes => nodes.map(n => n.dataset.id));
  assert.notDeepEqual(after, before);
  assert.equal((await page.evaluate(() => window.lumen.init())).library.length, 1);
  // A failed lookup keeps playback running and can be retried.
  await openVideo('CBzLIKfWpdg'); await page.locator('#recommendations-retry').waitFor();
  assert.ok((await page.locator('#video-label').innerText()).includes('REPRODUZINDO'));
  await app.evaluate(() => { globalThis.failHistoryLookup = false; });
  await page.locator('#recommendations-retry').click(); await checkChannel(channelB);
  await page.locator('#history-button').click();
  assert.equal(await page.locator('.history-entry').first().getAttribute('data-id'), 'CBzLIKfWpdg');
  await page.locator('.history-entry').first().focus(); await page.keyboard.press('Enter');
  await page.locator('#history-dialog').waitFor({ state: 'hidden' });
  await checkChannel(channelB);
  console.log('PASS history click/keyboard playback, channel lookup, randomized carousel, unsaved channels, stale lookup protection and retry without interrupting video.');
} catch (error) { console.error(error); process.exitCode = 1; } finally { await app?.close(); } })();
