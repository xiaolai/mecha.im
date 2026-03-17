import React from "react";
import ReactDOM from "react-dom/client";
import { FleetProvider } from "./lib/fleet-context";
import LoginGate from "./lib/login-gate";
import App from "./app";
import { PixelOffice } from "./pixel-engine/components/PixelOffice";
import "./index.css";

const path = window.location.pathname.replace(/\/+$/, "") || "/";

function PublicOffice() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "#111" }}>
      <PixelOffice isActive readOnly />
      {/* Login button — bottom right */}
      <a
        href="/login"
        className="absolute bottom-4 right-4 p-2 rounded-lg bg-black/40 hover:bg-black/60 backdrop-blur-sm transition-colors"
        title="Login"
      >
        <svg className="w-5 h-5 text-white/60 hover:text-white/90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
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
