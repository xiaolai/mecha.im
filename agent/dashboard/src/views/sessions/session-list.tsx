import { useState, useEffect, useRef, useCallback } from "react";
import { MessageCirclePlus, Copy, Check } from "lucide-react";
import { botFetch } from "../../lib/api";
import { timeAgo, modelShort } from "../../lib/format";

function CopyIdButton({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(id).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }).catch(() => {});
      }}
      className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground transition-colors"
      title="Copy session ID"
    >
      <span>ID</span>
      {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

interface SessionSummary {
  id: string;
  title: string;
  timestamp: string;
  lastActivity: string;
  model: string;
  messageCount: number;
  costUsd: number;
  hasPty: boolean;
}

interface SearchMatch {
  role: "user" | "assistant";
  snippet: string;
  timestamp: string;
}

interface SearchResult {
  id: string;
  title: string;
  model: string;
  lastActivity: string;
  hasPty: boolean;
  matches: SearchMatch[];
}

interface Props {
  selectedId: string | null;
  onSelect: (id: string, hasPty: boolean) => void;
  onNewSession: () => void;
}

export default function SessionList({ selectedId, onSelect, onNewSession }: Props) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      searchAbortRef.current?.abort();
    };
  }, []);

  // Load session list
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval>;

    const load = () => {
      if (document.hidden) return;
      botFetch("/api/sessions")
        .then((r) => r.json())
        .then((data) => {
          if (active && Array.isArray(data)) {
            setSessions(data as SessionSummary[]);
            setLoadError(null);
          }
        })
        .catch((err) => {
          if (active) setLoadError(err instanceof Error ? err.message : "Failed to load sessions");
        });
    };

    load();
    timer = setInterval(load, 15_000);

    const onVisibility = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Debounced search with abort for stale requests
  const doSearch = useCallback((q: string) => {
    searchAbortRef.current?.abort();
    if (!q.trim()) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const controller = new AbortController();
    searchAbortRef.current = controller;
    botFetch(`/api/sessions/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        if (controller.signal.aborted) return;
        if (Array.isArray(data)) setSearchResults(data as SearchResult[]);
        setSearching(false);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setSearching(false);
      });
  }, []);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(value), 300);
  };

  const clearSearch = () => {
    setQuery("");
    setSearchResults(null);
    setSearching(false);
  };

  const isSearching = query.trim().length > 0;

  return (
    <div className="w-72 shrink-0 border-r border-border flex flex-col bg-card h-full overflow-hidden relative">
      <div className="p-3">
        {/* Search input */}
        <div className="relative">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Search sessions..."
            className="w-full pl-8 pr-7 py-1.5 text-sm bg-background border border-input rounded-md placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {isSearching && (
            <button
              onClick={clearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {/* Search results mode */}
        {isSearching ? (
          <>
            {searching && (
              <p className="text-muted-foreground text-xs p-4 text-center">Searching...</p>
            )}
            {!searching && searchResults && searchResults.length === 0 && (
              <p className="text-muted-foreground text-sm p-4 text-center">No results</p>
            )}
            {searchResults?.map((r) => (
              <button
                key={r.id}
                onClick={() => { onSelect(r.id, r.hasPty); clearSearch(); }}
                className={`w-full text-left px-3 py-3 hover:bg-accent transition-colors ${
                  selectedId === r.id ? "bg-accent border-l-2 border-l-primary" : ""
                }`}
              >
                <p className="text-sm text-foreground truncate">{r.title}</p>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                  <span>{timeAgo(r.lastActivity)}</span>
                  <span className="opacity-30">·</span>
                  <span>{modelShort(r.model)}</span>
                  <span className="opacity-30">·</span>
                  <span>{r.matches.length} hit{r.matches.length !== 1 ? "s" : ""}</span>
                </div>
                {/* First match snippet */}
                {r.matches[0] && (
                  <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2 leading-relaxed">
                    <span className="text-muted-foreground/60">{r.matches[0].role}:</span>{" "}
                    {r.matches[0].snippet}
                  </p>
                )}
              </button>
            ))}
          </>
        ) : (
          <>
            {/* Normal session list */}
            {loadError && (
              <p className="text-destructive text-sm p-4 text-center">{loadError}</p>
            )}
            {!loadError && sessions.length === 0 && (
              <p className="text-muted-foreground text-sm p-4 text-center">No sessions yet</p>
            )}
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => onSelect(s.id, s.hasPty)}
                className={`group w-full text-left px-3 py-3 hover:bg-accent transition-colors ${
                  selectedId === s.id ? "bg-accent border-l-2 border-l-primary" : ""
                }`}
              >
                <div className="flex items-start gap-2">
                  <span
                    className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                      s.hasPty ? "bg-success animate-pulse" : "bg-muted-foreground/30"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground truncate">{s.title}</p>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      <span>{timeAgo(s.lastActivity)}</span>
                      <span className="opacity-30">·</span>
                      <span>{s.messageCount} msgs</span>
                      <span className="opacity-30">·</span>
                      <span>{modelShort(s.model)}</span>
                      <span className="opacity-30">·</span>
                      <CopyIdButton id={s.id} />
                    </div>
                  </div>
                </div>
              </button>
            ))}
          </>
        )}
      </div>

      {/* Floating new session button */}
      <button
        onClick={onNewSession}
        className="absolute bottom-4 right-4 p-2 text-muted-foreground hover:text-foreground transition-colors"
        title="New Session"
      >
        <MessageCirclePlus className="w-5 h-5" />
      </button>
    </div>
  );
}
