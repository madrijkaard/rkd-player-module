'use strict';
(() => {
  const $ = (selector) => document.querySelector(selector);
  const api = window.lumen;
  let library = [], settings = {}, current = null, selectedChannel = null, playerOrigin;
  let minimized = false, settingsQueue = Promise.resolve();
  let spaceBackground, radarBackground, cyberpunkBackground;
  let history = [], historyQueue = Promise.resolve(), watchedId = null, recordedSignature = '', historyChannelVideoId = null;
  let likePending = false;
  function updateLikeButton() {
    const entry = current && history.find(item => item.id === current.id);
    const button = $('#like-video');
    button.disabled = !entry || likePending;
    button.setAttribute('aria-pressed', String(entry?.liked === true));
    button.setAttribute('aria-label', entry?.liked ? 'Remover curtida' : 'Curtir vídeo');
    button.title = !entry ? 'Reproduza um vídeo para curtir' : entry.liked ? 'Curtido · Clique para remover a curtida' : 'Gostei deste vídeo';
  }
  function renderHistory() {
    const list = $('#history-list'), scroll = list.scrollTop;
    const fragment = document.createDocumentFragment();
    for (const item of history) {
      const row = create('li');
      const play = create('button', 'history-entry');
      play.type = 'button'; play.dataset.id = item.id;
      play.setAttribute('aria-label', `Assistir ${item.title}${item.liked ? ' · Curtido' : ''}`);
      play.addEventListener('click', () => {
        $('#history-dialog').close();
        playVideo({ ...item, author: 'YouTube' }, { fromHistory: true });
      });
      const thumbnail = create('span', 'history-thumbnail', '▷');
      thumbnail.setAttribute('aria-hidden', 'true');
      const img = create('img');
      img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => img.remove(), { once: true });
      img.src = item.thumbnail; thumbnail.append(img);
      const text = create('span', 'history-text');
      text.append(create('strong', '', item.title));
      if (item.liked) {
        const badge = create('span', 'history-liked');
        badge.append($('#like-video svg').cloneNode(true), document.createTextNode('Curtido'));
        text.append(badge);
      }
      play.append(thumbnail, text); row.append(play); fragment.append(row);
    }
    list.replaceChildren(fragment); list.scrollTop = scroll;
    $('#history-empty').hidden = history.length > 0;
    list.hidden = !history.length;
    updateLikeButton();
    updateRecommendationLikes();
  }
  function updateRecommendationLikes() {
    const likedIds = new Set(history.filter(item => item.liked).map(item => item.id));
    document.querySelectorAll('.recommendation-card').forEach(button => {
      const liked = likedIds.has(button.dataset.id);
      const title = button.querySelector('.recommendation-title').textContent;
      button.setAttribute('aria-label', `Assistir ${title}${liked ? ' · Curtido' : ''}`);
      const existing = button.querySelector('.recommendation-liked');
      if (!liked) { existing?.remove(); return; }
      if (existing) return;
      const badge = create('span', 'recommendation-liked');
      badge.title = 'Curtido anteriormente';
      badge.setAttribute('aria-hidden', 'true');
      badge.append($('#like-video svg').cloneNode(true));
      button.append(badge);
    });
  }
  function recordWatchedVideo() {
    if (!current || watchedId !== current.id) return;
    const video = { id: current.id, title: current.title };
    const signature = JSON.stringify(video);
    if (recordedSignature === signature) return;
    recordedSignature = signature;
    historyQueue = historyQueue.then(async () => {
      history = await api.recordHistory(video);
      renderHistory();
    }).catch(error => {
      if (recordedSignature === signature) recordedSignature = '';
      notice(`Não foi possível salvar o histórico: ${errorText(error)}`, true);
    });
  }
  let noticeTimer, opacityTimer;
  let recommendationsRequest = 0;
  const profileQueue = [], pendingProfiles = new Set();
  let activeProfiles = 0;
  const profileObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      profileObserver.unobserve(entry.target);
      const id = entry.target.dataset.id;
      if (!pendingProfiles.has(id)) { pendingProfiles.add(id); profileQueue.push(id); }
    }
    loadProfiles();
  });
  function renderAvatar(container, item) {
    container.replaceChildren(create('span', 'avatar-initial', [...item.title][0]?.toLocaleUpperCase('pt-BR') || '◎'));
    if (!item.avatar) return;
    const img = create('img');
    img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => img.remove(), { once: true });
    img.src = item.avatar;
    container.append(img);
  }
  function loadProfiles() {
    while (activeProfiles < 3 && profileQueue.length) {
      const id = profileQueue.shift();
      activeProfiles++;
      api.channelProfile(id).then(profile => {
        const item = library.find(channel => channel.id === id);
        if (!profile || !item) return;
        if (item.banner !== profile.banner) {
          item.banner = profile.banner;
          const card = $(`.video-card[data-id="${id}"]`);
          if (card) renderBanner(card, item);
        }
        if (item.avatar !== profile.avatar) {
          item.avatar = profile.avatar;
          const avatar = $(`.video-card[data-id="${id}"] .channel-avatar`);
          if (avatar) renderAvatar(avatar, item);
        }
        item.subscriberCount = profile.subscriberCount || '';
        item.profileLoaded = true;
        const count = $(`.video-card[data-id="${id}"] .subscriber-count`);
        if (count) count.textContent = subscriberLabel(item);
      }).catch(() => { /* Keep the initial or cached image when offline. */ })
        .finally(() => { activeProfiles--; pendingProfiles.delete(id); loadProfiles(); });
    }
  }
  function renderBanner(card, item) {
    card.querySelector('.channel-banner')?.remove();
    card.classList.remove('has-banner');
    if (!item.banner) return;
    const backdrop = create('div', 'channel-banner');
    backdrop.setAttribute('aria-hidden', 'true');
    const img = create('img');
    img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
    img.addEventListener('load', () => { if (backdrop.parentNode === card) card.classList.add('has-banner'); }, { once: true });
    img.addEventListener('error', () => { if (backdrop.parentNode === card) { backdrop.remove(); card.classList.remove('has-banner'); } }, { once: true });
    img.src = item.banner;
    backdrop.append(img); card.prepend(backdrop);
  }
  function subscriberLabel(item) {
    return item.subscriberCount || (item.profileLoaded || item.profileUpdatedAt ? 'Inscritos indisponíveis' : 'Carregando inscritos…');
  }
  const visualizer = new window.LumenVisualizer($('#audio-visualizer'), (state, message) => {
    $('#visualizer-status').textContent = message;
    $('#visualizer-retry').hidden = state !== 'error';
  });
  function notice(message, error = false, persistent = false) {
    clearTimeout(noticeTimer);
    $('#notice-text').textContent = message;
    $('#notice').classList.toggle('error', error);
    $('#notice').hidden = false;
    if (!persistent) noticeTimer = setTimeout(() => { $('#notice').hidden = true; }, 7000);
  }
  function persist(patch) {
    settings = { ...settings, ...patch };
    settingsQueue = settingsQueue.then(() => api.settings(patch)).catch((error) => notice(`Não foi possível salvar a preferência: ${error.message}`, true));
    return settingsQueue;
  }
  function errorText(error) { return error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
  function create(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function openAdd() {
    $('#form-error').textContent = '';
    $('#video-dialog').showModal();
    $('#video-url').focus();
  }
  function confirmAction(title, text, actionLabel) {
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    $('#confirm-accept').textContent = actionLabel;
    const dialog = $('#confirm-dialog');
    dialog.returnValue = 'cancel';
    dialog.showModal();
    return new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'accept'), { once: true }));
  }
  function renderLibrary() {
    profileObserver.disconnect();
    const container = $('#library');
    container.replaceChildren();
    $('#count').textContent = String(library.length);
    const search = $('#search').value.trim().toLocaleLowerCase('pt-BR');
    const filtered = library.filter((item) => `${item.title} ${item.url}`.toLocaleLowerCase('pt-BR').includes(search));
    $('#library-empty').hidden = library.length > 0;
    $('#no-results').hidden = !library.length || filtered.length > 0;
    $('#result-count').textContent = search ? String(filtered.length) : '';
    for (const item of filtered) {
      const card = create('article', `video-card${selectedChannel?.id === item.id ? ' active' : ''}`);
      card.dataset.id = item.id;
      renderBanner(card, item);
      const play = create('button', 'card-play');
      play.setAttribute('aria-label', `Selecionar canal ${item.title}`);
      play.title = item.title;
      const thumb = create('span', 'channel-avatar');
      thumb.setAttribute('aria-hidden', 'true');
      renderAvatar(thumb, item);
      const text = create('span', 'card-text');
      text.append(create('strong', '', item.title), create('small', 'subscriber-count', subscriberLabel(item)));
      play.append(thumb, text);
      play.addEventListener('click', () => selectChannel(item));
      const actions = create('div', 'card-actions');
      if (selectedChannel?.id === item.id) actions.append(create('span', 'playing', '● SELECIONADO'));
      const remove = create('button', 'remove');
      remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7"/></svg>';
      remove.title = `Remover ${item.title}`;
      remove.setAttribute('aria-label', `Remover ${item.title}`);
      remove.addEventListener('click', async () => {
        if (!await confirmAction('Remover da biblioteca?', `“${item.title}” será removido da sua lista de links salvos.`, 'Remover')) return;
        try { library = await api.removeChannel(item.id); if (selectedChannel?.id === item.id) { selectedChannel = null; if (!current) stopVideo(); loadRecommendations(); } renderLibrary(); notice('Canal removido da biblioteca.'); }
        catch (error) { notice(errorText(error), true); }
      });
      actions.append(remove); card.append(play, actions); container.append(card);
      profileObserver.observe(card);
    }
  }
  function updateCarouselArrows() {
    const track = $('#recommendations-track');
    $('#recommendations-prev').disabled = track.scrollLeft <= 1;
    $('#recommendations-next').disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 2;
  }
  function recommendationStatus(message, { loading = false, retry = false } = {}) {
    $('#recommendations-track').replaceChildren();
    $('#recommendations-status').textContent = message;
    $('#recommendations-status').hidden = false;
    $('#recommendations-retry').hidden = !retry;
    $('#recommendations').setAttribute('aria-busy', String(loading));
    $('#recommendations').title = '';
    updateCarouselArrows();
  }
  async function loadRecommendations({ refresh = false } = {}) {
    const request = ++recommendationsRequest;
    if (!selectedChannel && !historyChannelVideoId) { recommendationStatus('Selecione um canal na biblioteca para carregar os vídeos.'); return; }
    let id = selectedChannel?.id;
    recommendationStatus(historyChannelVideoId ? 'Buscando o canal do vídeo…' : `Buscando vídeos de ${selectedChannel.title}…`, { loading: true });
    try {
      if (historyChannelVideoId) {
        const channel = await api.historyChannel(historyChannelVideoId);
        if (request !== recommendationsRequest) return;
        selectedChannel = channel; historyChannelVideoId = null; id = channel.id;
        renderLibrary();
      }
      const result = await api.recommendations(id, { refresh, currentId: current?.id });
      if (request !== recommendationsRequest || selectedChannel?.id !== id) return;
      $('#recommendations').setAttribute('aria-busy', 'false');
      $('#recommendations').title = `Vídeos de ${result.channel.title}`;
      $('#recommendations').setAttribute('aria-label', `Outros vídeos de ${result.channel.title}`);
      if (!result.items.length) { recommendationStatus(result.total ? 'Nenhum outro vídeo disponível neste canal.' : 'Nenhum vídeo público encontrado neste canal.'); return; }
      $('#recommendations-status').hidden = true;
      const track = $('#recommendations-track');
      track.replaceChildren();
      for (const video of result.items) {
        const button = create('button', 'recommendation-card');
        button.dataset.id = video.id;
        button.dataset.channelId = video.channelId;
        button.title = `${video.title} — ${video.author}`;
        button.setAttribute('aria-label', `Assistir ${video.title}`);
        const img = create('img');
        img.src = video.thumbnail; img.alt = ''; img.loading = 'lazy';
        img.addEventListener('error', () => { img.hidden = true; button.classList.add('thumbnail-missing'); });
        button.append(img, create('span', 'recommendation-title', video.title));
        button.addEventListener('click', () => playVideo(video));
        track.append(button);
      }
      updateRecommendationLikes();
      track.scrollLeft = 0;
      requestAnimationFrame(updateCarouselArrows);
    } catch (error) {
      if (request !== recommendationsRequest || selectedChannel?.id !== id) return;
      recommendationStatus('Não foi possível carregar este canal.', { retry: true });
      $('#recommendations-status').title = errorText(error);
    }
  }
  function playerCommand(type, values = {}) {
    if (playerOrigin && current) $('#player').contentWindow?.postMessage({ source: 'lumen-app', type, ...values }, playerOrigin);
  }
  function selectChannel(item) {
    historyChannelVideoId = null;
    selectedChannel = item;
    if (!current) {
      $('#now-title').textContent = item.title;
      $('#now-author').textContent = 'Escolha um vídeo no carrossel acima para assistir.';
    }
    renderLibrary();
    setLibraryOpen(false);
    loadRecommendations();
  }
  function playVideo(item, { fromHistory = false } = {}) {
    cyberpunkBackground?.selectVideo();
    historyChannelVideoId = fromHistory ? item.id : null;
    if (fromHistory) selectedChannel = null;
    current = item;
    updateLikeButton();
    watchedId = null; recordedSignature = '';
    visualizer.start();
    $('#notice').hidden = true;
    $('#video-empty').hidden = true;
    $('#player').hidden = false;
    $('#now-title').textContent = item.title;
    $('#now-author').textContent = `${item.author} · YouTube`;
    $('#video-label').textContent = 'CONECTANDO / YOUTUBE';
    $('#stage').classList.add('has-video');
    // A fresh wrapper also lets the user retry a network/player failure by clicking again.
    $('#player').src = `${playerOrigin}/player.html?video=${item.id}&request=${Date.now()}`;
    renderLibrary();
    setLibraryOpen(false);
    loadRecommendations({ refresh: true });
  }
  function stopVideo() {
    historyChannelVideoId = null;
    playerCommand('stop');
    visualizer.stop();
    current = null;
    updateLikeButton();
    watchedId = null; recordedSignature = '';
    recommendationsRequest++;
    $('#player').removeAttribute('src');
    $('#player').hidden = true;
    $('#video-empty').hidden = false;
    $('#video-label').textContent = 'PLAYER / YOUTUBE';
    $('#now-title').textContent = 'Nenhum vídeo selecionado';
    $('#now-author').textContent = 'Selecione um canal na biblioteca.';
    $('#stage').classList.remove('has-video');
    renderLibrary();
  }
  function setLibraryOpen(open) {
    const dialog = $('#library-dialog');
    if (open && !dialog.open) { dialog.showModal(); $('#search').focus(); }
    else if (!open && dialog.open) dialog.close();
    $('#library-button').setAttribute('aria-expanded', String(open));
  }
  function updateMigration(data) {
    library = data.library;
    renderLibrary();
    $('#migration-info').hidden = !data.pending;
    $('#migration-text').textContent = data.migrating ? `Convertendo ${data.pending} link(s) antigo(s) em canais…` : `${data.pending} link(s) antigo(s) preservado(s). Não foi possível identificar seus canais.`;
    $('#migration-retry').hidden = data.migrating || !data.pending;
  }
  $('#migration-retry').addEventListener('click', async () => {
    try { updateMigration(await api.migrateLibrary()); } catch (error) { notice(errorText(error), true); }
  });
  async function init() {
    const data = await api.init();
    library = data.library; settings = data.settings; playerOrigin = data.playerOrigin;
    history = data.history || []; renderHistory();
    minimized = data.minimized;
    spaceBackground = new window.LumenSpaceBackground($('#space-background'), $('#space-status'), playerOrigin);
    radarBackground = new window.LumenRadarBackground($('#radar-background'), api);
    cyberpunkBackground = new window.LumenCyberpunkBackground($('#cyberpunk-background'), history);
    applyTheme(settings.theme);
    applyVideoTint(settings.videoTint);
    minimized = data.minimized;
    $('#visualizer-enabled').checked = settings.visualizerEnabled;
    document.querySelector(`input[name="visualizer-style"][value="${settings.visualizerStyle}"]`).checked = true;
    visualizer.configure(settings.visualizerEnabled, settings.visualizerStyle);
    visualizer.setVisible(!minimized);
    $('#keep-playing').checked = settings.keepPlayingMinimized;
    $('#transparency').value = settings.transparency;
    $('#transparency-value').textContent = `${settings.transparency}%`;
    setLibraryOpen(false);
    renderLibrary();
    api.onVisibility((visible) => { minimized = !visible; visualizer.setVisible(visible); spaceBackground.configure(settings.theme, minimized); radarBackground.configure(settings.theme, minimized); if (minimized && !settings.keepPlayingMinimized) playerCommand('pause'); });
    if (data.warning) notice(data.warning, true, true);
    api.onLibraryUpdate(updateMigration);
    updateMigration(await api.migrateLibrary());
    document.body.dataset.ready = 'true';
  }
  document.querySelectorAll('[data-window]').forEach((button) => button.addEventListener('click', () => api.window(button.dataset.window)));
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => $(`#${button.dataset.close}`).close('cancel')));
  $('#library-button').addEventListener('click', () => setLibraryOpen(true));
  $('#history-button').addEventListener('click', () => {
    renderHistory(); $('#history-dialog').showModal(); $('#history-button').setAttribute('aria-expanded', 'true');
  });
  $('#history-dialog').addEventListener('close', () => $('#history-button').setAttribute('aria-expanded', 'false'));
  $('#library-dialog').addEventListener('close', () => $('#library-button').setAttribute('aria-expanded', 'false'));
  $('#stage-add').addEventListener('click', () => setLibraryOpen(true));
  for (const id of ['add-video', 'first-video']) $(`#${id}`).addEventListener('click', openAdd);
  $('#like-video').addEventListener('click', () => {
    const entry = current && history.find(item => item.id === current.id);
    if (!entry || likePending) return;
    const id = entry.id, liked = !entry.liked;
    likePending = true; updateLikeButton();
    historyQueue = historyQueue.then(async () => {
      history = await api.likeHistory(id, liked);
      renderHistory();
    }).catch(error => notice(`Não foi possível salvar a curtida: ${errorText(error)}`, true))
      .finally(() => { likePending = false; updateLikeButton(); });
  });
  $('#confirm-accept').addEventListener('click', () => $('#confirm-dialog').close('accept'));
  $('#confirm-cancel').addEventListener('click', () => $('#confirm-dialog').close('cancel'));
  $('#notice-close').addEventListener('click', () => { $('#notice').hidden = true; });
  $('#search').addEventListener('input', renderLibrary);
  $('#settings-button').addEventListener('click', () => $('#settings-dialog').showModal());
  function applyTheme(theme) {
    cyberpunkBackground?.configure(theme);
    spaceBackground?.configure(theme, minimized);
    if (theme !== 'military' || settings.theme === theme) radarBackground?.configure(theme, minimized);
    document.documentElement.dataset.theme = theme;
    $('#theme').value = theme;
    visualizer.refreshColors();
  }
  const themePresets = {
    military: { videoTint: 'yellow', visualizerStyle: 'wave', transparency: 0 },
    space: { videoTint: 'blue', visualizerStyle: 'aurora', transparency: 8 },
    cyberpunk: { videoTint: 'pink', visualizerStyle: 'matrix', transparency: 8 }
  };
  $('#theme').addEventListener('change', () => {
    const theme = $('#theme').value, preset = themePresets[theme];
    // A pending slider update must not overwrite the newly selected preset.
    clearTimeout(opacityTimer);
    applyTheme(theme);
    if (preset) {
      applyVideoTint(preset.videoTint);
      document.querySelector(`input[name="visualizer-style"][value="${preset.visualizerStyle}"]`).checked = true;
      visualizer.configure(settings.visualizerEnabled, preset.visualizerStyle);
      if (current && settings.visualizerEnabled) visualizer.start();
      $('#transparency').value = preset.transparency;
      $('#transparency-value').textContent = `${preset.transparency}%`;
    }
    persist({ theme, ...preset }).then(() => radarBackground?.configure(settings.theme, minimized));
  });
  function applyVideoTint(color) {
    $('#video-tint').dataset.color = color;
    $('#video-tint-color').value = color;
  }
  $('#video-tint-color').addEventListener('change', () => {
    const videoTint = $('#video-tint-color').value;
    applyVideoTint(videoTint);
    persist({ videoTint });
  });
  function updateVisualizer() {
    const visualizerEnabled = $('#visualizer-enabled').checked;
    const visualizerStyle = document.querySelector('input[name="visualizer-style"]:checked').value;
    visualizer.configure(visualizerEnabled, visualizerStyle);
    if (current && visualizerEnabled) visualizer.start();
    persist({ visualizerEnabled, visualizerStyle });
  }
  $('#visualizer-enabled').addEventListener('change', updateVisualizer);
  document.querySelectorAll('input[name="visualizer-style"]').forEach(input => input.addEventListener('change', updateVisualizer));
  $('#visualizer-retry').addEventListener('click', () => { if (current) visualizer.start(); else notice('Selecione um vídeo do carrossel para ativar o visualizador.'); });
  $('#recommendations-retry').addEventListener('click', loadRecommendations);
  function scrollRecommendations(direction) {
    const track = $('#recommendations-track');
    track.scrollBy({ left: direction * Math.max(120, track.clientWidth * .8), behavior: 'smooth' });
  }
  $('#recommendations-prev').addEventListener('click', () => scrollRecommendations(-1));
  $('#recommendations-next').addEventListener('click', () => scrollRecommendations(1));
  $('#recommendations-track').addEventListener('scroll', updateCarouselArrows);
  $('#recommendations').addEventListener('wheel', (event) => {
    const track = $('#recommendations-track');
    if (event.ctrlKey || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY) || track.scrollWidth <= track.clientWidth) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? track.clientWidth : 1;
    track.scrollBy({ left: event.deltaY * unit, behavior: 'instant' });
  }, { passive: false });
  $('#recommendations-track').addEventListener('keydown', (event) => {
    if (event.target.id === 'recommendations-track' && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault(); scrollRecommendations(event.key === 'ArrowRight' ? 1 : -1);
    }
  });
  new ResizeObserver(updateCarouselArrows).observe($('#recommendations-track'));
  $('#keep-playing').addEventListener('change', () => {
    persist({ keepPlayingMinimized: $('#keep-playing').checked });
    if (minimized && !settings.keepPlayingMinimized) playerCommand('pause');
  });
  $('#transparency').addEventListener('input', (event) => { const value = Number(event.target.value); $('#transparency-value').textContent = `${value}%`; clearTimeout(opacityTimer); opacityTimer = setTimeout(() => persist({ transparency: value }), 60); });
  $('#transparency').addEventListener('change', () => { clearTimeout(opacityTimer); persist({ transparency: Number($('#transparency').value) }); });
  $('#reset-opacity').addEventListener('click', () => { clearTimeout(opacityTimer); $('#transparency').value = 0; $('#transparency-value').textContent = '0%'; persist({ transparency: 0 }); });
  $('#player').addEventListener('load', () => { if (current) { playerCommand('hello'); playerCommand('load', { id: current.id, autoplay: !minimized || settings.keepPlayingMinimized }); } });
  $('#video-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if ($('#save-video').disabled) return;
    $('#save-video').disabled = true; $('#save-video').textContent = 'Salvando…'; $('#form-error').textContent = '';
    try {
      library = await api.addChannel($('#video-url').value);
      $('#video-dialog').close(); $('#video-form').reset(); $('#search').value = ''; renderLibrary(); setLibraryOpen(true); notice('Canal salvo. Selecione-o na biblioteca para carregar os vídeos.');
    } catch (error) { $('#form-error').textContent = errorText(error); }
    finally { $('#save-video').disabled = false; $('#save-video').textContent = 'Salvar na biblioteca ↗'; }
  });
  window.addEventListener('message', (event) => {
    if (event.origin !== playerOrigin || event.source !== $('#player').contentWindow || event.data?.source !== 'lumen-player' || !current) return;
    if (event.data.session !== new URL($('#player').src).search) return;
    if (event.data.type === 'video') {
      const video = event.data.value;
      if (video && typeof video.id === 'string' && /^[\w-]{11}$/.test(video.id)) {
        if (video.id !== current.id) { watchedId = null; recordedSignature = ''; }
        current = { ...current, id: video.id, title: String(video.title || current.title || 'Vídeo do YouTube').slice(0, 180), author: String(video.author || current.author || 'YouTube').slice(0, 100), url: `https://www.youtube.com/watch?v=${video.id}` };
        updateLikeButton();
        $('#now-title').textContent = current.title;
        $('#now-author').textContent = `${current.author} · YouTube`;
        renderLibrary();
        recordWatchedVideo();
      }
    }
    if (event.data.type === 'state') {
      if (event.data.value === 1) { watchedId = current.id; recordWatchedVideo(); cyberpunkBackground?.rememberVideo(current.id); }
      if (event.data.value === 1 && minimized && !settings.keepPlayingMinimized) playerCommand('pause');
      const label = ({ 0: 'FINALIZADO / YOUTUBE', 1: 'REPRODUZINDO / YOUTUBE', 2: 'PAUSADO / YOUTUBE', 3: 'CARREGANDO / YOUTUBE', 5: 'PRONTO / YOUTUBE' })[event.data.value];
      if (label) $('#video-label').textContent = label;
    }
    if (event.data.type === 'error' && typeof event.data.value === 'string') { $('#video-label').textContent = 'INDISPONÍVEL / YOUTUBE'; notice(event.data.value.slice(0, 400), true, true); }
    if (event.data.type === 'blocked') { notice('Clique em Play no player do YouTube para iniciar o vídeo.', false, true); }
  });
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.key.toLowerCase() === 'k') { event.preventDefault(); if (!document.querySelector('dialog[open]:not(#library-dialog)')) openAdd(); }
  });
  init().catch((error) => notice(`Não foi possível iniciar o aplicativo: ${errorText(error)}`, true, true));
})();
