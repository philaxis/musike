/* 소리로 검색: 한국어 질의 → e5 개념 매칭 → MuQ-MuLan 개념별 곡 순위.
   UI 는 붙이지 않은 모듈이다. 지도 페이지가 import 해서 쓴다.
   - soundSearch(query, {k, base}) → [{videoId, score, concepts:[ko]}]
   - expandByAudio(textHits, neighborsAudio) → 글자 검색 + 소리 이웃 RRF
   자산: sound_concepts_meta.json, vectors_e5_concepts.bin, sound_concepts_index.json (지도 페이지에선 이름표 window.mapFile 의 해시 이름) */

const MODEL = 'Xenova/multilingual-e5-small';
const CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';
const DEFAULT_MIN_SIM = 0.82;

let assetsPromise = null;
let modelPromise = null;

// 지도 페이지는 해시 이름(오래 캐시)으로 준다. 이름표가 없으면 원래 이름.
const file = name => (typeof window !== 'undefined' && window.mapFile ? window.mapFile(name) : name);

function fetchJson(url) {
  return fetch(url).then(r => {
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json();
  });
}

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

async function ensureModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      const { pipeline, env } = await import(CDN);
      try { env.allowLocalModels = false; } catch (_) { /* 버전 차이 */ }
      return pipeline('feature-extraction', MODEL, { dtype: 'q8' });
    })();
    modelPromise.catch(() => { modelPromise = null; });
  }
  return modelPromise;
}

async function embed(text) {
  if (typeof window !== 'undefined' && typeof window.musicSearchEmbed === 'function') {
    const [vec] = await window.musicSearchEmbed([text]);
    if (vec) return vec;
  }
  const ex = await ensureModel();
  const out = await ex([text], { pooling: 'mean', normalize: true });
  const dim = out.dims[out.dims.length - 1];
  return Float32Array.from(out.data.slice(0, dim));
}

export function loadSoundAssets(base = '') {
  if (!assetsPromise) {
    assetsPromise = (async () => {
      const [meta, index] = await Promise.all([
        fetchJson(`${base}${file('sound_concepts_meta.json')}`),
        fetchJson(`${base}${file('sound_concepts_index.json')}`),
      ]);
      const buf = await fetch(`${base}${file('vectors_e5_concepts.bin')}`)
        .then(r => { if (!r.ok) throw new Error(`vectors: HTTP ${r.status}`); return r.arrayBuffer(); });
      const vectors = new Int8Array(buf);
      const items = meta.items || [];
      const dim = meta.dim || 0;
      if (!dim || vectors.length !== items.length * dim) throw new Error('개념 벡터 크기가 맞지 않습니다');
      return { meta, index, vectors, dim, norms: normsOf(vectors, items.length, dim) };
    })();
    assetsPromise.catch(() => { assetsPromise = null; });
  }
  return assetsPromise;
}

export function conceptCosines(qvec, data) {
  const { vectors, norms, dim, meta } = data;
  const n = meta.items.length;
  let qn = 0;
  for (let d = 0; d < dim; d++) qn += qvec[d] * qvec[d];
  qn = Math.sqrt(qn) || 1;
  const cos = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let dot = 0;
    const off = i * dim;
    for (let d = 0; d < dim; d++) dot += vectors[off + d] * qvec[d];
    cos[i] = dot / (norms[i] * qn);
  }
  return cos;
}

export function rankConcepts(cos, meta, { k = 3, minSim = DEFAULT_MIN_SIM, weak = null } = {}) {
  const weakSet = weak instanceof Set ? weak : new Set(weak || []);
  const rows = [];
  for (let i = 0; i < cos.length; i++) if (cos[i] >= minSim) rows.push({ i, sim: cos[i] });
  rows.sort((a, b) => b.sim - a.sim || a.i - b.i);
  return rows.slice(0, k).map(r => {
    const item = meta.items[r.i] || {};
    return {
      id: item.id,
      ko: item.ko || item.id,
      group: item.group || '',
      sim: r.sim,
      weak: weakSet.has(item.id),
    };
  });
}


export function rankSongsByConcepts(hits, index, { k = 20, minSim = DEFAULT_MIN_SIM } = {}) {
  const scores = new Map();
  const labels = new Map();
  let total = 0;
  for (const hit of hits) {
    const weight = Math.max(0, (hit.sim || 0) - minSim);
    if (!weight) continue;
    total += weight;
    const rows = (index.index || {})[hit.id] || [];
    for (const row of rows) {
      const vid = row[0];
      const z = row[1] || 0;
      if (z <= 0) continue;
      scores.set(vid, (scores.get(vid) || 0) + weight * z);
      if (!labels.has(vid)) labels.set(vid, []);
      const list = labels.get(vid);
      if (hit.ko && !list.includes(hit.ko)) list.push(hit.ko);
    }
  }
  const denom = total || 1;
  return [...scores.entries()]
    .map(([videoId, score]) => ({ videoId, score: score / denom, concepts: labels.get(videoId) || [] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export async function soundSearch(query, opts = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  const { k = 20, minSim = DEFAULT_MIN_SIM, conceptK = 3, base = '' } = opts;
  const data = await loadSoundAssets(base);
  const qvec = await embed('query: ' + q);
  const cos = conceptCosines(qvec, data);
  const hits = rankConcepts(cos, data.meta, { k: conceptK, minSim, weak: data.index.weak });
  return rankSongsByConcepts(hits, data.index, { k, minSim });
}

function normalizeHits(textHits) {
  const out = [];
  for (const hit of textHits || []) {
    if (!hit) continue;
    if (typeof hit === 'string') out.push({ videoId: hit, score: 1 });
    else if (Array.isArray(hit)) out.push({ videoId: String(hit[0]), score: Number(hit[1]) || 0 });
    else if (hit.videoId != null) out.push({ videoId: String(hit.videoId), score: Number(hit.score) || 0 });
    else if (hit.id != null) out.push({ videoId: String(hit.id), score: Number(hit.score) || 0 });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

export function expandByAudio(textHits, neighborsAudio, opts = {}) {
  const { k = 30, rrfK = 60, textWeight = 1, audioWeight = 0.7, neighborHits = 10 } = opts;
  const hits = normalizeHits(textHits);
  const scores = new Map();
  const fromText = new Set();
  const fromAudio = new Set();
  hits.forEach((hit, rank) => {
    scores.set(hit.videoId, (scores.get(hit.videoId) || 0) + textWeight / (rrfK + rank + 1));
    fromText.add(hit.videoId);
  });
  const neighbors = neighborsAudio || {};
  const getNeighbors = vid => (typeof neighbors.get === 'function' ? neighbors.get(vid) : neighbors[vid]) || [];
  hits.slice(0, neighborHits).forEach(hit => {
    const rows = getNeighbors(hit.videoId);
    rows.forEach((row, rank) => {
      if (!row || row[0] == null) return;
      const vid = String(row[0]);
      scores.set(vid, (scores.get(vid) || 0) + audioWeight / (rrfK + rank + 1));
      fromAudio.add(vid);
    });
  });
  return [...scores.entries()]
    .map(([videoId, score]) => ({
      videoId,
      score,
      text: fromText.has(videoId),
      audio: fromAudio.has(videoId),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export function clearSoundCache() {
  assetsPromise = null;
  modelPromise = null;
}

if (typeof window !== 'undefined') {
  window.musicSoundSearch = soundSearch;
  window.musicExpandByAudio = expandByAudio;
}
