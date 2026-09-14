const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseYouTube, parseChannel, cleanState, cleanSettings, Store } = require('../src/core.cjs');
test('aceita watch, links curtos, shorts, live e embed sem perder o ID', () => {
  for (const url of ['https://www.youtube.com/watch?v=jfKfPfyJRdk&list=ABC', 'https://youtu.be/jfKfPfyJRdk?t=10', 'youtube.com/shorts/jfKfPfyJRdk', 'https://m.youtube.com/live/jfKfPfyJRdk', 'https://www.youtube-nocookie.com/embed/jfKfPfyJRdk']) assert.equal(parseYouTube(url).id, 'jfKfPfyJRdk');
});
test('rejeita URLs maliciosas, hosts semelhantes, IDs inválidos e playlists sem vídeo', () => {
  for (const url of ['javascript:alert(1)', 'https://youtube.com.evil.test/watch?v=jfKfPfyJRdk', 'https://youtube.com@evil.test/watch?v=jfKfPfyJRdk', 'https://evil@youtube.com/watch?v=jfKfPfyJRdk', 'https://youtube.com:1234/watch?v=jfKfPfyJRdk', 'https://youtube.com/watch?v=abc', 'https://youtube.com/playlist?list=ABC', '<script>alert(1)</script>']) assert.throws(() => parseYouTube(url));
});
test('normaliza configurações e remove duplicatas de bibliotecas corrompidas', () => {
  assert.equal(cleanSettings({ transparency: 100 }).transparency, 65);
  assert.equal(cleanSettings({ transparency: NaN }).transparency, 0);
  assert.equal(cleanSettings({ theme: 'unknown' }).theme, 'cyberpunk');
  assert.equal(cleanSettings().theme, 'cyberpunk');
  const legacy = { theme: 'lumen', transparency: 30, videoTint: 'blue', keepPlayingMinimized: false, visualizerEnabled: false, visualizerStyle: 'wave' };
  assert.deepEqual(cleanSettings(legacy), { ...legacy, theme: 'cyberpunk' });
  assert.equal(cleanSettings({ videoTint: 'invalid' }).videoTint, 'none');
  for (const videoTint of ['none', 'yellow', 'blue', 'red', 'pink']) assert.equal(cleanSettings({ videoTint }).videoTint, videoTint);
  for (const theme of ['cyberpunk', 'military', 'space']) assert.equal(cleanSettings({ theme }).theme, theme);
  assert.equal(cleanSettings({ visualizerStyle: 'invalid' }).visualizerStyle, 'matrix');
  assert.equal(cleanSettings({ theme: 'cyberpunk' }).visualizerStyle, 'matrix');
  assert.equal(cleanSettings({ theme: 'space' }).visualizerStyle, 'aurora');
  for (const [theme, fallback] of [['cyberpunk', 'matrix'], ['space', 'aurora'], ['military', 'wave']]) {
    for (const visualizerStyle of ['circle', 'particles']) assert.equal(cleanState({ settings: { theme, visualizerStyle } }).settings.visualizerStyle, fallback);
  }
  for (const visualizerStyle of ['bars', 'wave', 'aurora', 'helix', 'constellation', 'matrix']) {
    assert.equal(cleanState({ settings: { visualizerStyle } }).settings.visualizerStyle, visualizerStyle);
  }
  assert.equal(cleanSettings({ visualizerStyle: 'wave', visualizerEnabled: false }).visualizerStyle, 'wave');
  assert.equal(cleanSettings({ visualizerEnabled: false }).visualizerEnabled, false);
  assert.equal(cleanSettings({ mode: 'evil', shell: 'evil' }).mode, undefined);
  const clean = cleanState({ library: [{ id: 'jfKfPfyJRdk', url: 'javascript:evil', title: 'Teste' }, { id: 'jfKfPfyJRdk' }, { id: 'bad' }] });
  assert.equal(clean.legacyVideos.length, 1);
  assert.equal(clean.legacyVideos[0].url, 'https://www.youtube.com/watch?v=jfKfPfyJRdk');
});
test('preserva banner validado e marca bibliotecas antigas para buscar capa', () => {
  const id = 'UC_x5XG1OV2P6uZZ5FSM9Ttw';
  const banner = 'https://yt3.googleusercontent.com/banner=w1060';
  const clean = cleanState({library:[{id,banner,bannerUpdatedAt:123}]});
  assert.equal(clean.library[0].banner,banner);
  assert.equal(clean.library[0].bannerUpdatedAt,123);
  assert.equal(cleanState({library:[{id,banner:'https://evil.test/banner'}]}).library[0].banner,'');
  assert.equal(cleanState({library:[{id,profileUpdatedAt:123}]}).library[0].bannerUpdatedAt,0);
});
test('preserva biblioteca e configurações entre aberturas; faz backup de arquivo inválido', () => {
  const testRoot = process.env.LUMEN_TEST_DIR ? path.resolve(process.env.LUMEN_TEST_DIR) : path.resolve(__dirname, '..', 'test-results');
  fs.mkdirSync(testRoot, { recursive: true });
  const dir = fs.mkdtempSync(path.join(testRoot, 'store-'));
  try {
    let store = new Store(dir);
    store.save({ library: [{ id: 'UC_x5XG1OV2P6uZZ5FSM9Ttw', title: 'Meu canal' }], settings: { transparency: 25, videoTint: 'pink', mode: 'background' } });
    store = new Store(dir);
    assert.equal(store.value.library[0].title, 'Meu canal');
    assert.equal(store.value.settings.transparency, 25);
    assert.equal(store.value.settings.videoTint, 'pink');
    assert.equal(store.value.settings.mode, undefined);
    fs.writeFileSync(store.file, '{invalid');
    const recovered = new Store(dir);
    assert.ok(recovered.warning);
    assert.equal(recovered.value.library.length, 0);
    assert.ok(fs.readdirSync(dir).some((file) => file.includes('.backup-')));
  } finally { if (path.resolve(dir).startsWith(testRoot + path.sep)) fs.rmSync(dir, { recursive: true, force: true }); }
});
test('migra preferências antigas sem perder vídeos e preserva a escolha de pausar', () => {
  const old = { version: 1, library: [{ id: 'M7lc1UVf-VE', title: 'Meu vídeo salvo', author: 'Canal' }], settings: { mode: 'background', shell: 'bash', fontSize: 18, transparency: 30, alwaysOnTop: true } };
  const migrated = cleanState(old);
  assert.equal(migrated.version, 3);
  assert.equal(migrated.legacyVideos[0].title, old.library[0].title);
  assert.deepEqual(migrated.settings, { transparency: 30, theme: 'cyberpunk', videoTint: 'none', keepPlayingMinimized: true, visualizerEnabled: true, visualizerStyle: 'matrix' });
  assert.equal(cleanSettings({ keepPlayingMinimized: false }).keepPlayingMinimized, false);
  assert.equal(cleanSettings({ mode: 'cinema', alwaysOnTop: true }).alwaysOnTop, undefined);
});

test('aceita apenas páginas de canais e normaliza suas abas', () => {
  for (const url of ['youtube.com/@GoogleDevelopers', 'https://www.youtube.com/@GoogleDevelopers/videos?view=0', 'https://m.youtube.com/@GoogleDevelopers/streams']) assert.equal(parseChannel(url).url, 'https://www.youtube.com/@GoogleDevelopers');
  for (const prefix of ['c', 'user']) assert.equal(parseChannel('youtube.com/' + prefix + '/GoogleDevelopers/about').url, 'https://www.youtube.com/' + prefix + '/GoogleDevelopers');
  assert.equal(parseChannel('youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw').id, 'UC_x5XG1OV2P6uZZ5FSM9Ttw');
  for (const url of ['https://youtu.be/M7lc1UVf-VE', 'https://youtube.com/watch?v=M7lc1UVf-VE', 'https://youtube.com/playlist?list=a', 'https://youtube.com.evil.test/@name', 'https://evil@youtube.com/@name', 'https://youtube.com:42/@name', 'https://youtube.com/@', 'https://youtube.com/channel/invalid', 'https://youtube.com/@name/videos/extra', 'https://youtube.com/@%2f..', 'https://youtube.com/user/']) assert.throws(() => parseChannel(url), url);
});
test('normaliza canais e preserva links antigos ao salvar preferências', () => {
  const value = cleanState({ library: [{ id: 'UC_x5XG1OV2P6uZZ5FSM9Ttw', title: 'Meu canal', url: 'https://evil.test' }, { id: 'UC_x5XG1OV2P6uZZ5FSM9Ttw' }, { id: 'M7lc1UVf-VE', title: 'Original' }] });
  assert.equal(value.library.length, 1);
  assert.equal(value.library[0].url, 'https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw');
  assert.equal(value.legacyVideos.length, 1);
  assert.deepEqual(cleanState(value), value);
});

test('preserva foto de perfil e aceita somente HTTPS nos hosts de avatares do YouTube', () => {
  const channel = { id: 'UC_x5XG1OV2P6uZZ5FSM9Ttw', title: 'Nome personalizado', avatar: 'https://yt3.googleusercontent.com/profile=s160', avatarUpdatedAt: 123 };
  const saved = cleanState({ library: [channel] }).library[0];
  assert.equal(saved.avatar, channel.avatar);
  assert.equal(saved.avatarUpdatedAt, 123);
  assert.equal(saved.title, channel.title);
  for (const avatar of ['https://yt3.googleusercontent.com.evil.test/a', 'http://yt3.ggpht.com/a', 'https://user@yt3.ggpht.com/a', 'https://yt3.ggpht.com:42/a', 'file:///photo.png', 'data:image/png;base64,AA']) assert.equal(cleanState({ library: [{ ...channel, avatar }] }).library[0].avatar, '');
});

test('preserva contagem pública de inscritos e renomeações sem inventar precisão', () => {
  const channel = { id: 'UC_x5XG1OV2P6uZZ5FSM9Ttw', title: 'Meu canal', subscriberCount: '2,67\u00a0mi de inscritos', profileUpdatedAt: 456 };
  const saved = cleanState({ library: [channel] }).library[0];
  assert.equal(saved.subscriberCount, '2,67 mi de inscritos');
  assert.equal(saved.profileUpdatedAt, 456);
  assert.equal(cleanState({ library: [{ ...saved, title: 'Novo nome' }] }).library[0].subscriberCount, saved.subscriberCount);
  for (const value of ['6 mil vídeos', '500 visualizações', '<img onerror=evil()>', 1234, null]) assert.equal(cleanState({ library: [{ ...channel, subscriberCount: value }] }).library[0].subscriberCount, '');
});
