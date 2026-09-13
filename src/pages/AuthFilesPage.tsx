import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { animate } from 'motion/mini';
import type { AnimationPlaybackControlsWithThen } from 'motion-dom';
import { useInterval } from '@/hooks/useInterval';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useDebounce } from '@/hooks/useDebounce';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { IconSearch } from '@/components/ui/icons';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { copyToClipboard } from '@/utils/clipboard';
import {
  MIN_CARD_PAGE_SIZE,
  QUOTA_PROVIDER_TYPES,
  clampCardPageSize,
  getTypeColor,
  getTypeLabel,
  isRuntimeOnlyAuthFile,
  normalizeProviderKey,
  type QuotaProviderType,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import type { AuthFilesListQuery } from '@/features/authFiles/listQuery';
import { AUTH_UPLOAD_ACCEPT } from '@/features/authFiles/uploadValidation';
import { AuthFileCard } from '@/features/authFiles/components/AuthFileCard';
import { AuthFileModelsModal } from '@/features/authFiles/components/AuthFileModelsModal';
import { AuthFileTestModal } from '@/features/authFiles/components/AuthFileTestModal';
import { AuthFilesPrefixProxyEditorModal } from '@/features/authFiles/components/AuthFilesPrefixProxyEditorModal';
import { AuthFilesBatchFieldsEditorModal } from '@/features/authFiles/components/AuthFilesBatchFieldsEditorModal';
import { OAuthExcludedCard } from '@/features/authFiles/components/OAuthExcludedCard';
import { OAuthModelAliasCard } from '@/features/authFiles/components/OAuthModelAliasCard';
import iconAntigravity from '@/assets/icons/antigravity.svg';
import iconClaude from '@/assets/icons/claude.svg';
import iconCodex from '@/assets/icons/codex.svg';
import iconGemini from '@/assets/icons/gemini.svg';
import iconIflow from '@/assets/icons/iflow.svg';
import iconKimiDark from '@/assets/icons/kimi-dark.svg';
import iconKimiLight from '@/assets/icons/kimi-light.svg';
import iconQwen from '@/assets/icons/qwen.svg';
import iconVertex from '@/assets/icons/vertex.svg';
import { useAuthFilesData } from '@/features/authFiles/hooks/useAuthFilesData';
import { useAuthFilesModels } from '@/features/authFiles/hooks/useAuthFilesModels';
import { useAuthFilesOauth } from '@/features/authFiles/hooks/useAuthFilesOauth';
import { useAuthFilesPrefixProxyEditor } from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor';
import { useAuthFilesBatchFieldsEditor } from '@/features/authFiles/hooks/useAuthFilesBatchFieldsEditor';
import { useAuthFilesStats } from '@/features/authFiles/hooks/useAuthFilesStats';
import { useAuthFilesStatusBarCache } from '@/features/authFiles/hooks/useAuthFilesStatusBarCache';
import {
  isAuthFilesSortMode,
  readAuthFilesUiState,
  writeAuthFilesUiState,
  type AuthFilesSortMode,
} from '@/features/authFiles/uiState';
import { useAuthStore, useNotificationStore, useThemeStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import {
  AUTH_CLEANUP_SUPPORTED_TYPES,
  authFilesApi,
  isAuthCleanupProvider,
  type CodexCleanupEvent,
} from '@/services/api/authFiles';
import styles from './AuthFilesPage.module.scss';

const easePower3Out = (progress: number) => 1 - (1 - progress) ** 4;
const easePower2In = (progress: number) => progress ** 3;
const BATCH_BAR_BASE_TRANSFORM = 'translateX(-50%)';
const BATCH_BAR_HIDDEN_TRANSFORM = 'translateX(-50%) translateY(56px)';
const AUTH_FILE_FILTER_ICONS: Record<string, string | { light: string; dark: string }> = {
  antigravity: iconAntigravity,
  aistudio: iconGemini,
  claude: iconClaude,
  codex: iconCodex,
  gemini: iconGemini,
  'gemini-cli': iconGemini,
  iflow: iconIflow,
  kimi: { light: iconKimiLight, dark: iconKimiDark },
  qwen: iconQwen,
  vertex: iconVertex,
};

const getFilterTagIcon = (type: string, resolvedTheme: ResolvedTheme): string | null => {
  const iconEntry = AUTH_FILE_FILTER_ICONS[normalizeProviderKey(type)];
  if (!iconEntry) return null;
  return typeof iconEntry === 'string'
    ? iconEntry
    : resolvedTheme === 'dark'
      ? iconEntry.dark
      : iconEntry.light;
};

export function AuthFilesPage() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const pageTransitionLayer = usePageTransitionLayer();
  const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.status === 'current' : true;
  const navigate = useNavigate();
  const persistedUiState = useMemo(() => readAuthFilesUiState(), []);
  const persistedPageSize =
    typeof persistedUiState?.pageSize === 'number' && Number.isFinite(persistedUiState.pageSize)
      ? clampCardPageSize(persistedUiState.pageSize)
      : 12;

  const [filter, setFilter] = useState<'all' | string>(() => {
    const persistedFilter = persistedUiState?.filter?.trim();
    return persistedFilter || 'all';
  });
  const [problemOnly, setProblemOnly] = useState(() => persistedUiState?.problemOnly ?? false);
  const [disabledOnly, setDisabledOnly] = useState(() => persistedUiState?.disabledOnly ?? false);
  const [enabledOnly, setEnabledOnly] = useState(() => persistedUiState?.enabledOnly ?? false);
  const [search, setSearch] = useState(() => persistedUiState?.search ?? '');
  const [page, setPage] = useState(() =>
    typeof persistedUiState?.page === 'number' && Number.isFinite(persistedUiState.page)
      ? Math.max(1, Math.round(persistedUiState.page))
      : 1
  );
  const [pageSize, setPageSize] = useState(persistedPageSize);
  const [pageSizeInput, setPageSizeInput] = useState(() => String(persistedPageSize));
  const [viewMode, setViewMode] = useState<'diagram' | 'list'>('list');
  const [sortMode, setSortMode] = useState<AuthFilesSortMode>(() =>
    isAuthFilesSortMode(persistedUiState?.sortMode) ? persistedUiState.sortMode : 'default'
  );
  const [batchActionBarVisible, setBatchActionBarVisible] = useState(false);
  const floatingBatchActionsRef = useRef<HTMLDivElement>(null);
  const batchActionAnimationRef = useRef<AnimationPlaybackControlsWithThen | null>(null);
  const previousSelectionCountRef = useRef(0);
  const selectionCountRef = useRef(0);
  const debouncedSearch = useDebounce(search, 200);
  const listQuery = useMemo<AuthFilesListQuery>(
    () => ({
      page,
      pageSize,
      type: filter === 'all' ? '' : String(filter),
      problemOnly,
      disabledOnly,
      enabledOnly,
      search: debouncedSearch.trim(),
      sort: sortMode,
    }),
    [page, pageSize, filter, problemOnly, disabledOnly, enabledOnly, debouncedSearch, sortMode]
  );

  const {
    keyStats,
    statusBarByAuthIndex,
    resetKeyStats,
    loadKeyStatsForFiles,
    refreshKeyStatsForFiles,
    refreshKeyStatsForAuthIndex,
  } = useAuthFilesStats();
  const {
    files,
    total,
    types,
    typeCounts,
    enabledTypeCounts,
    selectedFiles,
    selectionCount,
    loading,
    error,
    uploading,
    uploadProgress,
    deleting,
    deletingAll,
    deleteAllProgress,
    downloadingAll,
    statusUpdating,
    manualRefreshing,
    batchStatusUpdating,
    fileInputRef,
    loadFiles,
    handleUploadClick,
    handleFileChange,
    handleDelete,
    handleDeleteAll,
    handleDownload,
    handleDownloadAll,
    handleManualRefresh,
    handleStatusToggle,
    toggleSelect,
    selectAllVisible,
    removeFromSelection,
    deselectAll,
    batchSetStatus,
    batchDelete,
  } = useAuthFilesData({ query: listQuery, resetKeyStats, loadKeyStatsForFiles });

  const statusBarCache = useAuthFilesStatusBarCache(files, statusBarByAuthIndex);

  const {
    excluded,
    excludedError,
    modelAlias,
    modelAliasError,
    allProviderModels,
    loadExcluded,
    loadModelAlias,
    deleteExcluded,
    deleteModelAlias,
    handleMappingUpdate,
    handleDeleteLink,
    handleToggleFork,
    handleRenameAlias,
    handleDeleteAlias,
  } = useAuthFilesOauth({ viewMode, files });

  const {
    modelsModalOpen,
    modelsLoading,
    modelsList,
    modelsFileName,
    modelsFileType,
    modelsError,
    showModels,
    closeModelsModal,
  } = useAuthFilesModels();

  const {
    prefixProxyEditor,
    prefixProxyUpdatedText,
    prefixProxyDirty,
    openPrefixProxyEditor,
    closePrefixProxyEditor,
    handlePrefixProxyChange,
    handlePrefixProxySave,
    handleCooldownReset,
  } = useAuthFilesPrefixProxyEditor({
    disableControls: connectionStatus !== 'connected',
    loadFiles: async () => {
      await loadFiles();
    },
  });

  const disableControls = connectionStatus !== 'connected';
  const [testFile, setTestFile] = useState<AuthFileItem | null>(null);
  const [codexCleaning, setCodexCleaning] = useState(false);
  const [cleanupPickerOpen, setCleanupPickerOpen] = useState(false);
  const [cleanupProvider, setCleanupProvider] = useState('codex');
  const [cleanupModalOpen, setCleanupModalOpen] = useState(false);
  const [cleanupTotal, setCleanupTotal] = useState(0);
  const [cleanupCurrent, setCleanupCurrent] = useState(0);
  const [cleanupDeleted, setCleanupDeleted] = useState(0);
  const [cleanupLogs, setCleanupLogs] = useState<string[]>([]);
  const [cleanupDone, setCleanupDone] = useState(false);
  const cleanupAbortRef = useRef<AbortController | null>(null);
  const cleanupLogsEndRef = useRef<HTMLDivElement | null>(null);
  const normalizedFilter = normalizeProviderKey(String(filter));
  const quotaFilterType: QuotaProviderType | null = QUOTA_PROVIDER_TYPES.has(
    normalizedFilter as QuotaProviderType
  )
    ? (normalizedFilter as QuotaProviderType)
    : null;

  useEffect(() => {
    writeAuthFilesUiState({
      filter,
      problemOnly,
      disabledOnly,
      enabledOnly,
      search,
      page,
      pageSize,
      sortMode,
    });
  }, [filter, problemOnly, disabledOnly, enabledOnly, search, page, pageSize, sortMode]);

  useEffect(() => {
    setPageSizeInput(String(pageSize));
  }, [pageSize]);

  const commitPageSizeInput = (rawValue: string) => {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      setPageSizeInput(String(pageSize));
      return;
    }

    const value = Number(trimmed);
    if (!Number.isFinite(value)) {
      setPageSizeInput(String(pageSize));
      return;
    }

    const next = clampCardPageSize(value);
    setPageSize(next);
    setPageSizeInput(String(next));
    setPage(1);
  };

  const handlePageSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const rawValue = event.currentTarget.value;
    setPageSizeInput(rawValue);

    const trimmed = rawValue.trim();
    if (!trimmed) return;

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return;

    const rounded = Math.round(parsed);
    if (rounded < MIN_CARD_PAGE_SIZE) return;

    setPageSize(rounded);
    setPage(1);
  };

  const handleSortModeChange = useCallback(
    (value: string) => {
      if (!isAuthFilesSortMode(value) || value === sortMode) return;
      setSortMode(value);
      setPage(1);
    },
    [sortMode]
  );

  const handleHeaderRefresh = useCallback(async () => {
    const [latestFiles] = await Promise.all([loadFiles(), loadExcluded(), loadModelAlias()]);
    await refreshKeyStatsForFiles(latestFiles);
  }, [loadFiles, loadExcluded, loadModelAlias, refreshKeyStatsForFiles]);

  const cleanableTypes = useMemo(
    () => AUTH_CLEANUP_SUPPORTED_TYPES.filter((type) => (enabledTypeCounts[type] ?? 0) > 0),
    [enabledTypeCounts]
  );

  const cleanupTypeOptions = useMemo(
    () =>
      cleanableTypes.map((type) => ({
        value: type,
        label: `${getTypeLabel(t, type)} (${enabledTypeCounts[type] ?? 0})`,
      })),
    [cleanableTypes, enabledTypeCounts, t]
  );

  const openCleanupPicker = useCallback(() => {
    if (cleanableTypes.length === 0) return;
    const preferred =
      isAuthCleanupProvider(normalizedFilter) && cleanableTypes.includes(normalizedFilter)
        ? normalizedFilter
        : cleanableTypes[0];
    setCleanupProvider(preferred);
    setCleanupPickerOpen(true);
  }, [cleanableTypes, normalizedFilter]);

  const handleCodexCleanup = useCallback(
    async (provider: string) => {
      const target = provider.trim().toLowerCase() || 'codex';
      const typeLabel = getTypeLabel(t, target);
      setCleanupPickerOpen(false);
      setCleanupProvider(target);
      setCodexCleaning(true);
      setCleanupModalOpen(true);
      setCleanupTotal(0);
      setCleanupCurrent(0);
      setCleanupDeleted(0);
      setCleanupLogs([]);
      setCleanupDone(false);

      const abort = new AbortController();
      const deletedNames = new Set<string>();
      cleanupAbortRef.current = abort;

      try {
        await authFilesApi.codexCleanup(
          (ev: CodexCleanupEvent) => {
            if (ev.type === 'start') {
              setCleanupTotal(ev.total);
              setCleanupLogs((prev) => [
                ...prev,
                t('auth_files.codex_cleanup_log_start', { total: ev.total, type: typeLabel }),
              ]);
            } else if (ev.type === 'progress') {
              setCleanupCurrent(ev.index);
              const status = ev.deleted
                ? `\u2717 ${t('auth_files.codex_cleanup_log_deleted')}`
                : ev.error
                  ? `\u26A0 ${ev.error}`
                  : `\u2713 ${t('auth_files.codex_cleanup_log_valid')}`;
              setCleanupLogs((prev) => [
                ...prev,
                `[${ev.index}/${ev.total}] ${ev.name} \u2014 ${status}`,
              ]);
              if (ev.deleted) {
                deletedNames.add(ev.name);
                setCleanupDeleted((prev) => prev + 1);
              }
            } else if (ev.type === 'done') {
              setCleanupDone(true);
              setCleanupLogs((prev) => [
                ...prev,
                t('auth_files.codex_cleanup_log_done', {
                  total: ev.total,
                  deleted: ev.deleted,
                  type: typeLabel,
                }),
              ]);
            }
          },
          abort.signal,
          target
        );
      } catch {
        if (!abort.signal.aborted) {
          showNotification(t('auth_files.codex_cleanup_failed', { type: typeLabel }), 'error');
        }
      } finally {
        removeFromSelection(deletedNames);
        await loadFiles();
        setCodexCleaning(false);
        cleanupAbortRef.current = null;
      }
    },
    [loadFiles, removeFromSelection, showNotification, t]
  );

  const handleCleanupModalClose = useCallback(() => {
    if (codexCleaning && cleanupAbortRef.current) {
      cleanupAbortRef.current.abort();
    }
    setCleanupModalOpen(false);
  }, [codexCleaning]);

  useEffect(() => {
    cleanupLogsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [cleanupLogs]);

  useHeaderRefresh(handleHeaderRefresh);

  useLayoutEffect(() => {
    if (!isCurrentLayer) return;
    loadFiles();
  }, [isCurrentLayer, listQuery, loadFiles]);

  useEffect(() => {
    if (!isCurrentLayer) return;
    loadExcluded();
    loadModelAlias();
  }, [isCurrentLayer, loadExcluded, loadModelAlias]);

  useInterval(
    () => {
      void refreshKeyStatsForFiles(files).catch(() => {});
    },
    isCurrentLayer ? 240_000 : null
  );

  const existingTypes = useMemo(() => ['all', ...types.filter((type) => type !== 'all')], [types]);

  const sortOptions = useMemo(
    () => [
      { value: 'default', label: t('auth_files.sort_default') },
      { value: 'az', label: t('auth_files.sort_az') },
      { value: 'priority', label: t('auth_files.sort_priority') },
    ],
    [t]
  );

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = files;
  useEffect(() => {
    if (!loading && page > totalPages) {
      setPage(totalPages);
    }
  }, [loading, page, totalPages]);
  const selectablePageItems = useMemo(
    () => pageItems.filter((file) => !isRuntimeOnlyAuthFile(file)),
    [pageItems]
  );
  const selectedNames = useMemo(() => Array.from(selectedFiles), [selectedFiles]);
  const batchFieldsEditor = useAuthFilesBatchFieldsEditor({
    disableControls,
    files,
    selectedNames,
    loadFiles,
    deselectAll,
  });
  const selectedHasStatusUpdating = useMemo(
    () => selectedNames.some((name) => statusUpdating[name] === true),
    [selectedNames, statusUpdating]
  );
  const batchStatusButtonsDisabled =
    disableControls ||
    selectedNames.length === 0 ||
    batchStatusUpdating ||
    selectedHasStatusUpdating;

  const copyTextWithNotification = useCallback(
    async (text: string) => {
      const copied = await copyToClipboard(text);
      showNotification(
        copied
          ? t('notification.link_copied', { defaultValue: 'Copied to clipboard' })
          : t('notification.copy_failed', { defaultValue: 'Copy failed' }),
        copied ? 'success' : 'error'
      );
    },
    [showNotification, t]
  );

  const openExcludedEditor = useCallback(
    (provider?: string) => {
      const providerValue = (provider || (filter !== 'all' ? String(filter) : '')).trim();
      const params = new URLSearchParams();
      if (providerValue) {
        params.set('provider', providerValue);
      }
      const nextSearch = params.toString();
      navigate(`/auth-files/oauth-excluded${nextSearch ? `?${nextSearch}` : ''}`, {
        state: { fromAuthFiles: true },
      });
    },
    [filter, navigate]
  );

  const openModelAliasEditor = useCallback(
    (provider?: string) => {
      const providerValue = (provider || (filter !== 'all' ? String(filter) : '')).trim();
      const params = new URLSearchParams();
      if (providerValue) {
        params.set('provider', providerValue);
      }
      const nextSearch = params.toString();
      navigate(`/auth-files/oauth-model-alias${nextSearch ? `?${nextSearch}` : ''}`, {
        state: { fromAuthFiles: true },
      });
    },
    [filter, navigate]
  );

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;

    const actionsEl = floatingBatchActionsRef.current;
    if (!actionsEl) {
      document.documentElement.style.removeProperty('--auth-files-action-bar-height');
      return;
    }

    const updatePadding = () => {
      const height = actionsEl.getBoundingClientRect().height;
      document.documentElement.style.setProperty('--auth-files-action-bar-height', `${height}px`);
    };

    updatePadding();
    window.addEventListener('resize', updatePadding);

    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePadding);
    ro?.observe(actionsEl);

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', updatePadding);
      document.documentElement.style.removeProperty('--auth-files-action-bar-height');
    };
  }, [batchActionBarVisible, selectionCount]);

  useEffect(() => {
    selectionCountRef.current = selectionCount;
    if (selectionCount > 0) {
      setBatchActionBarVisible(true);
    }
  }, [selectionCount]);

  useLayoutEffect(() => {
    if (!batchActionBarVisible) return;
    const currentCount = selectionCount;
    const previousCount = previousSelectionCountRef.current;
    const actionsEl = floatingBatchActionsRef.current;
    if (!actionsEl) return;

    batchActionAnimationRef.current?.stop();
    batchActionAnimationRef.current = null;

    if (currentCount > 0 && previousCount === 0) {
      batchActionAnimationRef.current = animate(
        actionsEl,
        {
          transform: [BATCH_BAR_HIDDEN_TRANSFORM, BATCH_BAR_BASE_TRANSFORM],
          opacity: [0, 1],
        },
        {
          duration: 0.28,
          ease: easePower3Out,
          onComplete: () => {
            actionsEl.style.transform = BATCH_BAR_BASE_TRANSFORM;
            actionsEl.style.opacity = '1';
          },
        }
      );
    } else if (currentCount === 0 && previousCount > 0) {
      batchActionAnimationRef.current = animate(
        actionsEl,
        {
          transform: [BATCH_BAR_BASE_TRANSFORM, BATCH_BAR_HIDDEN_TRANSFORM],
          opacity: [1, 0],
        },
        {
          duration: 0.22,
          ease: easePower2In,
          onComplete: () => {
            if (selectionCountRef.current === 0) {
              setBatchActionBarVisible(false);
            }
          },
        }
      );
    }

    previousSelectionCountRef.current = currentCount;
  }, [batchActionBarVisible, selectionCount]);

  useEffect(
    () => () => {
      batchActionAnimationRef.current?.stop();
      batchActionAnimationRef.current = null;
    },
    []
  );

  const renderFilterTags = () => (
    <div className={styles.filterTags}>
      {existingTypes.map((type) => {
        const isActive = filter === type;
        const iconSrc = getFilterTagIcon(type, resolvedTheme);
        const color =
          type === 'all'
            ? { bg: 'var(--bg-tertiary)', text: 'var(--text-primary)' }
            : getTypeColor(type, resolvedTheme);
        const activeTextColor = resolvedTheme === 'dark' ? '#111827' : '#fff';
        return (
          <button
            key={type}
            className={`${styles.filterTag} ${isActive ? styles.filterTagActive : ''}`}
            style={{
              backgroundColor: isActive ? color.text : color.bg,
              color: isActive ? activeTextColor : color.text,
              borderColor: color.text,
            }}
            onClick={() => {
              setFilter(type);
              setPage(1);
            }}
          >
            <span className={styles.filterTagLabel}>
              {iconSrc && <img src={iconSrc} alt="" className={styles.filterTagIcon} />}
              <span>{getTypeLabel(t, type)}</span>
            </span>
            <span className={styles.filterTagCount}>{typeCounts[type] ?? 0}</span>
          </button>
        );
      })}
    </div>
  );

  const titleNode = (
    <div className={styles.titleWrapper}>
      <span>{t('auth_files.title_section')}</span>
      {total > 0 && <span className={styles.countBadge}>{total}</span>}
    </div>
  );
  const hasAnyAuthFiles = total > 0 || types.some((type) => type !== 'all');
  const deleteCandidateCount = typeCounts[filter] ?? 0;

  const deleteAllButtonLabel = (() => {
    if (disabledOnly) {
      return t('auth_files.delete_filtered_result_button');
    }
    if (problemOnly) {
      return filter === 'all'
        ? t('auth_files.delete_problem_button')
        : t('auth_files.delete_problem_button_with_type', { type: getTypeLabel(t, filter) });
    }
    return filter === 'all'
      ? t('auth_files.delete_all_button')
      : `${t('common.delete')} ${getTypeLabel(t, filter)}`;
  })();
  const uploadProgressLabel = uploadProgress
    ? uploadProgress.percent !== null
      ? t('auth_files.upload_progress_percent', { percent: uploadProgress.percent })
      : t('auth_files.upload_progress_active')
    : '';
  const deleteAllProgressPercent =
    deleteAllProgress && deleteAllProgress.total > 0
      ? Math.min(
          100,
          Math.max(0, Math.round((deleteAllProgress.current / deleteAllProgress.total) * 100))
        )
      : null;
  const deleteAllProgressLabel = deletingAll
    ? deleteAllProgressPercent !== null
      ? t('auth_files.delete_all_progress_percent', { percent: deleteAllProgressPercent })
      : t('auth_files.delete_all_progress_active')
    : '';

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('auth_files.title')}</h1>
        <p className={styles.description}>{t('auth_files.description')}</p>
      </div>

      <Card
        title={titleNode}
        extra={
          <div className={styles.headerActions}>
            {cleanableTypes.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={openCleanupPicker}
                disabled={disableControls || codexCleaning}
                loading={codexCleaning}
              >
                {t('auth_files.codex_cleanup_button')}
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={handleHeaderRefresh} disabled={loading}>
              {t('common.refresh')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleDownloadAll()}
              disabled={disableControls || loading || !hasAnyAuthFiles || downloadingAll}
              loading={downloadingAll}
            >
              {t('auth_files.download_all_button')}
            </Button>
            <Button
              size="sm"
              onClick={handleUploadClick}
              disabled={disableControls || uploading}
              loading={uploading}
            >
              {t('auth_files.upload_button')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() =>
                handleDeleteAll({
                  filter,
                  problemOnly,
                  disabledOnly,
                  enabledOnly,
                  onResetFilterToAll: () => setFilter('all'),
                  onResetProblemOnly: () => setProblemOnly(false),
                  onResetDisabledOnly: () => setDisabledOnly(false),
                  onResetEnabledOnly: () => setEnabledOnly(false),
                })
              }
              disabled={disableControls || loading || deleteCandidateCount === 0 || deletingAll}
              loading={deletingAll}
            >
              {deleteAllButtonLabel}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept={AUTH_UPLOAD_ACCEPT}
              multiple
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </div>
        }
      >
        {error && <div className={styles.errorBox}>{error}</div>}
        {uploading && uploadProgress && (
          <div className={styles.uploadProgress} role="status" aria-live="polite">
            <div className={styles.uploadProgressHeader}>
              <span>{uploadProgressLabel}</span>
            </div>
            <div className={styles.uploadProgressTrack}>
              <div
                className={styles.uploadProgressBar}
                style={{
                  width: uploadProgress.percent !== null ? `${uploadProgress.percent}%` : '100%',
                }}
              />
            </div>
          </div>
        )}
        {deletingAll && (
          <div className={styles.uploadProgress} role="status" aria-live="polite">
            <div className={styles.uploadProgressHeader}>
              <span>{deleteAllProgressLabel}</span>
            </div>
            <div className={styles.uploadProgressTrack}>
              <div
                className={styles.uploadProgressBar}
                style={{
                  width:
                    deleteAllProgressPercent !== null ? `${deleteAllProgressPercent}%` : '100%',
                }}
              />
            </div>
          </div>
        )}

        <div className={styles.filterSection}>
          {renderFilterTags()}

          <div className={styles.filterControls}>
            <div className={`${styles.filterItem} ${styles.filterSearchItem}`}>
              <label>{t('auth_files.search_label')}</label>
              <Input
                className={styles.searchInput}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder={t('auth_files.search_placeholder')}
                rightElement={<IconSearch className={styles.searchIcon} size={18} />}
              />
            </div>
            <div className={styles.filterItem}>
              <label>{t('auth_files.page_size_label')}</label>
              <input
                className={styles.pageSizeSelect}
                type="number"
                min={MIN_CARD_PAGE_SIZE}
                step={1}
                value={pageSizeInput}
                onChange={handlePageSizeChange}
                onBlur={(e) => commitPageSizeInput(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  }
                }}
              />
            </div>
            <div className={styles.filterItem}>
              <label>{t('auth_files.sort_label')}</label>
              <Select
                className={styles.sortSelect}
                value={sortMode}
                options={sortOptions}
                onChange={handleSortModeChange}
                ariaLabel={t('auth_files.sort_label')}
                fullWidth={false}
              />
            </div>
            <div className={`${styles.filterItem} ${styles.filterToggleItem}`}>
              <label>{t('auth_files.problem_filter_label')}</label>
              <div className={styles.filterToggle}>
                <ToggleSwitch
                  checked={problemOnly}
                  onChange={(value) => {
                    setProblemOnly(value);
                    setPage(1);
                  }}
                  ariaLabel={t('auth_files.problem_filter_only')}
                  label={
                    <span className={styles.filterToggleLabel}>
                      {t('auth_files.problem_filter_only')}
                    </span>
                  }
                />
              </div>
            </div>
            <div className={`${styles.filterItem} ${styles.filterToggleItem}`}>
              <label>{t('auth_files.disabled_filter_label')}</label>
              <div className={styles.filterToggle}>
                <ToggleSwitch
                  checked={disabledOnly}
                  onChange={(value) => {
                    setDisabledOnly(value);
                    setPage(1);
                  }}
                  ariaLabel={t('auth_files.disabled_filter_only')}
                  label={
                    <span className={styles.filterToggleLabel}>
                      {t('auth_files.disabled_filter_only')}
                    </span>
                  }
                />
              </div>
            </div>
            <div className={`${styles.filterItem} ${styles.filterToggleItem}`}>
              <label>{t('auth_files.enabled_filter_label')}</label>
              <div className={styles.filterToggle}>
                <ToggleSwitch
                  checked={enabledOnly}
                  onChange={(value) => {
                    setEnabledOnly(value);
                    setPage(1);
                  }}
                  ariaLabel={t('auth_files.enabled_filter_only')}
                  label={
                    <span className={styles.filterToggleLabel}>
                      {t('auth_files.enabled_filter_only')}
                    </span>
                  }
                />
              </div>
            </div>
          </div>
        </div>

        {loading ? (
          <div className={styles.hint}>{t('common.loading')}</div>
        ) : pageItems.length === 0 ? (
          <EmptyState
            title={t('auth_files.search_empty_title')}
            description={t('auth_files.search_empty_desc')}
          />
        ) : (
          <div className={styles.fileGrid}>
            {pageItems.map((file) => (
              <AuthFileCard
                key={file.name}
                file={file}
                selected={selectedFiles.has(file.name)}
                resolvedTheme={resolvedTheme}
                disableControls={disableControls}
                deleting={deleting}
                statusUpdating={statusUpdating}
                manualRefreshing={manualRefreshing}
                quotaFilterType={quotaFilterType}
                keyStats={keyStats}
                statusBarCache={statusBarCache}
                onTest={setTestFile}
                onShowModels={showModels}
                onDownload={handleDownload}
                onManualRefresh={handleManualRefresh}
                onOpenPrefixProxyEditor={openPrefixProxyEditor}
                onDelete={handleDelete}
                onToggleStatus={handleStatusToggle}
                onToggleSelect={toggleSelect}
                onRefreshStats={refreshKeyStatsForAuthIndex}
              />
            ))}
          </div>
        )}

        {!loading && total > pageSize && (
          <div className={styles.pagination}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
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
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage >= totalPages}
            >
              {t('auth_files.pagination_next')}
            </Button>
          </div>
        )}
      </Card>

      <OAuthExcludedCard
        disableControls={disableControls}
        excludedError={excludedError}
        excluded={excluded}
        onRetry={loadExcluded}
        onAdd={() => openExcludedEditor()}
        onEdit={openExcludedEditor}
        onDelete={deleteExcluded}
      />

      <OAuthModelAliasCard
        disableControls={disableControls}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onRetry={loadModelAlias}
        onAdd={() => openModelAliasEditor()}
        onEditProvider={openModelAliasEditor}
        onDeleteProvider={deleteModelAlias}
        modelAliasError={modelAliasError}
        modelAlias={modelAlias}
        allProviderModels={allProviderModels}
        onUpdate={handleMappingUpdate}
        onDeleteLink={handleDeleteLink}
        onToggleFork={handleToggleFork}
        onRenameAlias={handleRenameAlias}
        onDeleteAlias={handleDeleteAlias}
      />

      <AuthFileModelsModal
        open={modelsModalOpen}
        fileName={modelsFileName}
        fileType={modelsFileType}
        loading={modelsLoading}
        error={modelsError}
        models={modelsList}
        excluded={excluded}
        onClose={closeModelsModal}
        onCopyText={copyTextWithNotification}
      />

      <AuthFileTestModal
        open={testFile !== null}
        file={testFile}
        onClose={() => setTestFile(null)}
      />

      <AuthFilesPrefixProxyEditorModal
        disableControls={disableControls}
        editor={prefixProxyEditor}
        updatedText={prefixProxyUpdatedText}
        dirty={prefixProxyDirty}
        onClose={closePrefixProxyEditor}
        onCopyText={copyTextWithNotification}
        onSave={handlePrefixProxySave}
        onClearCooldown={handleCooldownReset}
        onChange={handlePrefixProxyChange}
      />

      <AuthFilesBatchFieldsEditorModal
        open={batchFieldsEditor.open}
        saving={batchFieldsEditor.saving}
        disableControls={disableControls}
        selectedCount={batchFieldsEditor.selectedCount}
        form={batchFieldsEditor.form}
        headersError={batchFieldsEditor.headersError}
        priorityError={batchFieldsEditor.priorityError}
        showWebsockets={batchFieldsEditor.showWebsockets}
        showUsingApi={batchFieldsEditor.showUsingApi}
        canApply={batchFieldsEditor.canApply}
        onClose={batchFieldsEditor.closeBatchFieldsEditor}
        onApply={() => {
          void batchFieldsEditor.handleApply();
        }}
        onChange={batchFieldsEditor.setField}
      />

      <Modal
        open={cleanupPickerOpen}
        title={t('auth_files.codex_cleanup_button')}
        onClose={() => setCleanupPickerOpen(false)}
        width={420}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="secondary" size="sm" onClick={() => setCleanupPickerOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              disabled={!cleanupProvider || cleanupTypeOptions.length === 0}
              onClick={() => void handleCodexCleanup(cleanupProvider)}
            >
              {t('auth_files.codex_cleanup_start')}
            </Button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {t('auth_files.codex_cleanup_select_hint')}
          </div>
          <Select
            value={cleanupProvider}
            options={cleanupTypeOptions}
            onChange={setCleanupProvider}
            ariaLabel={t('auth_files.codex_cleanup_select_label')}
            fullWidth
          />
        </div>
      </Modal>

      <Modal
        open={cleanupModalOpen}
        title={t('auth_files.codex_cleanup_running_title', {
          type: getTypeLabel(t, cleanupProvider),
        })}
        onClose={handleCleanupModalClose}
        width={560}
        footer={
          <Button
            variant={cleanupDone ? 'primary' : 'danger'}
            size="sm"
            onClick={handleCleanupModalClose}
          >
            {cleanupDone ? t('common.close') : t('common.cancel')}
          </Button>
        }
      >
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: 6,
              fontSize: 13,
            }}
          >
            <span>
              {cleanupDone
                ? t('auth_files.codex_cleanup_log_done', {
                    total: cleanupTotal,
                    deleted: cleanupDeleted,
                    type: getTypeLabel(t, cleanupProvider),
                  })
                : t('auth_files.codex_cleanup_progress', {
                    current: cleanupCurrent,
                    total: cleanupTotal,
                    type: getTypeLabel(t, cleanupProvider),
                  })}
            </span>
            <span>
              {cleanupTotal > 0 ? `${Math.round((cleanupCurrent / cleanupTotal) * 100)}%` : '0%'}
            </span>
          </div>
          <div
            style={{
              width: '100%',
              height: 6,
              borderRadius: 3,
              background: 'var(--border-color)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: cleanupTotal > 0 ? `${(cleanupCurrent / cleanupTotal) * 100}%` : '0%',
                height: '100%',
                borderRadius: 3,
                background: cleanupDone ? 'var(--success-color)' : 'var(--primary-color)',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
        </div>
        <div
          style={{
            maxHeight: 260,
            overflowY: 'auto',
            fontSize: 12,
            fontFamily: 'monospace',
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            borderRadius: 6,
            padding: '8px 10px',
            lineHeight: 1.7,
          }}
        >
          {cleanupLogs.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
          <div ref={cleanupLogsEndRef} />
        </div>
      </Modal>

      {batchActionBarVisible && typeof document !== 'undefined'
        ? createPortal(
            <div className={styles.batchActionContainer} ref={floatingBatchActionsRef}>
              <div className={styles.batchActionBar}>
                <div className={styles.batchActionLeft}>
                  <span className={styles.batchSelectionText}>
                    {t('auth_files.batch_selected', { count: selectionCount })}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => selectAllVisible(pageItems)}
                    disabled={selectablePageItems.length === 0}
                  >
                    {t('auth_files.batch_select_all')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={deselectAll}>
                    {t('auth_files.batch_deselect')}
                  </Button>
                </div>
                <div className={styles.batchActionRight}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={batchFieldsEditor.openBatchFieldsEditor}
                    disabled={
                      disableControls ||
                      selectedNames.length === 0 ||
                      batchFieldsEditor.saving ||
                      batchStatusUpdating
                    }
                  >
                    {t('auth_files.batch_edit_fields')}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => batchSetStatus(selectedNames, true)}
                    disabled={batchStatusButtonsDisabled}
                  >
                    {t('auth_files.batch_enable')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => batchSetStatus(selectedNames, false)}
                    disabled={batchStatusButtonsDisabled}
                  >
                    {t('auth_files.batch_disable')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => batchDelete(selectedNames)}
                    disabled={disableControls || selectedNames.length === 0}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
