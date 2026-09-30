/* This document has its own origin and never receives the Electron bridge. */
let player, ready = false, pending, parentOrigin;
let startupTimer;
function notify(type, value) { if (parentOrigin) parent.postMessage({ source: 'lumen-player', session: location.search, type, value }, parentOrigin); }
function failure(message) {
  const loading = document.getElementById('loading');
  loading.textContent = message;
  loading.hidden = false;
  notify('error', message);
}
function execute(command) {
  if (!ready) { if (command.type === 'load') pending = command; return; }
  if (command.type === 'load' && /^[\w-]{11}$/.test(command.id)) {
    if (command.autoplay === false) player.cueVideoById(command.id);
    else player.loadVideoById(command.id);
    document.getElementById('loading').hidden = true;
  } else if (command.type === 'pause') { pending = null; player.pauseVideo(); }
  else if (command.type === 'play') player.playVideo();
  else if (command.type === 'stop') { pending = null; player.stopVideo(); }
}
window.addEventListener('message', (event) => {
  if (event.source !== parent || (event.origin !== location.origin && !/^http:\/\/127\.0\.0\.1:\d+$/.test(event.origin)) || event.data?.source !== 'lumen-app') return;
  if (parentOrigin && parentOrigin !== event.origin) return;
  parentOrigin = event.origin;
  if (event.data.type === 'hello') { notify('connected', ready); return; }
  if (event.data.type === 'pause' && !ready) { if (pending) pending.autoplay = false; return; }
  if (event.data.type === 'stop' && !ready) { pending = null; return; }
  execute(event.data);
});
window.onYouTubeIframeAPIReady = () => {
  player = new YT.Player('yt', { width: '100%', height: '100%',
    playerVars: { autoplay: 0, controls: 1, playsinline: 1, origin: location.origin, rel: 0 },
    events: {
      onReady: () => { clearTimeout(startupTimer); ready = true; document.getElementById('loading').hidden = true; notify('ready', true); if (pending) { const next = pending; pending = null; execute(next); } },
      onStateChange: (event) => {
        const video = player.getVideoData();
        if (video?.video_id) notify('video', { id: video.video_id, title: video.title, author: video.author });
        notify('state', event.data);
      },
      onAutoplayBlocked: () => notify('blocked', 'Clique no botão Play do YouTube para iniciar o vídeo.'),
      onError: (event) => {
        const messages = { 2: 'O link deste vídeo é inválido.', 5: 'O YouTube não conseguiu reproduzir este vídeo neste momento.', 100: 'Este vídeo está privado, removido ou indisponível.', 101: 'Este vídeo não está disponível para reprodução incorporada.', 150: 'Este vídeo não está disponível para reprodução incorporada.', 153: 'O YouTube recusou a identificação do player nesta conexão.' };
        notify('error', `${messages[event.data] || 'Não foi possível reproduzir o vídeo.'} Tente outro vídeo do carrossel.`);
      }
    }
  });
};
const script = document.createElement('script');
script.src = 'https://www.youtube.com/iframe_api';
script.onerror = () => failure('Não foi possível conectar ao YouTube. Verifique sua internet e selecione o vídeo novamente.');
document.head.append(script);
startupTimer = setTimeout(() => { if (!ready) failure('O YouTube está demorando para responder. Verifique sua conexão ou selecione o vídeo novamente.'); }, 20000);
