import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "@fontsource-variable/literata/wght.css";
import "@fontsource-variable/source-sans-3/wght.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "./styles.css";
import { webApp } from "./tg";
import { initAccent, initTheme } from "./theme";

initTheme();
initAccent();
if ((window as unknown as { __LIFE_DESK__?: boolean }).__LIFE_DESK__) document.documentElement.classList.add("desk");
if ((window as unknown as { __LIFE_IOS__?: boolean }).__LIFE_IOS__) document.documentElement.classList.add("ios");
webApp?.ready();
webApp?.expand();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
