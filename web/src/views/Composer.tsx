import { CaretDownIcon, DotsThreeIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useParams } from "react-router";
import { Artwork } from "../components/Artwork";
import { Cover } from "../components/Cover";
import { IconButton } from "../components/IconButton";
import { menuTrigger, NO_CALLOUT, openMenuFromButton } from "../components/menuTrigger";
import { performanceMenu } from "../components/menus";
import { BackButton, EmptyState, PageHeader } from "../components/Page";
import { TrackList, TrackListSkeleton } from "../components/TrackList";
import { useRemote } from "../hooks/useRemote";
import { useT } from "../i18n";
import { cn } from "../lib/format";
import { paths } from "../lib/routes";
import { server, type ComposerPage } from "../lib/server";

type Performance = ComposerPage["works"][number]["instances"][number];

/** One performance of a work: performer, album and track count; opens to its movements, ⋯ plays or queues it whole. */
function PerformanceRow({ work, p }: { work: string; p: Performance }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const performer = p.performer || t.works.unknownPerformer;
  const menu = () => performanceMenu({ key: p.key, work, performer: p.performer, count: p.tracks.length }, p.tracks[0]?.thumb, p.tracks);
  return (
    <li>
      <div className="flex items-center gap-1 rounded-xl pr-1 transition-colors hover:bg-surface-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          {...menuTrigger(menu)}
          className={cn("flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2 text-left", NO_CALLOUT)}
        >
          <Artwork src={p.tracks[0]?.thumb} className="size-12 shrink-0 rounded-lg" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{performer}</span>
            <span className="block truncate text-sm text-fg-2">{[t.common.tracks(p.tracks.length), p.album].filter(Boolean).join(" · ")}</span>
          </span>
          <CaretDownIcon size={18} className={cn("shrink-0 text-fg-2 transition-transform", open && "rotate-180")} />
        </button>
        <IconButton label={t.basics.menuFor(performer)} onClick={(e) => openMenuFromButton(e, menu())}>
          <DotsThreeIcon size={22} weight="bold" />
        </IconButton>
      </div>
      {open && (
        <div className="pb-2 md:pl-12">
          <TrackList tracks={p.tracks} showAlbum={false} header={false} selectable={false} />
        </div>
      )}
    </li>
  );
}

/** A composer: works with my tracks (most first), each performance of a work on a row of its own; tracks without a work after. */
export default function Composer() {
  const { name = "" } = useParams();
  const t = useT();
  const page = useRemote(`composer:${name}`, (signal) => server.composer(name, signal));
  const data = page.status === "ok" ? page.data : null;
  const cover = data ? [...data.works.flatMap((w) => w.instances.map((p) => p.tracks[0])), ...data.others] : [];

  return (
    <div className="pb-8">
      <PageHeader title={name} actions={<BackButton fallback={paths.composers()} />} />

      <div className="relative">
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 -top-20 h-72 bg-linear-to-b from-accent-soft to-transparent" />
        <div className="relative flex flex-col items-center gap-5 px-4 pt-2 pb-6 md:flex-row md:items-end md:gap-6 md:px-6 md:pt-6">
          {cover.length ? (
            <Cover kind="playlist" tracks={cover} iconSize={64} className="size-36 shrink-0 overflow-hidden rounded-[18px] shadow-[0_24px_60px_rgb(0_0_0/0.4)] md:size-44" />
          ) : (
            <span className="skeleton size-36 shrink-0 rounded-[18px] md:size-44" />
          )}
          <div className="flex min-w-0 flex-col items-center gap-2 text-center md:items-start md:text-left">
            <span className="text-xs font-medium text-fg-2">{t.works.composers}</span>
            <h1 className="max-w-full text-[28px] leading-[1.1] font-bold tracking-tight break-words md:text-5xl">{name}</h1>
            {data && <p className="text-sm text-fg-2">{t.works.composerSub(data.count, data.works.length)}</p>}
          </div>
        </div>
      </div>

      {page.status === "loading" && <TrackListSkeleton />}
      {page.status === "error" && (
        <EmptyState
          icon={<WarningCircleIcon size={28} />}
          title={t.taste.openFailed}
          body={page.message}
          action={
            <button type="button" onClick={page.retry} className="mt-2 h-11 rounded-full bg-surface-3 px-6 text-sm font-medium hover:bg-surface-4">
              {t.common.retry}
            </button>
          }
        />
      )}
      {data && (
        <div className="flex flex-col gap-6">
          {data.works.map((w) => (
            <section key={w.work} className="px-2 md:px-4">
              <div className="px-2 pb-1">
                <h2 className="text-lg font-semibold tracking-tight">{w.work}</h2>
                <p className="text-xs text-fg-2">
                  {t.works.performances(w.instances.length)} · {t.common.tracks(w.count)}
                </p>
              </div>
              <ul className="flex flex-col">
                {w.instances.map((p) => (
                  <PerformanceRow key={p.key} work={w.work} p={p} />
                ))}
              </ul>
            </section>
          ))}
          {data.others.length > 0 && (
            <section className="px-2 md:px-3">
              <h2 className="px-2 pb-2 text-lg font-semibold tracking-tight">{t.works.otherTracks}</h2>
              <TrackList tracks={data.others} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
