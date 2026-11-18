import { isListen, type Play } from "./plays.js";
import { artistKey, probeOf, seeded, shuffleWith, simPair, simsTo, type Probe, type Taste } from "./taste.js";

// Automatic playlists (#26), made on the server from the listening log, favorites, 「오늘 좋음」, the song box and
// the taste analysis; no AI call. The day (Asia/Seoul) seeds every random choice, so a mix stays the same all day.

const DAY_MS = 86_400_000;
export const MIX_SIZE = 25;
/** Fewer tracks than this and there is no card. */
const MIN_SIZE = 5;
/** A daily mix is ~70% tracks heard lately, ~30% alike ones never heard. */
const HEARD_SHARE = 0.7;
const RECENT_DAYS = 28;

export type MixKind = "daily" | "onRepeat" | "forgotten" | "newForYou" | "upbeat" | "calm";

export interface Mix {
  id: string;
  kind: MixKind;
  /** Daily mixes: 1–5. */
  n?: number;
  /** Daily mixes: the sound group (or genre) they come from. */
  name?: string;
  ids: string[];
}

export interface KnownTrack {
  artist: string;
  /** When it came into the song box (ms); 0 when unknown (music folders). */
  addedAt: number;
}

export interface MixInput {
  taste: Taste;
  plays: Play[];
  now: number;
  /** YYYY-MM-DD in Asia/Seoul: the seed of the day's shuffles. */
  day: string;
  favorites: string[];
  /** Every track ever marked 「오늘 좋음」. */
  daylikes: string[];
  /** Tracks that can be played now, by ID. */
  known: Map<string, KnownTrack>;
}

interface Listens {
  /** Listens in the last 28 days. */
  recent: Map<string, number>;
  all: Map<string, number>;
  last: Map<string, number>;
}

function countListens(plays: Play[], now: number): Listens {
  const recent = new Map<string, number>();
  const all = new Map<string, number>();
  const last = new Map<string, number>();
  for (const p of plays) {
    if (!isListen(p)) continue;
    all.set(p.id, (all.get(p.id) ?? 0) + 1);
    last.set(p.id, Math.max(last.get(p.id) ?? 0, p.startedAt));
    if (p.startedAt >= now - RECENT_DAYS * DAY_MS) recent.set(p.id, (recent.get(p.id) ?? 0) + 1);
  }
  return { recent, all, last };
}

/** The first `count` of `list` with at most `per` tracks of one artist. */
function capArtists(list: number[], count: number, per: number, artistOf: (i: number) => string): number[] {
  const seen = new Map<string, number>();
  const out: number[] = [];
  for (const i of list) {
    if (out.length >= count) break;
    const a = artistKey(artistOf(i));
    if ((seen.get(a) ?? 0) >= per) continue;
    seen.set(a, (seen.get(a) ?? 0) + 1);
    out.push(i);
  }
  return out;
}

/** `count` of `items` drawn without replacement, heavier ones likelier (Efraimidis–Spirakis). */
function weightedSample(items: number[], weight: (i: number) => number, count: number, rand: () => number): number[] {
  return items
    .map((i) => ({ i, key: rand() ** (1 / Math.max(weight(i), 1e-6)) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, count)
    .map((x) => x.i);
}

/** Splits songs into `k` clusters of alike ones (k-medoids, farthest-first start); biggest weight first. */
export function kMedoids(taste: Taste, songs: number[], k: number, weight: (i: number) => number): number[][] {
  const n = songs.length;
  const sim = songs.map((x) => songs.map((y) => simPair(taste, x, y)));
  const byWeight = songs.map((_, a) => a).sort((a, b) => weight(songs[b]) - weight(songs[a]));
  const medoids = [byWeight[0]];
  while (medoids.length < Math.min(k, n)) {
    let far = -1;
    let farSim = Infinity;
    for (let a = 0; a < n; a++) {
      if (medoids.includes(a)) continue;
      const near = Math.max(...medoids.map((m) => sim[a][m]));
      if (near < farSim) {
        farSim = near;
        far = a;
      }
    }
    medoids.push(far);
  }
  let members: number[][] = [];
  for (let round = 0; round < 12; round++) {
    members = medoids.map(() => []);
    for (let a = 0; a < n; a++) {
      let best = 0;
      for (let c = 1; c < medoids.length; c++) if (sim[a][medoids[c]] > sim[a][medoids[best]]) best = c;
      members[best].push(a);
    }
    let moved = false;
    members.forEach((group, c) => {
      if (!group.length) return;
      const centre = group.reduce((best, a) => {
        const total = (x: number) => group.reduce((s, b) => s + sim[x][b], 0);
        return total(a) > total(best) ? a : best;
      }, group[0]);
      if (centre !== medoids[c]) {
        medoids[c] = centre;
        moved = true;
      }
    });
    if (!moved) break;
  }
  const total = (g: number[]) => g.reduce((s, i) => s + weight(i), 0);
  return members
    .filter((g) => g.length)
    .map((g) => g.map((a) => songs[a]))
    .sort((a, b) => total(b) - total(a));
}

/** What a cluster is called: its most common sound group's name, else its most common genre. */
function clusterName(taste: Taste, members: number[]): string {
  const most = (keys: (string | null)[]) => {
    const counts = new Map<string, number>();
    for (const key of keys) if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const group = most(members.map((i) => taste.songs[i].group));
  return taste.groups.find((g) => g.id === group)?.name ?? most(members.map((i) => taste.songs[i].genre)) ?? "";
}

const isEtc = (group: string) => group.endsWith("·etc");

function dailyMixes(input: MixInput, listens: Listens, playable: (i: number) => boolean, artistOf: (i: number) => string): Mix[] {
  const { taste, day } = input;
  const weights = new Map<number, number>();
  for (const [id, n] of listens.recent) {
    const i = taste.index.get(id);
    if (i !== undefined && playable(i)) weights.set(i, n);
  }
  // Little history yet: start from what was marked liked.
  if (weights.size < 10) {
    for (const id of [...input.favorites, ...input.daylikes]) {
      const i = taste.index.get(id);
      if (i !== undefined && playable(i) && !weights.has(i)) weights.set(i, 1);
    }
  }
  const weight = (i: number) => weights.get(i) ?? 0;
  /** Daily mix `n`: `pick` chooses its tracks with the day's random numbers, which then shuffle them. */
  const daily = (n: number, name: string, pick: (rand: () => number) => number[]): Mix => {
    const rand = seeded(`${day}:daily:${n}`);
    return { id: `daily-${n}`, kind: "daily", n, name, ids: shuffleWith(pick(rand), rand).map((i) => taste.songs[i].id) };
  };

  if (weights.size < 10) {
    // Nothing to go on: the box's biggest sound groups, a few picked for the day.
    const rand = seeded(`${day}:groups`);
    const groups = shuffleWith(
      taste.groups.filter((g) => !isEtc(g.id)).sort((a, b) => b.size - a.size).slice(0, 8),
      rand,
    ).slice(0, 4);
    return groups.map((g, k) =>
      daily(k + 1, g.name, (rand) => {
        const members = taste.songs.map((_, i) => i).filter((i) => taste.songs[i].group === g.id && playable(i));
        return capArtists(shuffleWith(members, rand), MIX_SIZE, 2, artistOf);
      }),
    );
  }

  const seeds = [...weights.keys()];
  const byGroup = new Map<string, number[]>();
  for (const i of seeds) {
    const s = taste.songs[i];
    const key = s.group ?? `genre:${s.genre}`;
    byGroup.set(key, [...(byGroup.get(key) ?? []), i]);
  }
  const total = (g: number[]) => g.reduce((s, i) => s + weight(i), 0);
  let clusters = [...byGroup.values()].filter((g) => g.length >= 3).sort((a, b) => total(b) - total(a));
  if (clusters.length < 3) {
    const top = seeds.sort((a, b) => weight(b) - weight(a)).slice(0, 200);
    clusters = kMedoids(taste, top, Math.min(5, Math.max(3, Math.floor(top.length / 8))), weight);
  }
  const heardEver = new Set(listens.all.keys());
  const used = new Set(seeds);
  return clusters.slice(0, 5).map((members, k) =>
    daily(k + 1, clusterName(taste, members), (rand) => {
      const heard = weightedSample(members, weight, Math.round(MIX_SIZE * HEARD_SHARE), rand);
      const freshCount = Math.min(MIX_SIZE - heard.length, Math.round((heard.length * (1 - HEARD_SHARE)) / HEARD_SHARE));
      const rel = simsTo(taste, probeOf(taste, members, members.map(weight)));
      const pool = taste.songs
        .map((_, i) => i)
        .filter((i) => playable(i) && !used.has(i) && !heardEver.has(taste.songs[i].id))
        .sort((a, b) => rel[b] - rel[a])
        // Three alike tracks per place: varied from day to day, still close to what was heard.
        .slice(0, freshCount * 3);
      const fresh = capArtists(shuffleWith(pool, rand), freshCount, 2, artistOf);
      for (const i of fresh) used.add(i);
      return [...heard, ...fresh];
    }),
  );
}

/** Every mix there is enough for: daily mixes, on repeat, new for you, forgotten favourites, upbeat, calm. */
export function buildMixes(input: MixInput): Mix[] {
  const { taste, now, day, known } = input;
  const listens = countListens(input.plays, now);
  const playable = (i: number) => known.has(taste.songs[i].id);
  const artistOf = (i: number) => known.get(taste.songs[i].id)?.artist ?? "";
  const mixes: Mix[] = [];

  if (taste.songs.length) mixes.push(...dailyMixes(input, listens, playable, artistOf));

  const onRepeat = [...listens.recent]
    .filter(([id, n]) => n >= 2 && known.has(id))
    .sort((a, b) => b[1] - a[1] || listens.last.get(b[0])! - listens.last.get(a[0])!)
    .map(([id]) => id);
  mixes.push({ id: "on-repeat", kind: "onRepeat", ids: onRepeat.slice(0, MIX_SIZE) });

  // What the listener likes, to rank by: favorites, 「오늘 좋음」 and tracks heard more than once.
  const liked = [...new Set([...input.favorites, ...input.daylikes, ...[...listens.all].filter(([, n]) => n >= 2).map(([id]) => id)])]
    .map((id) => taste.index.get(id))
    .filter((i): i is number => i !== undefined);
  const likeProbe: Probe | null = liked.length ? probeOf(taste, liked) : null;
  const likeness = likeProbe ? simsTo(taste, likeProbe) : null;
  const all = taste.songs.map((_, i) => i).filter(playable);

  const since = now - 14 * DAY_MS;
  const added = (i: number) => known.get(taste.songs[i].id)?.addedAt ?? 0;
  const fresh = all.filter((i) => added(i) >= since).sort(likeness ? (a, b) => likeness[b] - likeness[a] : (a, b) => added(b) - added(a));
  mixes.push({ id: "new-for-you", kind: "newForYou", ids: fresh.slice(0, MIX_SIZE).map((i) => taste.songs[i].id) });

  const forgotten = [...listens.all]
    .filter(([id, n]) => n >= 3 && listens.last.get(id)! < now - 60 * DAY_MS && known.has(id))
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);
  mixes.push({ id: "forgotten", kind: "forgotten", ids: forgotten.slice(0, MIX_SIZE) });

  const mood = (kind: "upbeat" | "calm", test: (s: NonNullable<Taste["songs"][number]["scores"]>) => boolean) => {
    let pool = all.filter((i) => {
      const s = taste.songs[i].scores;
      return !!s && test(s);
    });
    if (likeness) pool = pool.sort((a, b) => likeness[b] - likeness[a]).slice(0, 100);
    const picked = capArtists(shuffleWith(pool, seeded(`${day}:${kind}`)), MIX_SIZE, 2, artistOf);
    mixes.push({ id: kind, kind, ids: picked.map((i) => taste.songs[i].id) });
  };
  mood("upbeat", (s) => s.energy >= 4 && s.valence >= 4);
  mood("calm", (s) => s.energy <= 2 && s.acoustic >= 4);

  return mixes.filter((m) => m.ids.length >= MIN_SIZE);
}
