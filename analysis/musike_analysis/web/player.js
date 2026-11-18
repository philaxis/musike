/* Musike 다리(음악 지도): 지도는 Musike 「음악 지도」 화면(/library/map)의 같은 origin iframe 안에서 돈다.
   재생·메뉴·재생목록은 Musike 쪽 것만 쓴다. 지도는 곡 번호만 window.parent 로 보낸다({musikeMap: 1, type, …}).
   보내는 것: ready(첫 화면을 그렸다) · radio{id}(그 곡부터 닮은 곡 라디오) · play{ids, start}(목록을 start 번째부터) · menu{ids, x, y, title}(곡 메뉴) ·
   toggle · next · prev (지도 자료를 못 읽으면 지도 페이지가 직접 failed). 받는 것: player{id, state} · theme{theme} · favorites{ids}(Musike ♥) ·
   visible{on}(Musike 가 지도 화면을 떠나면 지도는 숨긴 채 살아 있다).
   지도 템플릿에는 예전 미니 플레이어와 같은 모양으로 window.musicPlayer(재생), window.musicUser(♥)를 준다.
   이벤트로 알리는 것: playerstate({i, state}) · songmarks(♥ 점 번호) · musiketheme(테마) · musikevisible(보이는지, 숨으면 그리기를 멈춘다). */
(() => {
  const P = window.P || [];
  const parent = window.parent !== window ? window.parent : null;
  const pointOf = new Map();
  P.forEach((p, i) => { if (p.id && !pointOf.has(p.id)) pointOf.set(p.id, i); });
  const send = (type, extra = {}) => { if (parent) parent.postMessage({ musikeMap: 1, type, ...extra }, location.origin); };

  let curId = null, state = 'idle';
  let favs = new Set();
  const cur = () => (curId != null && pointOf.has(curId) ? pointOf.get(curId) : -1);

  /** 화면 안 좌표(iframe 기준) → Musike 가 바깥 좌표로 옮긴다. ids 가 여럿이면 묶음 메뉴. */
  function menu(ids, x, y, title = '') {
    const list = [...new Set((ids || []).filter(Boolean))];
    if (list.length) send('menu', { ids: list, x: Math.round(x), y: Math.round(y), title });
  }
  /** 목록을 start 번째 곡부터 재생(같은 곡이 두 번이면 처음 것만). */
  function playIds(ids, start = 0) {
    const first = ids[start];
    const list = [...new Set(ids.filter(Boolean))];
    if (list.length) send('play', { ids: list, start: Math.max(0, list.indexOf(first)) });
  }
  window.musike = { menu, play: playIds, embedded: !!parent };

  window.musicPlayer = {
    /** 점 번호 i 의 곡부터 닮은 곡 라디오(대기열 포함). */
    play: i => { if (P[i] && P[i].id) send('radio', { id: P[i].id }); },
    toggle: () => send('toggle'),
    next: () => send('next'),
    prev: () => send('prev'),
    current: cur,
    state: () => state,
    playing: i => i >= 0 && cur() === i && (state === 'playing' || state === 'loading'),
  };

  // 지도의 ♥ = Musike 즐겨찾기(지도 자체 기록은 없다). 바꾸기는 곡 메뉴(⋯)에서.
  window.musicUser = {
    fav: id => favs.has(id),
    favPoints: () => [...favs].map(id => (pointOf.has(id) ? pointOf.get(id) : -1)).filter(i => i >= 0),
  };

  addEventListener('message', e => {
    if (!parent || e.source !== parent || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.musikeMap !== 1) return;
    if (d.type === 'player') {
      curId = typeof d.id === 'string' ? d.id : null;
      state = typeof d.state === 'string' ? d.state : 'idle';
      dispatchEvent(new CustomEvent('playerstate', { detail: { i: cur(), state } }));
    } else if (d.type === 'theme' && (d.theme === 'light' || d.theme === 'dark')) {
      dispatchEvent(new CustomEvent('musiketheme', { detail: d.theme }));
    } else if (d.type === 'favorites' && Array.isArray(d.ids)) {
      favs = new Set(d.ids.filter(x => typeof x === 'string'));
      dispatchEvent(new CustomEvent('songmarks', { detail: window.musicUser.favPoints() }));
    } else if (d.type === 'visible') {
      dispatchEvent(new CustomEvent('musikevisible', { detail: !!d.on }));
    }
  });

  // Space = 재생/일시정지, N = 다음 곡 (입력창·버튼 포커스에선 무시). 지도에 포커스가 있으면 Musike 단축키가 안 닿으므로 여기서.
  addEventListener('keydown', e => {
    const t = e.target;
    if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (e.key === ' ' && !(t && t.tagName === 'BUTTON')) { e.preventDefault(); send('toggle'); }
    else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); send('next'); }
  });

  addEventListener('mapready', () => send('ready'));
})();
