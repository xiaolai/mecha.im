/**
 * Layout persistence hook — loads and saves office layout via the backend API.
 *
 * On mount: GET /api/office/layout (stores ETag for conflict detection).
 * If 404: falls back to the bundled default-layout.json from assets.
 * On 5xx/network error: retries 3 times with backoff, then falls back to default.
 *
 * saveLayout: debounced 500ms POST with If-Match ETag.
 * On 409 conflict: reloads server version.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { LAYOUT_SAVE_DEBOUNCE_MS } from '../constants';
import { migrateLayoutColors } from '../layout/layoutSerializer';
import type { OfficeLayout } from '../types';

const ASSET_BASE = '/pixel-engine';
const MAX_RETRIES = 3;
const RETRY_DELAYS = [2000, 5000, 10000];

export function useLayoutPersistence(): {
  layout: OfficeLayout | null;
  saveLayout: (layout: OfficeLayout) => void;
  saveLayoutImmediate: (layout: OfficeLayout) => Promise<boolean>;
  reloadLayout: () => void;
} {
  const [layout, setLayout] = useState<OfficeLayout | null>(null);
  const etagRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

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

  /** Fetch layout from API with retry on transient errors */
  const fetchLayout = useCallback(async () => {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (!mountedRef.current) return;
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
          // 200 but invalid shape — fall back to default
          await loadDefaultLayout();
          return;
        }
        if (resp.status === 404) {
          // No layout saved yet — use default
          await loadDefaultLayout();
          return;
        }
        // Server error — retry
        console.warn(`[LayoutPersistence] Server error ${resp.status} (attempt ${attempt + 1}/${MAX_RETRIES + 1})`);
      } catch {
        console.warn(`[LayoutPersistence] Network error (attempt ${attempt + 1}/${MAX_RETRIES + 1})`);
      }
      // Wait before retry (skip wait on last attempt)
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt] ?? 10000));
      }
    }
    // All retries exhausted — fall back to default
    console.warn('[LayoutPersistence] Retries exhausted, using default layout');
    await loadDefaultLayout();
  }, [loadDefaultLayout]);

  /** Save layout to the API with ETag conflict detection. Returns true on success. */
  const doSave = useCallback(async (layoutToSave: OfficeLayout): Promise<boolean> => {
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
        return true;
      } else if (resp.status === 409) {
        // Conflict — reload server version
        console.warn('[LayoutPersistence] Conflict detected, reloading server layout');
        await fetchLayout();
      }
    } catch {
      console.warn('[LayoutPersistence] Failed to save layout');
    }
    return false;
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

  /** Immediate (non-debounced) save — returns true on success */
  const saveLayoutImmediate = useCallback(
    async (layoutToSave: OfficeLayout): Promise<boolean> => {
      // Flush any pending debounced save
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      return doSave(layoutToSave);
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

  return { layout, saveLayout, saveLayoutImmediate, reloadLayout };
}
