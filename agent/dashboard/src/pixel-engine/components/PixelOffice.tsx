/**
 * PixelOffice — composition root for the pixel office engine.
 *
 * Wires asset loading, layout persistence, and SSE streaming into the
 * OfficeCanvas component. Renders a loading state until all assets are ready.
 *
 * The OfficeState and EditorState refs persist across tab switches so
 * characters keep their positions and animation state.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { OfficeState } from '../engine/officeState';
import { EditorState } from '../editor/editorState';
import { defaultZoom } from '../toolUtils';
import { OfficeCanvas } from './OfficeCanvas';
import { ZoomControls } from './ZoomControls';
import { useAssetLoader } from '../hooks/useAssetLoader';
import { useLayoutPersistence } from '../hooks/useLayoutPersistence';
import { useOfficeStream } from '../hooks/useOfficeStream';
import '../pixel-office.css';

interface PixelOfficeProps {
  /** Whether this tab is currently visible (controls game loop pause/resume) */
  isActive: boolean;
  /** Callback when a bot character is clicked — navigates to that bot's sessions */
  onSelectBot?: (name: string) => void;
}

export function PixelOffice({ isActive, onSelectBot }: PixelOfficeProps) {
  // Persistent refs — survive tab switches
  const officeStateRef = useRef<OfficeState | null>(null);
  const editorStateRef = useRef(new EditorState());
  const panRef = useRef({ x: 0, y: 0 });

  const [zoom, setZoom] = useState(() => defaultZoom());
  const [officeReady, setOfficeReady] = useState(false);

  // 1. Load all assets
  const { assetsReady } = useAssetLoader();

  // 2. Load layout from API (or default)
  const { layout } = useLayoutPersistence();

  // 3. Create OfficeState once both assets and layout are ready
  useEffect(() => {
    if (!assetsReady || !layout) return;
    if (officeStateRef.current) {
      // Layout changed — rebuild in-place
      officeStateRef.current.rebuildFromLayout(layout);
    } else {
      officeStateRef.current = new OfficeState(layout);
    }
    setOfficeReady(true);
  }, [assetsReady, layout]);

  // 4. Connect to SSE stream
  const { getBotNameByNumericId } = useOfficeStream(
    officeReady ? officeStateRef.current : null,
    assetsReady,
  );

  // Handle character click — map numeric ID to bot name
  const handleClick = useCallback(
    (agentId: number) => {
      const name = getBotNameByNumericId(agentId);
      if (name && onSelectBot) {
        onSelectBot(name);
      }
    },
    [getBotNameByNumericId, onSelectBot],
  );

  // No-op callbacks for editor features (wired in Chunk 6)
  const noop = useCallback(() => {}, []);
  const noopTile = useCallback((_col: number, _row: number) => {}, []);
  const noopDrag = useCallback((_uid: string, _col: number, _row: number) => {}, []);

  if (!officeReady || !officeStateRef.current) {
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
    <div className="pixel-engine" style={{ width: '100%', height: '100%', position: 'relative' }}>
      <OfficeCanvas
        officeState={officeStateRef.current}
        onClick={handleClick}
        isEditMode={false}
        editorState={editorStateRef.current}
        onEditorTileAction={noopTile}
        onEditorEraseAction={noopTile}
        onEditorSelectionChange={noop}
        onDeleteSelected={noop}
        onRotateSelected={noop}
        onDragMove={noopDrag}
        editorTick={0}
        zoom={zoom}
        onZoomChange={setZoom}
        panRef={panRef}
        isActive={isActive}
      />
      <ZoomControls zoom={zoom} onZoomChange={setZoom} />
    </div>
  );
}
