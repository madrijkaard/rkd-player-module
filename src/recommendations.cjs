const VIDEO_ID = /^[\w-]{11}$/;
const { parseChannel, cleanAvatar, cleanSubscriberCount } = require('./core.cjs');
const { createCatalog, sampleVideos } = require('./recommendation-catalog.cjs');
const CHANNEL_ID = /^UC[\w-]{22}$/;
const TTL = 5 * 60 * 1000;
const MAX_BYTES = 4 * 1024 * 1024;
function channelAvatar(metadata) {
  const thumbnails = Array.isArray(metadata?.avatar?.thumbnails) ? metadata.avatar.thumbnails : [];
  const valid = thumbnails.filter(t => cleanAvatar(t?.url)).sort((a, b) => (a.width || 0) - (b.width || 0));
  return cleanAvatar((valid.find(t => t.width >= 108) || valid.at(-1))?.url);
}
function channelSubscribers(data) {
  const header = data?.header;
  const legacy = header?.c4TabbedHeaderRenderer?.subscriberCountText;
  const legacyText = legacy?.simpleText || legacy?.runs?.map(run => run.text || '').join('');
  const rows = header?.pageHeaderRenderer?.content?.pageHeaderViewModel?.metadata?.contentMetadataViewModel?.metadataRows || [];
  const candidates = [legacyText, ...rows.flatMap(row => (row.metadataParts || []).map(part => part.text?.content))];
  return candidates.map(cleanSubscriberCount).find(Boolean) || '';
}

function channelBanner(data) {
  const header = data?.header;
  const modern = header?.pageHeaderRenderer?.content?.pageHeaderViewModel?.banner?.imageBannerViewModel?.image?.sources;
  const legacy = header?.c4TabbedHeaderRenderer?.banner?.thumbnails;
  const sources = [...(Array.isArray(modern) ? modern : []), ...(Array.isArray(legacy) ? legacy : [])];
  const valid = sources.filter(source => cleanAvatar(source?.url)).sort((a, b) => (a.width || 0) - (b.width || 0));
  return cleanAvatar((valid.find(source => source.width >= 1000) || valid.at(-1))?.url);
}

// Read data literals from the public page without executing any remote script.
function initialJson(html, name) {
  const match = new RegExp(`(?:var\\s+)?${name}\\s*=\\s*`).exec(html);
  if (!match) return null;
  const start = match.index + match[0].length;
  if (html[start] !== '{') return null;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}
function decodeXml(text = '') {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (all, entity) => {
    const names = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (names[entity]) return names[entity];
    const n = entity.startsWith('#x') ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return Number.isInteger(n) && n >= 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : all;
  });
}
function tag(xml, name) { return decodeXml(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`).exec(xml)?.[1] || '').trim(); }
function item(id, title, channel, published = '') {
  return { id, title: String(title || `Vídeo ${id}`).slice(0, 180), author: channel.title, channelId: channel.id, url: `https://www.youtube.com/watch?v=${id}`, thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, published };
}
function parseFeed(xml, channel) {
  if (!xml.includes('<feed') || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Resposta de canal inválida.');
  const header = xml.split('<entry>')[0];
  const rawId = tag(header, 'yt:channelId');
  if (rawId !== channel.id && `UC${rawId}` !== channel.id) throw new Error('O feed não pertence ao canal selecionado.');
  const author = tag(header, 'title') || channel.title;
  const seen = new Set(), items = [];
  for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const entry = match[1], id = tag(entry, 'yt:videoId');
    if (!VIDEO_ID.test(id) || seen.has(id) || tag(entry, 'yt:channelId') !== channel.id) continue;
    seen.add(id);
    items.push(item(id, tag(entry, 'title'), { ...channel, title: author }, tag(entry, 'published')));
    if (items.length === 30) break;
  }
  return { channel: { ...channel, title: author }, items, source: 'feed' };
}
function parseChannelPage(html, channel) {
  const data = initialJson(html, 'ytInitialData');
  const metadata = data?.metadata?.channelMetadataRenderer;
  if (metadata?.externalId !== channel.id) throw new Error('Não foi possível confirmar o canal das sugestões.');
  const tab = data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.find((t) => t.tabRenderer?.selected)?.tabRenderer;
  const url = tab?.endpoint?.commandMetadata?.webCommandMetadata?.url || '';
  if (!url.split('?')[0].endsWith('/videos')) throw new Error('Este canal não disponibilizou a lista de vídeos.');
  const result = { channel: { ...channel, title: String(metadata.title || channel.title).slice(0, 100) }, items: [], source: 'channel' };
  const seen = new Set();
  // Only direct uploads in the selected Videos tab, never sidebar/related videos.
  for (const row of tab.content?.richGridRenderer?.contents || []) {
    const content = row.richItemRenderer?.content;
    const legacy = content?.videoRenderer;
    const modern = content?.lockupViewModel;
    const id = legacy?.videoId || (modern?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' ? modern.contentId : null);
    if (!VIDEO_ID.test(id || '') || seen.has(id)) continue;
    seen.add(id);
    const title = legacy?.title?.simpleText || legacy?.title?.runs?.map((run) => run.text || '').join('') || modern?.metadata?.lockupMetadataViewModel?.title?.content;
    result.items.push(item(id, title, result.channel));
    if (result.items.length === 30) break;
  }
  return result;
}
function createRecommendations({ fetcher = (...args) => fetch(...args), now = Date.now, random = Math.random } = {}) {
  const videos = new Map(), channels = new Map(), pending = new Map();
  const previous = new Map();
  const catalog = createCatalog({ read: text, initialJson, parsePage: parseChannelPage, now, random });
  function getCache(map, key) {
    const cached = map.get(key);
    if (!cached || now() - cached.time >= TTL) { map.delete(key); return null; }
    return cached.value;
  }
  function remember(map, key, value, limit) {
    map.delete(key); map.set(key, { value, time: now() });
    while (map.size > limit) map.delete(map.keys().next().value);
    return value;
  }
  async function text(url, options = {}) {
    const response = await fetcher(url, { ...options, signal: AbortSignal.timeout(10000), headers: { 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.7', ...options.headers } });
    if (!response.ok) throw new Error(`O YouTube não respondeu à consulta (${response.status}).`);
    const reader = response.body.getReader();
    const chunks = []; let total = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BYTES) throw new Error('A resposta do canal é grande demais.');
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks).toString('utf8');
    } finally { await reader.cancel().catch(() => {}); }
  }
  async function resolveChannel(id) {
    const cached = getCache(videos, id);
    if (cached) return cached;
    let details;
    try {
      const html = await text(`https://www.youtube.com/watch?v=${id}`);
      details = initialJson(html, 'ytInitialPlayerResponse')?.videoDetails;
    } catch { /* oEmbed can still identify a channel when the watch page is unavailable. */ }
    if (details?.videoId === id && CHANNEL_ID.test(details.channelId)) return remember(videos, id, { id: details.channelId, title: String(details.author || 'YouTube').slice(0, 100) }, 600);
    const metadata = JSON.parse(await text(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`));
    const url = new URL(metadata.author_url);
    if (!['youtube.com', 'www.youtube.com'].includes(url.hostname) || !/^\/(?:@[^/]+|channel\/UC[\w-]{22}|user\/[^/]+|c\/[^/]+)\/?$/.test(url.pathname)) throw new Error('Não foi possível identificar o canal deste vídeo.');
    const html = await text(`https://www.youtube.com${url.pathname.replace(/\/$/, '')}/videos`);
    const channel = initialJson(html, 'ytInitialData')?.metadata?.channelMetadataRenderer;
    if (!CHANNEL_ID.test(channel?.externalId || '')) throw new Error('Não foi possível identificar o canal deste vídeo.');
    return remember(videos, id, { id: channel.externalId, title: String(channel.title || metadata.author_name || 'YouTube').slice(0, 100) }, 600);
  }
  async function fetchChannel(channel) {
    const cached = getCache(channels, channel.id);
    if (cached) return cached;
    let result;
    try { result = parseFeed(await text(`https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`), channel); }
    catch { result = parseChannelPage(await text(`https://www.youtube.com/channel/${channel.id}/videos`), channel); }
    for (const video of result.items) remember(videos, video.id, result.channel, 600);
    return remember(channels, channel.id, result, 40);
  }
  async function get(id) {
    if (typeof id !== 'string' || !VIDEO_ID.test(id)) throw new Error('Selecione um vídeo válido para ver as recomendações.');
    if (pending.has(id)) return pending.get(id);
    const request = (async () => {
      const channel = await resolveChannel(id);
      const result = await fetchChannel(channel);
      return { ...result, videoId: id, items: result.items.filter((video) => video.id !== id) };
    })();
    pending.set(id, request);
    try { return await request; } finally { pending.delete(id); }
  }
  async function resolveLink(input) {
    const link = parseChannel(input);
    const html = await text(`${link.url}/videos`);
    const data = initialJson(html, 'ytInitialData');
    const metadata = data?.metadata?.channelMetadataRenderer;
    if (!CHANNEL_ID.test(metadata?.externalId || '') || (link.id && link.id !== metadata.externalId)) throw new Error('Não foi possível confirmar este canal. Confira o link e tente novamente.');
    const channel = { id: metadata.externalId, title: String(metadata.title || 'Canal do YouTube').slice(0, 100), url: `https://www.youtube.com/channel/${metadata.externalId}`, avatar: channelAvatar(metadata), avatarUpdatedAt: now(), subscriberCount: channelSubscribers(data), profileUpdatedAt: now() };
    channel.banner = channelBanner(data);
    channel.bannerUpdatedAt = now();
    try { remember(channels, channel.id, parseChannelPage(html, channel), 40); catalog.seed(html, channel); } catch { /* The feed can supply uploads when the Videos tab is unavailable. */ }
    return channel;
  }
  async function getChannel(id, options = {}) {
    if (typeof id !== 'string' || !CHANNEL_ID.test(id)) throw new Error('Selecione um canal válido para ver os vídeos.');
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Opções de recomendações inválidas.');
    const key = `channel:${id}`;
    if (!pending.has(key)) {
      const request = fetchChannel({ id, title: 'Canal do YouTube', url: `https://www.youtube.com/channel/${id}` });
      pending.set(key, request);
      request.finally(() => { if (pending.get(key) === request) pending.delete(key); }).catch(() => {});
    }
    const result = await pending.get(key);
    if (options.refresh === true) {
      try { await catalog.expand(result.channel); } catch { /* Keep available suggestions on a public-page or continuation failure. */ }
    }
    const pool = [...new Map([...result.items, ...(catalog.peek(id)?.items || [])].map(video => [video.id, video])).values()];
    const items = sampleVideos(pool, { currentId: typeof options.currentId === 'string' ? options.currentId : '', previous: previous.get(id), random });
    previous.delete(id); previous.set(id, items.map(video => video.id));
    while (previous.size > 40) previous.delete(previous.keys().next().value);
    return { ...result, items, total: pool.length };
  }
  return { get, getChannel, resolveLink, resolveChannel };
}
module.exports = { createRecommendations, initialJson, parseFeed, parseChannelPage, channelAvatar, channelSubscribers, channelBanner };
