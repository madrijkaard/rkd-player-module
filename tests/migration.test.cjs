const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cleanState } = require('../src/core.cjs');
const { migrateLibrary } = require('../src/migration.cjs');
test('converte vídeos em canais únicos sem perder falhas nem preferências', async () => {
  const channel = { id: 'UC_x5XG1OV2P6uZZ5FSM9Ttw', title: 'Google' };
  const store = { value: cleanState({ library: [{ id: 'M7lc1UVf-VE' }, { id: 'CBzLIKfWpdg' }, { id: 'aqz-KE-bpKQ' }], settings: { theme: 'space' } }), save(value) { this.value = cleanState(value); } };
  await migrateLibrary(store, async id => { if (id === 'aqz-KE-bpKQ') throw new Error('offline'); return channel; });
  assert.equal(store.value.library.length, 1);
  assert.equal(store.value.library[0].id, channel.id);
  assert.deepEqual(store.value.legacyVideos.map(v => v.id), ['aqz-KE-bpKQ']);
  assert.equal(store.value.settings.theme, 'space');
  store.value.library[0].title = 'Nome personalizado';
  await migrateLibrary(store, async () => channel);
  assert.equal(store.value.legacyVideos.length, 0);
  assert.equal(store.value.library[0].title, 'Nome personalizado');
});
