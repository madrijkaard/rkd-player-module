const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Store, cleanSettings } = require('./core.cjs');
const { recordHistory, setHistoryLike } = require('./history.cjs');
const { migrateLibrary } = require('./migration.cjs');
const { createRecommendations } = require('./recommendations.cjs');
const { createRadar } = require('./radar.cjs');
const { cleanPosition } = require('./location.cjs');

const MAIN_POLICY = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://i.ytimg.com https://yt3.googleusercontent.com https://yt3.ggpht.com data:; frame-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const PLAYER_POLICY = "default-src 'none'; script-src 'self' https://www.youtube.com https://s.ytimg.com; style-src 'unsafe-inline'; frame-src https://www.youtube.com https://www.youtube-nocookie.com; img-src https://i.ytimg.com; connect-src https://www.youtube.com; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function createWebServer(options = {}) {
  const root = options.root || path.join(__dirname, '..');
  const directory = options.dataDirectory || process.env.LUMEN_DATA_DIR || path.join(root, 'data');
  const store = options.store || new Store(directory);
  const recommendations = options.recommendations || createRecommendations();
  const radar = options.radar || createRadar();
  const host = options.host || process.env.LUMEN_HOST || '127.0.0.1';
  const port = options.port ?? Number(process.env.PORT || 3000);
  const allowedHosts = new Set((options.allowedHosts || process.env.LUMEN_ALLOWED_HOSTS || 'localhost,127.0.0.1')
    .split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
  const ui = name => path.join(root, 'src', 'ui', name);
  const files = {
    '/style.css': ui('style.css'), '/themes.css': ui('themes.css'),
    '/app.js': ui('app.js'), '/web-bridge.js': ui('web-bridge.js'),
    '/visualizer.js': ui('visualizer.js'), '/space-background.js': ui('space-background.js'),
    '/radar-background.js': ui('radar-background.js'), '/cyberpunk-background.js': ui('cyberpunk-background.js'),
    '/radar-map.json': ui('radar-map.json'), '/radar-cities.json': ui('radar-cities.json'),
    '/player.html': ui('player.html'), '/player.js': ui('player.js'),
    '/space-player.html': ui('space-player.html'), '/space-player.js': ui('space-player.js')
  };
  const index = fs.readFileSync(ui('index.html'), 'utf8');
  const marker = '<script src="/app.js" defer></script>';
  if (!index.includes(marker)) throw new Error('Não foi possível inserir a ponte web na interface.');
  const webIndex = index.replace(marker, '<script src="/web-bridge.js" defer></script>\n  ' + marker);
  const profileRequests = new Map();
  const profileAttempts = new Map();
  let migrating = false;

  function headers(extra = {}) {
    return {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      ...extra
    };
  }
  function json(response, status, value) {
    response.writeHead(status, headers({ 'Content-Type': 'application/json; charset=utf-8' }));
    response.end(JSON.stringify(value));
  }
  function migrationState() {
    return { library: store.value.library, pending: store.value.legacyVideos.length, migrating };
  }
  function startMigration() {
    if (migrating || !store.value.legacyVideos.length) return migrationState();
    migrating = true;
    migrateLibrary(store, recommendations.resolveChannel, () => {})
      .catch(() => {})
      .finally(() => { migrating = false; });
    return migrationState();
  }
  async function channelProfile(id) {
    const item = store.value.library.find(channel => channel.id === id);
    if (!item) return null;
    if ((item.bannerUpdatedAt > 0 && Date.now() - item.bannerUpdatedAt < 86400000
        && item.profileUpdatedAt > 0 && Date.now() - item.profileUpdatedAt < 86400000)
        || Date.now() - (profileAttempts.get(id) || 0) < 60000) {
      return { id, avatar: item.avatar, banner: item.banner, subscriberCount: item.subscriberCount };
    }
    if (profileRequests.has(id)) return profileRequests.get(id);
    const request = (async () => {
      try {
        const profile = await recommendations.resolveLink(item.url);
        const latest = store.value.library.find(channel => channel.id === id);
        if (!latest) return null;
        const avatar = profile.avatar || latest.avatar;
        const banner = profile.banner;
        const subscriberCount = profile.subscriberCount || latest.subscriberCount;
        store.save({ ...store.value, library: store.value.library.map(channel =>
          channel.id === id ? { ...channel, avatar, avatarUpdatedAt: Date.now(), banner,
            bannerUpdatedAt: Date.now(), subscriberCount, profileUpdatedAt: Date.now() } : channel) });
        return { id, avatar, banner, subscriberCount };
      } catch {
        const latest = store.value.library.find(channel => channel.id === id);
        return { id, avatar: latest?.avatar || '', banner: latest?.banner || '',
          subscriberCount: latest?.subscriberCount || '' };
      } finally {
        profileAttempts.set(id, Date.now());
        while (profileAttempts.size > 2000) profileAttempts.delete(profileAttempts.keys().next().value);
      }
    })();
    profileRequests.set(id, request);
    try { return await request; } finally { profileRequests.delete(id); }
  }
  async function action(name, input, origin) {
    switch (name) {
      case 'init':
        return { ...store.value, settings: { ...store.value.settings, transparency: 0,
          keepPlayingMinimized: false }, warning: store.warning, playerOrigin: origin,
          minimized: false, platform: 'web' };
      case 'recommendations':
        return recommendations.getChannel(input.id, input.options);
      case 'radar':
        radar.setLocation(cleanPosition(input.position));
        return radar.get();
      case 'history-channel':
        if (typeof input.id !== 'string' || !/^[\w-]{11}$/.test(input.id)) {
          throw new Error('Vídeo inválido para o histórico.');
        }
        return recommendations.resolveChannel(input.id);
      case 'library-migrate':
        return startMigration();
      case 'migration-state':
        return migrationState();
      case 'library-add': {
        const channel = await recommendations.resolveLink(input.url);
        if (store.value.library.some(item => item.id === channel.id)) {
          throw new Error('Este canal já está na sua biblioteca.');
        }
        if (store.value.library.length >= 2000) throw new Error('A biblioteca atingiu o limite de 2.000 canais.');
        return store.save({ ...store.value, library: [{ ...channel, addedAt: Date.now() }, ...store.value.library] }).library;
      }
      case 'library-remove':
        return store.save({ ...store.value,
          library: store.value.library.filter(item => item.id !== input.id) }).library;
      case 'library-profile':
        return channelProfile(input.id);
      case 'history-record':
        return store.save({ ...store.value, history: recordHistory(store.value.history, input.video) }).history;
      case 'history-like':
        return store.save({ ...store.value,
          history: setHistoryLike(store.value.history, input.id, input.liked) }).history;
      case 'settings': {
        if (!input.patch || typeof input.patch !== 'object' || Array.isArray(input.patch)) {
          throw new Error('Configuração inválida.');
        }
        const settings = cleanSettings({ ...store.value.settings, ...input.patch,
          transparency: 0, keepPlayingMinimized: false });
        store.save({ ...store.value, settings });
        if (settings.theme !== 'military') radar.stop();
        return settings;
      }
      default:
        throw new Error('Operação desconhecida.');
    }
  }
  async function readJson(request) {
    if (!request.headers['content-type']?.startsWith('application/json')) {
      throw new Error('Envie JSON para esta operação.');
    }
    const parts = [];
    let size = 0;
    for await (const part of request) {
      size += part.length;
      if (size > 16384) throw new Error('Requisição grande demais.');
      parts.push(part);
    }
    const value = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('A requisição deve conter um objeto JSON.');
    }
    return value;
  }
  async function dispatch(request, response) {
    const rawHost = request.headers.host || '';
    let parsedHost;
    try { parsedHost = new URL('http://' + rawHost); } catch { json(response, 403, { error: 'Host não permitido.' }); return; }
    if (parsedHost.host.toLowerCase() !== rawHost.toLowerCase()
        || !allowedHosts.has(parsedHost.hostname.toLowerCase())) {
      json(response, 403, { error: 'Host não permitido.' }); return;
    }
    let pathname;
    try { pathname = new URL(request.url, 'http://local').pathname; }
    catch { json(response, 400, { error: 'URL inválida.' }); return; }
    if (pathname === '/health' && request.method === 'GET') {
      json(response, 200, { status: 'ok' }); return;
    }
    if (pathname.startsWith('/api/')) {
      if (request.method !== 'POST') { json(response, 405, { error: 'Método não permitido.' }); return; }
      const origin = request.headers.origin;
      if ((origin !== 'http://' + rawHost && origin !== 'https://' + rawHost)
          || request.headers['x-lumen-web'] !== '1') {
        json(response, 403, { error: 'Origem não autorizada.' }); return;
      }
      try {
        const body = await readJson(request);
        json(response, 200, await action(pathname.slice(5), body, origin));
      } catch (error) {
        json(response, error instanceof SyntaxError ? 400 : 422,
          { error: String(error.message || 'Falha na operação.').slice(0, 400) });
      }
      return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      json(response, 405, { error: 'Método não permitido.' }); return;
    }
    if (pathname !== '/' && !files[pathname]) {
      json(response, 404, { error: 'Arquivo não encontrado.' }); return;
    }
    const isPlayer = ['/player.html', '/player.js', '/space-player.html', '/space-player.js'].includes(pathname);
    const type = CONTENT_TYPES[path.extname(pathname)] || CONTENT_TYPES['.html'];
    response.writeHead(200, headers({
      'Content-Type': type,
      'Content-Security-Policy': isPlayer ? PLAYER_POLICY : MAIN_POLICY
    }));
    if (request.method === 'HEAD') { response.end(); return; }
    if (pathname === '/') response.end(webIndex);
    else fs.createReadStream(files[pathname]).pipe(response);
  }
  const server = http.createServer((request, response) => {
    dispatch(request, response).catch(error => {
      if (!response.headersSent) json(response, 500, { error: 'Falha interna do servidor.' });
      else response.destroy(error);
    });
  });
  async function start() {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolve);
    });
    return server.address();
  }
  async function stop() {
    radar.stop();
    await new Promise(resolve => server.close(resolve));
  }
  return { start, stop, server };
}

if (require.main === module) {
  const app = createWebServer();
  app.start().then(address => {
    console.log('Lúmen web disponível na porta ' + address.port);
  }).catch(error => { console.error(error); process.exitCode = 1; });
  process.on('SIGTERM', () => { app.stop().then(() => process.exit(0)); });
}

module.exports = { createWebServer };
