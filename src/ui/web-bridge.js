'use strict';
// Browser counterpart of the Electron preload. Only the main page loads this file.
(() => {
  const libraryListeners = new Set();
  let migrationTimer = null;
  let positionPromise;
  async function request(name, body = {}) {
    const response = await fetch('/api/' + name, {
      method: 'POST', cache: 'no-store', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Lumen-Web': '1' },
      body: JSON.stringify(body)
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'Falha ao acessar o servidor.');
    return value;
  }
  function notifyLibrary(value) {
    for (const listener of libraryListeners) listener(value);
  }
  function pollMigration() {
    if (migrationTimer) return;
    const poll = async () => {
      try {
        const value = await request('migration-state');
        notifyLibrary(value);
        if (value.migrating) migrationTimer = setTimeout(poll, 1000);
        else migrationTimer = null;
      } catch {
        migrationTimer = setTimeout(poll, 3000);
      }
    };
    migrationTimer = setTimeout(poll, 1000);
  }
  function browserPosition() {
    if (positionPromise) return positionPromise;
    positionPromise = new Promise(resolve => {
      if (!navigator.geolocation) { resolve({ status: 'unavailable' }); return; }
      navigator.geolocation.getCurrentPosition(
        result => resolve({ status: 'available', lat: result.coords.latitude,
          lon: result.coords.longitude, accuracy: result.coords.accuracy }),
        error => resolve({ status: error.code === 1 ? 'denied' : 'unavailable' }),
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 }
      );
    });
    return positionPromise;
  }
  window.lumen = {
    init: () => request('init'),
    recommendations: (id, options) => request('recommendations', { id, options }),
    radar: async () => request('radar', { position: await browserPosition() }),
    recordHistory: video => request('history-record', { video }),
    likeHistory: (id, liked) => request('history-like', { id, liked }),
    historyChannel: id => request('history-channel', { id }),
    addChannel: url => request('library-add', { url }),
    removeChannel: id => request('library-remove', { id }),
    channelProfile: id => request('library-profile', { id }),
    migrateLibrary: async () => {
      const value = await request('library-migrate');
      if (value.migrating) pollMigration();
      return value;
    },
    onLibraryUpdate: listener => {
      libraryListeners.add(listener);
      return () => libraryListeners.delete(listener);
    },
    settings: patch => request('settings', { patch }),
    window: () => {},
    onVisibility: listener => {
      const handler = () => listener(!document.hidden);
      document.addEventListener('visibilitychange', handler);
      return () => document.removeEventListener('visibilitychange', handler);
    }
  };
})();
