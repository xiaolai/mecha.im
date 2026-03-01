import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";

interface AuthContextValue {
  apiKey: string | null;
  setApiKey: (key: string) => void;
  logout: () => void;
  /** Headers to attach to every API request */
  authHeaders: Record<string, string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = "mecha_api_key";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKeyState] = useState<string | null>(
    () => sessionStorage.getItem(STORAGE_KEY),
  );

  const setApiKey = useCallback((key: string) => {
    sessionStorage.setItem(STORAGE_KEY, key);
    setApiKeyState(key);
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    setApiKeyState(null);
  }, []);

  const authHeaders = useMemo<Record<string, string>>(
    () => apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    [apiKey],
  );

  const value = useMemo(
    () => ({ apiKey, setApiKey, logout, authHeaders }),
    [apiKey, setApiKey, logout, authHeaders],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
