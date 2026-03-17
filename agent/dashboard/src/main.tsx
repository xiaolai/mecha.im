import React from "react";
import ReactDOM from "react-dom/client";
import { FleetProvider } from "./lib/fleet-context";
import LoginGate from "./lib/login-gate";
import App from "./app";
import { PixelOffice } from "./pixel-engine/components/PixelOffice";
import "./index.css";

const isPublicOffice = window.location.pathname === "/office" || window.location.pathname === "/office/";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isPublicOffice ? (
      <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "#111" }}>
        <PixelOffice isActive readOnly />
      </div>
    ) : (
      <LoginGate>
        <FleetProvider>
          <App />
        </FleetProvider>
      </LoginGate>
    )}
  </React.StrictMode>,
);
