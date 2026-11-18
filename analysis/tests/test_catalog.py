from musike_analysis import catalog


def test_composer_variants_merge():
    names = ["Johannes Brahms"] * 5 + ["Brahms", "J. Brahms", "J.S. Bach", "Johann Sebastian Bach", "C.P.E. Bach", "Yoko Kanno", "Yugo Kanno"]
    m = catalog.composer_map(names)
    assert m["Brahms"] == m["J. Brahms"] == "Johannes Brahms"
    assert m["J.S. Bach"] == "Johann Sebastian Bach"
    assert m["C.P.E. Bach"] == "C.P.E. Bach"
    assert m["Yugo Kanno"] == "Yugo Kanno"


def test_tidy_work():
    assert catalog.tidy_work("Violin Sonata No.1 in G Major Op.78", "Johannes Brahms") == "Violin Sonata No. 1 in G major Op. 78"
    assert catalog.tidy_work("Brahms: Symphony No 3, Op 90", "Johannes Brahms") == "Symphony No. 3, Op. 90"
    assert catalog.tidy_work("2 Arabesques, L. 66: No. 1, Andantino con moto") == "2 Arabesques, L. 66"


def test_work_map_same_catalog_and_prefix():
    c = "Sergei Rachmaninoff"
    pairs = [(c, "Piano Concerto No. 2 in C minor, Op. 18")] * 3 + [(c, "Piano Concerto No. 2"), (c, "Piano Concerto No.2, Op. 18")]
    m = catalog.work_map([(a, catalog.tidy_work(b)) for a, b in pairs])
    assert set(m.values()) == {"Piano Concerto No. 2 in C minor, Op. 18"}


def test_work_map_conflicting_keys_stay_apart():
    c = "X"
    m = catalog.work_map([(c, "Concerto No. 1 in C minor, Op. 35"), (c, "Violin Concerto in D major, Op. 35")])
    assert len(set(m.values())) == 2


def test_movement():
    assert catalog.movement("Elgar: Cello Concerto in E Minor, Op. 85: II. Lento - Allegro molto") == {"n": 2, "title": "Lento - Allegro molto"}
    assert catalog.movement("Scheherazade, Op. 35: 2. The Story of the Calender Prince") == {"n": 2, "title": "The Story of the Calender Prince"}
    assert catalog.movement("24 Preludes, Op. 53: No. 4 in E Minor. Allegretto") == {"n": 4, "title": "Allegretto"}
    assert catalog.movement("IV. Vivace") == {"n": 4, "title": "Vivace"}
    assert catalog.movement("Mahler: Symphony No. 9: II. Im Tempo (Live From Philharmonie, Berlin)") == {"n": 2, "title": "Im Tempo"}
    assert catalog.movement("Ballade No. 1, Op. 23") is None


def test_annotate_instance():
    base = {"composer": "Brahms", "work": "Violin Sonata No. 1, Op. 78", "artist": "Pinchas Zukerman, Marc Neikrug", "genre": "클래식"}
    rows = [
        {**base, "album": "Brahms: Sonatas", "title": "Violin Sonata No. 1, Op. 78: I. Vivace ma non troppo"},
        {**base, "composer": "Johannes Brahms", "work": "Violin Sonata No.1 Op.78", "album": None, "title": "II. Adagio"},
        {**base, "composer": "Johannes Brahms", "album": "Brahms: Sonatas", "title": "III. Allegro molto moderato"},
        {"composer": "Tatsuro Yamashita", "work": "Ride on Time", "artist": "Tatsuro Yamashita", "album": "RIDE ON TIME", "title": "RIDE ON TIME", "genre": "J-pop/시티팝"},
    ]
    out = catalog.annotate(rows)
    assert {o["instance"] for o in out[:3]} == {"Johannes Brahms | Violin Sonata No. 1, Op. 78 | Pinchas Zukerman | Brahms: Sonatas"}
    assert [o["movement"]["n"] for o in out[:3]] == [1, 2, 3]
    assert out[3] == {"composer": "Tatsuro Yamashita", "work": None, "album": "RIDE ON TIME", "movement": None, "instance": None}
