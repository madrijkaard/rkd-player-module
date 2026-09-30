const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWebServer } = require('../src/web-server.cjs');
const { Store } = require('../src/core.cjs');

const channel = { id: 'UC_x5XG1OV2P6uZZ5FSM9Ttw', title: 'Canal de teste',
  url: 'https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw' };

test('web server serves the browser bridge and persists library, history and settings', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-web-'));
  const store = new Store(directory);
  const radarCalls = [];
  const app = createWebServer({ port: 0, dataDirectory: directory, store,
    recommendations: {
      resolveLink: async () => channel,
      resolveChannel: async () => channel,
      getChannel: async () => ({ channel, videos: [] })
    },
    radar: {
      setLocation: position => radarCalls.push(position),
      get: async () => ({ status: 'ok', flights: [] }), stop: () => {}
    }
  });
  try {
    const address = await app.start();
    const origin = 'http://127.0.0.1:' + address.port;
    const api = async (name, body = {}, headers = {}) => fetch(origin + '/api/' + name, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json',
        'X-Lumen-Web': '1', ...headers }, body: JSON.stringify(body)
    });

    const page = await fetch(origin);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /^text\/html/);
    assert.match(page.headers.get('cache-control'), /no-store/);
    assert.ok(html.indexOf('/web-bridge.js') < html.indexOf('/app.js'));
    assert.match(page.headers.get('content-security-policy'), /frame-src 'self'/);
    const bridge = await fetch(origin + '/web-bridge.js');
    assert.match(bridge.headers.get('content-type'), /^application\/javascript/);
    const player = await fetch(origin + '/player.html');
    assert.equal(player.status, 200);
    assert.match(player.headers.get('content-security-policy'), /youtube.com/);
    assert.equal((await fetch(origin + '/src/main.cjs')).status, 404);

    const initial = await (await api('init')).json();
    assert.equal(initial.platform, 'web');
    assert.equal(initial.playerOrigin, origin);
    assert.equal(initial.settings.keepPlayingMinimized, false);
    const saved = await (await api('library-add', { url: channel.url })).json();
    assert.equal(saved.length, 1);
    assert.equal(saved[0].id, channel.id);
    assert.ok(saved[0].addedAt > 0);
    assert.equal((await api('library-add', { url: channel.url })).status, 422);
    const settings = await (await api('settings', { patch: {
      theme: 'space', transparency: 50, keepPlayingMinimized: true
    } })).json();
    assert.equal(settings.theme, 'space');
    assert.equal(settings.transparency, 0);
    assert.equal(settings.keepPlayingMinimized, false);
    const reloaded = new Store(directory);
    assert.equal(reloaded.value.library.length, 1);
    assert.equal(reloaded.value.settings.theme, 'space');

    const radar = await api('radar', { position: { status: 'available', lat: -23.55,
      lon: -46.63, accuracy: 100 } });
    assert.equal(radar.status, 200);
    assert.equal(radarCalls.length, 1);
    const deleted = await (await api('library-remove', { id: channel.id })).json();
    assert.deepEqual(deleted, []);

    const forbidden = await fetch(origin + '/api/init', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Lumen-Web': '1' }, body: '{}' });
    assert.equal(forbidden.status, 403);
    assert.equal((await api('init', {}, { Origin: 'http://evil.example' })).status, 403);
    assert.equal((await api('init', {}, { 'X-Lumen-Web': '0' })).status, 403);
    assert.equal((await fetch(origin + '/health')).status, 200);
  } finally {
    await app.stop();
    if (directory.startsWith(os.tmpdir() + path.sep)) fs.rmSync(directory, { recursive: true, force: true });
  }
});
