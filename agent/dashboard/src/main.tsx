import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { FleetProvider } from "./lib/fleet-context";
import LoginGate, { TotpInput, useTotpVerify } from "./lib/login-gate";
import App from "./app";
import { PixelOffice } from "./pixel-engine/components/PixelOffice";
import { Card } from "./components";
import "./index.css";

const path = window.location.pathname.replace(/\/+$/, "") || "/";

// Lock icon
const lockSvg = (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
  </svg>
);
// Unlock icon
const unlockSvg = (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5V6.75a4.5 4.5 0 119 0v3.75M3.75 21.75h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
  </svg>
);

function PublicOffice() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [totpEnabled, setTotpEnabled] = useState(false);
  const { verify, error, busy } = useTotpVerify();

  useEffect(() => {
    fetch("/api/session", { credentials: "same-origin" })
      .then(r => setLoggedIn(r.ok))
      .catch(() => {});
    fetch("/api/totp/status", { credentials: "same-origin" })
      .then(r => r.ok ? r.json() : null)
      .then((d: { enabled?: boolean } | null) => { if (d?.enabled) setTotpEnabled(true); })
      .catch(() => {});
  }, []);

  async function handleVerify(code: string) {
    if (await verify(code)) {
      setLoggedIn(true);
      setShowLogin(false);
      window.location.href = "/dashboard";
    }
  }

  function handleIconClick() {
    if (loggedIn) {
      window.location.href = "/dashboard";
    } else {
      setShowLogin(true);
    }
  }

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "#111" }}>
      <PixelOffice isActive readOnly />

      {/* Top-right login/dashboard icon */}
      <button
        onClick={handleIconClick}
        className="absolute top-4 right-4 p-2.5 rounded-lg bg-black/40 hover:bg-black/60 backdrop-blur-sm transition-colors text-white/50 hover:text-white/90"
        title={loggedIn ? "Dashboard" : "Login"}
      >
        {loggedIn ? unlockSvg : lockSvg}
      </button>

      {/* TOTP login modal */}
      {showLogin && (
        <>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={() => setShowLogin(false)} />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-full max-w-sm px-4 pointer-events-auto">
              <Card spacing={4} className="text-center bg-card/90 backdrop-blur-md shadow-2xl">
                <img src="./logo.png" alt="Mecha" className="w-16 h-16 mx-auto rounded-xl" />
                {totpEnabled ? (
                  <TotpInput onComplete={handleVerify} error={error} busy={busy} />
                ) : (
                  <p className="text-sm text-muted-foreground">Access denied.</p>
                )}
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const isPublic = path === "/" || path === "/office";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isPublic ? (
      <PublicOffice />
    ) : (
      <LoginGate>
        <FleetProvider>
          <App />
        </FleetProvider>
      </LoginGate>
    )}
  </React.StrictMode>,
);
