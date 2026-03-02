import { createContext, useContext, useState, useCallback, useMemo, useEffect, type ReactNode } from "react";

type AuthMode = "totp" | "apikey" | null;

interface AuthStatus {
  methods: { totp: boolean; apiKey: boolean };
}

interface AuthContextValue {
  /** True when user has authenticated (session cookie or API key). */
  authenticated: boolean;
  /** Which auth mode is active. */
  authMode: AuthMode;
  /** Headers to attach to every API request (empty for session-based auth). */
  authHeaders: Record<string, string>;
  /** Set API key and mark as authenticated. */
  setApiKey: (key: string) => void;
  /** Mark as authenticated via TOTP session cookie. */
  setTotpAuthenticated: () => void;
  /** Log out — clears session and state. */
  logout: () => void;
  /** Available auth methods from server. */
  availableMethods: { totp: boolean; apiKey: boolean };
  /** True while fetching /auth/status. */
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = "mecha_api_key";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKeyState] = useState<string | null>(
    () => sessionStorage.getItem(STORAGE_KEY),
  );
  const [totpAuth, setTotpAuth] = useState(false);
  const [availableMethods, setAvailableMethods] = useState<{ totp: boolean; apiKey: boolean }>({
    totp: false,
    apiKey: false,
  });
  const [loading, setLoading] = useState(true);

  // Fetch available auth methods on mount
  useEffect(() => {
    let cancelled = false;
    fetch("/auth/status")
      .then((res) => res.json())
      .then((data: AuthStatus) => {
        if (!cancelled) setAvailableMethods(data.methods);
      })
      .catch(() => {
        // Server unreachable — keep defaults
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const setApiKey = useCallback((key: string) => {
    sessionStorage.setItem(STORAGE_KEY, key);
    setApiKeyState(key);
  }, []);

  const setTotpAuthenticated = useCallback(() => {
    setTotpAuth(true);
  }, []);

  const logout = useCallback(async () => {
    sessionStorage.removeItem(STORAGE_KEY);
    setApiKeyState(null);
    setTotpAuth(false);
    // Clear server session cookie
    try {
      await fetch("/auth/logout", { method: "POST", credentials: "include" });
    } catch {
      // Ignore — server may be unreachable
    }
  }, []);

  const authenticated = totpAuth || !!apiKey;

  const authMode: AuthMode = totpAuth ? "totp" : apiKey ? "apikey" : null;

  const authHeaders = useMemo(
    (): Record<string, string> => {
      if (apiKey) return { Authorization: `Bearer ${apiKey}` };
      return {};
    },
    [apiKey],
  );

  const value = useMemo(
    () => ({ authenticated, authMode, authHeaders, setApiKey, setTotpAuthenticated, logout, availableMethods, loading }),
    [authenticated, authMode, authHeaders, setApiKey, setTotpAuthenticated, logout, availableMethods, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
