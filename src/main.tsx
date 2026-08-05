// Ultralytics 🚀 AGPL-3.0 License - https://ultralytics.com/license

import React from "react";
import ReactDOM from "react-dom/client";
import App, { initialTheme } from "./App";
import "./index.css";

const theme = initialTheme();
document.documentElement.classList.toggle("dark", theme === "dark");
document.documentElement.style.colorScheme = theme;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
