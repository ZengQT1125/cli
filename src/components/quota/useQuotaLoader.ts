/**
 * Generic hook for quota data fetching and management.
 */

import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { AuthFileItem } from '@/types';
import { captureQuotaCacheGeneration, commitIfQuotaCacheCurrent, useQuotaStore } from '@/stores';
import { getStatusFromError } from '@/utils/quota';
import type { QuotaConfig } from './quotaConfigs';
import { QuotaLoadCoordinator } from './quotaLoadCoordinator';

type QuotaScope = 'page' | 'all';

type QuotaUpdater<T> = T | ((prev: T) => T);

type QuotaSetter<T> = (updater: QuotaUpdater<T>) => void;

interface LoadQuotaResult<TData> {
  name: string;
  status: 'success' | 'error';
  data?: TData;
  error?: string;
  errorStatus?: number;
}

export function useQuotaLoader<TState, TData>(config: QuotaConfig<TState, TData>) {
  const { t } = useTranslation();
  const quota = useQuotaStore(config.storeSelector);
  const setQuota = useQuotaStore((state) => state[config.storeSetter]) as QuotaSetter<
    Record<string, TState>
  >;

  const loadCoordinatorRef = useRef(new QuotaLoadCoordinator());

  const loadQuota = useCallback(
    async (
      targets: AuthFileItem[],
      scope: QuotaScope,
      setLoading: (loading: boolean, scope?: QuotaScope | null) => void
    ) => {
      const cacheGeneration = captureQuotaCacheGeneration();
      const requestId = loadCoordinatorRef.current.begin(cacheGeneration);
      if (requestId === null) return;
      setLoading(true, scope);

      try {
        if (targets.length === 0) return;

        setQuota((prev) => {
          const nextState = { ...prev };
          targets.forEach((file) => {
            nextState[file.name] = config.buildLoadingState();
          });
          return nextState;
        });

        const batchResults = await config.fetchQuotaBatch(targets, t);
        const results: LoadQuotaResult<TData>[] = batchResults.map((result) => {
          if (result.status === 'success') return result;
          return {
            name: result.name,
            status: 'error',
            error: result.error instanceof Error ? result.error.message : t('common.unknown_error'),
            errorStatus: getStatusFromError(result.error),
          };
        });

        if (!loadCoordinatorRef.current.isCurrent(requestId)) return;

        commitIfQuotaCacheCurrent(cacheGeneration, () => {
          setQuota((prev) => {
            const nextState = { ...prev };
            results.forEach((result) => {
              if (result.status === 'success') {
                nextState[result.name] = config.buildSuccessState(result.data as TData);
              } else {
                nextState[result.name] = config.buildErrorState(
                  result.error || t('common.unknown_error'),
                  result.errorStatus
                );
              }
            });
            return nextState;
          });
        });
      } finally {
        if (loadCoordinatorRef.current.finish(requestId)) {
          setLoading(false);
        }
      }
    },
    [config, setQuota, t]
  );

  return { quota, loadQuota };
}
