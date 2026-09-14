const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createRecommendations, initialJson, parseFeed, parseChannelPage, channelAvatar, channelSubscribers, channelBanner } = require('../src/recommendations.cjs');
const channel = { id: 'UC_x5XG1OV2P6uZZ5FSM9Ttw', title: 'Example' };
const other = 'UCaaaaaaaaaaaaaaaaaaaaaa';
test('extrai capa atual e legada, valida origem e preserva canais sem banner', async () => {
  const banner = 'https://yt3.googleusercontent.com/banner=w1060';
  const header = {pageHeaderRenderer:{content:{pageHeaderViewModel:{banner:{imageBannerViewModel:{image:{sources:[{url:banner,width:1060},{url:'https://evil.test/banner',width:1000},{url:'https://yt3.ggpht.com/large',width:2560}]}}}}}}};
  assert.equal(channelBanner({header}),banner);
  assert.equal(channelBanner({header:{c4TabbedHeaderRenderer:{banner:{thumbnails:[{url:banner,width:1060}]}}}}),banner);
  assert.equal(channelBanner({header:{c4TabbedHeaderRenderer:{banner:{thumbnails:[{url:'javascript:alert(1)'}]}}}}),'');
  assert.equal(channelBanner({}),'');
  const html = channelPage().replace('"metadata":', `"header":${JSON.stringify(header)},"metadata":`);
  const service = createRecommendations({now:()=>789,fetcher:async()=>new Response(html)});
  const resolved = await service.resolveLink('youtube.com/@Example');
  assert.equal(resolved.banner,banner);
  assert.equal(resolved.bannerUpdatedAt,789);
});
const current = 'M7lc1UVf-VE', next = 'CBzLIKfWpdg';
const entry = (id, owner = channel.id) => `<entry><yt:videoId>${id}</yt:videoId><yt:channelId>${owner}</yt:channelId><title>A &amp; B</title></entry>`;
const feed = `<feed><yt:channelId>${channel.id.slice(2)}</yt:channelId><title>Example</title>${entry(current)}${entry(next)}${entry(next)}${entry('aqz-KE-bpKQ', other)}${entry('../invalid')}</feed>`;
const watch = `var ytInitialPlayerResponse = ${JSON.stringify({ videoDetails: { videoId: current, channelId: channel.id, author: channel.title } })};`;
function channelPage() {
  return `var ytInitialData = ${JSON.stringify({ metadata: { channelMetadataRenderer: { externalId: channel.id, title: 'Example' } }, contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { selected: true, endpoint: { commandMetadata: { webCommandMetadata: { url: '/@Example/videos' } } }, content: { richGridRenderer: { contents: [
    { richItemRenderer: { content: { lockupViewModel: { contentType: 'LOCKUP_CONTENT_TYPE_VIDEO', contentId: next, metadata: { lockupMetadataViewModel: { title: { content: 'Modern video' } } } } } } },
    { richItemRenderer: { content: { videoRenderer: { videoId: current, title: { runs: [{ text: 'Legacy video' }] } } } } },
    { richItemRenderer: { content: { lockupViewModel: { contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST', contentId: 'aqz-KE-bpKQ' } } } }
  ] } } } }] } }, sidebar: { videoRenderer: { videoId: 'aqz-KE-bpKQ' } } })};`;
}
test('public data parser handles quoted braces and rejects executable literals', () => {
  assert.deepEqual(initialJson('var ytInitialData = {"title":"a } \\\" b", "nested":{"ok":true}};', 'ytInitialData'), { title: 'a } " b', nested: { ok: true } });
  assert.equal(initialJson('var ytInitialData = {value: evil()};', 'ytInitialData'), null);
});
test('feed validates channel, excludes foreign/invalid entries and duplicates', () => {
  const result = parseFeed(feed, channel);
  assert.deepEqual(result.items.map(v => v.id), [current, next]);
  assert.equal(result.items[0].title, 'A & B');
  assert.throws(() => parseFeed(feed, { id: other }), /não pertence/);
  assert.throws(() => parseFeed('<!DOCTYPE feed>' + feed, channel), /inválida/);
});
test('channel fallback reads only direct videos in the verified Videos tab', () => {
  const result = parseChannelPage(channelPage(), channel);
  assert.deepEqual(result.items.map(v => v.id), [next, current]);
  assert.equal(result.items[0].title, 'Modern video');
  assert.throws(() => parseChannelPage(channelPage(), { id: other }), /confirmar/);
  assert.throws(() => parseChannelPage(channelPage().replace('/@Example/videos', '/@Example/featured'), channel), /lista/);
});
test('service excludes current video, shares pending requests and expires caches', async () => {
  let time = 0;
  const calls = [];
  const service = createRecommendations({ now: () => time, fetcher: async url => { calls.push(url); return new Response(url.includes('/watch?') ? watch : feed); } });
  const [a, b] = await Promise.all([service.get(current), service.get(current)]);
  assert.deepEqual(a, b);
  assert.deepEqual(a.items.map(v => v.id), [next]);
  assert.equal(calls.length, 2);
  assert.deepEqual((await service.get(next)).items.map(v => v.id), [current]);
  assert.equal(calls.length, 2);
  time = 300001;
  await service.get(current);
  assert.equal(calls.length, 4);
  await assert.rejects(service.get('https://evil.test'), /válido/);
  assert.equal(calls.length, 4);
});
test('feed failure falls back to public channel and surfaces complete outage', async () => {
  const service = createRecommendations({ fetcher: async url => new Response(url.includes('/watch?') ? watch : url.includes('/feeds/') ? '' : channelPage(), { status: url.includes('/feeds/') ? 503 : 200 }) });
  const result = await service.get(current);
  assert.equal(result.source, 'channel');
  assert.deepEqual(result.items.map(v => v.id), [next]);
  const offline = createRecommendations({ fetcher: async () => { throw new Error('offline'); } });
  await assert.rejects(offline.get(current), /offline/);
});

test('resolve canal por handle, confirma ID e reutiliza vídeos sem excluir o primeiro', async () => {
  const calls = [];
  const service = createRecommendations({ fetcher: async url => { calls.push(url); return new Response(channelPage()); } });
  const resolved = await service.resolveLink('youtube.com/@Example');
  assert.equal(resolved.id, channel.id);
  assert.equal(resolved.url, `https://www.youtube.com/channel/${channel.id}`);
  const result = await service.getChannel(resolved.id);
  assert.deepEqual(result.items.map(v => v.id).sort(), [next, current].sort());
  assert.equal(calls.length, 1);
  await assert.rejects(service.resolveLink(`youtube.com/channel/${other}`), /confirmar/);
  await assert.rejects(service.getChannel(current), /canal válido/);
  await assert.rejects(service.resolveLink('youtube.com/watch?v=' + current), /canal/);
});

test('canal sem vídeos retorna lista vazia; consultas simultâneas compartilham o feed', async () => {
  let calls = 0;
  const service = createRecommendations({ fetcher: async () => { calls++; return new Response(`<feed><yt:channelId>${channel.id}</yt:channelId><title>Empty</title></feed>`); } });
  const [a, b] = await Promise.all([service.getChannel(channel.id), service.getChannel(channel.id)]);
  assert.deepEqual(a, b);
  assert.equal(a.items.length, 0);
  assert.equal(calls, 1);
});

test('extrai foto de perfil com tamanho adequado e rejeita origens externas', async () => {
  const small = 'https://yt3.ggpht.com/profile=s48', large = 'https://yt3.googleusercontent.com/profile=s160';
  assert.equal(channelAvatar({ avatar: { thumbnails: [{ url: small, width: 48 }, { url: large, width: 160 }, { url: 'https://evil.test/avatar', width: 108 }] } }), large);
  assert.equal(channelAvatar({ avatar: { thumbnails: [{ url: 'javascript:alert(1)' }] } }), '');
  assert.equal(channelAvatar({}), '');
  const html = channelPage().replace('"title":"Example"', `"title":"Example","avatar":{"thumbnails":[{"url":"${large}","width":160}]}`);
  const service = createRecommendations({ now: () => 123, fetcher: async () => new Response(html) });
  const resolved = await service.resolveLink('youtube.com/@Example');
  assert.equal(resolved.avatar, large);
  assert.equal(resolved.avatarUpdatedAt, 123);
});

test('extrai inscritos do cabeçalho atual e legado sem confundir com vídeos ou visualizações', async () => {
  const header = { pageHeaderRenderer: { content: { pageHeaderViewModel: { metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: '@Example' } }, { text: { content: '6 mil vídeos' } }, { text: { content: '2,67\u00a0mi de inscritos' } }] }] } } } } } };
  assert.equal(channelSubscribers({ header }), '2,67 mi de inscritos');
  assert.equal(channelSubscribers({ header: { c4TabbedHeaderRenderer: { subscriberCountText: { runs: [{ text: '123 ' }, { text: 'inscritos' }] } } } }), '123 inscritos');
  assert.equal(channelSubscribers({ header: { c4TabbedHeaderRenderer: { subscriberCountText: { simpleText: '0 subscribers' } } } }), '0 inscritos');
  assert.equal(channelSubscribers({ header: { c4TabbedHeaderRenderer: { subscriberCountText: { simpleText: '5 mil vídeos' } } } }), '');
  assert.equal(channelSubscribers({}), '');
  const html = channelPage().replace('"metadata":', `"header":${JSON.stringify(header)},"metadata":`);
  const service = createRecommendations({ now: () => 456, fetcher: async () => new Response(html) });
  const channel = await service.resolveLink('youtube.com/@Example');
  assert.equal(channel.subscriberCount, '2,67 mi de inscritos');
  assert.equal(channel.profileUpdatedAt, 456);
});
