import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconBot,
  IconDownload,
  IconKey,
  IconPlay,
  IconRefreshCw,
  IconSettings,
  IconTrash2,
} from '@/components/ui/icons';
import { ProviderStatusBar } from '@/components/providers/ProviderStatusBar';
import { useQuotaStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { EMPTY_STATUS_BAR, normalizeAuthIndex, type KeyStats } from '@/utils/usage';
import {
  formatModified,
  getAuthFileErrorMessage,
  getTypeColor,
  getTypeLabel,
  isRuntimeOnlyAuthFile,
  parsePriorityValue,
  readCodexAuthFileWebsockets,
  resolveAuthFileStats,
  supportsAuthFileManualRefresh,
  type QuotaProviderType,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import {
  canRefreshAuthFileQuota,
  resolveVisibleAuthFileQuotaType,
} from '@/features/authFiles/quotaDisplay';
import type { AuthFileStatusBarData } from '@/features/authFiles/hooks/useAuthFilesStatusBarCache';
import { useAuthFileQuotaRefresh } from '@/features/authFiles/hooks/useAuthFileQuotaRefresh';
import { AuthFileQuotaSection } from '@/features/authFiles/components/AuthFileQuotaSection';
import { isCodexFile } from '@/utils/quota/validators';
import styles from '@/pages/AuthFilesPage.module.scss';

const HEALTHY_STATUS_MESSAGES = new Set(['ok', 'healthy', 'ready', 'success', 'available']);
type QuotaState = { status?: string } | undefined;

export type AuthFileCardProps = {
  file: AuthFileItem;
  selected: boolean;
  resolvedTheme: ResolvedTheme;
  disableControls: boolean;
  deleting: string | null;
  statusUpdating: Record<string, boolean>;
  manualRefreshing: Record<string, boolean>;
  quotaFilterType: QuotaProviderType | null;
  keyStats: KeyStats;
  statusBarCache: Map<string, AuthFileStatusBarData>;
  onShowModels: (file: AuthFileItem) => void;
  onTest: (file: AuthFileItem) => void;
  onDownload: (name: string) => void;
  onManualRefresh: (file: AuthFileItem) => void;
  onOpenPrefixProxyEditor: (file: AuthFileItem) => void;
  onDelete: (name: string) => void;
  onToggleStatus: (file: AuthFileItem, enabled: boolean) => void;
  onToggleSelect: (file: AuthFileItem) => void;
  onRefreshStats: (authIndex: unknown) => Promise<void>;
};

export function AuthFileCard(props: AuthFileCardProps) {
  const { t } = useTranslation();
  const {
    file,
    selected,
    resolvedTheme,
    disableControls,
    deleting,
    statusUpdating,
    manualRefreshing,
    quotaFilterType,
    keyStats,
    statusBarCache,
    onShowModels,
    onTest,
    onDownload,
    onManualRefresh,
    onOpenPrefixProxyEditor,
    onDelete,
    onToggleStatus,
    onToggleSelect,
    onRefreshStats,
  } = props;

  const fileStats = resolveAuthFileStats(file, keyStats);
  const isRuntimeOnly = isRuntimeOnlyAuthFile(file);
  const isAistudio = (file.type || '').toLowerCase() === 'aistudio';
  const showModelsButton = !isRuntimeOnly || isAistudio;
  const showManualRefreshButton =
    !isRuntimeOnly && supportsAuthFileManualRefresh(file.type ?? file.provider);
  const isManualRefreshing = manualRefreshing[file.name] === true;
  const typeColor = getTypeColor(file.type || 'unknown', resolvedTheme);
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndexKey = normalizeAuthIndex(rawAuthIndex);

  const quotaType = resolveVisibleAuthFileQuotaType(file, quotaFilterType);
  const quota = useQuotaStore((state) => {
    if (quotaType === 'antigravity') return state.antigravityQuota[file.name] as QuotaState;
    if (quotaType === 'claude') return state.claudeQuota[file.name] as QuotaState;
    if (quotaType === 'codex') return state.codexQuota[file.name] as QuotaState;
    if (quotaType === 'kimi') return state.kimiQuota[file.name] as QuotaState;
    if (quotaType === 'xai') return state.xaiQuota[file.name] as QuotaState;
    if (quotaType === 'gemini-cli') return state.geminiCliQuota[file.name] as QuotaState;
    return undefined;
  });
  const { refreshQuotaForFile } = useAuthFileQuotaRefresh();

  const showQuotaLayout = Boolean(quotaType) && !isRuntimeOnly;
  const quotaRefreshing = quota?.status === 'loading';
  const canRefreshQuota =
    Boolean(quotaType) &&
    !disableControls &&
    !quotaRefreshing &&
    canRefreshAuthFileQuota(file, quotaType);
  const handleRefreshQuota = useCallback(async () => {
    if (!quotaType) return;
    const result = await refreshQuotaForFile(file, quotaType);
    if (result.status !== 'skipped' && authIndexKey) {
      await onRefreshStats(authIndexKey);
    }
  }, [authIndexKey, file, onRefreshStats, quotaType, refreshQuotaForFile]);

  const providerCardClass =
    quotaType === 'antigravity'
      ? styles.antigravityCard
      : quotaType === 'claude'
        ? styles.claudeCard
        : quotaType === 'codex'
          ? styles.codexCard
          : quotaType === 'gemini-cli'
            ? styles.geminiCliCard
            : quotaType === 'kimi'
              ? styles.kimiCard
              : quotaType === 'xai'
                ? styles.xaiCard
                : '';

  const statusData = (authIndexKey && statusBarCache.get(authIndexKey)) || EMPTY_STATUS_BAR;
  const rawStatusMessage = getAuthFileErrorMessage(file);
  const hasStatusWarning =
    Boolean(rawStatusMessage) && !HEALTHY_STATUS_MESSAGES.has(rawStatusMessage.toLowerCase());

  const priorityValue = parsePriorityValue(file.priority ?? file['priority']) ?? 0;
  const noteValue = typeof file.note === 'string' ? file.note.trim() : '';
  const showWebsocketsBadge = isCodexFile(file) && readCodexAuthFileWebsockets(file);

  return (
    <div
      className={`${styles.fileCard} ${providerCardClass} ${selected ? styles.fileCardSelected : ''} ${file.disabled ? styles.fileCardDisabled : ''}`}
    >
      {showWebsocketsBadge && (
        <span
          className={styles.websocketsBadge}
          title={t('auth_files.websockets_label')}
          aria-label={t('auth_files.websockets_label')}
        >
          WS
        </span>
      )}
      <div className={styles.fileCardLayout}>
        <div className={styles.fileCardMain}>
          <div className={styles.cardHeader}>
            {!isRuntimeOnly && (
              <SelectionCheckbox
                checked={selected}
                onChange={() => onToggleSelect(file)}
                aria-label={
                  selected ? t('auth_files.batch_deselect') : t('auth_files.batch_select_all')
                }
                title={selected ? t('auth_files.batch_deselect') : t('auth_files.batch_select_all')}
              />
            )}
            <span
              className={styles.typeBadge}
              style={{
                backgroundColor: typeColor.bg,
                color: typeColor.text,
                ...(typeColor.border ? { border: typeColor.border } : {}),
              }}
            >
              {getTypeLabel(t, file.type || 'unknown')}
            </span>
            <span className={styles.fileName}>{file.name}</span>
          </div>

          <div className={styles.cardMeta}>
            <div className={styles.cardMetaRow}>
              <span className={styles.modifiedTime}>
                {t('auth_files.file_modified')}: {formatModified(file)}
              </span>
              <span className={styles.priorityBadge}>
                {t('auth_files.priority_display')}:{' '}
                <span className={styles.priorityValue}>{priorityValue}</span>
              </span>
            </div>
          </div>

          {noteValue && (
            <div className={styles.noteText} title={noteValue}>
              <span className={styles.noteLabel}>{t('auth_files.note_display')}: </span>
              {noteValue}
            </div>
          )}

          {rawStatusMessage && hasStatusWarning && (
            <div className={styles.healthStatusMessage} title={rawStatusMessage}>
              {rawStatusMessage}
            </div>
          )}

          <div className={styles.cardStats}>
            <span className={`${styles.statPill} ${styles.statSuccess}`}>
              {t('stats.success')}: {fileStats.success}
            </span>
            <span className={`${styles.statPill} ${styles.statFailure}`}>
              {t('stats.failure')}: {fileStats.failure}
            </span>
          </div>

          <ProviderStatusBar statusData={statusData} styles={styles} />

          {showQuotaLayout && quotaType && (
            <AuthFileQuotaSection
              file={file}
              quotaType={quotaType}
              disableControls={disableControls}
            />
          )}

          <div className={styles.cardActions}>
            {showQuotaLayout && quotaType && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleRefreshQuota()}
                className={styles.iconButton}
                title={t('auth_files.quota_refresh_button')}
                aria-label={t('auth_files.quota_refresh_button')}
                disabled={!canRefreshQuota}
              >
                {quotaRefreshing ? (
                  <LoadingSpinner size={14} />
                ) : (
                  <IconRefreshCw className={styles.actionIcon} size={16} />
                )}
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onTest(file)}
              className={styles.iconButton}
              title={t('auth_files.test_button')}
              aria-label={t('auth_files.test_button')}
              disabled={disableControls}
            >
              <IconPlay className={styles.actionIcon} size={16} />
            </Button>
            {showModelsButton && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => onShowModels(file)}
                className={styles.iconButton}
                title={t('auth_files.models_button', { defaultValue: '模型' })}
                disabled={disableControls}
              >
                <IconBot className={styles.actionIcon} size={16} />
              </Button>
            )}
            {!isRuntimeOnly && (
              <>
                {showManualRefreshButton && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onManualRefresh(file)}
                    className={styles.iconButton}
                    title={t('auth_files.manual_refresh_button')}
                    aria-label={t('auth_files.manual_refresh_button')}
                    disabled={
                      disableControls ||
                      file.disabled ||
                      statusUpdating[file.name] === true ||
                      isManualRefreshing
                    }
                  >
                    {isManualRefreshing ? (
                      <LoadingSpinner size={14} />
                    ) : (
                      <IconKey className={styles.actionIcon} size={16} />
                    )}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onDownload(file.name)}
                  className={styles.iconButton}
                  title={t('auth_files.download_button')}
                  disabled={disableControls}
                >
                  <IconDownload className={styles.actionIcon} size={16} />
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onOpenPrefixProxyEditor(file)}
                  className={styles.iconButton}
                  title={t('auth_files.prefix_proxy_button')}
                  disabled={disableControls || isManualRefreshing}
                >
                  <IconSettings className={styles.actionIcon} size={16} />
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => onDelete(file.name)}
                  className={styles.iconButton}
                  title={t('auth_files.delete_button')}
                  disabled={disableControls || deleting === file.name || isManualRefreshing}
                >
                  {deleting === file.name ? (
                    <LoadingSpinner size={14} />
                  ) : (
                    <IconTrash2 className={styles.actionIcon} size={16} />
                  )}
                </Button>
              </>
            )}
            {!isRuntimeOnly && (
              <div className={styles.statusToggle}>
                <ToggleSwitch
                  ariaLabel={t('auth_files.status_toggle_label')}
                  checked={!file.disabled}
                  disabled={
                    disableControls || statusUpdating[file.name] === true || isManualRefreshing
                  }
                  onChange={(value) => onToggleStatus(file, value)}
                />
              </div>
            )}
            {isRuntimeOnly && (
              <div className={styles.virtualBadge}>
                {t('auth_files.type_virtual') || '虚拟认证文件'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
