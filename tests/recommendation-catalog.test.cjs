const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sampleVideos } = require('../src/recommendation-catalog.cjs');
const { createRecommendations } = require('../src/recommendations.cjs');
const channel = { id: 'UC_x5XG1OV2P6uZZ5FSM9Ttw', title: 'Example' };
const video = n => ({ id: String(n).padStart(11, '0'), title: `Video ${n}`, channelId: channel.id });
const row = n => ({ richItemRenderer: { content: { videoRenderer: { videoId: video(n).id, title: { simpleText: video(n).title } } } } });
const next = token => ({ continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token } } } });
function page() {
  const grid = { targetId: 'verified-grid', contents: [...Array.from({ length: 30 }, (_, i) => row(i)), next('recent-page-2')], header: { chipBarViewModel: { chips: [{ chipViewModel: { text: 'Mais antigos', tapCommand: { innertubeCommand: { continuationCommand: { token: 'oldest-page-1' } } } } }] } } };
  return `ytcfg.set(${JSON.stringify({ INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: 'fixture' } } })}); var ytInitialData = ${JSON.stringify({ metadata: { channelMetadataRenderer: { externalId: channel.id, title: channel.title } }, contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { selected: true, endpoint: { commandMetadata: { webCommandMetadata: { url: '/@Example/videos' } } }, content: { richGridRenderer: grid } } }] } } })};`;
}
test('sorteio exclui atual, evita lista anterior, não duplica e funciona com poucos vídeos', () => {
  const items = Array.from({ length: 60 }, (_, i) => video(i));
  const first = sampleVideos(items, { currentId: video(0).id });
  const second = sampleVideos([...items, items[0]], { currentId: first[0].id, previous: first.map(v => v.id) });
  assert.equal(second.length, 16);
  assert.equal(new Set(second.map(v => v.id)).size, 16);
  assert.ok(second.every(v => !first.some(old => old.id === v.id)));
  assert.deepEqual(sampleVideos([video(0)], { currentId: video(0).id }), []);
  assert.deepEqual(sampleVideos([]), []);
  const small = sampleVideos(items.slice(0, 3), { random: () => .999, previous: items.slice(0, 3).map(v => v.id) });
  assert.notDeepEqual(small, items.slice(0, 3));
});
test('clique amplia catálogo com uploads antigos e paginação; cache não congela o sorteio', async () => {
  const calls = [];
  const service = createRecommendations({ random: () => .5, fetcher: async (url, options) => {
    if (!options.body) return new Response(page());
    const token = JSON.parse(options.body).continuation; calls.push(token);
    const start = token === 'oldest-page-1' ? 100 : 200;
    return new Response(JSON.stringify({ onResponseReceivedActions: [{ reloadContinuationItemsCommand: { targetId: 'unrelated-grid', continuationItems: [row(999)] } }, { appendContinuationItemsAction: { targetId: 'verified-grid', continuationItems: [...Array.from({ length: 30 }, (_, i) => row(start + i)), next('older-page-2')] } }] }));
  } });
  await service.resolveLink('youtube.com/@Example');
  const initial = await service.getChannel(channel.id);
  const refreshed = await service.getChannel(channel.id, { refresh: true, currentId: initial.items[0].id });
  assert.equal(refreshed.total, 60);
  assert.equal(calls[0], 'oldest-page-1');
  assert.ok(refreshed.items.some(v => Number(v.id) >= 100));
  assert.ok(refreshed.items.every(v => v.id !== initial.items[0].id && v.channelId === channel.id && Number(v.id) !== 999));
  const more = await service.getChannel(channel.id, { refresh: true, currentId: refreshed.items[0].id });
  assert.equal(more.total, 90);
  assert.notDeepEqual(more.items, refreshed.items);
  assert.equal(calls[1], 'older-page-2');
});
test('falha ao buscar antigos preserva sugestões e falha de rede não para o sorteio em cache', async () => {
  let offline = false;
  const service = createRecommendations({ fetcher: async (_, options) => {
    if (offline || options.method === 'POST') throw new Error('offline');
    return new Response(page());
  } });
  await service.resolveLink('youtube.com/@Example');
  const initial = await service.getChannel(channel.id);
  offline = true;
  const refreshed = await service.getChannel(channel.id, { refresh: true, currentId: initial.items[0].id });
  assert.equal(refreshed.items.length, 16);
  assert.ok(!refreshed.items.some(v => v.id === initial.items[0].id));
  assert.notDeepEqual(refreshed.items, initial.items);
});
