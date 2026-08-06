// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyTheme, initialTheme } from "./theme";
import "./index.css";

applyTheme(initialTheme());

// macOS draws its window buttons over the top bar, so the bar reserves room for them there and nowhere else.
if (navigator.userAgent.includes("Macintosh")) document.documentElement.dataset.platform = "macos";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
