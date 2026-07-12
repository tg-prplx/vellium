import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
