import { createContext, useContext, useState, useCallback, useMemo, useEffect, type ReactNode } from "react";

type AuthMode = "totp" | null;

interface AuthStatus {
  methods: { totp: boolean };
}

interface AuthContextValue {
  /** True when user has authenticated via TOTP session cookie. */
  authenticated: boolean;
  /** Which auth mode is active. */
  authMode: AuthMode;
  /** Headers to attach to every API request (empty — session cookie handles auth). */
  authHeaders: Record<string, string>;
  /** Mark as authenticated via TOTP session cookie. */
  setTotpAuthenticated: () => void;
  /** Log out — clears session and state. */
  logout: () => void;
  /** Available auth methods from server. */
  availableMethods: { totp: boolean };
  /** True while fetching /auth/status. */
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [totpAuth, setTotpAuth] = useState(false);
  const [availableMethods, setAvailableMethods] = useState<{ totp: boolean }>({
    totp: false,
  });
  const [loading, setLoading] = useState(true);

  // Fetch available auth methods on mount, then probe session cookie
  useEffect(() => {
    let cancelled = false;
    fetch("/auth/status")
      .then((res) => res.json())
      .then(async (data: AuthStatus) => {
        if (cancelled) return;
        setAvailableMethods(data.methods);
        // If TOTP is enabled, probe session cookie
        if (data.methods.totp) {
          try {
            const probe = await fetch("/bots", { credentials: "include" });
            if (!cancelled && probe.ok) setTotpAuth(true);
          } catch {
            // Cookie invalid or server unreachable — stay logged out
          }
        }
      })
      .catch(() => {
        // Server unreachable — keep defaults
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const setTotpAuthenticated = useCallback(() => {
    setTotpAuth(true);
  }, []);

  const logout = useCallback(async () => {
    setTotpAuth(false);
    // Clear server session cookie
    try {
      await fetch("/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      // Ignore — server may be unreachable
    }
  }, []);

  const authenticated = totpAuth;
  const authMode: AuthMode = totpAuth ? "totp" : null;
  const authHeaders = useMemo((): Record<string, string> => ({}), []);

  const value = useMemo(
    () => ({ authenticated, authMode, authHeaders, setTotpAuthenticated, logout, availableMethods, loading }),
    [authenticated, authMode, authHeaders, setTotpAuthenticated, logout, availableMethods, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
