import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";
import { useT } from "../i18n";
import { cn } from "../lib/format";
import { useLocal } from "../stores/local";

/**
 * "숨긴 것 보기": "내 음악" lists hidden folders, albums and tracks too, dimmed, so they can be shown again.
 * Not rendered in TV mode (callers check), where hidden items never appear.
 */
export function ShowHiddenToggle() {
  const show = useLocal((s) => s.showHidden);
  const setShow = useLocal((s) => s.setShowHidden);
  const t = useT();
  return (
    <button
      type="button"
      aria-pressed={show}
      onClick={() => setShow(!show)}
      className={cn(
        "flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors",
        show ? "bg-accent-soft text-accent-text" : "text-fg-2 hover:bg-surface-3 hover:text-fg",
      )}
    >
      {show ? <EyeIcon size={18} /> : <EyeSlashIcon size={18} />}
      {t.hide.showHidden}
    </button>
  );
}
