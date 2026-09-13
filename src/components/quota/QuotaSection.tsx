/**
 * Generic quota section component.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useNotificationStore,
  useQuotaStore,
  useThemeStore,
} from '@/stores';
import type { AuthFileItem, ResolvedTheme } from '@/types';
import { authFilesApi } from '@/services/api';
import { getStatusFromError } from '@/utils/quota';
import { QuotaCard } from './QuotaCard';
import type { QuotaStatusState } from './QuotaCard';
import { canRunQuotaResetAction } from './quotaActions';
import { useQuotaLoader } from './useQuotaLoader';
import type { QuotaConfig } from './quotaConfigs';
import { sortQuotaFiles } from './quotaFiles';
import { buildQuotaAuthFilesListQuery } from './quotaListQuery';
import { MAX_QUOTA_PAGE_SIZE, MIN_QUOTA_PAGE_SIZE, normalizeQuotaPageSize } from './uiState';
import { IconRefreshCw } from '@/components/ui/icons';
import styles from '@/pages/QuotaPage.module.scss';

type QuotaUpdater<T> = T | ((prev: T) => T);

type QuotaSetter<T> = (updater: QuotaUpdater<T>) => void;

type ViewMode = 'paged' | 'all';

const MAX_SHOW_ALL_THRESHOLD = MAX_QUOTA_PAGE_SIZE;

const isCanceledRequest = (error: unknown): boolean =>
  axios.isCancel(error) ||
  (typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ERR_CANCELED');

interface QuotaSectionProps<TState extends QuotaStatusState, TData> {
  config: QuotaConfig<TState, TData>;
  disabled: boolean;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  refreshKey: number;
}

export function QuotaSection<TState extends QuotaStatusState, TData>({
  config,
  disabled,
  pageSize: quotaPageSize,
  onPageSizeChange,
  refreshKey,
}: QuotaSectionProps<TState, TData>) {
  const { t } = useTranslation();
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const setQuota = useQuotaStore((state) => state[config.storeSetter]) as QuotaSetter<
    Record<string, TState>
  >;

  const [viewMode, setViewMode] = useState<ViewMode>('paged');
  const [page, setPage] = useState(1);
  const [pageSizeInput, setPageSizeInput] = useState(String(quotaPageSize));
  const [showTooManyWarning, setShowTooManyWarning] = useState(false);
  const [resettingQuotaName, setResettingQuotaName] = useState<string | null>(null);
  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [total, setTotal] = useState(0);
  const [filesLoading, setFilesLoading] = useState(true);
  const [filesError, setFilesError] = useState('');
  const [sectionLoading, setSectionLoading] = useState(false);

  const pageSize = normalizeQuotaPageSize(quotaPageSize);
  const effectiveViewMode: ViewMode =
    viewMode === 'all' && total > MAX_SHOW_ALL_THRESHOLD ? 'paged' : viewMode;
  const requestPageSize = effectiveViewMode === 'all' ? MAX_SHOW_ALL_THRESHOLD : pageSize;
  const requestPage = effectiveViewMode === 'all' ? 1 : page;
  const totalPages = Math.max(1, Math.ceil(total / requestPageSize));
  const currentPage = Math.min(requestPage, totalPages);

  const loadControllerRef = useRef<AbortController | null>(null);
  const loadRequestIdRef = useRef(0);
  const mountedRef = useRef(true);

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadControllerRef.current?.abort();
    };
  }, []);

  const loadFiles = useCallback(async () => {
    const query = buildQuotaAuthFilesListQuery(config.type, requestPage, requestPageSize);
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    const requestId = ++loadRequestIdRef.current;
    loadControllerRef.current = controller;
    setFilesLoading(true);
    setFilesError('');
    try {
      const data = await authFilesApi.listPage(query, controller.signal);
      if (!mountedRef.current || requestId !== loadRequestIdRef.current) {
        return [];
      }
      const nextFiles = sortQuotaFiles((data?.files || []).filter((file) => config.filterFn(file)));
      setFiles(nextFiles);
      setTotal(data?.total ?? nextFiles.length);
      return nextFiles;
    } catch (err: unknown) {
      if (isCanceledRequest(err)) return [];
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      if (mountedRef.current && requestId === loadRequestIdRef.current) {
        setFilesError(errorMessage);
        setFiles([]);
        setTotal(0);
      }
      return [];
    } finally {
      if (mountedRef.current && requestId === loadRequestIdRef.current) {
        setFilesLoading(false);
      }
    }
  }, [config, requestPage, requestPageSize, t]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles, refreshKey]);

  useEffect(() => {
    setPageSizeInput(String(pageSize));
  }, [pageSize]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const setPageSize = useCallback(
    (size: number) => {
      const nextPageSize = normalizeQuotaPageSize(size);
      setPage(1);
      setViewMode('paged');
      onPageSizeChange(nextPageSize);
    },
    [onPageSizeChange]
  );

  const applyPageSizeInput = useCallback(() => {
    const nextPageSize = normalizeQuotaPageSize(pageSizeInput);
    setPageSize(nextPageSize);
    setPageSizeInput(String(nextPageSize));
  }, [pageSizeInput, setPageSize]);

  const applyShowAllPageSize = useCallback(() => {
    setPageSize(MAX_SHOW_ALL_THRESHOLD);
    setPageSizeInput(String(MAX_SHOW_ALL_THRESHOLD));
  }, [setPageSize]);

  const handlePageSizeInputKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur();
    }
  }, []);

  useEffect(() => {
    if (total <= MAX_SHOW_ALL_THRESHOLD) return;
    if (viewMode !== 'all') return;

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setViewMode('paged');
      setShowTooManyWarning(true);
    });

    return () => {
      cancelled = true;
    };
  }, [total, viewMode]);

  useEffect(() => {
    if (effectiveViewMode === 'all') {
      applyShowAllPageSize();
    }
  }, [applyShowAllPageSize, effectiveViewMode]);

  const goToPrev = useCallback(() => {
    setPage((prev) => Math.max(1, prev - 1));
  }, []);

  const goToNext = useCallback(() => {
    setPage((prev) => Math.min(totalPages, prev + 1));
  }, [totalPages]);

  const setLoading = useCallback((isLoading: boolean) => {
    setSectionLoading(isLoading);
  }, []);

  const { quota, loadQuota } = useQuotaLoader(config);

  const handleRefresh = useCallback(async () => {
    const scope = effectiveViewMode === 'all' ? 'all' : 'page';
    if (files.length === 0) return;
    await loadQuota(files, scope, setLoading);
  }, [effectiveViewMode, files, loadQuota, setLoading]);

  useEffect(() => {
    if (filesLoading) return;
    if (files.length === 0) {
      setQuota({});
      return;
    }
    setQuota((prev) => {
      const nextState: Record<string, TState> = {};
      files.forEach((file) => {
        const cached = prev[file.name];
        if (cached) {
          nextState[file.name] = cached;
        }
      });
      return nextState;
    });
  }, [files, filesLoading, setQuota]);

  const refreshQuotaForFile = useCallback(
    async (file: AuthFileItem) => {
      if (disabled || file.disabled) return;
      if (quota[file.name]?.status === 'loading') return;
      const cacheGeneration = captureQuotaCacheGeneration();

      setQuota((prev) => ({
        ...prev,
        [file.name]: config.buildLoadingState(),
      }));

      try {
        const data = await config.fetchQuota(file, t);
        commitIfQuotaCacheCurrent(cacheGeneration, () => {
          setQuota((prev) => ({
            ...prev,
            [file.name]: config.buildSuccessState(data),
          }));
          showNotification(t('auth_files.quota_refresh_success', { name: file.name }), 'success');
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('common.unknown_error');
        const status = getStatusFromError(err);
        commitIfQuotaCacheCurrent(cacheGeneration, () => {
          setQuota((prev) => ({
            ...prev,
            [file.name]: config.buildErrorState(message, status),
          }));
          showNotification(
            t('auth_files.quota_refresh_failed', { name: file.name, message }),
            'error'
          );
        });
      }
    },
    [config, disabled, quota, setQuota, showNotification, t]
  );

  const resetQuotaForFile = useCallback(
    (file: AuthFileItem) => {
      const resetQuota = config.resetQuota;
      const itemQuota = quota[file.name];
      if (!resetQuota) return;
      if (
        !canRunQuotaResetAction({
          sectionDisabled: disabled,
          fileDisabled: file.disabled,
          quota: itemQuota,
          resetting: resettingQuotaName === file.name,
          canResetQuota: config.canResetQuota,
        })
      ) {
        return;
      }

      showConfirmation({
        title: t('codex_quota.reset_confirm_title'),
        message: t('codex_quota.reset_confirm_message', { name: file.name }),
        confirmText: t('codex_quota.reset_confirm_button'),
        variant: 'primary',
        onConfirm: async () => {
          const cacheGeneration = captureQuotaCacheGeneration();
          setResettingQuotaName(file.name);
          try {
            const data = await resetQuota(file, t);
            commitIfQuotaCacheCurrent(cacheGeneration, () => {
              setQuota((prev) => ({
                ...prev,
                [file.name]: config.buildSuccessState(data),
              }));
              showNotification(t('codex_quota.reset_success', { name: file.name }), 'success');
            });
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : t('common.unknown_error');
            commitIfQuotaCacheCurrent(cacheGeneration, () => {
              showNotification(
                t('codex_quota.reset_failed', { name: file.name, message }),
                'error'
              );
            });
          } finally {
            setResettingQuotaName((current) => (current === file.name ? null : current));
          }
        },
      });
    },
    [config, disabled, quota, resettingQuotaName, setQuota, showConfirmation, showNotification, t]
  );

  const titleNode = (
    <div className={styles.titleWrapper}>
      <span>{t(`${config.i18nPrefix}.title`)}</span>
      {total > 0 && <span className={styles.countBadge}>{total}</span>}
    </div>
  );

  const isRefreshing = sectionLoading || filesLoading;

  return (
    <Card
      title={titleNode}
      extra={
        <div className={styles.headerActions}>
          <div className={styles.viewModeToggle}>
            <Button
              variant="secondary"
              size="sm"
              className={`${styles.viewModeButton} ${
                effectiveViewMode === 'paged' ? styles.viewModeButtonActive : ''
              }`}
              onClick={() => setViewMode('paged')}
            >
              {t('auth_files.view_mode_paged')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className={`${styles.viewModeButton} ${
                effectiveViewMode === 'all' ? styles.viewModeButtonActive : ''
              }`}
              onClick={() => {
                if (total > MAX_SHOW_ALL_THRESHOLD) {
                  applyShowAllPageSize();
                  setShowTooManyWarning(true);
                } else {
                  setViewMode('all');
                }
              }}
            >
              {t('auth_files.view_mode_all')}
            </Button>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className={styles.refreshAllButton}
            onClick={handleRefresh}
            disabled={disabled || isRefreshing}
            loading={isRefreshing}
            title={t('quota_management.refresh_all_credentials')}
            aria-label={t('quota_management.refresh_all_credentials')}
          >
            {!isRefreshing && <IconRefreshCw size={16} />}
            {t('quota_management.refresh_all_credentials')}
          </Button>
        </div>
      }
    >
      {filesError && <div className={styles.errorBox}>{filesError}</div>}
      {!filesLoading && total === 0 ? (
        <EmptyState
          title={t(`${config.i18nPrefix}.empty_title`)}
          description={t(`${config.i18nPrefix}.empty_desc`)}
        />
      ) : (
        <>
          <div className={config.gridClassName}>
            {files.map((item) => {
              const itemQuota = quota[item.name];
              const isResettingQuota = resettingQuotaName === item.name;
              const canUseQuotaAction =
                !disabled && !item.disabled && itemQuota?.status !== 'loading';
              const canReset =
                !config.canResetQuota || (itemQuota ? config.canResetQuota(itemQuota) : true);
              const canRunResetQuotaAction = canRunQuotaResetAction({
                sectionDisabled: disabled,
                fileDisabled: item.disabled,
                quota: itemQuota,
                resetting: isResettingQuota,
                canResetQuota: config.canResetQuota,
              });
              const resetButtonTitle = canReset
                ? t('codex_quota.reset_button')
                : t('codex_quota.reset_no_credits_hint');
              const resetQuotaAction = config.resetQuota ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className={styles.quotaResetCreditButton}
                  onClick={() => resetQuotaForFile(item)}
                  disabled={!canRunResetQuotaAction}
                  loading={isResettingQuota}
                  title={resetButtonTitle}
                  aria-label={resetButtonTitle}
                >
                  {!isResettingQuota && <IconRefreshCw size={14} />}
                  {t('codex_quota.reset_button')}
                </Button>
              ) : undefined;

              return (
                <QuotaCard
                  key={item.name}
                  item={item}
                  quota={itemQuota}
                  resolvedTheme={resolvedTheme}
                  i18nPrefix={config.i18nPrefix}
                  cardIdleMessageKey={config.cardIdleMessageKey}
                  cardClassName={config.cardClassName}
                  defaultType={config.type}
                  canRefresh={canUseQuotaAction && !isResettingQuota}
                  onRefresh={() => void refreshQuotaForFile(item)}
                  resetQuotaAction={resetQuotaAction}
                  renderQuotaItems={config.renderQuotaItems}
                />
              );
            })}
          </div>
          {total > pageSize && effectiveViewMode === 'paged' && (
            <div className={styles.pagination}>
              <Button
                variant="secondary"
                size="sm"
                onClick={goToPrev}
                disabled={currentPage <= 1 || filesLoading}
              >
                {t('auth_files.pagination_prev')}
              </Button>
              <div className={styles.pageInfo}>
                {t('auth_files.pagination_info', {
                  current: currentPage,
                  total: totalPages,
                  count: total,
                })}
              </div>
              <label className={styles.pageSizeControl}>
                <span>{t('auth_files.page_size_label')}</span>
                <input
                  type="number"
                  min={MIN_QUOTA_PAGE_SIZE}
                  max={MAX_SHOW_ALL_THRESHOLD}
                  value={pageSizeInput}
                  onChange={(event) => setPageSizeInput(event.target.value)}
                  onBlur={applyPageSizeInput}
                  onKeyDown={handlePageSizeInputKeyDown}
                  disabled={effectiveViewMode !== 'paged'}
                  className={styles.pageSizeInput}
                />
                <span>{t('auth_files.page_size_unit')}</span>
              </label>
              <Button
                variant="secondary"
                size="sm"
                onClick={goToNext}
                disabled={currentPage >= totalPages || filesLoading}
              >
                {t('auth_files.pagination_next')}
              </Button>
            </div>
          )}
        </>
      )}
      {showTooManyWarning && (
        <div className={styles.warningOverlay} onClick={() => setShowTooManyWarning(false)}>
          <div className={styles.warningModal} onClick={(e) => e.stopPropagation()}>
            <p>{t('auth_files.too_many_files_warning')}</p>
            <Button variant="primary" size="sm" onClick={() => setShowTooManyWarning(false)}>
              {t('common.confirm')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
