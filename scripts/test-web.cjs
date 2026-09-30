const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { createWebServer } = require('../src/web-server.cjs');
const { Store } = require('../src/core.cjs');

const channel = { id: 'UC_x5XG1OV2P6uZZ5FSM9Ttw', title: 'Canal de teste',
  url: 'https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw' };

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-browser-'));
  const store = new Store(directory);
  store.save({ ...store.value, settings: { ...store.value.settings, visualizerEnabled: false } });
  const app = createWebServer({ port: 0, dataDirectory: directory, store,
    recommendations: {
      resolveLink: async () => channel,
      resolveChannel: async () => channel,
      getChannel: async () => ({ channel, total: 1, items: [{
        id: 'jfKfPfyJRdk', title: 'Vídeo de teste', author: channel.title,
        channelId: channel.id, thumbnail: 'https://i.ytimg.com/vi/jfKfPfyJRdk/hqdefault.jpg'
      }] })
    },
    radar: { setLocation: () => {}, get: async () => ({ status: 'inactive', flights: [] }), stop: () => {} }
  });
  let browser;
  try {
    const address = await app.start();
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({
      contentType: 'application/javascript', body: `
        window.YT = { Player: class {
          constructor(element, options) { this.options = options; setTimeout(() => options.events.onReady(), 0); }
          loadVideoById(id) { document.body.dataset.loadedVideo = id; this.id = id;
            this.options.events.onStateChange({ data: 1 }); }
          cueVideoById(id) { this.id = id; }
          getVideoData() { return { video_id: this.id, title: 'Vídeo de teste', author: 'Canal de teste' }; }
          pauseVideo() {} stopVideo() {} playVideo() {}
        } };
        window.onYouTubeIframeAPIReady();`
    }));
    await page.goto('http://127.0.0.1:' + address.port);
    await page.locator('body[data-ready="true"]').waitFor();
    assert.equal(await page.locator('body').getAttribute('data-platform'), 'web');
    assert.equal(await page.locator('.window-actions').isVisible(), false);
    await page.locator('#library-button').click();
    await page.locator('#add-video').click();
    await page.locator('#video-url').fill(channel.url);
    await page.locator('#save-video').click();
    await page.locator('.video-card[data-id="' + channel.id + '"]').waitFor();
    await page.locator('[data-close="library-dialog"]').last().click();
    await page.locator('#settings-button').click();
    assert.equal(await page.locator('.setting-transparency').isVisible(), false);
    await page.locator('#video-tint-color').selectOption('blue');
    await page.waitForTimeout(250);
    await page.reload();
    await page.locator('body[data-ready="true"]').waitFor();
    await page.locator('#library-button').click();
    await page.locator('.video-card[data-id="' + channel.id + '"]').waitFor();
    await page.locator('.video-card[data-id="' + channel.id + '"]').click();
    await page.locator('.recommendation-card[data-id="jfKfPfyJRdk"]').waitFor();
    await page.locator('.recommendation-card[data-id="jfKfPfyJRdk"]').click();
    await page.waitForFunction(() => document.querySelector('#player')?.contentDocument?.body?.dataset.loadedVideo === 'jfKfPfyJRdk');
    await page.locator('#history-button').click();
    await page.locator('.history-entry[data-id="jfKfPfyJRdk"]').waitFor();
    assert.deepEqual(pageErrors, []);
    console.log('Web UI: biblioteca, configuração, player e histórico OK.');
  } finally {
    if (browser) await browser.close();
    await app.stop();
    if (directory.startsWith(os.tmpdir() + path.sep)) fs.rmSync(directory, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
