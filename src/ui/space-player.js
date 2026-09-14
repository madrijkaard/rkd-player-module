/* Isolated from the Electron bridge and from the main video's controls. */
const STREAM_ID = 'fO9e9jnhYK8'; // Sen's ISS SpaceTV-1 live broadcast.
let player, parentOrigin, ready = false;
function notify(type) { if (parentOrigin) parent.postMessage({ source: 'lumen-space', type }, parentOrigin); }
function playMuted() { player.mute(); player.setVolume(0); player.playVideo(); }
window.addEventListener('message', event => {
  if (event.source !== parent || !/^http:\/\/127\.0\.0\.1:\d+$/.test(event.origin) || event.data?.source !== 'lumen-space-host' || event.data.type !== 'hello') return;
  if (parentOrigin && parentOrigin !== event.origin) return;
  parentOrigin = event.origin;
  if (ready) playMuted();
});
window.onYouTubeIframeAPIReady = () => {
  player = new YT.Player('yt', {
    videoId: STREAM_ID, width: '100%', height: '100%',
    playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, playsinline: 1, rel: 0, origin: location.origin },
    events: {
      onReady: () => { ready = true; player.mute(); player.setVolume(0); if (parentOrigin) playMuted(); },
      onStateChange: event => {
        player.mute(); player.setVolume(0);
        if (event.data === YT.PlayerState.PLAYING) notify('playing');
        else if (event.data === YT.PlayerState.BUFFERING) notify('buffering');
        else if (event.data === YT.PlayerState.ENDED || event.data === YT.PlayerState.PAUSED) notify('unavailable');
      },
      onError: () => notify('unavailable'),
      onAutoplayBlocked: () => notify('unavailable')
    }
  });
};
const script = document.createElement('script');
script.src = 'https://www.youtube.com/iframe_api';
script.onerror = () => notify('unavailable');
document.head.append(script);
