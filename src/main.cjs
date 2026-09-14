const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { Store, cleanSettings } = require('./core.cjs');
const { recordHistory, setHistoryLike } = require('./history.cjs');
const { migrateLibrary } = require('./migration.cjs');
const { createServers } = require('./server.cjs');
const { createRecommendations } = require('./recommendations.cjs');
const recommendations = createRecommendations();
const radar = require('./radar.cjs').createRadar();
const deviceLocation = require('./location.cjs').createLocation();
const root = path.join(__dirname, '..');
const testMode = process.argv.includes('--test');
const dataDirectory = process.env.LUMEN_DATA_DIR ? path.resolve(process.env.LUMEN_DATA_DIR) : path.join(root, 'data');
fs.mkdirSync(dataDirectory, { recursive: true });
app.setPath('userData', dataDirectory);
app.setPath('sessionData', path.join(dataDirectory, 'session'));
app.setAppUserModelId('local.lumen.terminal');
app.setName('Lúmen Player');
let win, servers, store, quitting = false;
function isTrusted(event) {
  return win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && event.senderFrame.url === `${servers.main.origin}/`;
}
function handle(name, fn) {
  ipcMain.handle(name, async (event, ...args) => {
    if (!isTrusted(event)) throw new Error('Origem não autorizada.');
    return fn(...args);
  });
}
function send(name, value) { if (win && !win.isDestroyed()) win.webContents.send(name, value); }
function applySettings(settings) {
  // Native window opacity also affects out-of-process video surfaces on Windows.
  // It preserves normal resize/maximize behavior; CSS opacity alone cannot reveal the desktop.
  win.setOpacity(1 - settings.transparency / 100);
  win.webContents.setBackgroundThrottling(!settings.keepPlayingMinimized);
  if (win.isMinimized()) send('app:visibility', false);
}
function configureIpc() {
  const profileRequests = new Map(), profileAttempts = new Map();
  handle('library:profile', async (id) => {
    const item = store.value.library.find(channel => channel.id === id);
    if (!item) return null;
    if ((item.bannerUpdatedAt > 0 && Date.now() - item.bannerUpdatedAt < 86400000 && item.profileUpdatedAt > 0 && Date.now() - item.profileUpdatedAt < 86400000) || Date.now() - (profileAttempts.get(id) || 0) < 60000) return { id, avatar: item.avatar, banner: item.banner, subscriberCount: item.subscriberCount };
    if (profileRequests.has(id)) return profileRequests.get(id);
    const request = (async () => {
      try {
        const profile = await recommendations.resolveLink(item.url);
        // Re-read the library so concurrent changes are preserved.
        const latest = store.value.library.find(channel => channel.id === id);
        if (!latest) return null;
        const avatar = profile.avatar || latest.avatar;
        const banner = profile.banner;
        const subscriberCount = profile.subscriberCount || latest.subscriberCount;
        store.save({ ...store.value, library: store.value.library.map(channel => channel.id === id ? { ...channel, avatar, avatarUpdatedAt: Date.now(), banner, bannerUpdatedAt: Date.now(), subscriberCount, profileUpdatedAt: Date.now() } : channel) });
        return { id, avatar, banner, subscriberCount };
      } catch { const latest = store.value.library.find(channel => channel.id === id); return { id, avatar: latest?.avatar || '', banner: latest?.banner || '', subscriberCount: latest?.subscriberCount || '' }; }
      finally {
        profileAttempts.set(id, Date.now());
        while (profileAttempts.size > 2000) profileAttempts.delete(profileAttempts.keys().next().value);
      }
    })();
    profileRequests.set(id, request);
    try { return await request; } finally { profileRequests.delete(id); }
  });
  let migrating = false;
  const migrationState = () => ({ library: store.value.library, pending: store.value.legacyVideos.length, migrating });
  function startMigration() {
    if (migrating || !store.value.legacyVideos.length) return;
    migrating = true;
    send('library:updated', migrationState());
    migrateLibrary(store, recommendations.resolveChannel, () => send('library:updated', migrationState()))
      .finally(() => { migrating = false; send('library:updated', migrationState()); });
  }
  handle('recommendations:get', (id, options) => recommendations.getChannel(id, options));
  const radarActive = () => win && !win.isDestroyed() && store.value.settings.theme === 'military' && !win.isMinimized();
  let locationEpoch = 0, locationRequest;
  handle('radar:get', async () => {
    if (!radarActive()) return { status: 'inactive', flights: [] };
    const epoch = locationEpoch;
    if (!locationRequest || locationRequest.epoch !== epoch) {
      // One fresh position per app session / Radar selection, shared by flight polls.
      const previous = locationRequest?.promise;
      locationRequest = { epoch, promise: Promise.resolve(previous).catch(() => {}).then(() => deviceLocation.get(true)) };
    }
    const position = await locationRequest.promise;
    if (!radarActive() || epoch !== locationEpoch) return { status: 'inactive', flights: [] };
    radar.setLocation(position); return radar.get();
  });
  handle('history:channel', id => {
    if (typeof id !== 'string' || !/^[\w-]{11}$/.test(id)) throw new Error('Vídeo inválido para o histórico.');
    return recommendations.resolveChannel(id);
  });
  handle('library:migrate', () => { startMigration(); return migrationState(); });
  handle('app:init', () => ({ ...store.value, warning: store.warning, playerOrigin: servers.player.origin, minimized: win.isMinimized(), platform: process.platform }));
  handle('library:add', async (input) => {
    const channel = await recommendations.resolveLink(input);
    if (store.value.library.some((item) => item.id === channel.id)) throw new Error('Este canal já está na sua biblioteca.');
    if (store.value.library.length >= 2000) throw new Error('A biblioteca atingiu o limite de 2.000 canais.');
    const item = { ...channel, addedAt: Date.now() };
    store.save({ ...store.value, library: [item, ...store.value.library] });
    return store.value.library;
  });
  handle('library:remove', (id) => store.save({ ...store.value, library: store.value.library.filter((item) => item.id !== id) }).library);
  handle('history:record', video => store.save({ ...store.value, history: recordHistory(store.value.history, video) }).history);
  handle('history:like', (id, liked) => store.save({ ...store.value, history: setHistoryLike(store.value.history, id, liked) }).history);
  handle('settings:update', (patch) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Configuração inválida.');
    const settings = cleanSettings({ ...store.value.settings, ...patch });
    store.save({ ...store.value, settings });
    if (Object.hasOwn(patch, 'theme')) locationEpoch++;
    if (settings.theme !== 'military') { radar.stop(); deviceLocation.stop(); }
    applySettings(settings);
    return settings;
  });
  handle('window:action', (action) => {
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === 'close') win.close();
  });
}
async function boot() {
  store = new Store(dataDirectory);
  servers = await createServers(root);
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 900, minHeight: 620, frame: false,
    backgroundColor: '#0b1018', title: 'Lúmen Player', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false, spellcheck: false, backgroundThrottling: !store.value.settings.keepPlayingMinimized }
  });
  win.setMenu(null);
  const session = win.webContents.session;
  const localPage = (wc, url) => wc === win?.webContents && url?.replace(/\/$/, '') === servers.main.origin;
  session.setPermissionRequestHandler((wc, permission, callback, details) => {
    // Electron 44 reports display capture as media with no camera/mic types.
    const display = permission === 'display-capture' || (permission === 'media' && Array.isArray(details.mediaTypes) && details.mediaTypes.length === 0);
    callback(display && details.isMainFrame === true && localPage(wc, details.requestingUrl));
  });
  session.setPermissionCheckHandler((wc, permission, origin, details) => permission === 'display-capture' && details.isMainFrame === true && localPage(wc, origin));
  session.setDisplayMediaRequestHandler((request, callback) => {
    // Capture only this app's own tab. Remote frames cannot request capture;
    // no desktop, microphone or other application's audio is granted.
    if (!win || request.frame !== win.webContents.mainFrame || request.frame.url !== `${servers.main.origin}/` || !request.userGesture || !request.audioRequested) { callback({}); return; }
    callback({ video: request.frame, audio: request.frame, enableLocalEcho: true });
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => { if (url !== `${servers.main.origin}/`) event.preventDefault(); });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  win.on('minimize', () => { radar.stop(); send('app:visibility', false); });
  win.on('restore', () => send('app:visibility', true));
  win.on('closed', () => { win = null; });
  configureIpc();
  applySettings(store.value.settings);
  await win.loadURL(`${servers.main.origin}/`);
  if (!testMode) win.show();
}
app.whenReady().then(boot).catch((error) => {
  console.error(error);
  if (!testMode) dialog.showErrorBox('Não foi possível abrir o Lúmen', error.message);
  app.quit();
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { if (!quitting) { quitting = true; radar.stop(); deviceLocation.stop(); servers?.close(); } });
