import { useT } from "../i18n";
import { FADE_MAX } from "../player/crossfade";
import { usePlayer } from "../player/player";
import { Slider } from "./Slider";

/** How long tracks overlap in Audio mode (player/crossfade.ts), kept on this device with the other player settings. */
export function FadeSection() {
  const t = useT();
  const fade = usePlayer((s) => s.fade);
  const setFade = usePlayer((s) => s.setFade);
  const text = (v: number) => (Math.round(v) === 0 ? t.fade.off : t.fade.seconds(Math.round(v)));

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-fg-3">{t.fade.section}</h3>
      <div className="flex flex-col gap-3 rounded-[16px] bg-surface-1 px-3 py-3 ring-1 ring-line">
        <div className="flex items-start justify-between gap-3">
          <span>
            <span className="block text-sm font-medium">{t.fade.title}</span>
            <span className="block text-xs text-fg-2">{t.fade.body}</span>
          </span>
          <span className="shrink-0 text-sm font-medium tabular-nums text-fg-2">{text(fade)}</span>
        </div>
        <Slider label={t.fade.title} value={fade} max={FADE_MAX} step={1} live onChange={setFade} valueText={text} showThumb />
      </div>
    </section>
  );
}
