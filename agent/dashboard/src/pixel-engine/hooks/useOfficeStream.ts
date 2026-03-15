/**
 * Fleet SSE stream adapter for the pixel office engine.
 *
 * Connects to GET /api/office/stream and maps SSE events to OfficeState mutations.
 * Handles snapshot reconciliation, delta events (bot_join, bot_leave, tool, state),
 * heartbeat seq-gap detection, and automatic reconnection with backoff.
 */

import { useCallback, useEffect, useRef } from 'react';

import type { OfficeState } from '../engine/officeState';
import { extractToolName } from '../toolUtils';

// ── SSE event payload types ─────────────────────────────────

interface SnapshotBot {
  bot_id: string;
  name: string;
  status: 'idle' | 'active' | 'waiting' | 'permission';
  tool?: string;
}

interface SnapshotEvent {
  seq: number;
  bots: SnapshotBot[];
}

interface DeltaStateEvent {
  seq: number;
  type: 'bot_join' | 'bot_leave' | 'status';
  bot_id: string;
  name?: string;
  status?: string;
}

interface DeltaToolEvent {
  seq: number;
  type: 'tool_start' | 'tool_done' | 'tools_clear';
  bot_id: string;
  tool_id?: string;
  tool?: string;
}

interface HeartbeatEvent {
  seq: number;
}

// ── ID management ───────────────────────────────────────────

interface BotEntry {
  numericId: number;
  name: string;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

export function useOfficeStream(
  officeState: OfficeState | null,
  assetsReady: boolean,
): { getBotNameByNumericId: (id: number) => string | null } {
  // Stable maps persisted across reconnections via refs
  const botMapRef = useRef(new Map<string, BotEntry>()); // botId → entry
  const reverseMapRef = useRef(new Map<number, string>()); // numericId → botId
  const nextIdRef = useRef(1);
  const expectedSeqRef = useRef(0);
  const esRef = useRef<EventSource | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Get or create a stable numeric ID for a bot */
  const getNumericId = useCallback((botId: string, name: string): number => {
    const existing = botMapRef.current.get(botId);
    if (existing) return existing.numericId;

    const id = nextIdRef.current++;
    const entry: BotEntry = { numericId: id, name };
    botMapRef.current.set(botId, entry);
    reverseMapRef.current.set(id, botId);
    return id;
  }, []);

  const getBotNameByNumericId = useCallback((id: number): string | null => {
    const botId = reverseMapRef.current.get(id);
    if (!botId) return null;
    return botMapRef.current.get(botId)?.name ?? null;
  }, []);

  useEffect(() => {
    if (!officeState || !assetsReady) return;

    // Capture in a const so TypeScript narrows the type inside closures
    const os = officeState;

    function connect() {
      // Clean up existing connection
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }

      const url = '/api/office/stream';
      const es = new EventSource(url);
      esRef.current = es;

      es.addEventListener('snapshot', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as SnapshotEvent;
          expectedSeqRef.current = data.seq + 1;
          reconnectAttemptRef.current = 0; // Successful connection

          // Reconcile: add new bots, remove stale ones
          const incomingIds = new Set<string>();
          for (const bot of data.bots) {
            incomingIds.add(bot.bot_id);
            const numId = getNumericId(bot.bot_id, bot.name);

            if (!os.characters.has(numId)) {
              os.addAgent(numId, undefined, undefined, undefined, true);
            }

            // Apply current status
            if (bot.status === 'active') {
              os.setAgentActive(numId, true);
              if (bot.tool) {
                os.setAgentTool(numId, extractToolName(bot.tool));
              }
            } else if (bot.status === 'waiting') {
              os.setAgentActive(numId, false);
              os.showWaitingBubble(numId);
            } else if (bot.status === 'permission') {
              os.setAgentActive(numId, true);
              os.showPermissionBubble(numId);
            } else {
              // idle
              os.setAgentActive(numId, false);
            }
          }

          // Remove characters not in snapshot
          for (const [numId, botId] of reverseMapRef.current) {
            if (!incomingIds.has(botId) && os.characters.has(numId)) {
              os.removeAgent(numId);
            }
          }
        } catch (err) {
          console.error('[OfficeStream] Error processing snapshot:', err);
        }
      });

      es.addEventListener('state', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as DeltaStateEvent;

          // Seq gap detection
          if (data.seq > expectedSeqRef.current) {
            console.warn(
              `[OfficeStream] Seq gap: expected ${expectedSeqRef.current}, got ${data.seq}. Reconnecting.`,
            );
            scheduleReconnect();
            return;
          }
          expectedSeqRef.current = data.seq + 1;

          if (data.type === 'bot_join') {
            const numId = getNumericId(data.bot_id, data.name ?? data.bot_id);
            os.addAgent(numId);
          } else if (data.type === 'bot_leave') {
            const entry = botMapRef.current.get(data.bot_id);
            if (entry) {
              os.removeAllSubagents(entry.numericId);
              os.removeAgent(entry.numericId);
            }
          } else if (data.type === 'status') {
            const entry = botMapRef.current.get(data.bot_id);
            if (entry) {
              const numId = entry.numericId;
              const status = data.status;

              if (status === 'active') {
                os.setAgentActive(numId, true);
                os.clearPermissionBubble(numId);
              } else if (status === 'waiting') {
                os.setAgentActive(numId, false);
                os.showWaitingBubble(numId);
              } else if (status === 'permission') {
                os.showPermissionBubble(numId);
              } else {
                // idle
                os.setAgentActive(numId, false);
                os.setAgentTool(numId, null);
                os.clearPermissionBubble(numId);
              }
            }
          }
        } catch (err) {
          console.error('[OfficeStream] Error processing state event:', err);
        }
      });

      es.addEventListener('tool', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as DeltaToolEvent;

          if (data.seq > expectedSeqRef.current) {
            console.warn(`[OfficeStream] Seq gap in tool event. Reconnecting.`);
            scheduleReconnect();
            return;
          }
          expectedSeqRef.current = data.seq + 1;

          const entry = botMapRef.current.get(data.bot_id);
          if (!entry) return;
          const numId = entry.numericId;

          if (data.type === 'tool_start') {
            const toolName = data.tool ? extractToolName(data.tool) : null;
            os.setAgentTool(numId, toolName);
            os.setAgentActive(numId, true);
            os.clearPermissionBubble(numId);

            // Handle subtask spawning
            if (data.tool?.startsWith('Subtask:') && data.tool_id) {
              os.addSubagent(numId, data.tool_id);
            }
          } else if (data.type === 'tool_done') {
            // Tool completed — don't clear agent tool immediately
            // (another tool may still be active)
          } else if (data.type === 'tools_clear') {
            os.setAgentTool(numId, null);
            os.removeAllSubagents(numId);
            os.clearPermissionBubble(numId);
          }
        } catch (err) {
          console.error('[OfficeStream] Error processing tool event:', err);
        }
      });

      es.addEventListener('subagent', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as {
            seq: number;
            type: string;
            bot_id: string;
            parent_tool_id: string;
            tool_id?: string;
            tool?: string;
          };

          if (data.seq > expectedSeqRef.current) {
            scheduleReconnect();
            return;
          }
          expectedSeqRef.current = data.seq + 1;

          const entry = botMapRef.current.get(data.bot_id);
          if (!entry) return;
          const numId = entry.numericId;

          if (data.type === 'tool_start') {
            const subId = os.getSubagentId(numId, data.parent_tool_id);
            if (subId !== null) {
              const toolName = data.tool ? extractToolName(data.tool) : null;
              os.setAgentTool(subId, toolName);
              os.setAgentActive(subId, true);
            }
          } else if (data.type === 'clear') {
            os.removeSubagent(numId, data.parent_tool_id);
          }
        } catch (err) {
          console.error('[OfficeStream] Error processing subagent event:', err);
        }
      });

      es.addEventListener('heartbeat', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as HeartbeatEvent;
          expectedSeqRef.current = data.seq + 1;
          reconnectAttemptRef.current = 0;
        } catch {
          // Ignore malformed heartbeats
        }
      });

      es.onerror = () => {
        console.warn('[OfficeStream] Connection error. Scheduling reconnect.');
        scheduleReconnect();
      };
    }

    function scheduleReconnect() {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      if (reconnectTimerRef.current) return; // Already scheduled

      const attempt = reconnectAttemptRef.current++;
      const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, attempt), RECONNECT_MAX_MS);
      console.log(`[OfficeStream] Reconnecting in ${delay}ms (attempt ${attempt + 1})`);

      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    }

    connect();

    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [officeState, assetsReady, getNumericId]);

  return { getBotNameByNumericId };
}
