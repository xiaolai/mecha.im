import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { FleetProvider } from "./lib/fleet-context";
import LoginGate from "./lib/login-gate";
import App from "./app";
import { PixelOffice } from "./pixel-engine/components/PixelOffice";
import "./index.css";

const path = window.location.pathname.replace(/\/+$/, "") || "/";

// Lock icon (not logged in)
const lockIcon = (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
  </svg>
);

// Unlock icon (logged in)
const unlockIcon = (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
  </svg>
);

function PublicOffice() {
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    fetch("/api/session", { credentials: "same-origin" })
      .then(r => setLoggedIn(r.ok))
      .catch(() => {});
  }, []);

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "#111" }}>
      <PixelOffice isActive readOnly />
      <a
        href={loggedIn ? "/dashboard" : "/login"}
        className="absolute top-4 right-4 p-2.5 rounded-lg bg-black/40 hover:bg-black/60 backdrop-blur-sm transition-colors text-white/50 hover:text-white/90"
        title={loggedIn ? "Dashboard" : "Login"}
      >
        {loggedIn ? unlockIcon : lockIcon}
      </a>
    </div>
  );
}

const isPublic = path === "/" || path === "/office";
const isLogin = path === "/login";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isPublic ? (
      <PublicOffice />
    ) : isLogin ? (
      <LoginGate redirectTo="/dashboard">
        <FleetProvider>
          <App />
        </FleetProvider>
      </LoginGate>
    ) : (
      <LoginGate>
        <FleetProvider>
          <App />
        </FleetProvider>
      </LoginGate>
    )}
  </React.StrictMode>,
);
