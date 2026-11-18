/* 미니 플레이어(음악 지도): 정보 패널 밖에 늘 있는 재생 바. 패널을 닫아도 소리는 이어지고 정지(✕)로만 멈춘다.
   YouTube IFrame Player API(youtube-nocookie, enablejsapi=1)로 상태를 받아 곡이 끝나면 연속 재생한다.
   지도와는 이벤트로만 주고받는다. 보내는 것: songplay(점 번호, user.js 가 '최근 들은 곡'에 쓴다)·playerstate({i, state}).
   지도는 window.select(i, fly) 와 window.P 만 준다. */
(() => {
  // ---------------------------------------------------------------- 다음 곡(순수 함수)
  // 지금 곡의 소리 이웃(an) 중 이번에 안 들은 것 → 설명 이웃(nn) 중 안 들은 것 → 둘 다 다 들었으면 소리·설명 첫 이웃.
  // points 를 주면 제목이 같은 곡(같은 곡의 다른 업로드)은 건너뛴다.
  const titleKey = q => String((q && q.t) || '').toLowerCase().replace(/\s*[([].*?[)\]]\s*/g, ' ').replace(/[^\p{L}\p{N}]+/gu, '');
  function nextSong(p, played, self = -1, points = null) {
    const same = points && p ? titleKey(p) : '';
    const order = [...((p && p.an) || []), ...((p && p.nn) || [])].filter(j => Number.isInteger(j) && j >= 0 && j !== self
      && !(same && points[j] && titleKey(points[j]) === same));
    const fresh = order.find(j => !played.has(j));
    if (fresh != null) return fresh;
    return order.length ? order[0] : -1;
  }
  const api = { nextSong };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window === 'undefined') return;

  const P = window.P || [];
  const bar = document.getElementById('mini');
  if (!bar) return;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const AUTO_KEY = 'musicmap-autoplay';
  const ICON = {
    prev: '<path d="M7 6v12M18 6l-8 6 8 6V6Z"/>',
    next: '<path d="M17 6v12M6 6l8 6-8 6V6Z"/>',
    play: '<path d="M8 5.5v13l10.5-6.5L8 5.5Z" fill="currentColor"/>',
    pause: '<path d="M8.5 6v12M15.5 6v12" stroke-width="2.6"/>',
    auto: '<path d="M4 12a8 8 0 0 1 13.7-5.6M20 12a8 8 0 0 1-13.7 5.6"/><path d="M18 3v4h-4M6 21v-4h4"/>',
    stop: '<path d="M6 6l12 12M18 6 6 18"/>',
  };
  const svg = k => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;
  bar.innerHTML = `<div class="mv"><div id="mini-video"></div></div>`
    + `<button class="mt" type="button" title="이 곡으로 가기"><b></b><small></small></button>`
    + `<div class="mc">`
    + `<button type="button" data-m="prev" title="이전 곡" aria-label="이전 곡">${svg('prev')}</button>`
    + `<button type="button" data-m="toggle" class="pp" title="재생/일시정지 (Space)" aria-label="재생/일시정지">${svg('pause')}</button>`
    + `<button type="button" data-m="next" title="다음 곡 (N) — 소리 이웃 중 안 들은 곡" aria-label="다음 곡">${svg('next')}</button>`
    + `<button type="button" data-m="auto" aria-label="연속 재생">${svg('auto')}</button>`
    + `<button type="button" data-m="stop" title="정지·닫기" aria-label="정지">${svg('stop')}</button>`
    + `</div>`;

  let auto = true;
  try { auto = localStorage.getItem(AUTO_KEY) !== '0'; } catch (_) { /* 저장 불가 */ }
  let cur = -1, state = 'idle', note = '';  // idle | loading | playing | paused | ended | error
  const played = new Set(), back = [];      // 이번에 들은 곡 · 이전 곡 스택
  let yt = null, ytReady = null, fallback = false, skipT = 0;

  // IFrame API 는 미리 받아 둔다(누른 순간 바로 플레이어를 만들어야 폰에서 자동 재생이 막히지 않는다)
  function loadAPI() {
    if (ytReady) return ytReady;
    ytReady = new Promise((resolve, reject) => {
      if (window.YT && window.YT.Player) { resolve(window.YT); return; }
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { try { if (prev) prev(); } catch (_) { /* 다른 스크립트 */ } resolve(window.YT); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.onerror = () => reject(new Error('YouTube IFrame API 를 받지 못했습니다'));
      document.head.appendChild(s);
      setTimeout(() => reject(new Error('YouTube IFrame API 시간 초과')), 15000);
    });
    ytReady.catch(err => { console.warn(err); fallback = true; });
    return ytReady;
  }

  function emit() {
    window.dispatchEvent(new CustomEvent('playerstate', { detail: { i: cur, state } }));
    document.body.classList.toggle('playing', cur >= 0);
  }
  function render() {
    if (cur < 0) { bar.hidden = true; return; }
    const p = P[cur] || {};
    bar.hidden = false;
    bar.querySelector('.mt b').textContent = p.t || '제목 없음';
    bar.querySelector('.mt small').innerHTML = note ? `<em>${esc(note)}</em>` : esc(p.a || '아티스트 미상');
    const tg = bar.querySelector('[data-m="toggle"]');
    const on = state === 'playing' || state === 'loading';
    tg.innerHTML = svg(on ? 'pause' : 'play');
    tg.title = on ? '일시정지 (Space)' : '재생 (Space)';
    tg.disabled = fallback;
    const au = bar.querySelector('[data-m="auto"]');
    au.classList.toggle('on', auto);
    au.title = `연속 재생 ${auto ? '켬' : '끔'} — 끝나면 소리 이웃으로`;
    au.setAttribute('aria-pressed', String(auto));
    bar.querySelector('[data-m="prev"]').disabled = !back.length;
  }
  function setState(s, msg = '') {
    state = s; note = msg;
    render(); emit();
  }

  function onState(e) {
    const S = window.YT && window.YT.PlayerState;
    if (!S) return;
    if (e.data === S.PLAYING) { fails = 0; setState('playing'); }
    else if (e.data === S.PAUSED) setState('paused');
    else if (e.data === S.BUFFERING) setState('loading');
    else if (e.data === S.ENDED) { setState('ended'); if (auto) next(); }
  }
  // 퍼가기 금지·삭제된 영상(100·101·150)만 연속 재생에서 건너뛴다. 연달아 3번 실패하면(네트워크·브라우저 문제) 멈춘다.
  let fails = 0;
  function onError(e) {
    // 유튜브는 IP 주소(127.0.0.1·100.x)로 연 페이지의 퍼가기를 모두 150 으로 막는다: 그땐 건너뛰지 말고 주소를 바꾸라고 알린다
    const ipHost = /^(\d+\.){3}\d+$|^\[/.test(location.hostname);
    if (ipHost) { clearTimeout(skipT); setState('error', 'IP 주소로 연 페이지는 유튜브가 막아요 · ts.net 주소로 열어 주세요'); return; }
    const skip = auto && [100, 101, 150].includes(e && e.data) && ++fails < 3;
    setState('error', skip ? '재생할 수 없는 영상 · 곧 다음 곡' : '재생할 수 없는 영상 · 유튜브에서 열어 보세요');
    clearTimeout(skipT);
    if (skip) skipT = setTimeout(() => { if (state === 'error') next(); }, 1800);
  }
  function plainFrame(id) {  // API 없이: 자동 재생 iframe 만(상태·연속 재생 없음)
    bar.querySelector('.mv').innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0&playsinline=1" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" title="유튜브 플레이어"></iframe>`;
  }
  function start(id) {
    if (fallback || !(window.YT && window.YT.Player)) {
      if (fallback) { plainFrame(id); setState('playing'); return; }
      loadAPI().then(() => { if (P[cur] && P[cur].id === id) start(id); }, () => { if (P[cur] && P[cur].id === id) { plainFrame(id); setState('playing'); } });
      return;
    }
    if (yt && yt.loadVideoById) { yt.loadVideoById(id); return; }
    const box = bar.querySelector('.mv');
    box.innerHTML = '<div id="mini-video"></div>';
    yt = new window.YT.Player('mini-video', {
      host: 'https://www.youtube-nocookie.com',
      videoId: id,
      width: '100%', height: '100%',
      playerVars: { autoplay: 1, rel: 0, playsinline: 1, enablejsapi: 1, origin: location.origin },
      events: { onReady: e => { try { e.target.playVideo(); } catch (_) { /* 자동 재생 막힘 */ } }, onStateChange: onState, onError },
    });
  }

  function play(i, opts = {}) {
    if (!Number.isInteger(i) || !P[i] || !P[i].id) return;
    clearTimeout(skipT);
    if (cur === i && yt && state !== 'error') { toggle(true); return; }
    if (cur >= 0 && cur !== i && opts.record !== false) back.push(cur);
    if (back.length > 50) back.splice(0, back.length - 50);
    cur = i;
    played.add(i);
    setState('loading');
    start(P[i].id);
    window.dispatchEvent(new CustomEvent('songplay', { detail: i }));
  }
  function toggle(forcePlay = false) {
    if (cur < 0 || !yt || !yt.getPlayerState) return;
    if (!forcePlay && (state === 'playing' || state === 'loading')) yt.pauseVideo();
    else yt.playVideo();
  }
  function next() {
    if (cur < 0) return;
    const j = nextSong(P[cur], played, cur, P);
    if (j >= 0) play(j);
  }
  function prev() {
    if (back.length) play(back.pop(), { record: false });
    else if (yt && yt.seekTo) yt.seekTo(0, true);
  }
  function stop() {
    clearTimeout(skipT);
    try { if (yt && yt.destroy) yt.destroy(); } catch (_) { /* 이미 없음 */ }
    yt = null;
    bar.querySelector('.mv').innerHTML = '<div id="mini-video"></div>';
    cur = -1;
    setState('idle');
  }
  function setAuto(on) {
    auto = !!on;
    try { localStorage.setItem(AUTO_KEY, auto ? '1' : '0'); } catch (_) { /* 저장 불가 */ }
    render(); emit();
  }

  window.musicPlayer = {
    play, toggle: () => toggle(), next, prev, stop, setAuto,
    current: () => cur, state: () => state, auto: () => auto,
    seek: sec => { if (yt && yt.seekTo) yt.seekTo(sec, true); },
    duration: () => (yt && yt.getDuration ? yt.getDuration() : 0),
    playing: i => cur === i && (state === 'playing' || state === 'loading'),
  };

  bar.addEventListener('click', e => {
    const b = e.target.closest('[data-m]');
    if (b) {
      const m = b.dataset.m;
      if (m === 'toggle') toggle();
      else if (m === 'next') next();
      else if (m === 'prev') prev();
      else if (m === 'auto') setAuto(!auto);
      else if (m === 'stop') stop();
      return;
    }
    if (e.target.closest('.mt') && cur >= 0 && typeof window.select === 'function') window.select(cur, true);
  });
  // Space = 재생/일시정지, N = 다음 곡 (입력창·버튼 포커스에선 무시)
  addEventListener('keydown', e => {
    const t = e.target;
    if (cur < 0 || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.key === ' ' && !(t && t.tagName === 'BUTTON')) { e.preventDefault(); toggle(); }
    else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); next(); }
  });
  const warm = () => { loadAPI().catch(() => {}); };
  if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 3000 }); else setTimeout(warm, 1500);
  render();
})();
