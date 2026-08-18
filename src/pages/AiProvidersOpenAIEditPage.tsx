import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { HeaderInputList } from '@/components/ui/HeaderInputList';
import { Input } from '@/components/ui/Input';
import { ModelInputList } from '@/components/ui/ModelInputList';
import { Select } from '@/components/ui/Select';
import { SecondaryScreenShell } from '@/components/common/SecondaryScreenShell';
import { useEdgeSwipeBack } from '@/hooks/useEdgeSwipeBack';
import { useNotificationStore } from '@/stores';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import type { ApiKeyEntry } from '@/types';
import { buildHeaderObject, hasHeader } from '@/utils/headers';
import { buildApiKeyEntry, buildOpenAIChatCompletionsEndpoint } from '@/components/providers/utils';
import type { OpenAIEditOutletContext } from './AiProvidersOpenAIEditLayout';
import type { KeyTestStatus } from '@/stores/useOpenAIEditDraftStore';
import styles from './AiProvidersPage.module.scss';
import layoutStyles from './AiProvidersEditLayout.module.scss';

const OPENAI_TEST_TIMEOUT_MS = 30_000;

const getErrorMessage = (err: unknown) => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
};

// Status icon components
function StatusLoadingIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={styles.statusIconSpin}>
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path
        d="M8 1A7 7 0 0 1 8 15"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function StatusSuccessIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="8" fill="var(--success-color, #22c55e)" />
      <path
        d="M4.5 8L7 10.5L11.5 6"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatusErrorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="8" fill="var(--danger-color, #ef4444)" />
      <path
        d="M5 5L11 11M11 5L5 11"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatusIdleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="var(--text-tertiary, #9ca3af)" strokeWidth="2" />
    </svg>
  );
}

function StatusIcon({ status }: { status: KeyTestStatus['status'] }) {
  switch (status) {
    case 'loading':
      return <StatusLoadingIcon />;
    case 'success':
      return <StatusSuccessIcon />;
    case 'error':
      return <StatusErrorIcon />;
    default:
      return <StatusIdleIcon />;
  }
}

export function AiProvidersOpenAIEditPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { showNotification } = useNotificationStore();
  const {
    hasIndexParam,
    invalidIndexParam,
    invalidIndex,
    disableControls,
    loading,
    saving,
    form,
    setForm,
    testModel,
    setTestModel,
    testStatus,
    setTestStatus,
    testMessage,
    setTestMessage,
    keyTestStatuses,
    setDraftKeyTestStatus,
    resetDraftKeyTestStatuses,
    availableModels,
    handleBack,
    handleSave,
  } = useOutletContext<OpenAIEditOutletContext>();

  const title = hasIndexParam
    ? t('ai_providers.openai_edit_modal_title')
    : t('ai_providers.openai_add_modal_title');

  const swipeRef = useEdgeSwipeBack({ onBack: handleBack });
  const [isTestingKeys, setIsTestingKeys] = useState(false);

  /* 分页与批量导入 API 密钥状态和处理 */
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importText, setImportText] = useState('');

  const apiKeyList = useMemo(() => {
    return form.apiKeyEntries.length ? form.apiKeyEntries : [buildApiKeyEntry()];
  }, [form.apiKeyEntries]);

  const totalItems = apiKeyList.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const activePage = Math.max(1, Math.min(currentPage, totalPages));
  const startIndex = (activePage - 1) * pageSize;
  const visibleKeys = useMemo(() => {
    return apiKeyList.slice(startIndex, startIndex + pageSize);
  }, [apiKeyList, startIndex, pageSize]);

  const handleImportKeys = () => {
    const lines = importText.split(/\r?\n/);
    const currentList = form.apiKeyEntries;

    // 去重集合：以「密钥 + 代理」组合为键，涵盖现有列表，同 key 配不同代理仍保留
    const existingKeys = new Set<string>();
    for (const entry of currentList) {
      if (!entry.apiKey?.trim()) continue;
      existingKeys.add(`${entry.apiKey.trim()}@${entry.proxyUrl?.trim() || ''}`);
    }

    const newEntries: ApiKeyEntry[] = [];
    let skipped = 0;

    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      const parts = trimmed.split(/[\s\t]+/);
      const apiKey = parts[0]?.trim() || '';
      const proxyUrl = parts.length > 1 ? parts[1].trim() : '';
      if (!apiKey) return;

      const dedupeKey = `${apiKey}@${proxyUrl}`;
      if (existingKeys.has(dedupeKey)) {
        skipped += 1;
        return;
      }

      existingKeys.add(dedupeKey);
      newEntries.push({
        apiKey,
        proxyUrl: proxyUrl || undefined,
        headers: {},
      });
    });

    if (newEntries.length === 0) {
      if (lines.some((line) => line.trim())) {
        showNotification(
          t('ai_providers.openai_keys_import_all_duplicates', '所有密钥都已存在，未添加新密钥'),
          'warning'
        );
      } else {
        showNotification(t('ai_providers.openai_keys_import_empty', '未检测到有效的密钥'), 'error');
      }
      return;
    }

    let nextList: ApiKeyEntry[];
    if (
      currentList.length === 1 &&
      !currentList[0].apiKey?.trim() &&
      !currentList[0].proxyUrl?.trim()
    ) {
      nextList = newEntries;
    } else {
      nextList = [...currentList, ...newEntries];
    }

    setForm((prev) => ({ ...prev, apiKeyEntries: nextList }));
    resetDraftKeyTestStatuses(nextList.length);
    setTestStatus('idle');
    setTestMessage('');

    showNotification(
      t('ai_providers.openai_keys_import_success', '成功导入了 {{count}} 个 API 密钥', { count: newEntries.length }),
      'success'
    );

    if (skipped > 0) {
      showNotification(
        t('ai_providers.openai_keys_import_skipped', '已跳过 {{count}} 个重复密钥', { count: skipped }),
        'warning'
      );
    }

    setImportModalOpen(false);
    setImportText('');

    const nextTotalPages = Math.ceil(nextList.length / pageSize) || 1;
    setCurrentPage(nextTotalPages);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleBack();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleBack]);

  const canSave = !disableControls && !loading && !saving && !invalidIndexParam && !invalidIndex && !isTestingKeys;
  const hasConfiguredModels = form.modelEntries.some((entry) => entry.name.trim());
  const hasTestableKeys = form.apiKeyEntries.some((entry) => entry.apiKey?.trim());
  const modelSelectOptions = useMemo(() => {
    const seen = new Set<string>();
    return form.modelEntries.reduce<Array<{ value: string; label: string }>>((acc, entry) => {
      const name = entry.name.trim();
      if (!name || seen.has(name)) return acc;
      seen.add(name);
      const alias = entry.alias.trim();
      acc.push({
        value: name,
        label: alias && alias !== name ? `${name} (${alias})` : name,
      });
      return acc;
    }, []);
  }, [form.modelEntries]);
  const connectivityConfigSignature = useMemo(() => {
    const headersSignature = form.headers
      .map((entry) => `${entry.key.trim()}:${entry.value.trim()}`)
      .join('|');
    const modelsSignature = form.modelEntries
      .map((entry) => `${entry.name.trim()}:${entry.alias.trim()}`)
      .join('|');
    return [form.baseUrl.trim(), testModel.trim(), headersSignature, modelsSignature].join('||');
  }, [form.baseUrl, form.headers, form.modelEntries, testModel]);
  const previousConnectivityConfigRef = useRef(connectivityConfigSignature);

  useEffect(() => {
    if (previousConnectivityConfigRef.current === connectivityConfigSignature) {
      return;
    }
    previousConnectivityConfigRef.current = connectivityConfigSignature;
    resetDraftKeyTestStatuses(form.apiKeyEntries.length);
    setTestStatus('idle');
    setTestMessage('');
  }, [
    connectivityConfigSignature,
    form.apiKeyEntries.length,
    resetDraftKeyTestStatuses,
    setTestStatus,
    setTestMessage,
  ]);

  // Test a single key by index
  const runSingleKeyTest = useCallback(
    async (keyIndex: number): Promise<boolean> => {
      const baseUrl = form.baseUrl.trim();
      if (!baseUrl) {
        showNotification(t('notification.openai_test_url_required'), 'error');
        return false;
      }

      const endpoint = buildOpenAIChatCompletionsEndpoint(baseUrl);
      if (!endpoint) {
        showNotification(t('notification.openai_test_url_required'), 'error');
        return false;
      }

      const keyEntry = form.apiKeyEntries[keyIndex];
      if (!keyEntry?.apiKey?.trim()) {
        setDraftKeyTestStatus(keyIndex, { status: 'error', message: t('notification.openai_test_key_required') });
        return false;
      }

      const modelName = testModel.trim() || availableModels[0] || '';
      if (!modelName) {
        showNotification(t('notification.openai_test_model_required'), 'error');
        return false;
      }

      const customHeaders = buildHeaderObject(form.headers);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...customHeaders,
      };
      if (!hasHeader(headers, 'authorization')) {
        headers.Authorization = `Bearer ${keyEntry.apiKey.trim()}`;
      }

      // Set loading state for this key
      setDraftKeyTestStatus(keyIndex, { status: 'loading', message: '' });

      try {
        const result = await apiCallApi.request(
          {
            method: 'POST',
            url: endpoint,
            header: Object.keys(headers).length ? headers : undefined,
            data: JSON.stringify({
              model: modelName,
              messages: [{ role: 'user', content: 'Hi' }],
              stream: false,
              max_tokens: 5,
            }),
          },
          { timeout: OPENAI_TEST_TIMEOUT_MS }
        );

        if (result.statusCode < 200 || result.statusCode >= 300) {
          throw new Error(getApiCallErrorMessage(result));
        }

        setDraftKeyTestStatus(keyIndex, { status: 'success', message: '' });
        return true;
      } catch (err: unknown) {
        const message = getErrorMessage(err);
        const errorCode =
          typeof err === 'object' && err !== null && 'code' in err
            ? String((err as { code?: string }).code)
            : '';
        const isTimeout = errorCode === 'ECONNABORTED' || message.toLowerCase().includes('timeout');
        const errorMessage = isTimeout
          ? t('ai_providers.openai_test_timeout', { seconds: OPENAI_TEST_TIMEOUT_MS / 1000 })
          : message;
        setDraftKeyTestStatus(keyIndex, { status: 'error', message: errorMessage });
        return false;
      }
    },
    [form.baseUrl, form.apiKeyEntries, form.headers, testModel, availableModels, t, setDraftKeyTestStatus, showNotification]
  );

  const testSingleKey = useCallback(
    async (keyIndex: number): Promise<boolean> => {
      if (isTestingKeys) return false;
      setIsTestingKeys(true);
      try {
        return await runSingleKeyTest(keyIndex);
      } finally {
        setIsTestingKeys(false);
      }
    },
    [isTestingKeys, runSingleKeyTest]
  );

  // Test all keys
  const testAllKeys = useCallback(async () => {
    if (isTestingKeys) return;

    const baseUrl = form.baseUrl.trim();
    if (!baseUrl) {
      const message = t('notification.openai_test_url_required');
      setTestStatus('error');
      setTestMessage(message);
      showNotification(message, 'error');
      return;
    }

    const endpoint = buildOpenAIChatCompletionsEndpoint(baseUrl);
    if (!endpoint) {
      const message = t('notification.openai_test_url_required');
      setTestStatus('error');
      setTestMessage(message);
      showNotification(message, 'error');
      return;
    }

    const modelName = testModel.trim() || availableModels[0] || '';
    if (!modelName) {
      const message = t('notification.openai_test_model_required');
      setTestStatus('error');
      setTestMessage(message);
      showNotification(message, 'error');
      return;
    }

    const validKeyIndexes = form.apiKeyEntries
      .map((entry, index) => (entry.apiKey?.trim() ? index : -1))
      .filter((index) => index >= 0);
    if (validKeyIndexes.length === 0) {
      const message = t('notification.openai_test_key_required');
      setTestStatus('error');
      setTestMessage(message);
      showNotification(message, 'error');
      return;
    }

    setIsTestingKeys(true);
    setTestStatus('loading');
    setTestMessage(t('ai_providers.openai_test_running'));
    resetDraftKeyTestStatuses(form.apiKeyEntries.length);

    try {
      const results = await Promise.all(validKeyIndexes.map((index) => runSingleKeyTest(index)));

      const successCount = results.filter(Boolean).length;
      const failCount = validKeyIndexes.length - successCount;

      if (failCount === 0) {
        const message = t('ai_providers.openai_test_all_success', { count: successCount });
        setTestStatus('success');
        setTestMessage(message);
        showNotification(message, 'success');
      } else if (successCount === 0) {
        const message = t('ai_providers.openai_test_all_failed', { count: failCount });
        setTestStatus('error');
        setTestMessage(message);
        showNotification(message, 'error');
      } else {
        const message = t('ai_providers.openai_test_all_partial', { success: successCount, failed: failCount });
        setTestStatus('error');
        setTestMessage(message);
        showNotification(message, 'warning');
      }
    } finally {
      setIsTestingKeys(false);
    }
  }, [
    isTestingKeys,
    form.baseUrl,
    form.apiKeyEntries,
    testModel,
    availableModels,
    t,
    setTestStatus,
    setTestMessage,
    resetDraftKeyTestStatuses,
    runSingleKeyTest,
    showNotification,
  ]);

  const openOpenaiModelDiscovery = () => {
    const baseUrl = form.baseUrl.trim();
    if (!baseUrl) {
      showNotification(t('ai_providers.openai_models_fetch_invalid_url'), 'error');
      return;
    }
    navigate('models');
  };

  const renderKeyEntries = () => {
    const updateEntry = (localIndex: number, field: keyof ApiKeyEntry, value: string) => {
      const globalIndex = startIndex + localIndex;
      const next = apiKeyList.map((entry, i) => (i === globalIndex ? { ...entry, [field]: value } : entry));
      setForm((prev) => ({ ...prev, apiKeyEntries: next }));
      setDraftKeyTestStatus(globalIndex, { status: 'idle', message: '' });
      setTestStatus('idle');
      setTestMessage('');
    };

    const removeEntry = (localIndex: number) => {
      const globalIndex = startIndex + localIndex;
      const next = apiKeyList.filter((_, i) => i !== globalIndex);
      const nextLength = next.length ? next.length : 1;
      const finalNextList = next.length ? next : [buildApiKeyEntry()];
      setForm((prev) => ({
        ...prev,
        apiKeyEntries: finalNextList,
      }));
      resetDraftKeyTestStatuses(nextLength);
      setTestStatus('idle');
      setTestMessage('');

      const nextTotalPages = Math.ceil(finalNextList.length / pageSize) || 1;
      if (activePage > nextTotalPages) {
        setCurrentPage(nextTotalPages);
      }
    };

    const addEntry = () => {
      const nextList = [...apiKeyList, buildApiKeyEntry()];
      setForm((prev) => ({ ...prev, apiKeyEntries: nextList }));
      resetDraftKeyTestStatuses(nextList.length);
      setTestStatus('idle');
      setTestMessage('');

      const nextTotalPages = Math.ceil(nextList.length / pageSize) || 1;
      setCurrentPage(nextTotalPages);
    };

    return (
      <div className={styles.keyEntriesList}>
        <div className={styles.keyEntriesToolbar}>
          <span className={styles.keyEntriesCount}>
            {t('ai_providers.openai_keys_count')}: {totalItems}
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setImportModalOpen(true)}
              disabled={saving || disableControls || isTestingKeys}
            >
              {t('ai_providers.openai_keys_import_btn', '导入密钥')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={addEntry}
              disabled={saving || disableControls || isTestingKeys}
              className={styles.addKeyButton}
            >
              {t('ai_providers.openai_keys_add_btn')}
            </Button>
          </div>
        </div>
        <div className={styles.keyTableShell}>
          {/* 表头 */}
          <div className={styles.keyTableHeader}>
            <div className={styles.keyTableColIndex}>#</div>
            <div className={styles.keyTableColStatus}>{t('common.status')}</div>
            <div className={styles.keyTableColKey}>{t('common.api_key')}</div>
            <div className={styles.keyTableColProxy}>{t('common.proxy_url')}</div>
            <div className={styles.keyTableColAction}>{t('common.action')}</div>
          </div>

          {/* 数据行 */}
          {visibleKeys.map((entry, localIndex) => {
            const globalIndex = startIndex + localIndex;
            const keyStatus = keyTestStatuses[globalIndex]?.status ?? 'idle';
            const canTestKey = Boolean(entry.apiKey?.trim()) && hasConfiguredModels;

            return (
              <div key={globalIndex} className={styles.keyTableRow}>
                {/* 序号 */}
                <div className={styles.keyTableColIndex}>{globalIndex + 1}</div>

                {/* 状态指示灯 */}
                <div
                  className={styles.keyTableColStatus}
                  title={keyTestStatuses[globalIndex]?.message || ''}
                >
                  <StatusIcon status={keyStatus} />
                </div>

                {/* Key 输入框 */}
                <div className={styles.keyTableColKey}>
                  <input
                    type="text"
                    value={entry.apiKey}
                    onChange={(e) => updateEntry(localIndex, 'apiKey', e.target.value)}
                    disabled={saving || disableControls || isTestingKeys}
                    className={`input ${styles.keyTableInput}`}
                    placeholder={t('ai_providers.openai_key_placeholder')}
                  />
                </div>

                {/* Proxy 输入框 */}
                <div className={styles.keyTableColProxy}>
                  <input
                    type="text"
                    value={entry.proxyUrl ?? ''}
                    onChange={(e) => updateEntry(localIndex, 'proxyUrl', e.target.value)}
                    disabled={saving || disableControls || isTestingKeys}
                    className={`input ${styles.keyTableInput}`}
                    placeholder={t('ai_providers.openai_proxy_placeholder')}
                  />
                </div>

                {/* 操作按钮 */}
                <div className={styles.keyTableColAction}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void testSingleKey(globalIndex)}
                    disabled={saving || disableControls || isTestingKeys || !canTestKey}
                    loading={keyStatus === 'loading'}
                  >
                    {t('ai_providers.openai_test_single_action')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeEntry(localIndex)}
                    disabled={saving || disableControls || isTestingKeys || totalItems <= 1}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {/* 分页组件 */}
        {totalItems > pageSize && (
          <div className={styles.pagination} style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '16px', marginTop: '16px' }}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={activePage <= 1}
            >
              {t('auth_files.pagination_prev', '上一页')}
            </Button>
            <div className={styles.pageInfo} style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              {t('ai_providers.openai_keys_pagination_info', '第 {{current}} / {{total}} 页 · 共 {{count}} 个密钥', {
                current: activePage,
                total: totalPages,
                count: totalItems,
              })}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={activePage >= totalPages}
            >
              {t('auth_files.pagination_next', '下一页')}
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <SecondaryScreenShell
      ref={swipeRef}
      contentClassName={layoutStyles.content}
      title={title}
      onBack={handleBack}
      backLabel={t('common.back')}
      backAriaLabel={t('common.back')}
      hideTopBarBackButton
      hideTopBarRightAction
      floatingAction={
        <div className={layoutStyles.floatingActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleBack}
            className={layoutStyles.floatingBackButton}
          >
            {t('common.back')}
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSave()}
            loading={saving}
            disabled={!canSave}
            className={layoutStyles.floatingSaveButton}
          >
            {t('common.save')}
          </Button>
        </div>
      }
      isLoading={loading}
      loadingLabel={t('common.loading')}
    >
      <Card>
        {invalidIndexParam || invalidIndex ? (
          <div className={styles.sectionHint}>{t('common.invalid_provider_index')}</div>
        ) : (
          <div className={styles.openaiEditForm}>
            <Input
              label={t('ai_providers.openai_add_modal_name_label')}
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              disabled={saving || disableControls || isTestingKeys}
            />
            <Input
              label={t('ai_providers.priority_label')}
              hint={t('ai_providers.priority_hint')}
              type="number"
              step={1}
              value={form.priority ?? ''}
              onChange={(e) => {
                const raw = e.target.value;
                const parsed = raw.trim() === '' ? undefined : Number(raw);
                setForm((prev) => ({
                  ...prev,
                  priority: parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined,
                }));
              }}
              disabled={saving || disableControls || isTestingKeys}
            />
            <Input
              label={t('ai_providers.prefix_label')}
              placeholder={t('ai_providers.prefix_placeholder')}
              value={form.prefix ?? ''}
              onChange={(e) => setForm((prev) => ({ ...prev, prefix: e.target.value }))}
              hint={t('ai_providers.prefix_hint')}
              disabled={saving || disableControls || isTestingKeys}
            />
            <Input
              label={t('ai_providers.openai_add_modal_url_label')}
              value={form.baseUrl}
              onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
              disabled={saving || disableControls || isTestingKeys}
            />

            <HeaderInputList
              entries={form.headers}
              onChange={(entries) => setForm((prev) => ({ ...prev, headers: entries }))}
              addLabel={t('common.custom_headers_add')}
              keyPlaceholder={t('common.custom_headers_key_placeholder')}
              valuePlaceholder={t('common.custom_headers_value_placeholder')}
              removeButtonTitle={t('common.delete')}
              removeButtonAriaLabel={t('common.delete')}
              disabled={saving || disableControls || isTestingKeys}
            />

            {/* 模型配置区域 - 统一布局 */}
            <div className={styles.modelConfigSection}>
              {/* 标题行 */}
              <div className={styles.modelConfigHeader}>
                <label className={styles.modelConfigTitle}>
                  {hasIndexParam
                    ? t('ai_providers.openai_edit_modal_models_label')
                    : t('ai_providers.openai_add_modal_models_label')}
                </label>
                <div className={styles.modelConfigToolbar}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setForm((prev) => ({
                      ...prev,
                      modelEntries: [...prev.modelEntries, { name: '', alias: '' }]
                    }))}
                    disabled={saving || disableControls || isTestingKeys}
                  >
                    {t('ai_providers.openai_models_add_btn')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={openOpenaiModelDiscovery}
                    disabled={saving || disableControls || isTestingKeys}
                  >
                    {t('ai_providers.openai_models_fetch_button')}
                  </Button>
                </div>
              </div>

              {/* 提示文本 */}
              <div className={styles.sectionHint}>{t('ai_providers.openai_models_hint')}</div>

              {/* 模型列表 */}
              <ModelInputList
                entries={form.modelEntries}
                onChange={(entries) => setForm((prev) => ({ ...prev, modelEntries: entries }))}
                namePlaceholder={t('common.model_name_placeholder')}
                aliasPlaceholder={t('common.model_alias_placeholder')}
                disabled={saving || disableControls || isTestingKeys}
                hideAddButton
                className={styles.modelInputList}
                rowClassName={styles.modelInputRow}
                inputClassName={styles.modelInputField}
                removeButtonClassName={styles.modelRowRemoveButton}
                removeButtonTitle={t('common.delete')}
                removeButtonAriaLabel={t('common.delete')}
              />

              {/* 测试区域 */}
              <div className={styles.modelTestPanel}>
                <div className={styles.modelTestMeta}>
                  <label className={styles.modelTestLabel}>{t('ai_providers.openai_test_title')}</label>
                  <span className={styles.modelTestHint}>{t('ai_providers.openai_test_hint')}</span>
                </div>
                <div className={styles.modelTestControls}>
                  <Select
                    value={testModel}
                    options={modelSelectOptions}
                    onChange={(value) => {
                      setTestModel(value);
                      setTestStatus('idle');
                      setTestMessage('');
                    }}
                    placeholder={
                      availableModels.length
                        ? t('ai_providers.openai_test_select_placeholder')
                        : t('ai_providers.openai_test_select_empty')
                    }
                    className={styles.openaiTestSelect}
                    ariaLabel={t('ai_providers.openai_test_title')}
                    disabled={saving || disableControls || isTestingKeys || testStatus === 'loading' || availableModels.length === 0}
                  />
                  <Button
                    variant={testStatus === 'error' ? 'danger' : 'secondary'}
                    size="sm"
                    onClick={() => void testAllKeys()}
                    loading={testStatus === 'loading'}
                    disabled={saving || disableControls || isTestingKeys || testStatus === 'loading' || !hasConfiguredModels || !hasTestableKeys}
                    title={t('ai_providers.openai_test_all_hint')}
                    className={styles.modelTestAllButton}
                  >
                    {t('ai_providers.openai_test_all_action')}
                  </Button>
                </div>
              </div>
              {testMessage && (
                <div
                  className={`status-badge ${
                    testStatus === 'error'
                      ? 'error'
                      : testStatus === 'success'
                        ? 'success'
                        : 'muted'
                  }`}
                >
                  {testMessage}
                </div>
              )}
            </div>

            <div className={styles.keyEntriesSection}>
              <div className={styles.keyEntriesHeader}>
                <label className={styles.keyEntriesTitle}>{t('ai_providers.openai_add_modal_keys_label')}</label>
                <span className={styles.keyEntriesHint}>{t('ai_providers.openai_keys_hint')}</span>
              </div>
              {renderKeyEntries()}
            </div>
          </div>
        )}
      </Card>

      {/* 批量导入 API 密钥的 Modal 弹窗 */}
      <Modal
        open={importModalOpen}
        title={t('ai_providers.openai_keys_import_title', '批量导入 API 密钥')}
        onClose={() => {
          setImportModalOpen(false);
          setImportText('');
        }}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setImportModalOpen(false);
                setImportText('');
              }}
            >
              {t('common.cancel', '取消')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleImportKeys}
              disabled={!importText.trim()}
            >
              {t('common.confirm', '确定')}
            </Button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
            {t('ai_providers.openai_keys_import_hint')}
          </label>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={10}
            className="input"
            placeholder="sk-...\nsk-...\n..."
            style={{
              width: '100%',
              fontFamily: 'monospace',
              fontSize: '12px',
              padding: '8px',
              borderRadius: '8px',
              resize: 'vertical',
            }}
          />
        </div>
      </Modal>
    </SecondaryScreenShell>
  );
}
