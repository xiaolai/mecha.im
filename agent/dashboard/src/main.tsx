import React from "react";
import ReactDOM from "react-dom/client";
import { FleetProvider } from "./lib/fleet-context";
import App from "./app";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FleetProvider>
      <App />
    </FleetProvider>
  </React.StrictMode>,
);
