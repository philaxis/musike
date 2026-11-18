"""작곡가·작품·앨범·악장·연주(판본) 정규화.

곡에서 작곡가·앨범으로 가고, 「이 악장이 든 작품의 이 연주 전체」를 한 번에 고르기 위한 값이다.
- 작곡가: 'Brahms'·'J. Brahms'·'Johannes Brahms' 를 하나로(성 + 이름 첫 글자, 성만 있으면 그 성의 가장 흔한 사람).
- 작품: 'Op 78'·'Op.78' → 'Op. 78', 'No 1' → 'No. 1', 'B Minor' → 'B minor'. 같은 작곡가에서 같은 작품 번호(Op./BWV/K. …)면
  같은 작품으로 보고 가장 흔한(같으면 긴) 표기로 묶는다.
- 악장: 제목 끝의 'II. Adagio', ': 2. …', ': No. 4 …' 에서 번호·이름.
- 연주(instance): 정규화 작곡가 + 작품 + 주 연주자(+ 앨범). 작품이 없으면 null.
"""

from __future__ import annotations

import collections
import re
import unicodedata

ROMAN = {"I": 1, "V": 5, "X": 10, "L": 50}
SURNAME_ALIASES = {
    "rachmaninov": "rachmaninoff",
    "rachmaninow": "rachmaninoff",
    "tschaikowsky": "tchaikovsky",
    "tchaikowsky": "tchaikovsky",
    "prokofieff": "prokofiev",
    "prokofjew": "prokofiev",
    "schostakowitsch": "shostakovich",
    "strawinsky": "stravinsky",
    "skrjabin": "scriabin",
    "medtner": "medtner",
    "handel": "handel",
    "haendel": "handel",
    "kapoustine": "kapustin",
}
PARTICLES = {"van", "von", "de", "der", "da", "di", "del", "le", "la", "du"}
CATALOG = re.compile(
    r"\b(Op\.\s*posth\.|Op\.\s*\d+[a-z]?(?:,?\s*No\.\s*\d+)?|BWV\s*\d+[a-z]?|HWV\s*\d+|RV\s*\d+|K\.\s*\d+[a-z]?|KV\s*\d+|D\.\s*\d+"
    r"|Hob\.\s*[IVXL]+:\s*\d+|L\.\s*\d+|CD\s*\d+|FP\s*\d+|M\.\s*\d+|S\.\s*\d+|T\.\s*\d+|Kind\.\s*\d+|TH\s*\d+|WoO\s*\d+|Sz\.\s*\d+|B\.\s*\d+)",
)


def fold(text: str) -> str:
    """비교용: 악센트·대소문자·문장부호·공백을 지운다."""
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"[\W_]+", "", text.casefold())


# ---------------------------------------------------------------- 작곡가

def _composer_parts(name: str) -> tuple[str, list[str]]:
    """(접은 성, 접은 이름들). 'J.S. Bach' → ('bach', ['js']) 이 아니라 ['j','s'], 'Bach, Johann Sebastian' 도 읽는다."""
    if name.count(",") == 1:
        last, first = (p.strip() for p in name.split(","))
        name = f"{first} {last}"
    words = [w for w in re.split(r"[\s.]+", name.strip()) if w]
    if not words:
        return "", []
    surname = fold(words[-1])
    surname = SURNAME_ALIASES.get(surname, surname)
    given = [fold(w) for w in words[:-1] if w.casefold() not in PARTICLES and fold(w)]
    return surname, given


def _same_person(a: list[str], b: list[str]) -> bool:
    """이름 부분이 같은 사람으로 보이나: 첫 이름이 약자·앞부분이거나 철자가 거의 같고, 둘째 이름도 어긋나지 않는다."""
    import difflib

    def close(x: str, y: str) -> bool:
        if len(x) == 1 or len(y) == 1:
            return x[0] == y[0]
        return x.startswith(y) or y.startswith(x) or difflib.SequenceMatcher(None, x, y).ratio() >= 0.8

    if not a or not b or not close(a[0], b[0]):
        return False
    # 둘째 이름은 양쪽에 다 있을 때만 맞춰 본다('Nikolai' ↔ 'Nikolaj Girševič' 는 같은 사람)
    return all(close(x, y) for x, y in zip(a[1:], b[1:]))


def composer_map(names: list[str]) -> dict[str, str]:
    """카드에 나온 작곡가 표기들 → 정규화 이름. 여러 사람('A, B' / 'A & B')은 그대로 둔다.

    같은 성에서 이름이 맞는(약자·앞부분·거의 같은 철자) 표기끼리 묶고, 이름을 다 쓴 흔한 표기를 대표로 쓴다.
    성만 쓴 표기('Brahms')는 그 성을 가진 사람이 하나뿐이고 그 사람이 2곡 이상일 때만 붙인다.
    """
    counts = collections.Counter(n.strip() for n in names if n and n.strip())
    singles = [n for n in counts if not re.search(r"[&/;]| and |, .+ ", n)]
    people: dict[str, list[list[str]]] = collections.defaultdict(list)  # 성 → [표기 묶음]
    parts = {n: _composer_parts(n) for n in singles}
    for n in sorted(singles, key=lambda n: -counts[n]):
        surname, given = parts[n]
        if not surname or not given:
            continue
        for person in people[surname]:
            if _same_person(given, parts[person[0]][1]):
                person.append(n)
                break
        else:
            people[surname].append([n])

    def best(person: list[str]) -> str:
        # 첫 이름을 약자 없이 쓴 표기 중 가장 흔한 것(같으면 이름을 더 다 쓴 것)
        return max(person, key=lambda n: (len(re.split(r"[\s.]+", n)[0]) > 2, not n.isupper(), counts[n], sum(len(w) > 2 for w in re.split(r"[\s.]+", n)), len(n)))

    out = {n: n for n in counts}
    for surname, persons in people.items():
        for person in persons:
            rep = best(person)
            for n in person:
                out[n] = rep
    for n in singles:
        surname, given = parts[n]
        if surname and not given and len(people.get(surname, [])) == 1:
            person = people[surname][0]
            if sum(counts[x] for x in person) >= 2:
                out[n] = best(person)
    return out


# ---------------------------------------------------------------- 작품


def tidy_work(text: str | None, composer: str | None = None) -> str | None:
    """작품 표기 다듬기. 앞의 '작곡가: ' 는 뗀다."""
    if not text:
        return None
    w = " ".join(str(text).replace("№", "No.").split())
    if composer:
        surname = composer.split()[-1]
        w = re.sub(rf"^{re.escape(surname)}\s*[:\-–]\s*", "", w, flags=re.IGNORECASE)
    w = re.sub(r"\bOp\.?\s*(?=\d)", "Op. ", w, flags=re.IGNORECASE)
    w = re.sub(r"\bOp\. ", "Op. ", w)
    w = re.sub(r"\bNos?\.?\s*(?=\d)", lambda m: "Nos. " if m.group(0).lower().startswith("nos") else "No. ", w)
    w = re.sub(r"\b(BWV|HWV|RV|KV|WoO|FP|CD|TH)\.?\s*(?=\d)", lambda m: m.group(1) + " ", w)
    w = re.sub(r"\bK\.?\s*(?=\d)", "K. ", w)
    w = re.sub(
        r"\bin ([A-G])(?:[\s-]?(flat|sharp|♭|♯))?[\s-]+(major|minor|dur|moll)\b",
        lambda m: "in "
        + m.group(1).upper()
        + ({"flat": "-flat", "♭": "-flat", "sharp": "-sharp", "♯": "-sharp"}.get((m.group(2) or "").lower(), ""))
        + " "
        + {"dur": "major", "moll": "minor"}.get(m.group(3).lower(), m.group(3).lower()),
        w,
        flags=re.IGNORECASE,
    )
    w = re.sub(r"\s+,", ",", w)
    # 작품 칸에 악장까지 들어온 표기('2 Arabesques, L. 66: No. 1, Andantino')는 악장 앞까지
    w = re.sub(r":\s*(?:[IVX]{1,5}\.|\d{1,2}\.|No\.\s*\d+)(?:\s.*|,.*)?$", "", w)
    w = w.strip(" ,;:-")
    return w or None


def catalog_number(work: str) -> str | None:
    m = CATALOG.search(work or "")
    return fold(m.group(1)) if m else None


KEY_SIG = re.compile(r"\bin ([A-G](?:-flat|-sharp)? (?:major|minor))\b")


def key_signature(work: str) -> str | None:
    m = KEY_SIG.search(work or "")
    return m.group(1) if m else None


def work_map(pairs: list[tuple[str, str]]) -> dict[tuple[str, str], str]:
    """(정규화 작곡가, 다듬은 작품) → 대표 작품 표기(가장 흔한, 같으면 긴 것).

    작곡가가 있을 때만 묶는다: 같은 작품 번호(Op./BWV/K. …)이고 조성이 어긋나지 않으면 같은 작품, 접어서 같은 글자도 같은 작품,
    번호 없는 짧은 표기('Piano Concerto No. 2')가 번호 있는 다른 작품 하나로만 이어지면('… in C minor, Op. 18') 그쪽으로.
    """
    counts = collections.Counter(pairs)
    by_composer: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for (c, w), n in counts.items():
        by_composer[c][w] += n
    out: dict[tuple[str, str], str] = {}
    for composer, works in by_composer.items():
        if not composer:
            for w in works:
                out[(composer, w)] = w
            continue
        groups: dict[str, list[str]] = collections.defaultdict(list)
        for w in works:
            groups[catalog_number(w) or "text:" + fold(w)].append(w)
        # 같은 번호라도 조성이 다르면 다른 작품: 조성별로 나누고 조성 없는 표기는 가장 큰 쪽에
        for k in [k for k in groups if not k.startswith("text:")]:
            keys = collections.Counter()
            for w in groups[k]:
                if key_signature(w):
                    keys[key_signature(w)] += works[w]
            if len(keys) > 1:
                top = keys.most_common(1)[0][0]
                for w in list(groups[k]):
                    sig = key_signature(w)
                    if sig and sig != top:
                        groups[k].remove(w)
                        groups[f"{k}:{fold(sig)}"].append(w)
        rep = {k: max(ws, key=lambda w: (works[w], len(w))) for k, ws in groups.items() if ws}
        for k, ws in groups.items():
            for w in ws:
                out[(composer, w)] = rep[k]
        numbered = [r for k, r in rep.items() if not k.startswith("text:")]
        for k, w in rep.items():
            if not k.startswith("text:"):
                continue
            longer = [r for r in numbered if re.match(re.escape(w) + r"[ ,(]", r, flags=re.IGNORECASE)]
            if len(longer) == 1:
                for x in groups[k]:
                    out[(composer, x)] = longer[0]
    return out


# ---------------------------------------------------------------- 악장


def _roman(text: str) -> int | None:
    text = text.upper()
    if not re.fullmatch(r"X{0,3}(IX|IV|V?I{0,3})", text) or not text:
        return None
    total = 0
    for i, ch in enumerate(text):
        v = ROMAN[ch]
        total += -v if i + 1 < len(text) and ROMAN[text[i + 1]] > v else v
    return total


MOVEMENT_PATTERNS = [
    re.compile(r"(?:^|[:\-–—]\s*)([IVX]{1,5})\.\s+(?P<title>.*)$"),
    re.compile(r"[:–—]\s*(\d{1,2})\.\s+(?P<title>.*)$"),
    re.compile(r"[:–—]\s*No\.?\s*(\d{1,3})\b[.,:]?\s*(?P<title>.*)$", re.IGNORECASE),
    re.compile(r"[:–—]\s*(?P<title>Var(?:iation|\.)?\s*(\d{1,3})\b.*)$", re.IGNORECASE),
]


def movement(title: str | None) -> dict | None:
    """제목 끝의 악장 번호·이름. 'Op. 85: II. Lento - Allegro molto' → {n: 2, title: 'Lento - Allegro molto'}."""
    if not title:
        return None
    for i, pat in enumerate(MOVEMENT_PATTERNS):
        m = pat.search(title)
        if not m:
            continue
        num = m.group(2) if i == 3 else m.group(1)
        n = _roman(num) if i == 0 else int(num)
        if not n:
            continue
        name = m.group("title").strip(" .-–—")
        # 잘린 괄호·실황/리마스터 꼬리표는 뗀다
        name = re.sub(r"\s*\([^)]*$", "", name)
        name = re.sub(r"\s*\((?:[^)]*\b(?:live|remaster\w*|version|mono|stereo|edit)\b[^)]*)\)\s*$", "", name, flags=re.IGNORECASE)
        name = name.strip(" .-–—/…")
        # ': No. 4 in E Minor. Allegretto' → 'Allegretto'
        name = re.sub(r"^in [A-G](?:[\s-]?(?:flat|sharp))?\s+(?:major|minor)\b[.,:]?\s*", "", name, flags=re.IGNORECASE)
        return {"n": n, "title": name if re.search(r"\w", name) else None}
    return None


# ---------------------------------------------------------------- 연주(판본)


def main_performer(artist: str | None) -> str | None:
    if not artist:
        return None
    first = re.split(r"\s*(?:[,·&/;]|\band\b|\bfeat\.?)\s*", artist.strip())[0]
    return re.sub(r"\s*-\s*Topic$", "", first, flags=re.IGNORECASE).strip() or None


def annotate(rows: list[dict]) -> list[dict]:
    """rows: {composer, work, artist, album, title, genre}(카드 표기) → 같은 순서로 {composer, work, album, movement, instance}.

    전체 곡을 한꺼번에 봐야 표기를 묶을 수 있어서 목록을 받는다. 작품·악장·연주는 클래식 곡만 채운다(다른 갈래는 album 까지).
    """
    cmap = composer_map([r.get("composer") or "" for r in rows])
    composers = [cmap.get((r.get("composer") or "").strip()) if r.get("composer") else None for r in rows]
    works = [tidy_work(r.get("work"), c) if r.get("genre") == "클래식" else None for r, c in zip(rows, composers)]
    wmap = work_map([(c or "", w) for c, w in zip(composers, works) if w])
    works = [wmap.get((c or "", w), w) if w else None for c, w in zip(composers, works)]

    # 앨범이 빠진 곡: 같은 작곡가·작품·연주자의 앨범이 하나뿐이면 그것
    albums_of: dict[tuple, set] = collections.defaultdict(set)
    perf = [main_performer(r.get("artist")) for r in rows]
    for r, c, w, p in zip(rows, composers, works, perf):
        if w and r.get("album"):
            albums_of[(c, w, fold(p or ""))].add(r["album"])

    out = []
    for r, c, w, p in zip(rows, composers, works, perf):
        album = r.get("album") or None
        instance = None
        if w:
            if not album and len(albums_of[(c, w, fold(p or ""))]) == 1:
                album_key = next(iter(albums_of[(c, w, fold(p or ""))]))
            else:
                album_key = album or ""
            instance = " | ".join([c or "?", w, p or "?", album_key])
        out.append(
            {
                "composer": c,
                "work": w,
                "album": album,
                "movement": movement(r.get("title")) if w else None,
                "instance": instance,
            }
        )
    return out
