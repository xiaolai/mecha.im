/**
 * Layout persistence hook — loads and saves office layout via the backend API.
 *
 * On mount: GET /api/office/layout (stores ETag for conflict detection).
 * If 404: falls back to the bundled default-layout.json from assets.
 *
 * saveLayout: debounced 500ms POST with If-Match ETag.
 * On 409 conflict: reloads server version.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { LAYOUT_SAVE_DEBOUNCE_MS } from '../constants';
import { migrateLayoutColors } from '../layout/layoutSerializer';
import type { OfficeLayout } from '../types';

const ASSET_BASE = '/pixel-engine';

export function useLayoutPersistence(): {
  layout: OfficeLayout | null;
  saveLayout: (layout: OfficeLayout) => void;
  reloadLayout: () => void;
} {
  const [layout, setLayout] = useState<OfficeLayout | null>(null);
  const etagRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  /** Fetch layout from API, with fallback to default-layout.json */
  const fetchLayout = useCallback(async () => {
    try {
      const resp = await fetch('/api/office/layout');
      if (resp.ok) {
        const etag = resp.headers.get('ETag');
        if (etag) etagRef.current = etag;
        const data = (await resp.json()) as OfficeLayout;
        if (data?.version === 1 && mountedRef.current) {
          setLayout(migrateLayoutColors(data));
          return;
        }
      }
      // 404 or invalid — fall back to default layout
      if (resp.status === 404 || !resp.ok) {
        await loadDefaultLayout();
      }
    } catch {
      // Network error — try default layout
      await loadDefaultLayout();
    }
  }, []);

  /** Load bundled default-layout.json from public assets */
  const loadDefaultLayout = useCallback(async () => {
    try {
      const resp = await fetch(`${ASSET_BASE}/default-layout.json`);
      if (resp.ok) {
        const data = (await resp.json()) as OfficeLayout;
        if (data?.version === 1 && mountedRef.current) {
          setLayout(migrateLayoutColors(data));
        }
      }
    } catch {
      console.warn('[LayoutPersistence] Failed to load default layout');
    }
  }, []);

  /** Save layout to the API with ETag conflict detection */
  const doSave = useCallback(async (layoutToSave: OfficeLayout) => {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (etagRef.current) {
        headers['If-Match'] = etagRef.current;
      }

      const resp = await fetch('/api/office/layout', {
        method: 'POST',
        headers,
        body: JSON.stringify(layoutToSave),
      });

      if (resp.ok) {
        const etag = resp.headers.get('ETag');
        if (etag) etagRef.current = etag;
      } else if (resp.status === 409) {
        // Conflict — reload server version
        console.warn('[LayoutPersistence] Conflict detected, reloading server layout');
        await fetchLayout();
      }
    } catch {
      console.warn('[LayoutPersistence] Failed to save layout');
    }
  }, [fetchLayout]);

  /** Debounced save — waits 500ms after last call */
  const saveLayout = useCallback(
    (layoutToSave: OfficeLayout) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        doSave(layoutToSave);
      }, LAYOUT_SAVE_DEBOUNCE_MS);
    },
    [doSave],
  );

  const reloadLayout = useCallback(() => {
    fetchLayout();
  }, [fetchLayout]);

  // Load on mount
  useEffect(() => {
    mountedRef.current = true;
    fetchLayout();

    return () => {
      mountedRef.current = false;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [fetchLayout]);

  return { layout, saveLayout, reloadLayout };
}
