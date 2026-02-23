"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface MechaInfo {
  id: string;
  name: string;
  state: string;
  status: string;
  path: string;
  port?: number;
  ports: Array<{ PublicPort?: number; PrivatePort?: number; Type?: string }>;
  created: number;
}

export interface MechaWithNode extends MechaInfo {
  node: string;
}

/** Session summary from the filesystem-based API. */
export interface Session {
  /** JSONL filename UUID — canonical session ID. */
  id: string;
  /** Project slug directory name. */
  projectSlug: string;
  title: string;
  messageCount: number;
  model?: string;
  createdAt: string;
  updatedAt: string;
  /** Dashboard-only metadata (stars, custom titles). */
  customTitle?: string;
  starred?: boolean;
}

export type ActiveTab = "chat" | "overview" | "terminal" | "inspect";

interface DashboardState {
  // Mechas
  mechas: MechaWithNode[];
  setMechas: (m: MechaWithNode[]) => void;
  updateMechaState: (id: string, state: string) => void;

  // Selected mecha
  selectedMechaId: string | null;
  setSelectedMechaId: (id: string | null) => void;

  // Sessions per mecha
  sessions: Record<string, Session[]>;
  setSessions: (mechaId: string, s: Session[]) => void;
  addSession: (mechaId: string, s: Session) => void;
  removeSession: (mechaId: string, sessionId: string) => void;
  updateSession: (mechaId: string, sessionId: string, updates: Partial<Pick<Session, "title" | "customTitle" | "starred">>) => void;

  // Selected session
  selectedSessionId: string | null;
  setSelectedSessionId: (id: string | null) => void;

  // Active tab (within sessions panel)
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;

  // Rail state
  collapsedNodes: Record<string, boolean>;
  toggleNodeCollapsed: (node: string) => void;

  // Search
  searchQuery: string;
  setSearchQuery: (q: string) => void;

  // Sessions panel visibility (mobile)
  sessionsPanelOpen: boolean;
  setSessionsPanelOpen: (open: boolean) => void;
}

export const useDashboardStore = create<DashboardState>()(
  persist(
    (set) => ({
      // Mechas
      mechas: [],
      setMechas: (mechas) => set({ mechas }),
      updateMechaState: (id, state) =>
        set((s) => ({
          mechas: s.mechas.map((m) =>
            m.id === id ? { ...m, state } : m,
          ),
        })),

      // Selected mecha
      selectedMechaId: null,
      setSelectedMechaId: (selectedMechaId) => set({ selectedMechaId, selectedSessionId: null }),

      // Sessions
      sessions: {},
      setSessions: (mechaId, sessions) =>
        set((s) => ({ sessions: { ...s.sessions, [mechaId]: sessions } })),
      addSession: (mechaId, session) =>
        set((s) => ({
          sessions: {
            ...s.sessions,
            [mechaId]: [session, ...(s.sessions[mechaId] ?? [])],
          },
        })),
      removeSession: (mechaId, sessionId) =>
        set((s) => ({
          sessions: {
            ...s.sessions,
            [mechaId]: (s.sessions[mechaId] ?? []).filter(
              (sess) => sess.id !== sessionId,
            ),
          },
        })),
      updateSession: (mechaId, sessionId, updates) =>
        set((s) => ({
          sessions: {
            ...s.sessions,
            [mechaId]: (s.sessions[mechaId] ?? []).map(
              (sess) => sess.id === sessionId ? { ...sess, ...updates } : sess,
            ),
          },
        })),

      // Selected session
      selectedSessionId: null,
      setSelectedSessionId: (selectedSessionId) => set({ selectedSessionId }),

      // Active tab
      activeTab: "chat",
      setActiveTab: (activeTab) => set({ activeTab }),

      // Rail
      collapsedNodes: {},
      toggleNodeCollapsed: (node) =>
        set((s) => ({
          collapsedNodes: {
            ...s.collapsedNodes,
            [node]: !s.collapsedNodes[node],
          },
        })),

      // Search
      searchQuery: "",
      setSearchQuery: (searchQuery) => set({ searchQuery }),

      // Sessions panel
      sessionsPanelOpen: false,
      setSessionsPanelOpen: (sessionsPanelOpen) => set({ sessionsPanelOpen }),
    }),
    {
      name: "mecha-dashboard",
      partialize: (state) => ({
        selectedMechaId: state.selectedMechaId,
        activeTab: state.activeTab,
        collapsedNodes: state.collapsedNodes,
      }),
    },
  ),
);
