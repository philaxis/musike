/* 자연어 검색(음악 지도): 키워드 즉시 + 브라우저 무료 임베딩(transformers.js, multilingual-e5-small q8).
   곡 벡터는 vectors_e5.bin(int8)·search_meta.json. 결과 패널·최근 검색·접기/펼치기는 서재 지도 search.js 와 같다.
   결과는 musicsearch 이벤트(점 번호 목록/null)로 지도에 알린다. '소리로 찾음' 구간은 soundsearch.js(window.soundSearch)가 있을 때만. */
(() => {
  // ---------------------------------------------------------------- 순위 계산(순수 함수)
  // 비교용 정규화: 대소문자·공백·구두점·기호를 무시한다(한국어 제목도 공백 무시로 비교).
  function normText(s) {
    return String(s == null ? '' : s)
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\p{P}\p{S}\s]+/gu, '');
  }
  // 제목·아티스트 일치 단계: 3 = 정확 일치, 2 = 검색어로 시작, 1 = 검색어 전체가 연속 포함, 0 = 없음
  function matchTier(text, normQuery) {
    if (!text || !normQuery) return 0;
    const t = normText(text);
    if (!t) return 0;
    if (t === normQuery) return 3;
    if (t.startsWith(normQuery)) return 2;
    if (t.includes(normQuery)) return 1;
    return 0;
  }
  const TITLE_BONUS = [0, 0.35, 0.55, 1.0];
  const ARTIST_BONUS = [0, 0.25, 0.4, 0.7];
  const BONUS_MIN = 2;  // 한 글자 검색어가 모든 곡에 가산되는 것 방지
  function matchBonus(it, normQuery) {
    if (!normQuery || normQuery.length < BONUS_MIN) return 0;
    return TITLE_BONUS[matchTier(it.title, normQuery)] + ARTIST_BONUS[matchTier(it.artist, normQuery)];
  }
  function termsOf(q) { return q.trim().toLowerCase().split(/\s+/).filter(Boolean); }
  function kwScore(it, terms) {
    if (!terms.length) return 0;
    const fields = [
      [it.title, 3], [it.artist, 3], [it.composer, 2], [it.work, 2],
      [it.genre, 2], [it.subgenre, 2], [it.era, 1], [it.moods, 1],
      [(it.playlists || []).join(' '), 1], [it.summary, 1],
    ].map(([txt, w]) => [txt ? String(txt).toLowerCase() : '', w]);
    let sum = 0;
    for (const t of terms) {
      let best = 0;
      for (const [txt, w] of fields) if (txt && txt.includes(t)) best = Math.max(best, w);
      sum += best;
    }
    return sum / terms.length;
  }
  // items(검색 메타의 곡 목록)와 선택적 의미 점수(sem = {cos, lo, hi})로 순위를 매긴다.
  function rankItems(items, query, sem) {
    const terms = termsOf(query);
    const nq = normText(query);
    const rows = [];
    items.forEach((it, i) => {
      const kw = kwScore(it, terms);
      const bonus = matchBonus(it, nq);
      const kn = Math.min(1, kw / 2.2);
      let score = kn;
      let semantic = null;
      if (sem) {
        semantic = (sem.cos[i] - sem.lo) / Math.max(1e-9, sem.hi - sem.lo);
        score = 0.36 * kn + 0.64 * semantic;
      }
      score += bonus;
      if (kw > 0 || sem) rows.push({ it, i, score, kw, semantic, bonus });
    });
    rows.sort((a, b) => b.score - a.score || b.kw - a.kw);
    return rows;
  }
  // 화면(=키보드) 순서: 글자로 찾은 곡 상위 head 개 → 소리로 찾음 구간 → 나머지. 소리 구간이 긴 목록 아래에 묻히지 않게.
  const TEXT_BEFORE_SOUND = 5;
  function mixRows(textRows, soundRows, head = TEXT_BEFORE_SOUND) {
    const seen = new Set(textRows.slice(0, head).map(r => r.it.point));
    const snd = soundRows.filter(r => !seen.has(r.it.point));
    return textRows.slice(0, head).concat(snd, textRows.slice(head));
  }
  // soundSearch(soundsearch.js) 결과 → 행. [{videoId, score, concepts:[개념 한국어 이름]}].
  // 구간 이름은 결과에 가장 많이 나온 개념 두 개('소리로 찾음 · 몽환적인 신스 · 느린 템포').
  function soundHits(res, pointOf) {
    const hits = [];
    const freq = new Map();
    for (const h of Array.isArray(res) ? res : []) {
      if (!h) continue;
      const point = pointOf(h.videoId);
      if (!(point >= 0)) continue;
      const why = (h.concepts || []).filter(Boolean).map(String).slice(0, 3);
      why.forEach(c => freq.set(c, (freq.get(c) || 0) + 1));
      hits.push({ point, score: +h.score || 0, why });
    }
    const concept = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(x => x[0]).join(' · ');
    return { concept, hits };
  }
  // 개념이 안 맞을 때: 글자 결과 상위 곡의 소리 이웃(expandByAudio, RRF) 중 글자로는 안 찾힌 곡
  function audioOnly(expanded, pointOf, anchorOf) {
    return (expanded || []).filter(h => h.audio && !h.text).map(h => ({ point: pointOf(h.videoId), score: h.score, why: anchorOf(h.videoId) }))
      .filter(h => h.point >= 0);
  }
  // 검색 자료의 point 번호는 websearch build 때 지도 순서라 지도만 다시 지으면 어긋난다 → 영상 ID 로 지금 지도의 점 번호를 다시 붙인다.
  // 지도에 없는 곡은 -1(결과에서 뺀다). 돌려주는 것: 점 번호 → 항목.
  function relink(items, pointOf) {
    for (const it of items) it.point = pointOf(it.videoId);
    return new Map(items.filter(it => it.point >= 0).map(it => [it.point, it]));
  }
  // Node 테스트용 export(브라우저에서는 window/DOM 경로로 이어간다)
  const rankAPI = { normText, matchTier, matchBonus, termsOf, kwScore, rankItems, mixRows, soundHits, audioOnly, relink };
  if (typeof module !== 'undefined' && module.exports) module.exports = rankAPI;
  if (typeof window === 'undefined') { globalThis.__musicSearchRankAPI = rankAPI; return; }

  // ---------------------------------------------------------------- 저장소
  // 지도 페이지의 화면 상태(탐색 기록 등) 저장 접근은 이 객체 하나로 모은다(localStorage, 안 되면 메모리).
  window.store = window.store || (() => {
    const mem = new Map(), subs = new Map();
    let ls = null;
    try { ls = window.localStorage; const k = '__musicmap_probe__'; ls.setItem(k, '1'); ls.removeItem(k); } catch (_) { ls = null; }
    const read = key => {
      try {
        const raw = ls ? ls.getItem(key) : (mem.has(key) ? mem.get(key) : null);
        return raw == null ? undefined : JSON.parse(raw);
      } catch (_) { return undefined; }
    };
    const emit = (type, detail) => {
      for (const fn of (subs.get(type) || []).slice()) { try { fn(detail); } catch (_) { /* 구독자 오류는 삼킨다 */ } }
    };
    return {
      get(key, fallback = null) { const v = read(key); return v === undefined ? fallback : v; },
      set(key, value) {
        try {
          const raw = JSON.stringify(value);
          if (ls) ls.setItem(key, raw); else mem.set(key, raw);
        } catch (_) { /* 저장 불가(사생활 모드 등) */ }
        emit(key, value);
        emit('change', { key, value });
        return value;
      },
      on(type, fn) { if (!subs.has(type)) subs.set(type, []); subs.get(type).push(fn); },
      off(type, fn) { const a = subs.get(type); if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } },
    };
  })();
  const store = window.store;

  const MODEL = 'Xenova/multilingual-e5-small';
  const CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';
  const qEl = document.getElementById('q');
  const box = document.getElementById('results');
  if (!qEl || !box) return;
  const P = window.P || [];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const ACT = '<span class="ract"><button type="button" data-rp title="여기부터 재생(결과 목록을 Musike 대기열로)" aria-label="여기부터 재생">▶</button>'
    + '<button type="button" data-rm title="다음에 재생 · 대기열에 추가 · 재생목록에 추가 …" aria-label="곡 메뉴">⋯</button></span>';
  const TO_MUSIKE = 100;  // 결과에서 Musike 로 넘기는 곡 수(재생·대기열·재생목록)
  const rowIds = rows => rows.map(r => (P[r.it.point] || {}).id).filter(Boolean);
  const pointIdx = new Map(P.map((p, i) => [p.id, i]));
  const pointOf = id => pointIdx.has(id) ? pointIdx.get(id) : -1;

  let meta = null;
  let byPoint = null;     // 점 번호 → 검색 메타 항목
  let vectors = null;
  let norms = null;
  let modelPromise = null;
  let loadNote = '';
  let timer = 0;
  let seq = 0;
  let semCache = { q: '', cos: null, lo: 0, hi: 0 };
  let sound = { q: '', concept: '', hits: [] };  // 소리로 찾음(soundsearch.js) 결과
  // 폰·데이터 절약이면 모델(약 130MB)은 버튼으로 동의받은 뒤에 받는다. 한 번 켜면 기억한다.
  const touchy = matchMedia('(pointer: coarse)').matches || innerWidth <= 768;
  const saveData = (() => { try { const c = navigator.connection; return !!(c && (c.saveData || /2g/.test(c.effectiveType || ''))); } catch (_) { return false; } })();
  let semOK = !(touchy || saveData);
  try { if (localStorage.getItem('musicmap-sem') === '1') semOK = true; } catch (_) { /* 저장 불가 */ }

  // 결과 점 번호를 알린다(3D 지도가 강조). null = 검색 없음
  // 지도의 '검색어' 조건 버블은 window.lastSearch(검색어·결과 점)를 읽는다.
  const emit = rows => {
    const pts = rows ? [...new Set(rows.map(r => r.it.point))] : null;
    window.lastSearch = pts ? { q: qEl.value.trim(), pts } : null;
    window.dispatchEvent(new CustomEvent('musicsearch', { detail: pts }));
  };
  fetch('search_meta.json', { cache: 'no-cache' })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(async m => {
      const buf = await fetch('vectors_e5.bin').then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); });
      byPoint = relink(m.items, pointOf);
      meta = m;
      vectors = new Int8Array(buf);
      norms = normsOf(vectors, m.items.length, m.dim);
      if (qEl.value.trim()) update();
    })
    .catch(err => { console.warn('검색 자산을 읽지 못했습니다', err); });

  function normsOf(vecs, n, dim) {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      const off = i * dim;
      for (let d = 0; d < dim; d++) { const v = vecs[off + d]; s += v * v; }
      out[i] = Math.sqrt(s) || 1;
    }
    return out;
  }

  function ensureModel() {
    if (!modelPromise) {
      loadNote = '의미 검색 모델 불러오는 중…';
      renderStatus();
      modelPromise = (async () => {
        const { pipeline, env } = await import(CDN);
        try { env.allowLocalModels = false; } catch (_) { /* 버전 차이 */ }
        return pipeline('feature-extraction', MODEL, {
          dtype: 'q8',
          progress_callback: p => {
            if (!p) return;
            if (p.status === 'progress' && typeof p.progress === 'number') loadNote = `의미 검색 모델 불러오는 중… ${Math.round(p.progress)}%`;
            else if (p.status === 'ready') loadNote = '의미 검색 모델 준비 완료';
            renderStatus();
          },
        });
      })();
      modelPromise.catch(err => { loadNote = '의미 검색 모델을 불러오지 못했습니다 (키워드 결과만)'; console.warn('임베딩 모델 실패', err); renderStatus(); });
    }
    return modelPromise;
  }

  async function embed(texts) {
    const ex = await ensureModel();
    const out = await ex(texts, { pooling: 'mean', normalize: true });
    const dim = out.dims[out.dims.length - 1];
    const list = [];
    for (let i = 0; i < texts.length; i++) list.push(Float32Array.from(out.data.slice(i * dim, (i + 1) * dim)));
    return list;
  }
  window.musicSearchEmbed = embed;  // soundsearch.js 가 같은 모델을 다시 받지 않게
  window.__websearchMeta = () => meta;

  // 질문 벡터와 int8 곡 벡터의 코사인, 정규화용 최소·최대
  function cosines(qvec, vecs, nrm, dim) {
    const out = new Float32Array(nrm.length);
    let qn = 0;
    for (let d = 0; d < dim; d++) qn += qvec[d] * qvec[d];
    qn = Math.sqrt(qn) || 1;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < nrm.length; i++) {
      let dot = 0;
      const off = i * dim;
      for (let d = 0; d < dim; d++) dot += vecs[off + d] * qvec[d];
      const c = dot / (nrm[i] * qn);
      out[i] = c;
      if (c < lo) lo = c;
      if (c > hi) hi = c;
    }
    return { cos: out, lo, hi };
  }

  // 소리로 찾음: soundsearch.js(ES 모듈, 처음 검색 때 import)의 soundSearch 로 소리 개념 → 곡.
  // 개념이 하나도 안 맞으면 expandByAudio 로 글자 결과의 소리 이웃을 대신 보인다. 의미 검색 모델을 쓰므로 그게 켜졌을 때만.
  let soundMod = null;
  const loadSoundMod = () => soundMod || (soundMod = import('./soundsearch.js').catch(err => { console.warn('soundsearch.js 를 읽지 못했습니다(소리 구간 없이 계속)', err); return null; }));
  const audioNb = new Map(P.filter(p => p.an && p.an.length).map(p => [p.id, p.an.map((j, r) => [P[j].id, 1 - r / 40])]));
  async function loadSound(query) {
    if (query.length < 2 || !semOK) return;
    const mod = await loadSoundMod();
    const search = (mod && mod.soundSearch) || window.musicSoundSearch;
    if (typeof search !== 'function') return;
    try {
      let s = soundHits(await search(query, { k: 12 }), pointOf);
      if (!s.hits.length && mod && mod.expandByAudio && meta) {
        const text = rankItems(meta.items, query, semCache.q === query ? semCache : null).slice(0, 10).map(r => ({ videoId: r.it.videoId, score: r.score }));
        const anchorOf = vid => { for (const t of text) if ((audioNb.get(t.videoId) || []).some(r => r[0] === vid)) return [`‘${(P[pointOf(t.videoId)] || {}).t || ''}’과 소리가 비슷`]; return []; };
        s = { concept: '글자 결과와 소리가 비슷한 곡', hits: audioOnly(mod.expandByAudio(text, audioNb, { k: 30 }), pointOf, anchorOf).slice(0, 8) };
      }
      if (qEl.value.trim() !== query) return;
      sound = { q: query, ...s };
      if (view === 'list') rerender();
    } catch (err) { console.warn('소리 검색 실패(글자 결과만)', err); }
  }
  function soundRowsFor(query) {
    if (sound.q !== query || !byPoint) return [];
    return sound.hits.map(h => ({ it: byPoint.get(h.point) || { point: h.point, title: (P[h.point] || {}).t, artist: (P[h.point] || {}).a }, i: h.point, score: h.score, kw: 0, semantic: null, snd: true, why: h.why }));
  }

  function statusOf(sem) {
    if (sem) return '키워드 + 의미';
    if (modelPromise) return loadNote || '의미 검색 모델 불러오는 중…';
    return semOK ? '키워드' : '키워드 (의미 검색 꺼짐)';
  }
  function rank(query) {
    if (!meta) return { rows: [], status: '검색 자료를 읽는 중…' };
    const sem = semCache.q === query && semCache.cos ? semCache : null;
    const rows = rankItems(meta.items, query, sem).filter(r => r.it.point >= 0);
    const status = statusOf(sem);
    const snd = soundRowsFor(query);
    return { rows: mixRows(rows.slice(0, 24), snd), status, total: rows.length, sndTotal: snd.length };
  }

  // ---------------------------------------------------------------- 결과 패널(구글 지도식)
  // 검색어가 있으면 패널은 '펼침'(카드 목록) 또는 '접힘'(결과 N개 줄)이다. 지도를 만져도 검색어·결과는 남는다.
  const ctl = document.getElementById('ctl');
  const panel = document.getElementById('panel');
  const narrow = () => innerWidth <= 720;
  let last = { rows: [], status: '', total: null };
  let folded = false;
  let active = -1;      // 방향키로 고른 줄
  let current = -1;     // 지도에서 선택된 점(목록에서 강조)
  let leaveTimer = 0;
  let manualFold = false;  // '접기'를 직접 눌렀으면 마우스가 한 번 벗어날 때까지 저절로 펼치지 않는다
  let keyAt = 0;
  let view = 'list';    // 'list' = 검색 결과, 'recents' = 최근 검색
  let recActive = -1;
  const SEARCH_KEY = 'musicmap-search';

  // ---------------------------------------------------------------- 최근 검색(이 브라우저 localStorage)
  function recentList() {
    const a = store.get(SEARCH_KEY, []);
    return (Array.isArray(a) ? a : []).filter(q => typeof q === 'string' && q.trim()).slice(0, 20);
  }
  function forgetRecent(q) {
    store.set(SEARCH_KEY, q === '*' ? [] : recentList().filter(x => x !== q));
  }
  function rememberSearch(q) {
    q = String(q || '').trim();
    if (!q) return;
    const a = recentList().filter(x => x.toLowerCase() !== q.toLowerCase());
    a.unshift(q);
    store.set(SEARCH_KEY, a.slice(0, 20));
  }

  function place() {
    if (narrow()) { box.style.left = box.style.top = box.style.width = box.style.maxHeight = ''; return; }
    const c = ctl.getBoundingClientRect();
    const right = panel && panel.classList.contains('open') ? panel.getBoundingClientRect().width + 32 : 16;
    const chips = document.getElementById('chips');  // 조건 버블 줄이 있으면 그 아래
    let left = 16, top = (chips && chips.offsetHeight ? chips : document.getElementById('top')).getBoundingClientRect().bottom + 6;
    if (ctl.classList.contains('open')) { left = c.right + 8; top = c.top; }  // 내 기록 시트가 열려 있으면 그 옆에
    const width = Math.max(260, Math.min(480, innerWidth - left - right));
    box.style.left = left + 'px';
    box.style.top = top + 'px';
    box.style.width = width + 'px';
    box.style.maxHeight = Math.max(160, innerHeight - top - 90) + 'px';
  }
  function setFold(f) {
    folded = f;
    box.classList.toggle('fold', f);
    document.body.classList.toggle('sopen', !f && box.classList.contains('on'));
    place();
  }
  function show() { manualFold = false; box.classList.add('on'); setFold(false); }
  function fold() { if (box.classList.contains('on')) setFold(true); }
  function close() { box.classList.remove('on', 'fold'); document.body.classList.remove('sopen'); active = -1; view = 'list'; recActive = -1; }

  const CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
  function paintRecents() {
    view = 'recents';
    const a = recentList();
    const rows = a.map((q, k) => `<div class="rc${k === recActive ? ' act' : ''}" role="option" data-k="${k}">`
      + `<span class="rci">${CLOCK}</span><span class="rct">${esc(q)}</span>`
      + `<button class="rcx" type="button" data-x="${k}" aria-label="검색어 삭제">×</button></div>`).join('');
    box.innerHTML = `<div class="rch"><b>최근 검색</b>${a.length ? '<button class="rca" type="button">모두 지우기</button>' : ''}</div>`
      + `<div class="slist">${a.length ? rows : '<div class="snone">최근 검색이 없습니다.</div>'}</div>`;
    place();
  }
  function showRecents() {
    if (view !== 'recents') recActive = -1;
    emit(null);
    box.classList.add('on');
    box.classList.remove('fold');
    document.body.classList.toggle('sopen', !narrow());
    paintRecents();
  }
  function runRecent(k) {
    const q = recentList()[k];
    if (!q) return;
    qEl.value = q;
    rememberSearch(q);
    view = 'list';
    recActive = -1;
    show();
    qEl.focus();
    update();
  }

  const kindOf = r => r.semantic == null ? '키워드' : r.kw > 0 && r.semantic >= 0.6 ? '키워드+의미' : r.kw > 0 ? '키워드' : '의미';
  const metaLine = it => [it.artist || '아티스트 미상', it.genre, it.subgenre, it.era].filter(Boolean).join(' · ');
  function render(rows, status, total, sndTotal = 0) {
    view = 'list';
    last = { rows, status, total, sndTotal };
    emit(rows);
    const loading = /중…/.test(status);
    const count = total == null ? '검색 중' : `결과 ${total}곡${sndTotal ? ` · 소리 ${sndTotal}` : ''}`;
    const pinned = window.chips && window.chips.has('q', qEl.value.trim());
    const bar = `<div class="shead"><button class="sbar" type="button" aria-expanded="${!folded}">`
      + `<b>${count}</b><span class="sst${loading ? ' ld' : ''}">${esc(status)}</span>`
      + `<span class="sfold">${folded ? '펼치기' : '접기'}<i>⌃</i></span></button>`
      + (rows.length && window.chips ? `<button class="spin${pinned ? ' on' : ''}" type="button" title="이 검색 결과만 지도에 남기기(조건 버블)"${pinned ? ' disabled' : ''}>${pinned ? '거르는 중' : '결과만 보기'}</button>` : '')
      + (rows.length && window.musike ? `<button class="sall" type="button" title="결과 ${rows.length > TO_MUSIKE ? `상위 ${TO_MUSIKE}` : rows.length}곡: 재생 · 다음에 재생 · 대기열에 추가 · 재생목록에 추가" aria-label="결과 전체 메뉴">⋯ 전체</button>` : '')
      + `</div>`;
    let list;
    if (!rows.length) list = `<div class="snone">${total == null ? '검색 자료를 읽는 중…' : '맞는 곡이 없습니다.'}</div>`;
    let no = 0;
    const hasSnd = rows.some(r => r.snd);
    if (rows.length) list = rows.map((r, k) => {
      const it = r.it;
      const prev = rows[k - 1];
      if (r.snd) {  // 소리로 찾은 행: 번호 대신 '소리', 이유 칩
        const cls = 'rr snd' + (k === active ? ' act' : '') + (it.point === current ? ' cur' : '');
        return (!prev || !prev.snd ? `<div class="sdiv">소리로 찾음${sound.concept ? ` · ${esc(sound.concept)}` : ''}</div>` : '')
          + `<div class="${cls}" role="option" data-k="${k}">`
          + `<span class="rk">소리</span>`
          + `<div class="rm"><div class="rt">${esc(it.title || '제목 없음')}</div><div class="ra">${esc(metaLine(it))}</div>`
          + (r.why && r.why.length ? `<div class="rwhy">${r.why.map(w => `<span>${esc(w)}</span>`).join('')}</div>` : '')
          + '</div>' + ACT + '</div>';
      }
      const moods = String(it.moods || '').split(/\s+/).filter(Boolean).slice(0, 3);
      const kind = kindOf(r);
      const cls = 'rr' + (k === active ? ' act' : '') + (it.point === current ? ' cur' : '');
      return (k === 0 && hasSnd ? '<div class="sdiv">글자로 찾음</div>' : '') + (prev && prev.snd ? '<div class="sdiv">나머지 곡</div>' : '')
        + `<div class="${cls}" role="option" data-k="${k}" data-i="${r.i}">`
        + `<span class="rk">${++no}</span>`
        + `<div class="rm"><div class="rt">${esc(it.title || '제목 없음')}</div><div class="ra">${esc(metaLine(it))}</div>`
        + `${it.summary ? `<div class="rs">${esc(it.summary)}</div>` : ''}`
        + (moods.length && window.chips ? `<div class="rtg">${moods.map(m => `<button type="button" data-mood="${esc(m)}" title="분위기 '${esc(m)}' 버블 더하기">~ ${esc(m)}</button>`).join('')}</div>` : '')
        + `<div class="rf"><span class="rkind ${kind === '의미' ? 'sem' : kind === '키워드' ? 'kw' : 'both'}">${kind}</span>`
        + `<span class="rsc" title="${r.semantic == null ? '키워드 점수' : '키워드+의미 점수'}">${Math.round(r.score * 100)}점</span>`
        + '</div></div>' + ACT + '</div>';
    }).join('');
    if (!semOK && !modelPromise) list = '<button class="semon" type="button">의미 검색 켜기 (모델 약 130MB 내려받기)</button>' + list;
    const y = box.querySelector('.slist') ? box.querySelector('.slist').scrollTop : 0;
    box.innerHTML = bar + `<div class="slist">${list}</div>`;
    box.querySelector('.slist').scrollTop = y;
  }
  function rerender() {
    const query = qEl.value.trim();
    if (!query) { close(); emit(null); return; }
    const r = rank(query);
    render(r.rows, r.status, r.total, r.sndTotal);
  }
  // 모델을 받는 동안 진행률마다 목록 전체를 다시 그리면 누르던 결과가 바뀌어 클릭이 사라진다 → 상태 글자만 고친다
  function renderStatus() {
    const el = box.querySelector('.sst');
    if (!meta || !el || view !== 'list' || !qEl.value.trim()) return;
    const query = qEl.value.trim();
    last.status = statusOf(semCache.q === query && semCache.cos ? semCache : null);
    el.textContent = last.status;
    el.classList.toggle('ld', /중…/.test(last.status));
  }
  const repaint = () => render(last.rows, last.status, last.total, last.sndTotal);

  function choose(k) {
    const r = last.rows[k];
    if (!r) return;
    const i = r.it.point;  // 검색 자료를 읽을 때 영상 ID 로 지금 지도의 점 번호를 붙여 두었다
    rememberSearch(qEl.value);
    if (typeof i !== 'number' || !P[i]) return;
    active = k;
    window.select(i, true);  // 목록은 그대로 둔다(다른 결과를 이어서 볼 수 있게)
    if (narrow()) { qEl.blur(); fold(); }  // 폰: 키보드를 내리고 카드·정보 시트가 보이도록 접는다
  }

  async function update(allowSearch = true) {
    const query = qEl.value.trim();
    if (!query) { close(); emit(null); return; }
    const mine = ++seq;
    active = -1;
    const first = rank(query);
    render(first.rows, first.status, first.total, first.sndTotal);
    if (sound.q !== query) loadSound(query);
    if (!allowSearch || !semOK || !meta || query.length < 2) return;
    try {
      const [qv] = await embed(['query: ' + query]);
      if (mine !== seq || qEl.value.trim() !== query) return;
      semCache = { q: query, ...cosines(qv, vectors, norms, meta.dim) };
      const done = rank(query);
      render(done.rows, done.status, done.total, done.sndTotal);
    } catch (_) { /* 상태 문구는 ensureModel 쪽에서 */ }
  }

  // 좁은 화면에서 검색창에 포커스가 있으면(키보드 배치) 누르는 순간 포커스가 빠지며 목록이 아래로 옮겨가 클릭이 엇나간다 → 결과 줄·결과 메뉴는 포커스를 뺏지 않는다
  box.addEventListener('mousedown', e => { if (document.activeElement === qEl && e.target.closest('.rr, .rc, .sall') && !e.target.closest('a')) e.preventDefault(); });
  box.addEventListener('click', e => {
    if (view === 'list' && window.musike) {
      // Musike 쪽 메뉴·재생으로 넘어가면 키보드는 내린다(누른 자리는 위 mousedown 이 지켰다)
      if (e.target.closest('.sall, [data-rp], [data-rm]') && narrow()) qEl.blur();
      const all = e.target.closest('.sall');
      if (all) {
        const r = all.getBoundingClientRect(), ids = rowIds(last.rows), q = qEl.value.trim();
        rememberSearch(q);
        window.musike.menu(ids.slice(0, TO_MUSIKE), r.left, r.bottom, ids.length > TO_MUSIKE ? `검색 ‘${q}’ 상위 ${TO_MUSIKE}곡` : `검색 ‘${q}’`);
        return;
      }
      const act = e.target.closest('[data-rp], [data-rm]');
      const at = act && act.closest('.rr');
      if (at) {
        const k = +at.dataset.k, id = (P[(last.rows[k] || { it: {} }).it.point] || {}).id;
        rememberSearch(qEl.value);
        if (act.dataset.rp != null) window.musike.play(rowIds(last.rows.slice(k, k + TO_MUSIKE)), 0);
        else { const r = act.getBoundingClientRect(); window.musike.menu([id], r.left, r.bottom); }
        return;
      }
    }
    if (view === 'recents') {
      const x = e.target.closest('.rcx');
      if (x) { const q = recentList()[+x.dataset.x]; if (q) forgetRecent(q); recActive = -1; paintRecents(); return; }
      if (e.target.closest('.rca')) { forgetRecent('*'); recActive = -1; paintRecents(); return; }
      const rc = e.target.closest('.rc');
      if (rc) runRecent(+rc.dataset.k);
      return;
    }
    if (e.target.closest('.sbar')) { setFold(!folded); manualFold = folded; repaint(); return; }
    const mood = e.target.closest('[data-mood]');
    if (mood) { if (window.chips) window.chips.set({ k: 'm', v: mood.dataset.mood }); return; }
    if (e.target.closest('.spin')) { const q = qEl.value.trim(); if (q && window.chips) window.chips.set({ k: 'q', v: q }); repaint(); return; }
    if (e.target.closest('.semon')) {
      semOK = true;
      try { localStorage.setItem('musicmap-sem', '1'); } catch (_) { /* 저장 불가 */ }
      update();
      return;
    }
    const row = e.target.closest('.rr');
    if (row) choose(+row.dataset.k);
  });
  qEl.addEventListener('input', () => {
    seq++;  // 진행 중인 의미 검색 결과는 버린다(입력이 바뀌었으므로)
    clearTimeout(timer);
    const wasRecents = view === 'recents';
    view = 'list';
    if (!qEl.value.trim()) {  // × 로 지움
      emit(null);
      if (document.activeElement === qEl) showRecents(); else close();
      return;
    }
    if (wasRecents || !box.classList.contains('on')) { show(); rerender(); }
    else if (folded) { setFold(false); repaint(); }
    timer = setTimeout(() => update(), 260);
  });
  const reopen = () => {
    if (!qEl.value.trim()) { showRecents(); return; }  // 빈 검색창: 최근 검색
    if (!box.classList.contains('on') || folded || view !== 'list') { view = 'list'; show(); repaint(); }
  };
  qEl.addEventListener('focus', reopen);
  qEl.addEventListener('pointerdown', reopen);  // 터치: 검색창을 누르면 다시 펼침
  qEl.addEventListener('keydown', e => {
    keyAt = performance.now();
    if (e.isComposing || e.keyCode === 229) return;  // 한글 조합을 끝내는 Enter·방향키는 결과를 고르지 않는다(조합 중 글자로도 input 이벤트로 검색은 된다)
    if (view === 'recents') {
      const recs = recentList();
      if (e.key === 'Escape') { e.preventDefault(); close(); qEl.blur(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!recs.length) return;
        e.preventDefault();
        recActive = e.key === 'ArrowDown' ? (recActive + 1) % recs.length : (recActive <= 0 ? recs.length - 1 : recActive - 1);
        paintRecents();
        const el = box.querySelector('.rc.act');
        if (el) el.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (recActive >= 0) runRecent(recActive);
        return;
      }
      return;
    }
    const n = last.rows.length;
    if (e.key === 'Escape') { e.preventDefault(); if (box.classList.contains('on') && !folded) { setFold(true); repaint(); } else qEl.blur(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!n) return;
      e.preventDefault();
      if (folded) { setFold(false); }
      active = e.key === 'ArrowDown' ? (active + 1) % n : (active <= 0 ? n - 1 : active - 1);
      repaint();
      const el = box.querySelector('.rr.act');
      if (el) el.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      rememberSearch(qEl.value);
      if (touchy && active < 0) { qEl.blur(); return; }  // 폰: 키보드만 내리고 목록을 보여 준다
      if (n) choose(active >= 0 ? active : 0);
    }
  });
  // 지도·정보 패널을 누르면 접는다(지우지 않음)
  document.addEventListener('pointerdown', e => {
    if (box.contains(e.target) || ctl.contains(e.target)) return;
    if (narrow() && panel && panel.contains(e.target)) return;
    clearTimeout(leaveTimer);
    if (view === 'recents') { close(); return; }
    if (box.classList.contains('on') && !folded) { setFold(true); repaint(); }
  });
  // 마우스: 검색창·카드·목록 근처(여유 28px)에 오면 펼치고, 벗어나면 잠시 뒤 접는다
  const near = (el, x, y, pad) => { const r = el.getBoundingClientRect(); return r.width && x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad; };
  document.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse' || e.buttons || !qEl.value.trim()) return;
    if (document.querySelector('#mymusic.open')) return;  // 내 음악 패널이 같은 자리를 쓰는 동안은 저절로 펼치지 않는다
    const inside = near(ctl, e.clientX, e.clientY, 28) || (box.classList.contains('on') && near(box, e.clientX, e.clientY, 28));
    if (inside) { clearTimeout(leaveTimer); leaveTimer = 0; if (!manualFold && (folded || !box.classList.contains('on'))) { show(); repaint(); } }
    else if ((manualFold = false) || (box.classList.contains('on') && !folded && !leaveTimer && performance.now() - keyAt > 1500)) {
      leaveTimer = setTimeout(() => { leaveTimer = 0; setFold(true); repaint(); }, 400);
    }
  });
  // 폰 뒤로가기(지도 페이지가 보냄): 펼친 목록을 접는다
  window.addEventListener('searchfold', () => { if (view === 'list' && box.classList.contains('on') && !folded) { setFold(true); repaint(); } });
  // 지도에서 선택이 바뀌면 그 곡을 목록에서 강조
  window.addEventListener('songselect', e => {
    current = e.detail;
    if (view === 'list' && box.classList.contains('on')) repaint();
  });
  window.addEventListener('songhistory', () => { if (view === 'recents' && box.classList.contains('on')) paintRecents(); });
  new MutationObserver(place).observe(ctl, { attributes: true, attributeFilter: ['class'] });
  if (panel) new MutationObserver(place).observe(panel, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', () => { if (box.classList.contains('on')) place(); });
  window.addEventListener('chipschange', () => { if (box.classList.contains('on')) { place(); if (view === 'list') repaint(); } });
})();
