import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { setupPwa } from "./lib/pwa";

setupPwa();

const rootEl = document.getElementById("root");
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
