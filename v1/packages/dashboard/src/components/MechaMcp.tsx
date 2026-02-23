"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface McpInfo {
  endpoint: string;
  token?: string;
  config: {
    name: string;
    url: string;
    headers: Record<string, string>;
  };
}

export function MechaMcp({ mechaId }: { mechaId: string }) {
  const [info, setInfo] = useState<McpInfo | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [showToken, setShowToken] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/mechas/${mechaId}/mcp?reveal=true`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          setError(body.error ?? `Error ${res.status}`);
          return;
        }
        setInfo(await res.json() as McpInfo);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [mechaId]);

  const [copyError, setCopyError] = useState(false);

  const copyToClipboard = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setCopyError(false);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopyError(true);
      setTimeout(() => setCopyError(false), 3000);
    }
  }, []);

  if (loading) return <div className="text-sm text-muted-foreground">Loading MCP info...</div>;
  if (error) return <div className="text-sm text-destructive">{error}</div>;
  if (!info) return null;

  /* v8 ignore next */
  const copyLabel = (label: string) => copyError ? "Copy failed" : (copied === label ? "Copied" : "Copy");

  const configJson = JSON.stringify(
    {
      mcpServers: {
        [info.config.name]: {
          url: info.config.url,
          ...(Object.keys(info.config.headers).length > 0 && { headers: info.config.headers }),
        },
      },
    },
    null,
    2,
  );

  const maskedToken = info.token
    ? `${info.token.slice(0, 4)}...${info.token.slice(-4)}`
    : "(not available)";

  return (
    <div className="space-y-3">
      {/* Endpoint */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-16 shrink-0">Endpoint</span>
        <code className="text-sm font-mono flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
          {info.endpoint}
        </code>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => copyToClipboard(info.endpoint, "endpoint")}
        >
          {copyLabel("endpoint")}
        </Button>
      </div>

      {/* Token */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-16 shrink-0">Token</span>
        <code className="text-sm font-mono flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
          {showToken ? info.token ?? "(not available)" : maskedToken}
        </code>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setShowToken(!showToken)}
        >
          {showToken ? "Hide" : "Reveal"}
        </Button>
        {info.token && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => copyToClipboard(info.token!, "token")}
          >
            {copyLabel("token")}
          </Button>
        )}
      </div>

      {/* Config snippet */}
      <div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs mb-2"
          onClick={() => setShowConfig(!showConfig)}
        >
          {showConfig ? "Hide Config" : "Show MCP Config"}
        </Button>
        {showConfig && (
          <div className="relative">
            <pre className="text-xs font-mono bg-muted p-3 rounded-md overflow-x-auto">
              {configJson}
            </pre>
            <Button
              variant="outline"
              size="sm"
              className="absolute top-2 right-2 h-6 text-xs"
              onClick={() => copyToClipboard(configJson, "config")}
            >
              {copyLabel("config")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
