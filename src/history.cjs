const VIDEO_ID = /^[\w-]{11}$/;
function cleanHistory(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.slice(0, 10000)
    .filter(item => item && typeof item.id === 'string' && VIDEO_ID.test(item.id))
    .map(item => ({
      id: item.id,
      title: String(item.title || `Vídeo ${item.id}`).slice(0, 180),
      url: `https://www.youtube.com/watch?v=${item.id}`,
      thumbnail: `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`,
      liked: item.liked === true,
      watchedAt: Number.isFinite(item.watchedAt) && item.watchedAt >= 0 ? item.watchedAt : 0
    }))
    .sort((a, b) => b.watchedAt - a.watchedAt)
    .filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; })
    .slice(0, 100);
}
function recordHistory(history, video, now = Date.now()) {
  if (!video || typeof video.id !== 'string' || !VIDEO_ID.test(video.id)) throw new Error('Vídeo inválido para o histórico.');
  const entries = cleanHistory(history);
  const item = cleanHistory([{ id: video.id, title: video.title, watchedAt: now, liked: entries.find(entry => entry.id === video.id)?.liked }])[0];
  return [item, ...entries.filter(entry => entry.id !== item.id)].slice(0, 100);
}
function setHistoryLike(history, id, liked) {
  if (typeof id !== 'string' || !VIDEO_ID.test(id) || typeof liked !== 'boolean') throw new Error('Curtida inválida.');
  const entries = cleanHistory(history);
  if (!entries.some(entry => entry.id === id)) throw new Error('Reproduza o vídeo antes de curtir.');
  return entries.map(entry => entry.id === id ? { ...entry, liked } : entry);
}
module.exports = { cleanHistory, recordHistory, setHistoryLike };
