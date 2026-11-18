import { PlusIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useT } from "../i18n";
import { cn } from "../lib/format";
import { isLocal, server, type BoxSource, type Versions } from "../lib/server";
import type { Track } from "../lib/types";
import { usePlayer } from "../player/player";
import { useLibrary } from "../stores/library";
import { setTagEdit, useTagEdits } from "../stores/tags";
import { toast, useUi } from "../stores/ui";
import { Artwork } from "./Artwork";
import { Modal } from "./Modal";

// Tags are short free-form labels ("작품:Asayake", "편곡:브라스"). Hermes adds most of them; these are the hand tools.

const WORK = "작품:";
/** The kinds Hermes uses (see its skill file), offered as quick starts in the tags dialog. */
const KINDS = ["작품:", "판본:", "편곡:", "작곡:", "연주:", "분위기:", "장르:"];

/** Tags as small chips under a row: the work first, each showing what follows its kind ("1985 라이브"). */
export function TagChips({ tags, className }: { tags: string[]; className?: string }) {
  if (!tags.length) return null;
  const sorted = [...tags.filter((t) => t.startsWith(WORK)), ...tags.filter((t) => !t.startsWith(WORK))];
  return (
    <span className={cn("flex min-w-0 flex-wrap gap-1", className)}>
      {sorted.map((tag) => (
        <span
          key={tag}
          title={tag}
          className={cn(
            "max-w-full truncate rounded-full px-2 py-px text-[11px] leading-4",
            tag.startsWith(WORK) ? "bg-accent-soft font-medium text-accent-text" : "bg-surface-3 text-fg-2",
          )}
        >
          {tag.includes(":") ? tag.slice(tag.indexOf(":") + 1) : tag}
        </span>
      ))}
    </span>
  );
}

/** "11-18", or "2025-11-18" from another year. */
function shortDate(ms: number): string {
  const d = new Date(ms);
  const md = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()}-${md}`;
}

/** Where a box track came from, in one line: 「유튜브 '좋은 노래' · 11-18」, 「내 폴더 · 카시오페아」. */
export function useSourceText() {
  const t = useT().songBox;
  return (s: Pick<BoxSource, "kind" | "name"> & { at?: number }) => {
    const name =
      s.kind === "youtube-playlist"
        ? t.fromPlaylist(s.name)
        : s.kind === "youtube-liked"
          ? t.fromLiked
          : s.kind === "local"
            ? t.fromLocal(s.name)
            : [s.kind === "link" ? t.fromLink : t.fromSearch, s.name].filter(Boolean).join(" ");
    return s.at ? `${name} · ${shortDate(s.at)}` : name;
  };
}

/** A track's tags: edited here, a bundle's from the library, else its song-box row (found by its title). */
async function currentTags(track: Track): Promise<string[]> {
  const edited = useTagEdits.getState().edits[track.id];
  if (edited) return edited;
  if (track.kind === "bundle") return useLibrary.getState().bundles?.find((b) => b.id === track.id)?.tags ?? [];
  const page = await server.box({ q: track.title.slice(0, 200) });
  return page.items.find((it) => it.track.id === track.id)?.tags ?? [];
}

/** Track menu 「꼬리표」 (phones and laptops): add and remove tags by hand. */
export function TagsDialog() {
  const track = useUi((s) => s.tagsFor);
  const t = useT();
  return (
    <Modal open={!!track} onClose={() => useUi.getState().openTags(null)} title={track ? t.songBox.tagsOf(track.title) : ""}>
      {track && <TagsEditor track={track} />}
    </Modal>
  );
}

function TagsEditor({ track }: { track: Track }) {
  const [tags, setTags] = useState<string[] | null>(null);
  const [known, setKnown] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const t = useT();

  useEffect(() => {
    setTags(null);
    setText("");
    let live = true;
    currentTags(track).then(
      (list) => live && setTags(list),
      () => live && setTags([]),
    );
    server.tags().then((list) => live && setKnown(list.map((x) => x.tag)), () => {});
    return () => {
      live = false;
    };
  }, [track]);

  const save = (next: string[]) => {
    setTags(next);
    setTagEdit(track.id, next);
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const tag = text.replace(/\s+/g, " ").trim();
    if (!tag || !tags || tags.includes(tag)) return setText("");
    setBusy(true);
    try {
      let r = await server.addTags([track.id], [tag]);
      // A YouTube track from a search or a playlist goes into the box first, as added by hand.
      if (r.missing.length && !isLocal(track) && track.kind !== "bundle") {
        const { part: _, ...plain } = track;
        await server.addToBox([plain]);
        r = await server.addTags([track.id], [tag]);
      }
      if (r.missing.length) toast(t.songBox.cantTag, "error");
      else {
        save([...tags, tag]);
        setText("");
      }
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (tag: string) => {
    if (!tags) return;
    const before = tags;
    save(tags.filter((x) => x !== tag));
    try {
      await server.removeTags([track.id], [tag]);
    } catch (err) {
      save(before);
      toast((err as Error).message, "error");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {tags === null ? (
        <div className="skeleton h-7 w-40 rounded-full" />
      ) : tags.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <li key={tag}>
              <button
                type="button"
                onClick={() => void remove(tag)}
                aria-label={t.songBox.removeTag(tag)}
                title={t.songBox.removeTag(tag)}
                className={cn(
                  "flex h-8 items-center gap-1 rounded-full pr-2 pl-3 text-sm",
                  tag.startsWith(WORK) ? "bg-accent-soft text-accent-text" : "bg-surface-3 text-fg",
                )}
              >
                {tag} <XIcon size={14} className="opacity-70" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-2">{t.songBox.noTagsYet}</p>
      )}

      <form onSubmit={(e) => void add(e)} className="flex gap-2">
        <input
          ref={input}
          value={text}
          maxLength={80}
          list="musike-tags"
          onChange={(e) => setText(e.target.value)}
          placeholder={t.songBox.tagPlaceholder}
          aria-label={t.songBox.tags}
          className="h-11 min-w-0 flex-1 rounded-full border border-line-strong bg-surface-1 px-4 text-[15px] placeholder:text-fg-3 focus:border-accent focus:outline-none"
        />
        <datalist id="musike-tags">
          {known.map((tag) => (
            <option key={tag} value={tag} />
          ))}
        </datalist>
        <button
          type="submit"
          disabled={busy || !text.trim() || tags === null}
          className="flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-40"
        >
          <PlusIcon size={16} weight="bold" /> {t.songBox.addTag}
        </button>
      </form>

      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-fg-3">{t.songBox.tagsHint}</p>
        <div className="flex flex-wrap gap-1">
          {KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => {
                setText(kind);
                input.current?.focus();
              }}
              className="h-7 rounded-full bg-surface-1 px-2.5 text-xs text-fg-2 ring-1 ring-line hover:text-fg"
            >
              {kind}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function VersionRow({ track, tags, current }: { track: Track; tags: string[]; current: boolean }) {
  const t = useT();
  return (
    <li>
      <button
        type="button"
        onClick={() => {
          usePlayer.getState().playTrack(track);
          useUi.getState().openVersions(null);
        }}
        className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-surface-3"
      >
        <Artwork src={track.thumb} className="size-11 shrink-0 rounded-[10px]" />
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-[15px] font-medium", current && "text-accent-text")}>{track.title}</span>
          <span className="block truncate text-[13px] text-fg-2">
            {current && `${t.songBox.thisTrack} · `}
            {track.artist}
          </span>
          <TagChips tags={tags.filter((x) => !x.startsWith(WORK))} className="mt-1" />
        </span>
      </button>
    </li>
  );
}

/** Track menu 「같은 작품 다른 버전」: tracks sharing its 작품: tag, the plain versions first, arrangements apart. */
export function VersionsDialog() {
  const track = useUi((s) => s.versionsFor);
  const close = () => useUi.getState().openVersions(null);
  const [data, setData] = useState<Versions | "error" | null>(null);
  const t = useT();

  useEffect(() => {
    if (!track) return;
    setData(null);
    let live = true;
    server.versions(track.id).then(
      (v) => live && setData(v),
      () => live && setData("error"),
    );
    return () => {
      live = false;
    };
  }, [track]);

  const section = (items: Versions["originals"]) => (
    <ul className="flex flex-col">
      {items.map((it) => (
        <VersionRow key={it.track.id} track={it.track} tags={it.tags} current={it.track.id === track?.id} />
      ))}
    </ul>
  );

  return (
    <Modal open={!!track} onClose={close} title={t.songBox.versions}>
      <div className="-mx-1 flex max-h-[60dvh] flex-col gap-3 overflow-y-auto scroll-area">
        {data === null ? (
          <div className="skeleton mx-1 h-14 rounded-xl" />
        ) : data === "error" || !data.works.length ? (
          <p className="px-1 text-sm text-fg-2">{t.songBox.noWork}</p>
        ) : (
          <>
            <p className="px-1 text-sm font-medium text-accent-text">{t.songBox.versionsOf(data.works.join(", "))}</p>
            {section(data.originals)}
            {data.arrangements.length > 0 && (
              <>
                <h3 className="px-1 pt-1 text-xs font-medium text-fg-3">{t.songBox.arrangements}</h3>
                {section(data.arrangements)}
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
