const fs = require('node:fs');
const path = require('node:path');
const { cleanHistory } = require('./history.cjs');

const VIDEO_ID = /^[\w-]{11}$/;
const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be', 'www.youtube-nocookie.com', 'youtube-nocookie.com']);
function parseYouTube(input) {
  if (typeof input !== 'string' || input.length > 2048) throw new Error('Cole um link válido do YouTube.');
  let url;
  try { url = new URL(input.trim().match(/^https?:\/\//i) ? input.trim() : `https://${input.trim()}`); }
  catch { throw new Error('Cole um link válido do YouTube.'); }
  if (!['https:', 'http:'].includes(url.protocol) || !HOSTS.has(url.hostname) || url.username || url.password || url.port) {
    throw new Error('Use um link de youtube.com ou youtu.be.');
  }
  const parts = url.pathname.split('/').filter(Boolean);
  let id = /^(www\.)?youtu\.be$/.test(url.hostname) ? parts[0] : url.pathname === '/watch' ? url.searchParams.get('v') : ['shorts', 'live', 'embed'].includes(parts[0]) ? parts[1] : null;
  if (!id || !VIDEO_ID.test(id)) throw new Error('O link precisa apontar para um vídeo. Links de playlists não são aceitos.');
  return { id, url: `https://www.youtube.com/watch?v=${id}` };
}
const CHANNEL_ID = /^UC[\w-]{22}$/;
function cleanSubscriberCount(value) {
  if (typeof value !== 'string' || value.length > 100) return '';
  const text = value.replace(/\s+/g, ' ').trim();
  if (!/^\d[\d., ]*\s*(?:(?:mil|mi|milhão|milhões|bilhão|bilhões|[kmb])\s*)?(?:de\s+)?(?:inscritos?|subscribers?)$/i.test(text)) return '';
  return text.replace(/subscribers?$/i, 'inscritos');
}
function cleanAvatar(value) {
  if (typeof value !== 'string' || value.length > 2048) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['yt3.googleusercontent.com', 'yt3.ggpht.com'].includes(url.hostname) && !url.username && !url.password && !url.port ? url.href : '';
  } catch { return ''; }
}
function parseChannel(input) {
  if (typeof input !== 'string' || input.length > 2048) throw new Error('Cole um link de canal do YouTube.');
  let url;
  try { url = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`); }
  catch { throw new Error('Cole um link de canal do YouTube.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname) || url.username || url.password || url.port) throw new Error('Use um link de canal de youtube.com.');
  const parts = url.pathname.split('/').filter(Boolean);
  const count = parts[0]?.startsWith('@') ? 1 : 2;
  if (parts.length > count + 1 || (parts[count] && !['featured', 'videos', 'shorts', 'streams', 'playlists', 'community', 'about'].includes(parts[count]))) throw new Error('Use a página de um canal, como youtube.com/@nome.');
  if (count === 1 ? !/^@[^\s/%?#\\]+$/.test(decodeURIComponent(parts[0])) : !(parts[0] === 'channel' ? CHANNEL_ID.test(parts[1] || '') : ['c', 'user'].includes(parts[0]) && /^[^\s/%?#\\]+$/.test(decodeURIComponent(parts[1] || '')))) throw new Error('Use a página de um canal, como youtube.com/@nome.');
  return { id: parts[0] === 'channel' ? parts[1] : null, url: `https://www.youtube.com/${parts.slice(0, count).join('/')}` };
}
const defaults = () => ({ version: 3, library: [], legacyVideos: [], history: [], settings: cleanSettings() });
function cleanSettings(value = {}) {
  const theme = ['cyberpunk', 'military', 'space'].includes(value.theme) ? value.theme : 'cyberpunk';
  const defaultStyle = theme === 'space' ? 'aurora' : theme === 'cyberpunk' ? 'matrix' : 'wave';
  return {
    transparency: Number.isFinite(value.transparency) ? Math.round(Math.max(0, Math.min(65, value.transparency))) : 0,
    theme,
    videoTint: ['yellow', 'blue', 'red', 'pink'].includes(value.videoTint) ? value.videoTint : 'none',
    keepPlayingMinimized: value.keepPlayingMinimized !== false,
    visualizerEnabled: value.visualizerEnabled !== false,
    visualizerStyle: ['bars', 'wave', 'aurora', 'helix', 'constellation', 'matrix'].includes(value.visualizerStyle) ? value.visualizerStyle : defaultStyle
  };
}
function cleanState(value) {
  const out = defaults();
  const seen = new Set();
  if (Array.isArray(value?.library)) for (const item of value.library.slice(0, 2000)) {
    if (!item || !CHANNEL_ID.test(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    out.library.push({ id: item.id, url: `https://www.youtube.com/channel/${item.id}`, title: String(item.title || `Canal ${item.id}`).slice(0, 180), avatar: cleanAvatar(item.avatar), avatarUpdatedAt: Number.isFinite(item.avatarUpdatedAt) ? item.avatarUpdatedAt : 0, banner: cleanAvatar(item.banner), bannerUpdatedAt: Number.isFinite(item.bannerUpdatedAt) ? item.bannerUpdatedAt : 0, subscriberCount: cleanSubscriberCount(item.subscriberCount), profileUpdatedAt: Number.isFinite(item.profileUpdatedAt) ? item.profileUpdatedAt : 0, addedAt: Number.isFinite(item.addedAt) ? item.addedAt : Date.now() });
  }
  for (const item of [...(Array.isArray(value?.legacyVideos) ? value.legacyVideos : []), ...(Array.isArray(value?.library) ? value.library : [])].slice(0, 4000)) {
    if (!item || !VIDEO_ID.test(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    out.legacyVideos.push({ id: item.id, url: `https://www.youtube.com/watch?v=${item.id}`, title: String(item.title || `Vídeo ${item.id}`).slice(0, 180), author: String(item.author || 'YouTube').slice(0, 100), addedAt: Number.isFinite(item.addedAt) ? item.addedAt : Date.now() });
  }
  out.settings = cleanSettings(value?.settings);
  out.history = cleanHistory(value?.history);
  return out;
}
class Store {
  constructor(directory) {
    fs.mkdirSync(directory, { recursive: true });
    this.file = path.join(directory, 'library.json');
    this.warning = '';
    try { this.value = cleanState(JSON.parse(fs.readFileSync(this.file, 'utf8'))); }
    catch (error) {
      if (error.code !== 'ENOENT') {
        const backup = `${this.file}.backup-${Date.now()}`;
        fs.copyFileSync(this.file, backup);
        this.warning = 'A biblioteca anterior estava ilegível. Uma cópia foi preservada na pasta data.';
      }
      this.value = defaults();
    }
  }
  save(value) {
    const clean = cleanState(value);
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(clean, null, 2), 'utf8');
    fs.renameSync(temporary, this.file);
    this.value = clean;
    return this.value;
  }
}
module.exports = { parseYouTube, parseChannel, CHANNEL_ID, cleanAvatar, cleanSubscriberCount, cleanSettings, cleanState, Store };
