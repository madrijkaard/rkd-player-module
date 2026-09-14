// Keep unresolved video links until a later attempt can identify their channels.
async function migrateLibrary(store, resolveChannel, onUpdate = () => {}) {
  const pending = [...store.value.legacyVideos];
  async function worker() {
    while (pending.length) {
      const video = pending.shift();
      try {
        const channel = await resolveChannel(video.id);
        const library = [...store.value.library];
        if (!library.some(item => item.id === channel.id)) {
          if (library.length >= 2000) continue;
          library.push({ ...channel, addedAt: video.addedAt });
        }
        store.save({ ...store.value, library, legacyVideos: store.value.legacyVideos.filter(item => item.id !== video.id) });
        onUpdate();
      } catch { /* Preserve the original record on network/metadata failure. */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker));
}
module.exports = { migrateLibrary };
