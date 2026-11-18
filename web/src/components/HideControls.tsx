import { DotsThreeIcon, EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useT } from "../i18n";
import { cn } from "../lib/format";
import { useLocal } from "../stores/local";
import { IconButton } from "./IconButton";
import { Modal } from "./Modal";

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

/** The "⋯" of a folder row or album card: hide it, or unhide it when it is hidden. */
export function HideMenu({
  name,
  hidden,
  hideLabel,
  onHide,
  onUnhide,
  className,
}: {
  name: string;
  hidden: boolean;
  hideLabel: string;
  onHide: () => void;
  onUnhide: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const t = useT();
  return (
    <>
      <IconButton label={t.hide.menuFor(name)} className={className} onClick={() => setOpen(true)}>
        <DotsThreeIcon size={22} weight="bold" />
      </IconButton>
      <Modal open={open} onClose={() => setOpen(false)} title={name}>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            (hidden ? onUnhide : onHide)();
          }}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-surface-3"
        >
          {hidden ? <EyeIcon size={18} className="text-fg-2" /> : <EyeSlashIcon size={18} className="text-fg-2" />}
          {hidden ? t.hide.unhide : hideLabel}
        </button>
      </Modal>
    </>
  );
}
