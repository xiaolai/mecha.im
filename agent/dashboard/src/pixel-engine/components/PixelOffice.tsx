/**
 * PixelOffice — composition root for the pixel office engine.
 *
 * Wires asset loading, layout persistence, SSE streaming, editor tools,
 * settings modal, debug overlay, and tool overlay into the OfficeCanvas.
 *
 * The OfficeState and EditorState refs persist across tab switches so
 * characters keep their positions and animation state.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { PULSE_ANIMATION_DURATION_SEC, TILE_SIZE } from '../constants';
import { clearColorizeCache } from '../colorize';
import { BottomToolbar } from './BottomToolbar';
import { DebugView } from './DebugView';
import { OfficeCanvas } from './OfficeCanvas';
import { SettingsModal } from './SettingsModal';
import { ToolOverlay } from './ToolOverlay';
import { ZoomControls } from './ZoomControls';
import { EditorState } from '../editor/editorState';
import { EditorToolbar } from '../editor/EditorToolbar';
import { OfficeState } from '../engine/officeState';
import { useAssetLoader } from '../hooks/useAssetLoader';
import { useEditorActions } from '../hooks/useEditorActions';
import { useEditorKeyboard } from '../hooks/useEditorKeyboard';
import { useLayoutPersistence } from '../hooks/useLayoutPersistence';
import { useOfficeStream } from '../hooks/useOfficeStream';
import { isRotatable } from '../layout/furnitureCatalog';
import { clearSpriteCache } from '../sprites/spriteCache';
import { EditTool } from '../types';
import '../pixel-office.css';

import type { OfficeLayout } from '../types';

// ── EditActionBar (undo/redo/save/reset bar shown when editor is dirty) ──

const actionBarBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: '22px',
  background: 'var(--pixel-btn-bg)',
  color: 'var(--pixel-text-dim)',
  border: '2px solid transparent',
  borderRadius: 0,
  cursor: 'pointer',
};

const actionBarBtnDisabled: React.CSSProperties = {
  ...actionBarBtnStyle,
  opacity: 'var(--pixel-btn-disabled-opacity)',
  cursor: 'default',
};

function EditActionBar({
  editor,
  editorState: es,
}: {
  editor: ReturnType<typeof useEditorActions>;
  editorState: EditorState;
}) {
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const undoDisabled = es.undoStack.length === 0;
  const redoDisabled = es.redoStack.length === 0;

  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 'var(--pixel-controls-z)',
        display: 'flex',
        gap: 4,
        alignItems: 'center',
        background: 'var(--pixel-bg)',
        border: '2px solid var(--pixel-border)',
        borderRadius: 0,
        padding: '4px 8px',
        boxShadow: 'var(--pixel-shadow)',
      }}
    >
      <button
        style={undoDisabled ? actionBarBtnDisabled : actionBarBtnStyle}
        onClick={undoDisabled ? undefined : editor.handleUndo}
        title="Undo (Ctrl+Z)"
      >
        Undo
      </button>
      <button
        style={redoDisabled ? actionBarBtnDisabled : actionBarBtnStyle}
        onClick={redoDisabled ? undefined : editor.handleRedo}
        title="Redo (Ctrl+Y)"
      >
        Redo
      </button>
      <button style={actionBarBtnStyle} onClick={editor.handleSave} title="Save layout">
        Save
      </button>
      {!showResetConfirm ? (
        <button
          style={actionBarBtnStyle}
          onClick={() => setShowResetConfirm(true)}
          title="Reset to last saved layout"
        >
          Reset
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: '22px', color: 'var(--pixel-reset-text)' }}>Reset?</span>
          <button
            style={{ ...actionBarBtnStyle, background: 'var(--pixel-danger-bg)', color: '#fff' }}
            onClick={() => {
              setShowResetConfirm(false);
              editor.handleReset();
            }}
          >
            Yes
          </button>
          <button style={actionBarBtnStyle} onClick={() => setShowResetConfirm(false)}>
            No
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────

interface PixelOfficeProps {
  /** Whether this tab is currently visible (controls game loop pause/resume) */
  isActive: boolean;
  /** Callback when a bot character is clicked — navigates to that bot's sessions */
  onSelectBot?: (name: string) => void;
  /** Callback when "Avatar" is clicked in the agent popover */
  onEditAvatar?: (name: string) => void;
  /** When true, hides all editor controls (Layout/Settings buttons, toolbar, etc.) */
  readOnly?: boolean;
}

export function PixelOffice({ isActive, onSelectBot, onEditAvatar, readOnly }: PixelOfficeProps) {
  // Persistent refs — survive tab switches
  const officeStateRef = useRef<OfficeState | null>(null);
  const editorStateRef = useRef(new EditorState());
  const containerRef = useRef<HTMLDivElement>(null);

  const [officeReady, setOfficeReady] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isDebugMode, setIsDebugMode] = useState(false);
  const [clickedAgent, setClickedAgent] = useState<{ id: number; name: string } | null>(null);

  // 1. Load all assets
  const { assetsReady } = useAssetLoader();

  // 2. Load layout from API (or default)
  const { layout, saveLayout, saveLayoutImmediate } = useLayoutPersistence();

  // Stable getter for editor actions
  const getOfficeState = useCallback((): OfficeState => {
    if (!officeStateRef.current) {
      officeStateRef.current = new OfficeState();
    }
    return officeStateRef.current;
  }, []);

  // 3. Wire editor actions
  const editor = useEditorActions(getOfficeState, editorStateRef.current, saveLayout, saveLayoutImmediate);

  // 4. Create OfficeState once both assets and layout are ready
  useEffect(() => {
    if (!assetsReady || !layout) return;
    if (officeStateRef.current) {
      officeStateRef.current.rebuildFromLayout(layout);
    } else {
      officeStateRef.current = new OfficeState(layout);
    }
    editor.setLastSavedLayout(layout);
    setOfficeReady(true);
  }, [assetsReady, layout, editor.setLastSavedLayout]);

  // 5. Connect to SSE stream
  const { getBotNameByNumericId, getDisplayName } = useOfficeStream(
    officeReady ? officeStateRef.current : null,
    assetsReady,
  );

  // 6. Wire editor keyboard shortcuts
  const [editorTickForKeyboard, setEditorTickForKeyboard] = useState(0);
  useEditorKeyboard(
    editor.isEditMode,
    editorStateRef.current,
    editor.handleDeleteSelected,
    editor.handleRotateSelected,
    editor.handleToggleState,
    editor.handleUndo,
    editor.handleRedo,
    useCallback(() => setEditorTickForKeyboard((n) => n + 1), []),
    editor.handleToggleEditMode,
  );

  // 7. Clear caches when tab becomes inactive
  useEffect(() => {
    if (!isActive) {
      clearSpriteCache();
      clearColorizeCache();
    }
  }, [isActive]);

  // Handle character click — show popover (or delegate sub-agent to parent)
  const handleClick = useCallback(
    (agentId: number) => {
      // Check for sub-agent — focus parent's terminal
      const os = officeStateRef.current;
      if (os) {
        const meta = os.subagentMeta.get(agentId);
        if (meta) {
          const parentName = getBotNameByNumericId(meta.parentAgentId);
          if (parentName && onSelectBot) onSelectBot(parentName);
          return;
        }
      }
      const name = getBotNameByNumericId(agentId);
      if (!name) return;
      // Toggle popover on re-click
      setClickedAgent((prev) => (prev && prev.id === agentId ? null : { id: agentId, name }));
    },
    [getBotNameByNumericId, onSelectBot],
  );

  // Dismiss popover on Escape or clicking outside
  const popoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!clickedAgent) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setClickedAgent(null);
    };
    const onMouseDown = (e: MouseEvent) => {
      // If click is outside the popover, dismiss it
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setClickedAgent(null);
      }
    };
    window.addEventListener('keydown', onKey);
    // Delay adding mousedown to avoid dismissing from the same click that opened it
    const timer = setTimeout(() => window.addEventListener('mousedown', onMouseDown), 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onMouseDown);
    };
  }, [clickedAgent]);

  // Dismiss popover when zoom changes
  const prevZoomRef = useRef(editor.zoom);
  useEffect(() => {
    if (prevZoomRef.current !== editor.zoom) {
      setClickedAgent(null);
    }
    prevZoomRef.current = editor.zoom;
  }, [editor.zoom]);

  // Settings callbacks
  const handleToggleDebugMode = useCallback(() => setIsDebugMode((prev) => !prev), []);
  const handleOpenSettings = useCallback(() => setShowSettings(true), []);
  const handleCloseSettings = useCallback(() => setShowSettings(false), []);

  // Export layout: create JSON blob and trigger browser download
  const handleExportLayout = useCallback(() => {
    const os = officeStateRef.current;
    if (!os) return;
    const layoutData = os.getLayout();
    const blob = new Blob([JSON.stringify(layoutData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'office-layout.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  // Import layout: file picker → validate → save
  const handleImportLayout = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result as string) as OfficeLayout;
          if (
            data?.version === 1 &&
            Array.isArray(data.tiles) &&
            typeof data.cols === 'number' &&
            typeof data.rows === 'number' &&
            data.tiles.length === data.cols * data.rows
          ) {
            saveLayout(data);
            // Rebuild immediately
            const os = officeStateRef.current;
            if (os) {
              os.rebuildFromLayout(data);
            }
            // Reset editor state to match the imported layout
            editor.setLastSavedLayout(data);
            editorStateRef.current.reset();
            editor.syncDirtyState();
          } else {
            console.warn('[PixelOffice] Invalid layout file: missing or mismatched fields');
          }
        } catch (err) {
          console.warn('[PixelOffice] Failed to parse layout file:', err);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [saveLayout]);

  const officeState = officeStateRef.current;

  // Force dependency on editorTickForKeyboard to propagate keyboard-triggered re-renders
  void editorTickForKeyboard;

  // Show "Press R to rotate" hint when a rotatable item is selected or being placed
  const showRotateHint =
    editor.isEditMode &&
    officeState &&
    (() => {
      if (editorStateRef.current.selectedFurnitureUid) {
        const item = officeState
          .getLayout()
          .furniture.find((f) => f.uid === editorStateRef.current.selectedFurnitureUid);
        if (item && isRotatable(item.type)) return true;
      }
      if (
        editorStateRef.current.activeTool === EditTool.FURNITURE_PLACE &&
        isRotatable(editorStateRef.current.selectedFurnitureType)
      ) {
        return true;
      }
      return false;
    })();

  if (!officeReady || !officeState) {
    return (
      <div
        className="pixel-engine"
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#1E1E2E',
          color: 'rgba(255, 255, 255, 0.5)',
          fontSize: '20px',
        }}
      >
        Loading pixel office...
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="pixel-engine"
      style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}
    >
      <style>{`
        @keyframes pixel-agents-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        .pixel-agents-pulse { animation: pixel-agents-pulse ${PULSE_ANIMATION_DURATION_SEC}s ease-in-out infinite; }
      `}</style>

      <OfficeCanvas
        officeState={officeState}
        onClick={handleClick}
        isEditMode={editor.isEditMode}
        editorState={editorStateRef.current}
        onEditorTileAction={editor.handleEditorTileAction}
        onEditorEraseAction={editor.handleEditorEraseAction}
        onEditorSelectionChange={editor.handleEditorSelectionChange}
        onDeleteSelected={editor.handleDeleteSelected}
        onRotateSelected={editor.handleRotateSelected}
        onDragMove={editor.handleDragMove}
        editorTick={editor.editorTick}
        zoom={editor.zoom}
        onZoomChange={editor.handleZoomChange}
        panRef={editor.panRef}
        isActive={isActive}
      />

      {/* Agent click popover */}
      {clickedAgent &&
        (() => {
          const ch = officeState.characters.get(clickedAgent.id);
          if (!ch) return null;
          const canvas = containerRef.current?.querySelector('canvas');
          if (!canvas) return null;
          const dpr = window.devicePixelRatio || 1;
          const canvasW = Math.round(canvas.clientWidth * dpr);
          const canvasH = Math.round(canvas.clientHeight * dpr);
          const currentLayout = officeState.getLayout();
          const mapW = currentLayout.cols * TILE_SIZE * editor.zoom;
          const mapH = currentLayout.rows * TILE_SIZE * editor.zoom;
          const deviceOffsetX =
            Math.floor((canvasW - mapW) / 2) + Math.round(editor.panRef.current.x);
          const deviceOffsetY =
            Math.floor((canvasH - mapH) / 2) + Math.round(editor.panRef.current.y);
          const POPOVER_Y_OFFSET = -32;
          const screenX = (deviceOffsetX + ch.x * editor.zoom) / dpr;
          const screenY = (deviceOffsetY + (ch.y + POPOVER_Y_OFFSET) * editor.zoom) / dpr;
          const displayName = getDisplayName(clickedAgent.id) ?? clickedAgent.name;
          return (
            <div
              ref={popoverRef}
              style={{
                position: 'absolute',
                left: screenX,
                top: screenY,
                transform: 'translate(-50%, -100%)',
                zIndex: 'var(--pixel-overlay-selected-z)',
                background: 'var(--pixel-bg)',
                border: '2px solid var(--pixel-border)',
                borderRadius: 0,
                boxShadow: 'var(--pixel-shadow)',
                padding: '6px 8px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                pointerEvents: 'auto',
                whiteSpace: 'nowrap',
              }}
            >
              <span
                style={{
                  fontSize: '22px',
                  color: 'var(--pixel-text-dim)',
                }}
              >
                {displayName}
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  style={{
                    padding: '3px 8px',
                    fontSize: '20px',
                    background: 'var(--pixel-btn-bg)',
                    color: 'var(--pixel-text-dim)',
                    border: '2px solid transparent',
                    borderRadius: 0,
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    setClickedAgent(null);
                    onSelectBot?.(clickedAgent.name);
                  }}
                >
                  Sessions
                </button>
                <button
                  style={{
                    padding: '3px 8px',
                    fontSize: '20px',
                    background: 'var(--pixel-btn-bg)',
                    color: 'var(--pixel-text-dim)',
                    border: '2px solid transparent',
                    borderRadius: 0,
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    setClickedAgent(null);
                    onEditAvatar?.(clickedAgent.name);
                  }}
                >
                  Avatar
                </button>
              </div>
            </div>
          );
        })()}

      {!isDebugMode && <ZoomControls zoom={editor.zoom} onZoomChange={editor.handleZoomChange} />}

      {/* Vignette overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'var(--pixel-vignette)',
          pointerEvents: 'none',
          zIndex: 40,
        }}
      />

      {!readOnly && (
        <BottomToolbar
          isEditMode={editor.isEditMode}
          onToggleEditMode={editor.handleToggleEditMode}
          isDebugMode={isDebugMode}
          onToggleDebugMode={handleToggleDebugMode}
          onOpenSettings={handleOpenSettings}
        />
      )}

      {!readOnly && editor.isEditMode && editor.isDirty && (
        <EditActionBar editor={editor} editorState={editorStateRef.current} />
      )}

      {showRotateHint && (
        <div
          style={{
            position: 'absolute',
            top: editor.isDirty ? 52 : 8,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 49,
            background: 'var(--pixel-hint-bg)',
            color: '#fff',
            fontSize: '20px',
            padding: '3px 8px',
            borderRadius: 0,
            border: '2px solid var(--pixel-accent)',
            boxShadow: 'var(--pixel-shadow)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          Rotate (R)
        </div>
      )}

      {!readOnly && editor.isEditMode &&
        (() => {
          const selUid = editorStateRef.current.selectedFurnitureUid;
          const selColor = selUid
            ? (officeState.getLayout().furniture.find((f) => f.uid === selUid)?.color ?? null)
            : null;
          return (
            <EditorToolbar
              activeTool={editorStateRef.current.activeTool}
              selectedTileType={editorStateRef.current.selectedTileType}
              selectedFurnitureType={editorStateRef.current.selectedFurnitureType}
              selectedFurnitureUid={selUid}
              selectedFurnitureColor={selColor}
              floorColor={editorStateRef.current.floorColor}
              wallColor={editorStateRef.current.wallColor}
              selectedWallSet={editorStateRef.current.selectedWallSet}
              onToolChange={editor.handleToolChange}
              onTileTypeChange={editor.handleTileTypeChange}
              onFloorColorChange={editor.handleFloorColorChange}
              onWallColorChange={editor.handleWallColorChange}
              onWallSetChange={editor.handleWallSetChange}
              onSelectedFurnitureColorChange={editor.handleSelectedFurnitureColorChange}
              onFurnitureTypeChange={editor.handleFurnitureTypeChange}
            />
          );
        })()}

      {!isDebugMode && (
        <ToolOverlay
          officeState={officeState}
          agents={[...officeState.characters.keys()].filter((id) => id > 0)}
          agentTools={{}}
          subagentCharacters={[]}
          containerRef={containerRef}
          zoom={editor.zoom}
          panRef={editor.panRef}
        />
      )}

      {isDebugMode && (
        <DebugView
          agents={[...officeState.characters.keys()].filter((id) => id > 0)}
          selectedAgent={officeState.selectedAgentId}
          agentTools={{}}
          agentStatuses={{}}
          subagentTools={{}}
          onSelectAgent={handleClick}
        />
      )}

      {!readOnly && (
        <SettingsModal
          isOpen={showSettings}
          onClose={handleCloseSettings}
          isDebugMode={isDebugMode}
          onToggleDebugMode={handleToggleDebugMode}
          onExportLayout={handleExportLayout}
          onImportLayout={handleImportLayout}
        />
      )}
    </div>
  );
}
