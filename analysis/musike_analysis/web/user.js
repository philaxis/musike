/* 개인 기록(음악 지도): ♥ 즐겨찾기, 내 평점(1~5), 메모, 최근 들은 곡(미니 플레이어로 재생한 곡), 검색 기록.
   나만 보는 비공개 사이트라 로그인은 없다. music_map serve 서버가 있으면 그 JSON API(/api/me/*, 파일 user/me.json)에,
   서버 없이 정적 파일로 열면 이 브라우저 localStorage(키 접두 musicmap-)에 저장한다.
   화면: 정보 패널 .mine(♥·평점·메모) · 폰 카드 ♥ · 상단 '♥ 내 음악' 패널(서재 지도의 '📚 내 서재' 자리) · '내 기록' 시트(#more 의 #user-sec).
   지도와는 이벤트로만 주고받는다. 받는 것: songpanel·songcard·songselect·songplay·musicsearch·chipschange·panesopen·mapready.
   보내는 것: songmarks(♥ 점 번호 목록, 지도는 window.musicUser 로 평점도 다시 읽는다)·songhistory(검색 기록 바뀜). */
(() => {
const SONGS_KEY = "musicmap-songs", RECENT_KEY = "musicmap-recent", SEARCH_KEY = "musicmap-search", TAB_KEY = "musicmap-mytab";
const RECENT_MAX = 50, SEARCH_MAX = 20;
const API = "api/me";
const store = {
  get(k, f = null) { try { const v = localStorage.getItem(k); return v == null ? f : JSON.parse(v); } catch (_) { return f; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* 사생활 모드 등: 이번 창에서만 */ } },
};
const P = window.P || [];
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const VID = /^[A-Za-z0-9_-]{6,20}$/;
const pointOf = new Map();  // videoId → 점 번호
P.forEach((p, i) => { if (p.id && !pointOf.has(p.id)) pointOf.set(p.id, i); });
const idOf = i => (P[i] && P[i].id) || "";
const strs = (a, n) => (Array.isArray(a) ? a : []).filter(x => typeof x === "string" && x).slice(0, n);
const rate = v => { v = v | 0; return v >= 1 && v <= 5 ? v : 0; };

// ---------------------------------------------------------------- 로컬 기록
// songs[videoId] = {fav, rating, memo, t}. 모두 비면 {t} 만 남긴다(지운 표시). 서버 모드에선 localStorage 에 쓰지 않는다.
let songs = store.get(SONGS_KEY, {}) || {};
let recent = strs(store.get(RECENT_KEY, []), RECENT_MAX);
let searches = strs(store.get(SEARCH_KEY, []), SEARCH_MAX);
let mode = "init";  // init(확인 중) | server(이 PC 서버에 저장) | local(서버 없음 → 이 브라우저에만)
const blank = s => !s || (!s.fav && !rate(s.rating) && !(s.memo || "").trim());
const song = id => songs[id] || {};
const keep = (k, v) => { if (mode !== "server") store.set(k, v); };
const saveSongs = () => keep(SONGS_KEY, songs);
function setSong(id, patch, quiet = false) {
  if (!VID.test(id)) return;
  const s = { fav: false, rating: 0, memo: "", ...song(id), ...patch, t: Date.now() };
  songs[id] = blank(s) ? { t: s.t } : s;
  saveSongs();
  pushSong(id);
  if (!quiet) refresh();
}
function addRecent(id) {
  if (!VID.test(id)) return;
  recent = [id, ...recent.filter(x => x !== id)].slice(0, RECENT_MAX);
  keep(RECENT_KEY, recent);
  postHistory({ play: id });
  secUI(); myUI();
}
function addSearch(q) {
  q = String(q || "").trim().slice(0, 200);
  if (!q || searches[0] === q) return;
  searches = [q, ...searches.filter(x => x !== q)].slice(0, SEARCH_MAX);
  keep(SEARCH_KEY, searches);
  postHistory({ search: q });
  secUI();
  dispatchEvent(new Event("songhistory"));
}
function forgetSearch(q) {  // 최근 검색 ×(하나)·모두 지우기("*")
  searches = q === "*" ? [] : searches.filter(x => x !== q);
  keep(SEARCH_KEY, searches);
  postHistory({ forget: q });
  secUI();
  dispatchEvent(new Event("songhistory"));
}

// ---------------------------------------------------------------- 서버(serve 의 /api/me/*)
const pending = new Map();  // id → 타이머(메모 연타를 모아 올린다)
const fromServer = c => ({ fav: !!c.fav, rating: rate(c.rating), memo: typeof c.memo === "string" ? c.memo : "", t: +c.updatedAt || 0 });
const api = (path, opt = {}) => fetch(`${API}${path}`, { cache: "no-store", ...opt, headers: { "Content-Type": "application/json" } })
  .then(r => r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)));

async function loadServer() {
  let data;
  try {
    data = await api("/songs");
    if (!data || typeof data.songs !== "object") throw new Error("형식");
  } catch (_) {
    if (mode === "init") { mode = "local"; refresh(); }
    return;
  }
  const first = mode !== "server";
  mode = "server";
  const local = songs;
  songs = {};
  for (const [id, c] of Object.entries(data.songs || {})) if (VID.test(id) && c) songs[id] = fromServer(c);
  if (first) {  // 서버를 처음 만났을 때: 이 브라우저에만 있던 곡 기록을 한 번 올리고 로컬 사본은 지운다
    const ups = Object.keys(local).filter(id => VID.test(id) && !blank(local[id]) && (local[id].t || 0) > ((songs[id] || {}).t || 0));
    for (const id of ups) { songs[id] = local[id]; writeSong(id); }
    try { localStorage.removeItem(SONGS_KEY); } catch (_) { /* 없음 */ }
  }
  const h = data.history || {};
  recent = strs(h.recent, RECENT_MAX);
  searches = strs(h.searches, SEARCH_MAX);
  refresh();
  dispatchEvent(new Event("songhistory"));
}

function writeSong(id) {
  if (mode !== "server") return Promise.resolve(false);
  const s = songs[id] || {};
  const body = { fav: !!s.fav, rating: rate(s.rating), memo: (s.memo || "").slice(0, 2000) };
  return api(`/songs/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) })
    .then(() => true, err => { console.warn("기록 저장 실패", id, err); return false; });
}
function pushSong(id, delay = 0) {
  if (mode !== "server") return;
  clearTimeout(pending.get(id));
  pending.set(id, setTimeout(() => { pending.delete(id); writeSong(id).then(ok => onSaved(id, ok)); }, delay));
}
function postHistory(ev) {
  if (mode !== "server") return;
  api("/history", { method: "POST", body: JSON.stringify(ev) }).catch(err => console.warn("들은 곡·검색 기록 저장 실패", err));
}
addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && mode === "server") loadServer(); });  // 다른 기기·탭에서 바꾼 것

// ---------------------------------------------------------------- 화면
const sec = $("user-sec"), panel = $("panel"), card = $("card"), slot = $("user-slot");
let panelI = -1, cardI = -1, selI = -1, savedNote = null;
const favIds = () => Object.keys(songs).filter(id => songs[id].fav && pointOf.has(id));
const favPoints = () => favIds().map(id => pointOf.get(id));
const ratedIds = (min = 1) => Object.keys(songs).filter(id => rate(songs[id].rating) >= min && pointOf.has(id));
const where = () => mode === "server" ? "이 PC 서버에 저장 · 기기끼리 같은 기록" : mode === "local" ? "서버 없음 · 이 브라우저에만 저장" : "저장 위치 확인 중…";

// 상단 '♥ 내 음악' 버튼(서재 지도 '📚 내 서재' 버튼 자리·모양)
const myBtn = document.createElement("button");
myBtn.id = "mymusic-btn";
myBtn.className = "ub";
myBtn.type = "button";
myBtn.dataset.u = "mymusic";
myBtn.title = "내 음악 — 즐겨찾기·평점·최근 들은 곡";
myBtn.innerHTML = `<span aria-hidden="true">♥</span><span class="tx">내 음악</span>`;
if (slot) slot.appendChild(myBtn);
const myEl = document.createElement("aside");
myEl.id = "mymusic";
myEl.setAttribute("aria-label", "내 음악");
document.body.appendChild(myEl);
let myOpen = false, tab = store.get(TAB_KEY, "fav");
if (!["fav", "rated", "recent"].includes(tab)) tab = "fav";

function setMy(open) {
  if (open && $("ctl") && $("ctl").classList.contains("open")) $("toggle").click();  // 내 기록 시트와 겹치지 않게
  if (open) dispatchEvent(new Event("searchfold"));  // 검색 결과 목록과 같은 자리(왼쪽 위 카드 아래)라 결과를 접는다
  if (open) { const a = $("addmenu"), t = $("tags"); if (a) a.classList.remove("open"); if (t) t.classList.remove("open"); }
  myOpen = open;
  myEl.classList.toggle("open", open);
  myBtn.classList.toggle("on", open);
  myUI();
}
addEventListener("panesopen", () => { if (myOpen) setMy(false); });
{ const q = $("q"); if (q) q.addEventListener("focus", () => { if (myOpen) setMy(false); }); }  // 검색 목록이 다시 펼쳐지면 내 음악은 닫는다
addEventListener("keydown", e => { if (e.key === "Escape" && myOpen && !(e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))) { const pal = $("pal"); if (pal && !pal.hidden) return; setMy(false); e.stopImmediatePropagation(); } });  // 지도의 ESC(곡 선택 해제)까지 한 번에 가지 않게

function myUI() {
  myBtn.classList.toggle("has", favIds().length > 0);
  if (!myOpen) return;
  const nFav = favIds().length, nRated = ratedIds().length, nRecent = recent.filter(id => pointOf.has(id)).length;
  const viewOn = !!(window.chips && window.chips.has("fav"));
  let ids;
  if (tab === "fav") ids = favIds().sort((a, b) => (songs[b].t || 0) - (songs[a].t || 0));
  else if (tab === "rated") ids = ratedIds().sort((a, b) => rate(songs[b].rating) - rate(songs[a].rating) || (songs[b].t || 0) - (songs[a].t || 0));
  else ids = recent.filter(id => pointOf.has(id));
  const pl = window.musicPlayer;
  const row = id => {
    const i = pointOf.get(id), p = P[i], s = song(id), r = rate(s.rating);
    const now = pl && pl.current() === i;
    return `<div class="bk${i === selI ? " cur" : ""}${now ? " now" : ""}" data-pt="${i}">`
      + `<span class="bt" title="${esc(p.t)}">${now ? "♪ " : ""}${esc(p.t || "제목 없음")}<small>${esc(p.a || "")}</small></span>`
      + (r ? `<em>${"★".repeat(r)}</em>` : "") + (s.fav && tab !== "fav" ? `<em class="hf">♥</em>` : "")
      + `<span class="act"><button type="button" data-my="play" data-pt="${i}" title="재생" aria-label="재생">▶</button>`
      + (tab === "fav" ? `<button type="button" data-my="unfav" data-id="${esc(id)}" title="즐겨찾기에서 빼기" aria-label="즐겨찾기에서 빼기">✕</button>` : "")
      + `</span></div>`;
  };
  const empty = { fav: "아직 ♥ 곡이 없어요. 곡 정보의 ♡ 즐겨찾기를 누르면 여기 모여요.", rated: "아직 평점을 준 곡이 없어요.", recent: "아직 들은 곡이 없어요. ▶ 로 재생하면 여기 남아요." }[tab];
  myEl.innerHTML = `<div class="sh-head"><b>♥ 내 음악</b><span class="sh-n">♥ ${nFav} · 평점 ${nRated}</span><button class="sh-x" type="button" data-my="close" aria-label="닫기">×</button></div>`
    + `<div class="sh-view"><button type="button" class="btn${viewOn ? " on" : ""}" data-my="view">${viewOn ? "지도에서 ♥ 곡만 보는 중 · 끄기" : "지도에서 ♥ 곡만 보기"}</button></div>`
    + `<div class="sh-tabs seg"><button type="button" data-tab="fav" class="${tab === "fav" ? "on" : ""}">즐겨찾기 ${nFav}</button><button type="button" data-tab="rated" class="${tab === "rated" ? "on" : ""}">평점 ${nRated}</button><button type="button" data-tab="recent" class="${tab === "recent" ? "on" : ""}">최근 들은 곡 ${nRecent}</button></div>`
    + `<div class="sh-tree">${ids.length ? ids.map(row).join("") : `<div class="none">${empty}</div>`}</div>`
    + `<div class="sh-note">${where()}</div>`;
}
addEventListener("chipschange", () => myUI());
addEventListener("playerstate", () => { if (myOpen) myUI(); });
myEl.addEventListener("click", e => {
  const t = e.target.closest("[data-my],[data-tab],[data-pt]");
  if (!t) return;
  if (t.dataset.tab) { tab = t.dataset.tab; store.set(TAB_KEY, tab); myUI(); return; }
  const a = t.dataset.my;
  if (a === "close") { setMy(false); return; }
  if (a === "view") { if (window.chips) window.chips.has("fav") ? window.chips.remove("fav") : window.chips.set({ k: "fav", v: 1 }); return; }
  if (a === "play") { if (window.musicPlayer) window.musicPlayer.play(+t.dataset.pt); return; }
  if (a === "unfav") { setSong(t.dataset.id, { fav: false }); return; }
  if (t.dataset.pt != null && window.select) { window.select(+t.dataset.pt, true); if (innerWidth <= 720) setMy(false); }
});

// '내 기록' 시트(#more): 저장 위치·수·최근 들은 곡·검색 기록
function secUI() {
  if (!sec) return;
  const nFav = favIds().length, nRated = ratedIds().length;
  const rec = recent.filter(id => pointOf.has(id)).slice(0, 6).map(id => {
    const p = P[pointOf.get(id)];
    return `<button type="button" class="ui" data-pt="${pointOf.get(id)}">${esc(p.t || "제목 없음")}<small>${esc(p.a || "")}</small></button>`;
  }).join("");
  const qs = searches.slice(0, 8).map(q => `<button type="button" class="uq" data-q="${esc(q)}">${esc(q)}</button>`).join("");
  sec.innerHTML = `<h4>내 기록</h4><div class="ust">${where()}</div>`
    + `<div class="ust" style="margin-top:8px">♥ ${nFav}곡 · 평점 ${nRated}곡 <button class="btn" type="button" data-u="mymusic">♥ 내 음악 열기</button></div>`
    + (rec ? `<div class="uh">최근 들은 곡</div><div class="ulist">${rec}</div>` : "")
    + (qs ? `<div class="uh">검색 기록</div><div class="uqs">${qs}</div>` : "");
}

function mineHTML(i) {
  const s = song(idOf(i)), memo = (s.memo || "").trim(), r = rate(s.rating);
  const stars = [1, 2, 3, 4, 5].map(k => `<button type="button" data-rate="${k}" aria-label="내 평점 ${k}"${r >= k ? ' class="on"' : ""}>★</button>`).join("");
  return `<div class="mrow"><button class="fv${s.fav ? " on" : ""}" type="button" data-fav aria-pressed="${!!s.fav}">${s.fav ? "♥ 즐겨찾기" : "♡ 즐겨찾기"}</button>
    <span class="rate" title="내 평점(다시 누르면 해제)">내 평점 ${stars}</span></div>
    <div class="memo"><button class="mclosed${memo ? " has" : ""}" type="button" data-memo>${memo ? esc(memo.split("\n")[0]) : "메모 쓰기…"}</button></div>`;
}
function panelUI() {
  if (!panel || panelI < 0) return;
  const el = panel.querySelector(".mine");
  if (!el || el.contains(document.activeElement) && document.activeElement.tagName === "TEXTAREA") return;
  el.innerHTML = mineHTML(panelI);
}
function cardUI() {
  const btn = card && card.querySelector(".cb.fav");
  if (!btn || cardI < 0) return;
  const on = !!song(idOf(cardI)).fav;
  btn.hidden = false;
  btn.textContent = on ? "♥" : "♡";
  btn.classList.toggle("on", on);
  btn.setAttribute("aria-label", on ? "즐겨찾기 빼기" : "즐겨찾기");
  btn.title = on ? "즐겨찾기 빼기" : "즐겨찾기";
}
function refresh() {
  secUI(); panelUI(); cardUI(); myUI();
  dispatchEvent(new CustomEvent("songmarks", { detail: favPoints() }));
}
window.musicUser = {
  fav: id => !!song(id).fav,
  rating: id => rate(song(id).rating),
  favPoints,
  ratedPoints: (min = 1) => ratedIds(min).map(id => pointOf.get(id)),
  searches: () => searches.slice(),
  addSearch, forgetSearch,
  mode: () => mode,
};

function onSaved(id, ok) {
  if (!savedNote || savedNote.id !== id) return;
  savedNote.el.textContent = ok ? "저장됨 · 서버" : "저장 실패(서버 응답 없음)";
}

addEventListener("songpanel", e => { panelI = e.detail; panelUI(); });
addEventListener("songcard", e => { cardI = e.detail; cardUI(); });
addEventListener("songselect", e => { selI = e.detail; if (myOpen) myUI(); });
addEventListener("songplay", e => addRecent(idOf(e.detail)));
addEventListener("mapready", () => refresh());
let searchTimer = 0;
addEventListener("musicsearch", e => {  // 1.5초 동안 그대로인 검색어만 기록(타이핑 중간 글자는 안 남긴다)
  clearTimeout(searchTimer);
  // 끝이 홑자모(조합 중 'ㅍ')면 아직 치는 중이다: 남기지 않는다(Enter·결과 고르기는 search.js 가 따로 남긴다)
  if (e.detail) searchTimer = setTimeout(() => window.lastSearch && !/[ㄱ-ㆎ]$/.test(window.lastSearch.q) && addSearch(window.lastSearch.q), 1500);
});

document.addEventListener("click", e => {
  const u = e.target.closest("[data-u]");
  if (u && u.dataset.u === "mymusic") { setMy(!myOpen || !u.closest("#mymusic-btn")); return; }
  const pt = e.target.closest("#user-sec [data-pt]");
  if (pt) { if (window.select) window.select(+pt.dataset.pt, true); return; }
  const uq = e.target.closest("#user-sec [data-q]");
  if (uq) {
    const q = $("q");
    if (q) { q.value = uq.dataset.q; q.dispatchEvent(new Event("input")); q.focus(); }
    return;
  }
  const cf = e.target.closest("#card .cb.fav");
  if (cf && cardI >= 0) { const id = idOf(cardI); setSong(id, { fav: !song(id).fav }); return; }
  const mine = e.target.closest("#panel .mine");
  if (!mine || panelI < 0) return;
  const id = idOf(panelI);
  if (e.target.closest("[data-fav]")) { setSong(id, { fav: !song(id).fav }); return; }
  const r = e.target.closest("[data-rate]");
  if (r) { const k = +r.dataset.rate; setSong(id, { rating: rate(song(id).rating) === k ? 0 : k }); return; }
  if (e.target.closest("[data-memo]")) openMemo(mine.querySelector(".memo"), id);
});

function openMemo(box, id) {
  box.innerHTML = `<textarea maxlength="2000" placeholder="몇 줄 메모(자동 저장)">${esc(song(id).memo || "")}</textarea><div class="msave"></div>`;
  const ta = box.querySelector("textarea"), note = box.querySelector(".msave");
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  let timer = 0;
  const save = () => {
    clearTimeout(timer);
    if ((song(id).memo || "") === ta.value) return;
    setSong(id, { memo: ta.value.slice(0, 2000) }, true);
    savedNote = { id, el: note };
    note.textContent = mode === "server" ? "저장 중…" : "저장됨 · 이 브라우저";
    secUI(); myUI();
  };
  ta.addEventListener("input", () => { note.textContent = ""; clearTimeout(timer); timer = setTimeout(save, 700); });
  ta.addEventListener("blur", () => { save(); if (!ta.value.trim()) setTimeout(panelUI, 0); });
}

refresh();
loadServer();
})();
