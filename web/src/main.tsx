import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import { getT } from "./i18n";
import { desktop } from "./lib/desktop";
import { usePlayer } from "./player/player";
import { useUi } from "./stores/ui";
import "./styles.css";
import "./tv/tv.css";
import { installTvMode } from "./tv/tvMode";

// The desktop app ships its files locally; a service worker would only risk serving an old version after updates.
// A tab that stays open picks up a new version on its own: it checks when it comes back to the front and every
// 30 minutes, switches right away when nothing is playing, and otherwise offers 「새로 고침」.
if (!desktop) {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      if (usePlayer.getState().status !== "playing") return void updateSW(true);
      const t = getT().common;
      useUi.getState().toast(t.newVersion, "info", { label: t.reload, run: () => void updateSW(true) });
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => void registration.update().catch(() => {});
      setInterval(check, 30 * 60_000);
      document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && check());
    },
  });
}

// Android TV: spatial D-pad navigation + 10-foot styling (no-op elsewhere).
installTvMode();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
