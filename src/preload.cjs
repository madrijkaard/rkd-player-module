const { contextBridge, ipcRenderer } = require('electron');
if (process.isMainFrame) {
  const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
  const subscribe = (channel) => (callback) => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
  contextBridge.exposeInMainWorld('lumen', {
    init: invoke('app:init'),
    recommendations: invoke('recommendations:get'),
    radar: invoke('radar:get'),
    recordHistory: invoke('history:record'),
    likeHistory: invoke('history:like'),
    historyChannel: invoke('history:channel'),
    addChannel: invoke('library:add'), removeChannel: invoke('library:remove'),
    channelProfile: invoke('library:profile'),
    migrateLibrary: invoke('library:migrate'), onLibraryUpdate: subscribe('library:updated'),
    settings: invoke('settings:update'), window: invoke('window:action'),
    onVisibility: subscribe('app:visibility')
  });
}
