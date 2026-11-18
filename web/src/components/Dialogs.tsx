import { CheckIcon, PlusIcon } from "@phosphor-icons/react";
import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { useT, type Messages } from "../i18n";
import { cn } from "../lib/format";
import { paths } from "../lib/routes";
import { useLibrary } from "../stores/library";
import { useUi } from "../stores/ui";
import { Artwork } from "./Artwork";
import { Modal } from "./Modal";

export function AddToPlaylistDialog() {
  const tracks = useUi((s) => s.addToPlaylist);
  const close = useUi((s) => s.openAddToPlaylist);
  const playlists = useLibrary((s) => s.playlists);
  const add = useLibrary((s) => s.addToPlaylist);
  const create = useLibrary((s) => s.createPlaylist);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const many = !!tracks && tracks.length > 1;
  const t = useT();

  useEffect(() => {
    if (tracks) {
      setCreating(playlists.length === 0);
      setName("");
    }
  }, [tracks]);

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!tracks || !name.trim()) return;
    const p = await create(name, tracks);
    if (p) close(null);
  };

  return (
    <Modal
      open={!!tracks}
      onClose={() => close(null)}
      title={many ? t.dialogs.addManyToPlaylist(tracks?.length ?? 0) : t.dialogs.addToPlaylist}
    >
      {creating ? (
        <form onSubmit={onCreate} className="flex flex-col gap-3">
          <label htmlFor="new-playlist" className="text-sm text-fg-2">
            {t.dialogs.newPlaylistName}
          </label>
          <input
            id="new-playlist"
            autoFocus
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.dialogs.namePlaceholder}
            className="h-12 rounded-full border border-line-strong bg-surface-1 px-5 text-[15px] placeholder:text-fg-3 focus:border-accent focus:outline-none"
          />
          <div className="flex justify-end gap-2 pt-1">
            {playlists.length > 0 && (
              <button type="button" onClick={() => setCreating(false)} className="h-11 rounded-full px-5 text-sm font-medium text-fg-2 hover:text-fg">
                {t.common.back}
              </button>
            )}
            <button
              type="submit"
              disabled={!name.trim()}
              className="h-11 rounded-full bg-accent px-6 text-sm font-semibold text-accent-ink transition-transform active:scale-[0.97] disabled:opacity-40"
            >
              {t.dialogs.createAndAdd}
            </button>
          </div>
        </form>
      ) : (
        <div className="-mx-1 flex max-h-[55dvh] flex-col overflow-y-auto scroll-area">
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-3"
          >
            <span className="grid size-11 place-items-center rounded-[10px] bg-accent-soft text-accent-text">
              <PlusIcon size={20} />
            </span>
            <span className="font-medium">{t.nav.newPlaylist}</span>
          </button>
          {playlists.map((p) => {
            // Marked when it already has every track being added; picking it still asks whether to add them again.
            const has = !!tracks && tracks.every((x) => p.tracks.some((t) => t.id === x.id));
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  if (!tracks) return;
                  close(null);
                  void add(p.id, tracks);
                }}
                className="flex items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-3"
              >
                <Artwork src={p.tracks[0]?.thumb} className="size-11 rounded-[10px]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="block text-sm text-fg-2">{t.common.tracks(p.tracks.length)}</span>
                </span>
                {has && <CheckIcon size={18} className="text-accent-text" />}
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

/** 「이미 있는 N곡은 빼고 넣을까요?」: leaving them out is the default (Enter). */
export function DuplicatesDialog() {
  const ask = useUi((s) => s.duplicates);
  const t = useT();
  const all = !!ask && ask.dupes === ask.total;
  const button = "h-11 rounded-full px-5 text-sm font-medium transition-transform active:scale-[0.97]";
  return (
    <Modal open={!!ask} onClose={() => ask?.answer(null)} title={t.basics.dupTitle}>
      {ask && (
        <>
          <p className="text-sm text-fg-2">{all ? t.basics.dupAllBody(ask.dupes, ask.name) : t.basics.dupBody(ask.dupes, ask.name)}</p>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            {all ? (
              <>
                <button type="button" onClick={() => ask.answer("all")} className={cn(button, "text-fg-2 hover:text-fg")}>
                  {t.basics.dupAnyway}
                </button>
                <button type="button" autoFocus onClick={() => ask.answer(null)} className={cn(button, "bg-accent px-6 font-semibold text-accent-ink")}>
                  {t.common.cancel}
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => ask.answer("all")} className={cn(button, "text-fg-2 hover:text-fg")}>
                  {t.basics.dupAll}
                </button>
                <button type="button" autoFocus onClick={() => ask.answer("skip")} className={cn(button, "bg-accent px-6 font-semibold text-accent-ink")}>
                  {t.basics.dupSkip}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

/** Renaming or deleting a playlist, from its page or any of its menus (sidebar, library, home). */
export function PlaylistEditDialogs() {
  const edit = useUi((s) => s.playlistEdit);
  const setEdit = useUi((s) => s.setPlaylistEdit);
  const playlist = useLibrary((s) => s.playlists.find((p) => p.id === edit?.id));
  const navigate = useNavigate();
  const location = useLocation();
  const t = useT();
  const close = () => setEdit(null);

  return (
    <>
      <NamePlaylistDialog
        open={edit?.kind === "rename" && !!playlist}
        initial={playlist?.name}
        title={t.collection.renameTitle}
        action={t.collection.save}
        onClose={close}
        onSubmit={(n) => {
          if (playlist) void useLibrary.getState().renamePlaylist(playlist.id, n);
          close();
        }}
      />
      <Modal open={edit?.kind === "delete" && !!playlist} onClose={close} title={t.collection.deleteTitle}>
        <p className="text-sm text-fg-2">{playlist && t.collection.deleteBody(playlist.name, playlist.tracks.length)}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={close} className="h-11 rounded-full px-5 text-sm font-medium text-fg-2 hover:text-fg">
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={() => {
              close();
              if (!playlist) return;
              void useLibrary.getState().deletePlaylist(playlist.id);
              if (location.pathname === paths.playlist(playlist.id)) navigate(paths.library);
            }}
            className="h-11 rounded-full bg-danger px-6 text-sm font-semibold text-white"
          >
            {t.collection.delete}
          </button>
        </div>
      </Modal>
    </>
  );
}

export function NamePlaylistDialog({
  open,
  initial = "",
  title,
  action,
  onSubmit,
  onClose,
}: {
  open: boolean;
  initial?: string;
  title: string;
  action: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const t = useT();
  useEffect(() => {
    if (open) setName(initial);
  }, [open, initial]);

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSubmit(name.trim());
        }}
        className="flex flex-col gap-3"
      >
        <label htmlFor="playlist-name" className="text-sm text-fg-2">
          {t.dialogs.name}
        </label>
        <input
          id="playlist-name"
          autoFocus
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.dialogs.namePlaceholder}
          className="h-12 rounded-full border border-line-strong bg-surface-1 px-5 text-[15px] placeholder:text-fg-3 focus:border-accent focus:outline-none"
        />
        <div className="flex justify-end pt-1">
          <button
            type="submit"
            disabled={!name.trim()}
            className="h-11 rounded-full bg-accent px-6 text-sm font-semibold text-accent-ink transition-transform active:scale-[0.97] disabled:opacity-40"
          >
            {action}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Each shortcut's keys and what it does, in the current language. */
const SHORTCUTS: [keys: (t: Messages) => string, what: (t: Messages) => string][] = [
  [(t) => t.dialogs.space, (t) => t.dialogs.shortcuts.playPause],
  [() => "← →", (t) => t.dialogs.shortcuts.seek],
  [() => "Shift + ← →", (t) => t.dialogs.shortcuts.skip],
  [() => "↑ ↓", (t) => t.dialogs.shortcuts.volume],
  [() => "M", (t) => t.dialogs.shortcuts.mute],
  [() => "L", (t) => t.dialogs.shortcuts.favorite],
  [() => "S", (t) => t.dialogs.shortcuts.shuffle],
  [() => "R", (t) => t.dialogs.shortcuts.repeat],
  [() => "V", (t) => t.dialogs.shortcuts.video],
  [() => "F", (t) => t.dialogs.shortcuts.theater],
  [() => "Q", (t) => t.dialogs.shortcuts.queue],
  [() => "/ · Ctrl + F", (t) => t.dialogs.shortcuts.search],
  [(t) => `Ctrl + ${t.basics.click}`, (t) => t.basics.keyToggle],
  [(t) => `Shift + ${t.basics.click}`, (t) => t.basics.keyRange],
  [() => "Ctrl + A", (t) => t.basics.keySelectAll],
  [() => "Esc", (t) => t.basics.keyClear],
  [() => "?", (t) => t.dialogs.shortcuts.help],
];

export function ShortcutsDialog() {
  const open = useUi((s) => s.shortcutsOpen);
  const setOpen = useUi((s) => s.setShortcutsOpen);
  const t = useT();
  return (
    <Modal open={open} onClose={() => setOpen(false)} title={t.dialogs.shortcutsTitle}>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5 text-sm">
        {SHORTCUTS.map(([keys, what]) => (
          <div key={what(t)} className="contents">
            <dt className="flex justify-end">
              <kbd className="kbd">{keys(t)}</kbd>
            </dt>
            <dd className="text-fg-2">{what(t)}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
