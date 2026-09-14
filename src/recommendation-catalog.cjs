const TTL = 5 * 60 * 1000;
const LIMIT = 360;
function createCatalog({ read, initialJson, parsePage, now, random }) {
  const catalogs = new Map(), pending = new Map();
  function peek(id) {
    const catalog = catalogs.get(id);
    if (catalog && now() - catalog.time < TTL) return catalog;
    catalogs.delete(id);
    return null;
  }
  function continuation(rows) {
    return rows?.find(row => row.continuationItemRenderer)?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token || '';
  }
  function seed(html, channel) {
    if (peek(channel.id)) return;
    const parsed = parsePage(html, channel);
    const data = initialJson(html, 'ytInitialData');
    const grid = data.contents.twoColumnBrowseResultsRenderer.tabs.find(tab => tab.tabRenderer?.selected)?.tabRenderer.content?.richGridRenderer;
    const config = initialJson(html.replace(/ytcfg\.set\(\s*(?=\{)/g, 'var channelConfig = '), 'channelConfig');
    const client = config?.INNERTUBE_CONTEXT?.client;
    const chips = grid?.header?.chipBarViewModel?.chips || grid?.header?.feedFilterChipBarRenderer?.contents || [];
    const oldest = chips.map(chip => chip.chipViewModel || chip.chipCloudChipRenderer).find(chip => /mais antigos|oldest/i.test(chip?.text?.simpleText || chip?.text || ''));
    const command = oldest?.tapCommand?.innertubeCommand || oldest?.navigationEndpoint;
    catalogs.set(channel.id, { ...parsed, time: now(), target: grid?.targetId, client: client?.clientName === 'WEB' && typeof client.clientVersion === 'string' ? { clientName: 'WEB', clientVersion: client.clientVersion, hl: 'pt', gl: 'BR' } : null,
      recent: continuation(grid?.contents), older: command?.continuationCommand?.token || '', openedOlder: false });
    while (catalogs.size > 40) catalogs.delete(catalogs.keys().next().value);
  }
  async function expand(channel) {
    if (pending.has(channel.id)) return pending.get(channel.id);
    const request = (async () => {
      if (!peek(channel.id)) seed(await read(`https://www.youtube.com/channel/${channel.id}/videos`), channel);
      const catalog = peek(channel.id);
      if (!catalog?.client || !catalog.target || catalog.items.length >= LIMIT) return catalog;
      const lanes = ['recent', 'older'].filter(key => catalog[key]);
      const lane = !catalog.openedOlder && catalog.older ? 'older' : lanes[Math.floor(random() * lanes.length)];
      if (!lane) return catalog;
      const token = catalog[lane];
      const data = JSON.parse(await read('https://www.youtube.com/youtubei/v1/browse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: { client: catalog.client }, continuation: token }) }));
      // Only consume the continuation of the verified channel's Videos grid.
      const commands = [...(data.onResponseReceivedActions || []), ...(data.onResponseReceivedEndpoints || [])].map(action => action.appendContinuationItemsAction || action.reloadContinuationItemsCommand).filter(command => command?.targetId === catalog.target);
      if (!commands.length) throw new Error('Não foi possível ampliar os vídeos deste canal.');
      const rows = commands.flatMap(command => command.continuationItems || []);
      const html = `var ytInitialData = ${JSON.stringify({ metadata: { channelMetadataRenderer: { externalId: channel.id, title: catalog.channel.title } }, contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { selected: true, endpoint: { commandMetadata: { webCommandMetadata: { url: '/videos' } } }, content: { richGridRenderer: { contents: rows } } } }] } } })};`;
      const page = parsePage(html, catalog.channel);
      const seen = new Set(catalog.items.map(video => video.id));
      for (const video of page.items) if (!seen.has(video.id) && catalog.items.length < LIMIT) { catalog.items.push(video); seen.add(video.id); }
      catalog[lane] = continuation(rows);
      if (lane === 'older') catalog.openedOlder = true;
      return catalog;
    })();
    pending.set(channel.id, request);
    try { return await request; } finally { pending.delete(channel.id); }
  }
  return { peek, seed, expand };
}
function sampleVideos(items, { currentId, previous = [], random = Math.random, limit = 16 } = {}) {
  const last = new Set(previous), seen = new Set();
  const candidates = items.filter(video => video.id !== currentId && !seen.has(video.id) && seen.add(video.id));
  function shuffle(list) {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  }
  const fresh = shuffle(candidates.filter(video => !last.has(video.id)));
  const repeat = shuffle(candidates.filter(video => last.has(video.id)));
  const selected = shuffle([...fresh, ...repeat].slice(0, limit));
  if (selected.length > 1 && selected.every((video, i) => video.id === previous[i])) selected.push(selected.shift());
  return selected;
}
module.exports = { createCatalog, sampleVideos };
