import React from "react";
import ReactDOM from "react-dom/client";
import { FleetProvider } from "./lib/fleet-context";
import LoginGate from "./lib/login-gate";
import App from "./app";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LoginGate>
      <FleetProvider>
        <App />
      </FleetProvider>
    </LoginGate>
  </React.StrictMode>,
);
