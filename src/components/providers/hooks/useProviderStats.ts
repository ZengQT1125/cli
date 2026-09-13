import { useCallback, useRef, useState } from 'react';
import { useInterval } from '@/hooks/useInterval';
import {
  KEY_STATS_STALE_TIME_MS,
  monitorApi,
  type MonitorKeyStatsResponse,
} from '@/services/api/monitor';
import { blocksToStatusBarData, type KeyStats, type StatusBarData } from '@/utils/usage';

const EMPTY_KEY_STATS: KeyStats = { bySource: {}, byAuthIndex: {} };

function processKeyStatsResponse(response: MonitorKeyStatsResponse) {
  const { by_source, by_auth_index, block_config } = response;

  const bySource: Record<string, { success: number; failure: number }> = {};
  const byAuthIndex: Record<string, { success: number; failure: number }> = {};
  const statusBarBySource = new Map<string, StatusBarData>();

  for (const [key, entry] of Object.entries(by_source)) {
    bySource[key] = { success: entry.success, failure: entry.failure };
    statusBarBySource.set(
      key,
      blocksToStatusBarData(entry.blocks, block_config.window_start_ms, block_config.duration_ms)
    );
  }
  for (const [key, entry] of Object.entries(by_auth_index)) {
    byAuthIndex[key] = { success: entry.success, failure: entry.failure };
  }

  return {
    keyStats: { bySource, byAuthIndex } as KeyStats,
    statusBarBySource,
  };
}

export type UseProviderStatsOptions = {
  enabled?: boolean;
};

export const useProviderStats = (options: UseProviderStatsOptions = {}) => {
  const enabled = options.enabled ?? true;
  const [keyStats, setKeyStats] = useState<KeyStats>(EMPTY_KEY_STATS);
  const [statusBarBySource, setStatusBarBySource] = useState<Map<string, StatusBarData>>(
    () => new Map()
  );
  const [isLoading, setIsLoading] = useState(false);
  const lastRefreshedAt = useRef<number | null>(null);

  const loadKeyStats = useCallback(async () => {
    if (
      lastRefreshedAt.current &&
      Date.now() - lastRefreshedAt.current < KEY_STATS_STALE_TIME_MS
    ) {
      return;
    }
    setIsLoading(true);
    try {
      const response = await monitorApi.getKeyStats();
      const result = processKeyStatsResponse(response);
      setKeyStats(result.keyStats);
      setStatusBarBySource(result.statusBarBySource);
      lastRefreshedAt.current = Date.now();
    } catch {
      // silent — MainLayout 已做 404 提示
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refreshKeyStats = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await monitorApi.getKeyStats([], { forceRefresh: true });
      const result = processKeyStatsResponse(response);
      setKeyStats(result.keyStats);
      setStatusBarBySource(result.statusBarBySource);
      lastRefreshedAt.current = Date.now();
    } catch {
      // silent
    } finally {
      setIsLoading(false);
    }
  }, []);

  useInterval(
    () => {
      void refreshKeyStats().catch(() => {});
    },
    enabled ? 240_000 : null
  );

  return { keyStats, statusBarBySource, loadKeyStats, refreshKeyStats, isLoading };
};
