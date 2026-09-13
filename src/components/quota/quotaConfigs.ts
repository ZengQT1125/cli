/**
 * Quota configuration definitions.
 */

import React from 'react';
import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import type {
  AntigravityQuotaGroup,
  AntigravityQuotaSummaryPayload,
  AntigravityQuotaState,
  AntigravityQuotaSubscription,
  AuthFileItem,
  ClaudeExtraUsage,
  ClaudeProfileResponse,
  ClaudeQuotaState,
  ClaudeQuotaWindow,
  ClaudeUsagePayload,
  CodexRateLimitInfo,
  CodexRateLimitResetCredit,
  CodexQuotaState,
  CodexUsageWindow,
  CodexQuotaWindow,
  CodexUsagePayload,
  GeminiCliCodeAssistPayload,
  GeminiCliCredits,
  GeminiCliParsedBucket,
  GeminiCliQuotaBucketState,
  GeminiCliQuotaState,
  GeminiCliUserTier,
  KimiQuotaRow,
  KimiQuotaState,
  XaiBillingSummary,
  XaiQuotaState,
} from '@/types';
import {
  antigravitySubscriptionApi,
  apiCallApi,
  authFilesApi,
  getApiCallErrorMessage,
  parseAntigravitySubscriptionSummary,
  type ApiCallBatchRequest,
  type ApiCallBatchResult,
  type ApiCallRequest,
  type ApiCallResult,
  type AntigravitySubscriptionSummary,
} from '@/services/api';
import { useQuotaStore } from '@/stores';
import {
  ANTIGRAVITY_QUOTA_URLS,
  ANTIGRAVITY_CODE_ASSIST_URL,
  ANTIGRAVITY_REQUEST_HEADERS,
  CLAUDE_PROFILE_URL,
  CLAUDE_USAGE_URL,
  CLAUDE_REQUEST_HEADERS,
  CLAUDE_USAGE_WINDOW_KEYS,
  CODEX_RATE_LIMIT_RESET_CREDITS_URL,
  CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL,
  CODEX_USAGE_URL,
  CODEX_REQUEST_HEADERS,
  GEMINI_CLI_QUOTA_URL,
  GEMINI_CLI_CODE_ASSIST_URL,
  GEMINI_CLI_REQUEST_HEADERS,
  KIMI_USAGE_URL,
  KIMI_REQUEST_HEADERS,
  XAI_API_CHAT_URL,
  XAI_API_ME_URL,
  XAI_API_REQUEST_HEADERS,
  XAI_BILLING_MONTHLY_URL,
  XAI_BILLING_WEEKLY_URL,
  XAI_PAID_HEALTH_MODEL,
  XAI_REQUEST_HEADERS,
  normalizeGeminiCliModelId,
  normalizeNumberValue,
  normalizePlanType,
  normalizeQuotaFraction,
  normalizeStringValue,
  normalizeCodexResetCreditsPayload,
  parseAntigravityPayload,
  parseClaudeUsagePayload,
  parseCodexUsagePayload,
  parseGeminiCliQuotaPayload,
  parseGeminiCliCodeAssistPayload,
  parseKimiUsagePayload,
  parseXaiBillingPayload,
  resolveCodexChatgptAccountId,
  resolveCodexPlanType,
  resolveCodexSubscriptionActiveUntil,
  resolveGeminiCliProjectId,
  formatCodexResetLabel,
  formatQuotaResetTime,
  formatKimiResetHint,
  buildAntigravityQuotaGroups,
  buildGeminiCliQuotaBuckets,
  buildKimiQuotaRows,
  buildXaiBillingSummary,
  buildXaiPaidHealthSummary,
  mergeXaiBillingSummaries,
  createStatusError,
  formatShanghaiDateTime,
  getStatusFromError,
  isAntigravityFile,
  isClaudeFile,
  isCodexFile,
  isDisabledAuthFile,
  isGeminiCliFile,
  isKimiFile,
  isRuntimeOnlyAuthFile,
  isPaidXaiAuthFile,
  isXaiFile,
} from '@/utils/quota';
import { normalizeAuthIndex } from '@/utils/usage';
import { formatUnixTimestamp } from '@/utils/format';
import type { QuotaRenderHelpers } from './QuotaCard';
import styles from '@/pages/QuotaPage.module.scss';

type QuotaUpdater<T> = T | ((prev: T) => T);

type QuotaType = 'antigravity' | 'claude' | 'codex' | 'gemini-cli' | 'kimi' | 'xai';

type CodexResetCreditsData = {
  availableCount: number | null;
  credits: CodexRateLimitResetCredit[];
  error: string;
};

type CodexQuotaData = {
  planType: string | null;
  subscriptionActiveUntil: string | number | null;
  rateLimitResetCreditsAvailableCount: number | null;
  rateLimitResetCredits: CodexRateLimitResetCredit[];
  rateLimitResetCreditsError: string;
  windows: CodexQuotaWindow[];
};

type GeminiCliSupplementaryData = {
  tierLabel: string | null;
  tierId: string | null;
  creditBalance: number | null;
};

type GeminiCliQuotaData = GeminiCliSupplementaryData & {
  fileName: string;
  supplementaryRequestId: number;
  buckets: GeminiCliQuotaBucketState[];
};

const QUOTA_PROGRESS_HIGH_THRESHOLD = 70;
const QUOTA_PROGRESS_MEDIUM_THRESHOLD = 30;
const CODEX_RESET_CREDITS_REQUEST_TIMEOUT_MS = 8000;
const geminiCliSupplementaryRequestIds = new Map<string, number>();
const geminiCliSupplementaryCache = new Map<
  string,
  {
    requestId: number;
    tierLabel: string | null;
    tierId: string | null;
    creditBalance: number | null;
  }
>();
const XAI_PAID_HEALTH_REQUEST_TIMEOUT_MS = 15000;

export interface QuotaStore {
  antigravityQuota: Record<string, AntigravityQuotaState>;
  claudeQuota: Record<string, ClaudeQuotaState>;
  codexQuota: Record<string, CodexQuotaState>;
  geminiCliQuota: Record<string, GeminiCliQuotaState>;
  kimiQuota: Record<string, KimiQuotaState>;
  xaiQuota: Record<string, XaiQuotaState>;
  setAntigravityQuota: (updater: QuotaUpdater<Record<string, AntigravityQuotaState>>) => void;
  setClaudeQuota: (updater: QuotaUpdater<Record<string, ClaudeQuotaState>>) => void;
  setCodexQuota: (updater: QuotaUpdater<Record<string, CodexQuotaState>>) => void;
  setGeminiCliQuota: (updater: QuotaUpdater<Record<string, GeminiCliQuotaState>>) => void;
  setKimiQuota: (updater: QuotaUpdater<Record<string, KimiQuotaState>>) => void;
  setXaiQuota: (updater: QuotaUpdater<Record<string, XaiQuotaState>>) => void;
  clearQuotaCache: () => void;
}

export interface QuotaConfig<TState, TData> {
  type: QuotaType;
  i18nPrefix: string;
  cardIdleMessageKey?: string;
  filterFn: (file: AuthFileItem) => boolean;
  fetchQuota: (file: AuthFileItem, t: TFunction) => Promise<TData>;
  fetchQuotaBatch: (files: AuthFileItem[], t: TFunction) => Promise<QuotaBatchFetchResult<TData>[]>;
  resetQuota?: (file: AuthFileItem, t: TFunction) => Promise<TData>;
  canResetQuota?: (quota: TState) => boolean;
  storeSelector: (state: QuotaStore) => Record<string, TState>;
  storeSetter: keyof QuotaStore;
  buildLoadingState: () => TState;
  buildSuccessState: (data: TData) => TState;
  buildErrorState: (message: string, status?: number) => TState;
  cardClassName: string;
  controlsClassName: string;
  controlClassName: string;
  gridClassName: string;
  renderQuotaItems: (quota: TState, t: TFunction, helpers: QuotaRenderHelpers) => ReactNode;
}

export type QuotaBatchFetchResult<TData> =
  | { name: string; status: 'success'; data: TData }
  | { name: string; status: 'error'; error: unknown };

type QuotaBatchPlan<TData> = {
  requests: Array<{ key: string; request: ApiCallRequest }>;
  resolve: (results: Map<string, ApiCallBatchResult>) => TData;
};

const batchItemError = (result: Extract<ApiCallBatchResult, { status: 'error' }>): Error =>
  createStatusError(result.error.message, result.error.status || undefined);

const requireBatchValue = (
  results: Map<string, ApiCallBatchResult>,
  key: string
): ApiCallResult => {
  const result = results.get(key);
  if (!result) throw new Error(`Missing batch result: ${key}`);
  if (result.status === 'error') throw batchItemError(result);
  return result.value;
};

const executeQuotaBatch = async <TData>(
  files: AuthFileItem[],
  buildPlan: (
    file: AuthFileItem,
    t: TFunction
  ) => Promise<QuotaBatchPlan<TData>> | QuotaBatchPlan<TData>,
  t: TFunction
): Promise<QuotaBatchFetchResult<TData>[]> => {
  const prepared = await Promise.all(
    files.map(async (file, fileIndex) => {
      try {
        const plan = await buildPlan(file, t);
        const keys = new Set<string>();
        const requests: ApiCallBatchRequest[] = plan.requests.map(({ key, request }) => {
          if (!key || keys.has(key)) throw new Error('Invalid quota batch plan');
          keys.add(key);
          return { id: `${fileIndex}:${key}`, ...request };
        });
        if (requests.length === 0) throw new Error('Invalid quota batch plan');
        return { status: 'ready' as const, file, fileIndex, plan, requests };
      } catch (error: unknown) {
        return { status: 'error' as const, file, fileIndex, error };
      }
    })
  );

  const requests: ApiCallBatchRequest[] = prepared.flatMap((item) =>
    item.status === 'ready' ? item.requests : []
  );
  let batchResults: ApiCallBatchResult[] = [];
  let batchError: unknown;
  if (requests.length > 0) {
    try {
      batchResults = await apiCallApi.batch(requests);
    } catch (error: unknown) {
      batchError = error;
    }
  }

  const resultById = new Map(batchResults.map((result) => [result.id, result]));
  return prepared.map((item): QuotaBatchFetchResult<TData> => {
    if (item.status === 'error') {
      return { name: item.file.name, status: 'error', error: item.error };
    }
    if (batchError) {
      return { name: item.file.name, status: 'error', error: batchError };
    }

    const localResults = new Map<string, ApiCallBatchResult>();
    for (const { key } of item.plan.requests) {
      const result = resultById.get(`${item.fileIndex}:${key}`);
      if (result) localResults.set(key, result);
    }
    try {
      return { name: item.file.name, status: 'success', data: item.plan.resolve(localResults) };
    } catch (error: unknown) {
      return { name: item.file.name, status: 'error', error };
    }
  });
};

const readAntigravityProjectId = (file: AuthFileItem): string => {
  const directProjectId = normalizeStringValue(file.project_id ?? file.projectId);
  if (directProjectId) return directProjectId;

  const metadata =
    file.metadata && typeof file.metadata === 'object' && file.metadata !== null
      ? (file.metadata as Record<string, unknown>)
      : null;
  const metadataProjectId = metadata
    ? normalizeStringValue(metadata.project_id ?? metadata.projectId)
    : null;
  if (metadataProjectId) return metadataProjectId;

  const attributes =
    file.attributes && typeof file.attributes === 'object' && file.attributes !== null
      ? (file.attributes as Record<string, unknown>)
      : null;
  const attributesProjectId = attributes
    ? normalizeStringValue(
        attributes.project_id ?? attributes.projectId ?? attributes.gemini_virtual_project
      )
    : null;
  if (attributesProjectId) return attributesProjectId;

  return '';
};

const resolveAntigravityProjectId = async (file: AuthFileItem): Promise<string> => {
  const listedProjectId = readAntigravityProjectId(file);
  if (listedProjectId) return listedProjectId;

  try {
    const text = await authFilesApi.downloadText(file.name);
    const trimmed = text.trim();
    if (!trimmed) return '';

    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const topLevel = normalizeStringValue(parsed.project_id ?? parsed.projectId);
    if (topLevel) return topLevel;

    const installed =
      parsed.installed && typeof parsed.installed === 'object' && parsed.installed !== null
        ? (parsed.installed as Record<string, unknown>)
        : null;
    const installedProjectId = installed
      ? normalizeStringValue(installed.project_id ?? installed.projectId)
      : null;
    if (installedProjectId) return installedProjectId;

    const web =
      parsed.web && typeof parsed.web === 'object' && parsed.web !== null
        ? (parsed.web as Record<string, unknown>)
        : null;
    const webProjectId = web ? normalizeStringValue(web.project_id ?? web.projectId) : null;
    if (webProjectId) return webProjectId;
  } catch {
    return '';
  }

  return '';
};

const resolveResponseServerTimeOffsetMs = (
  header: Record<string, string[]> | undefined
): number | null => {
  if (!header) return null;
  const dateEntry = Object.entries(header).find(([key]) => key.toLowerCase() === 'date');
  const rawDate = dateEntry?.[1]?.[0];
  if (!rawDate) return null;
  const serverTime = new Date(rawDate).getTime();
  if (Number.isNaN(serverTime)) return null;
  return serverTime - Date.now();
};

type AntigravityQuotaData = {
  groups: AntigravityQuotaGroup[];
  subscription: AntigravityQuotaSubscription | null;
  serverTimeOffsetMs: number | null;
};

const toAntigravityQuotaSubscription = (
  summary: AntigravitySubscriptionSummary | null
): AntigravityQuotaSubscription | null => {
  if (!summary) return null;
  return {
    plan: summary.plan,
    tierName: summary.tierName,
    tierId: summary.tierId,
  };
};

const fetchAntigravityQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<AntigravityQuotaData> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('antigravity_quota.missing_auth_index'));
  }

  const projectId = await resolveAntigravityProjectId(file);
  if (!projectId) {
    throw new Error(t('antigravity_quota.missing_project_id'));
  }
  const requestBody = JSON.stringify({ project: projectId });
  const subscriptionPromise = antigravitySubscriptionApi
    .get(authIndex)
    .then(toAntigravityQuotaSubscription)
    .catch(() => null);

  let lastError = '';
  let lastStatus: number | undefined;
  let priorityStatus: number | undefined;
  let hadSuccess = false;

  for (const url of ANTIGRAVITY_QUOTA_URLS) {
    try {
      const result = await apiCallApi.request({
        authIndex,
        method: 'POST',
        url,
        header: { ...ANTIGRAVITY_REQUEST_HEADERS },
        data: requestBody,
      });

      if (result.statusCode < 200 || result.statusCode >= 300) {
        lastError = getApiCallErrorMessage(result);
        lastStatus = result.statusCode;
        if (result.statusCode === 403 || result.statusCode === 404) {
          priorityStatus ??= result.statusCode;
        }
        continue;
      }

      hadSuccess = true;
      const payload = parseAntigravityPayload(
        result.body ?? result.bodyText
      ) as AntigravityQuotaSummaryPayload | null;
      if (!payload || !Array.isArray(payload.groups)) {
        lastError = t('antigravity_quota.empty_models');
        continue;
      }

      const groups = buildAntigravityQuotaGroups(payload);
      if (groups.length === 0) {
        lastError = t('antigravity_quota.empty_models');
        continue;
      }

      return {
        groups,
        subscription: await subscriptionPromise,
        serverTimeOffsetMs: resolveResponseServerTimeOffsetMs(result.header),
      };
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : t('common.unknown_error');
      const status = getStatusFromError(err);
      if (status) {
        lastStatus = status;
        if (status === 403 || status === 404) {
          priorityStatus ??= status;
        }
      }
    }
  }

  if (hadSuccess) {
    return { groups: [], subscription: await subscriptionPromise, serverTimeOffsetMs: null };
  }

  throw createStatusError(lastError || t('common.unknown_error'), priorityStatus ?? lastStatus);
};

const fetchAntigravityQuotaBatch = (files: AuthFileItem[], t: TFunction) =>
  executeQuotaBatch(
    files,
    (file, translate) => {
      const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
      if (!authIndex) throw new Error(translate('antigravity_quota.missing_auth_index'));
      const projectId = readAntigravityProjectId(file);
      if (!projectId) throw new Error(translate('antigravity_quota.missing_project_id'));
      const requestBody = JSON.stringify({ project: projectId });

      return {
        requests: [
          {
            key: 'subscription',
            request: {
              authIndex,
              method: 'POST',
              url: ANTIGRAVITY_CODE_ASSIST_URL,
              header: { ...ANTIGRAVITY_REQUEST_HEADERS },
              data: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }),
            },
          },
          ...ANTIGRAVITY_QUOTA_URLS.map((url, index) => ({
            key: `quota-${index}`,
            request: {
              authIndex,
              method: 'POST',
              url,
              header: { ...ANTIGRAVITY_REQUEST_HEADERS },
              data: requestBody,
            },
          })),
        ],
        resolve: (results): AntigravityQuotaData => {
          const subscriptionResult = results.get('subscription');
          const subscription =
            subscriptionResult?.status === 'success' &&
            subscriptionResult.value.statusCode >= 200 &&
            subscriptionResult.value.statusCode < 300
              ? toAntigravityQuotaSubscription(
                  parseAntigravitySubscriptionSummary(
                    subscriptionResult.value.body ?? subscriptionResult.value.bodyText
                  )
                )
              : null;
          let lastError = '';
          let lastStatus: number | undefined;
          let priorityStatus: number | undefined;
          let hadSuccess = false;

          for (let index = 0; index < ANTIGRAVITY_QUOTA_URLS.length; index += 1) {
            const quotaResult = results.get(`quota-${index}`);
            if (!quotaResult) {
              lastError = translate('common.unknown_error');
              continue;
            }
            if (quotaResult.status === 'error') {
              lastError = quotaResult.error.message;
              lastStatus = quotaResult.error.status || undefined;
              if (lastStatus === 403 || lastStatus === 404) priorityStatus ??= lastStatus;
              continue;
            }

            const result = quotaResult.value;
            if (result.statusCode < 200 || result.statusCode >= 300) {
              lastError = getApiCallErrorMessage(result);
              lastStatus = result.statusCode;
              if (result.statusCode === 403 || result.statusCode === 404) {
                priorityStatus ??= result.statusCode;
              }
              continue;
            }

            hadSuccess = true;
            const payload = parseAntigravityPayload(
              result.body ?? result.bodyText
            ) as AntigravityQuotaSummaryPayload | null;
            if (!payload || !Array.isArray(payload.groups)) {
              lastError = translate('antigravity_quota.empty_models');
              continue;
            }
            const groups = buildAntigravityQuotaGroups(payload);
            if (groups.length === 0) {
              lastError = translate('antigravity_quota.empty_models');
              continue;
            }
            return {
              groups,
              subscription,
              serverTimeOffsetMs: resolveResponseServerTimeOffsetMs(result.header),
            };
          }

          if (hadSuccess) {
            return { groups: [], subscription, serverTimeOffsetMs: null };
          }
          throw createStatusError(
            lastError || translate('common.unknown_error'),
            priorityStatus ?? lastStatus
          );
        },
      };
    },
    t
  );

const buildCodexQuotaWindows = (payload: CodexUsagePayload, t: TFunction): CodexQuotaWindow[] => {
  const FIVE_HOUR_SECONDS = 18000;
  const WEEK_SECONDS = 604800;
  const WINDOW_META = {
    codeFiveHour: { id: 'five-hour', labelKey: 'codex_quota.primary_window' },
    codeWeekly: { id: 'weekly', labelKey: 'codex_quota.secondary_window' },
    codeMonthly: { id: 'monthly', labelKey: 'codex_quota.team_secondary_window' },
    codeReviewFiveHour: {
      id: 'code-review-five-hour',
      labelKey: 'codex_quota.code_review_primary_window',
    },
    codeReviewWeekly: {
      id: 'code-review-weekly',
      labelKey: 'codex_quota.code_review_secondary_window',
    },
    codeReviewMonthly: {
      id: 'code-review-monthly',
      labelKey: 'codex_quota.code_review_team_secondary_window',
    },
  } as const;

  const rateLimit = payload.rate_limit ?? payload.rateLimit ?? undefined;
  const codeReviewLimit =
    payload.code_review_rate_limit ?? payload.codeReviewRateLimit ?? undefined;
  const additionalRateLimits = payload.additional_rate_limits ?? payload.additionalRateLimits ?? [];
  const windows: CodexQuotaWindow[] = [];

  const addWindow = (
    id: string,
    label: string,
    labelKey: string | undefined,
    labelParams: Record<string, string | number> | undefined,
    window?: CodexUsageWindow | null,
    limitReached?: boolean,
    allowed?: boolean
  ) => {
    if (!window) return;
    const resetLabel = formatCodexResetLabel(window);
    const usedPercentRaw = normalizeNumberValue(window.used_percent ?? window.usedPercent);
    const isLimitReached = Boolean(limitReached) || allowed === false;
    const usedPercent = usedPercentRaw ?? (isLimitReached && resetLabel !== '-' ? 100 : null);
    windows.push({
      id,
      label,
      labelKey,
      labelParams,
      usedPercent,
      resetLabel,
    });
  };

  const getWindowSeconds = (window?: CodexUsageWindow | null): number | null => {
    if (!window) return null;
    return normalizeNumberValue(window.limit_window_seconds ?? window.limitWindowSeconds);
  };

  const MIN_MONTH_SECONDS = 28 * 24 * 60 * 60;
  const MAX_MONTH_SECONDS = 31 * 24 * 60 * 60;
  const isMonthlyWindow = (window?: CodexUsageWindow | null): boolean => {
    const seconds = getWindowSeconds(window);
    return seconds !== null && seconds >= MIN_MONTH_SECONDS && seconds <= MAX_MONTH_SECONDS;
  };

  const selectSecondaryWindowMeta = <
    TWeekly extends { id: string; labelKey: string },
    TMonthly extends { id: string; labelKey: string },
  >(
    window: CodexUsageWindow | null | undefined,
    weeklyMeta: TWeekly,
    monthlyMeta: TMonthly
  ): TWeekly | TMonthly => (isMonthlyWindow(window) ? monthlyMeta : weeklyMeta);

  const rawLimitReached = rateLimit?.limit_reached ?? rateLimit?.limitReached;
  const rawAllowed = rateLimit?.allowed;

  const pickClassifiedWindows = (
    limitInfo?: CodexRateLimitInfo | null,
    options?: { allowOrderFallback?: boolean }
  ): { fiveHourWindow: CodexUsageWindow | null; weeklyWindow: CodexUsageWindow | null } => {
    const allowOrderFallback = options?.allowOrderFallback ?? true;
    const primaryWindow = limitInfo?.primary_window ?? limitInfo?.primaryWindow ?? null;
    const secondaryWindow = limitInfo?.secondary_window ?? limitInfo?.secondaryWindow ?? null;
    const rawWindows = [primaryWindow, secondaryWindow];

    let fiveHourWindow: CodexUsageWindow | null = null;
    let weeklyWindow: CodexUsageWindow | null = null;

    for (const window of rawWindows) {
      if (!window) continue;
      const seconds = getWindowSeconds(window);
      if (seconds === FIVE_HOUR_SECONDS && !fiveHourWindow) {
        fiveHourWindow = window;
      } else if ((seconds === WEEK_SECONDS || isMonthlyWindow(window)) && !weeklyWindow) {
        weeklyWindow = window;
      }
    }

    // For legacy payloads without window duration, fallback to primary/secondary ordering.
    if (allowOrderFallback) {
      if (!fiveHourWindow) {
        fiveHourWindow = primaryWindow && primaryWindow !== weeklyWindow ? primaryWindow : null;
      }
      if (!weeklyWindow) {
        weeklyWindow =
          secondaryWindow && secondaryWindow !== fiveHourWindow ? secondaryWindow : null;
      }
    }

    return { fiveHourWindow, weeklyWindow };
  };

  const rateWindows = pickClassifiedWindows(rateLimit);
  addWindow(
    WINDOW_META.codeFiveHour.id,
    t(WINDOW_META.codeFiveHour.labelKey),
    WINDOW_META.codeFiveHour.labelKey,
    undefined,
    rateWindows.fiveHourWindow,
    rawLimitReached,
    rawAllowed
  );
  const codeSecondaryWindowMeta = selectSecondaryWindowMeta(
    rateWindows.weeklyWindow,
    WINDOW_META.codeWeekly,
    WINDOW_META.codeMonthly
  );
  addWindow(
    codeSecondaryWindowMeta.id,
    t(codeSecondaryWindowMeta.labelKey),
    codeSecondaryWindowMeta.labelKey,
    undefined,
    rateWindows.weeklyWindow,
    rawLimitReached,
    rawAllowed
  );

  const codeReviewWindows = pickClassifiedWindows(codeReviewLimit);
  const codeReviewLimitReached = codeReviewLimit?.limit_reached ?? codeReviewLimit?.limitReached;
  const codeReviewAllowed = codeReviewLimit?.allowed;
  addWindow(
    WINDOW_META.codeReviewFiveHour.id,
    t(WINDOW_META.codeReviewFiveHour.labelKey),
    WINDOW_META.codeReviewFiveHour.labelKey,
    undefined,
    codeReviewWindows.fiveHourWindow,
    codeReviewLimitReached,
    codeReviewAllowed
  );
  const codeReviewSecondaryWindowMeta = selectSecondaryWindowMeta(
    codeReviewWindows.weeklyWindow,
    WINDOW_META.codeReviewWeekly,
    WINDOW_META.codeReviewMonthly
  );
  addWindow(
    codeReviewSecondaryWindowMeta.id,
    t(codeReviewSecondaryWindowMeta.labelKey),
    codeReviewSecondaryWindowMeta.labelKey,
    undefined,
    codeReviewWindows.weeklyWindow,
    codeReviewLimitReached,
    codeReviewAllowed
  );

  const normalizeWindowId = (raw: string) =>
    raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  if (Array.isArray(additionalRateLimits)) {
    additionalRateLimits.forEach((limitItem, index) => {
      const rateInfo = limitItem?.rate_limit ?? limitItem?.rateLimit ?? null;
      if (!rateInfo) return;

      const limitName =
        normalizeStringValue(limitItem?.limit_name ?? limitItem?.limitName) ??
        normalizeStringValue(limitItem?.metered_feature ?? limitItem?.meteredFeature) ??
        `additional-${index + 1}`;

      const idPrefix = normalizeWindowId(limitName) || `additional-${index + 1}`;
      const additionalWindows = pickClassifiedWindows(rateInfo);
      const additionalLimitReached = rateInfo.limit_reached ?? rateInfo.limitReached;
      const additionalAllowed = rateInfo.allowed;

      addWindow(
        `${idPrefix}-five-hour-${index}`,
        t('codex_quota.additional_primary_window', { name: limitName }),
        'codex_quota.additional_primary_window',
        { name: limitName },
        additionalWindows.fiveHourWindow,
        additionalLimitReached,
        additionalAllowed
      );
      const additionalSecondaryMeta = selectSecondaryWindowMeta(
        additionalWindows.weeklyWindow,
        { id: 'weekly', labelKey: 'codex_quota.additional_secondary_window' },
        { id: 'monthly', labelKey: 'codex_quota.additional_team_secondary_window' }
      );
      addWindow(
        `${idPrefix}-${additionalSecondaryMeta.id}-${index}`,
        t(additionalSecondaryMeta.labelKey, { name: limitName }),
        additionalSecondaryMeta.labelKey,
        { name: limitName },
        additionalWindows.weeklyWindow,
        additionalLimitReached,
        additionalAllowed
      );
    });
  }

  return windows;
};

const buildCodexRequestHeader = (file: AuthFileItem): Record<string, string> => {
  const accountId = resolveCodexChatgptAccountId(file);
  const requestHeader: Record<string, string> = {
    ...CODEX_REQUEST_HEADERS,
  };
  if (accountId) {
    requestHeader['Chatgpt-Account-Id'] = accountId;
  }
  return requestHeader;
};

const buildCodexResetCreditsHeader = (
  requestHeader: Record<string, string>
): Record<string, string> => ({
  ...requestHeader,
  Accept: 'application/json',
  'OpenAI-Beta': 'codex-1',
  Originator: 'Codex Desktop',
});

const parseCodexResetCreditsResult = (
  result: ApiCallResult,
  t: TFunction
): CodexResetCreditsData => {
  if (result.statusCode < 200 || result.statusCode >= 300) {
    return {
      availableCount: null,
      credits: [],
      error: getApiCallErrorMessage(result),
    };
  }

  const summary = normalizeCodexResetCreditsPayload(result.body ?? result.bodyText);
  if (summary.invalidPayload) {
    return {
      availableCount: null,
      credits: [],
      error: t('codex_quota.reset_credits_invalid_payload'),
    };
  }

  return {
    availableCount: summary.availableCount,
    credits: summary.credits,
    error: '',
  };
};

const failedCodexResetCredits = (error: unknown, t: TFunction): CodexResetCreditsData => ({
  availableCount: null,
  credits: [],
  error: error instanceof Error ? error.message : t('common.unknown_error'),
});

const parseCodexUsageResult = (result: ApiCallResult, t: TFunction): CodexUsagePayload => {
  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseCodexUsagePayload(result.body ?? result.bodyText);
  if (!payload) throw new Error(t('codex_quota.empty_windows'));
  return payload;
};

const fetchCodexResetCredits = async (
  authIndex: string,
  requestHeader: Record<string, string>,
  t: TFunction
): Promise<CodexResetCreditsData> => {
  try {
    const result = await apiCallApi.request(
      {
        authIndex,
        method: 'GET',
        url: CODEX_RATE_LIMIT_RESET_CREDITS_URL,
        header: buildCodexResetCreditsHeader(requestHeader),
      },
      { timeout: CODEX_RESET_CREDITS_REQUEST_TIMEOUT_MS }
    );

    return parseCodexResetCreditsResult(result, t);
  } catch (err: unknown) {
    return failedCodexResetCredits(err, t);
  }
};

const parseCodexQuotaResult = (
  file: AuthFileItem,
  payload: CodexUsagePayload,
  resetCreditsData: CodexResetCreditsData,
  t: TFunction
): CodexQuotaData => {
  const planTypeFromUsage = normalizePlanType(payload.plan_type ?? payload.planType);
  const resetCredits = payload.rate_limit_reset_credits ?? payload.rateLimitResetCredits ?? null;
  const usageResetCreditsAvailableCount = normalizeNumberValue(
    resetCredits?.available_count ?? resetCredits?.availableCount
  );
  const resetCreditsCountFromDetails =
    resetCreditsData.credits.length > 0 ? resetCreditsData.credits.length : null;
  const rateLimitResetCreditsAvailableCount =
    resetCreditsData.availableCount ??
    resetCreditsCountFromDetails ??
    usageResetCreditsAvailableCount;

  return {
    planType: planTypeFromUsage ?? resolveCodexPlanType(file),
    subscriptionActiveUntil: resolveCodexSubscriptionActiveUntil(file),
    rateLimitResetCreditsAvailableCount,
    rateLimitResetCredits: resetCreditsData.credits,
    rateLimitResetCreditsError: resetCreditsData.error,
    windows: buildCodexQuotaWindows(payload, t),
  };
};

const fetchCodexQuota = async (file: AuthFileItem, t: TFunction): Promise<CodexQuotaData> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('codex_quota.missing_auth_index'));
  }

  const requestHeader = buildCodexRequestHeader(file);

  const result = await apiCallApi.request({
    authIndex,
    method: 'GET',
    url: CODEX_USAGE_URL,
    header: requestHeader,
  });

  const payload = parseCodexUsageResult(result, t);
  const resetCreditsData = await fetchCodexResetCredits(authIndex, requestHeader, t);
  return parseCodexQuotaResult(file, payload, resetCreditsData, t);
};

const fetchCodexQuotaBatch = (files: AuthFileItem[], t: TFunction) =>
  executeQuotaBatch(
    files,
    (file, translate) => {
      const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
      if (!authIndex) throw new Error(translate('codex_quota.missing_auth_index'));
      const requestHeader = buildCodexRequestHeader(file);
      return {
        requests: [
          {
            key: 'usage',
            request: {
              authIndex,
              method: 'GET',
              url: CODEX_USAGE_URL,
              header: requestHeader,
            },
          },
          {
            key: 'reset-credits',
            request: {
              authIndex,
              method: 'GET',
              url: CODEX_RATE_LIMIT_RESET_CREDITS_URL,
              header: buildCodexResetCreditsHeader(requestHeader),
            },
          },
        ],
        resolve: (results) => {
          const resetResult = results.get('reset-credits');
          const resetCreditsData =
            resetResult?.status === 'success'
              ? parseCodexResetCreditsResult(resetResult.value, translate)
              : failedCodexResetCredits(
                  resetResult?.status === 'error' ? batchItemError(resetResult) : undefined,
                  translate
                );
          return parseCodexQuotaResult(
            file,
            parseCodexUsageResult(requireBatchValue(results, 'usage'), translate),
            resetCreditsData,
            translate
          );
        },
      };
    },
    t
  );

const createCodexRedeemRequestId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    const segment = char === 'x' ? value : (value & 0x3) | 0x8;
    return segment.toString(16);
  });
};

const consumeCodexRateLimitResetCredit = async (
  file: AuthFileItem,
  t: TFunction
): Promise<void> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('codex_quota.missing_auth_index'));
  }

  const requestHeader = buildCodexRequestHeader(file);

  const result = await apiCallApi.request({
    authIndex,
    method: 'POST',
    url: CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL,
    header: requestHeader,
    data: JSON.stringify({
      redeem_request_id: createCodexRedeemRequestId(),
    }),
  });

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }
};

const resetCodexQuota = async (file: AuthFileItem, t: TFunction): Promise<CodexQuotaData> => {
  await consumeCodexRateLimitResetCredit(file, t);
  return fetchCodexQuota(file, t);
};

const GEMINI_CLI_G1_CREDIT_TYPE = 'GOOGLE_ONE_AI';

const GEMINI_CLI_TIER_LABELS: Record<string, string> = {
  'free-tier': 'tier_free',
  'legacy-tier': 'tier_legacy',
  'standard-tier': 'tier_standard',
  'g1-pro-tier': 'tier_pro',
  'g1-ultra-tier': 'tier_ultra',
};

const resolveGeminiCliTierLabel = (
  payload: GeminiCliCodeAssistPayload | null,
  t: TFunction
): string | null => {
  if (!payload) return null;
  const currentTier: GeminiCliUserTier | null | undefined =
    payload.currentTier ?? payload.current_tier;
  const paidTier: GeminiCliUserTier | null | undefined = payload.paidTier ?? payload.paid_tier;
  const rawId = normalizeStringValue(paidTier?.id) ?? normalizeStringValue(currentTier?.id);
  if (!rawId) return null;
  const tierId = rawId.toLowerCase();
  const labelKey = GEMINI_CLI_TIER_LABELS[tierId];
  return labelKey ? t(`gemini_cli_quota.${labelKey}`) : rawId;
};

const resolveGeminiCliTierId = (payload: GeminiCliCodeAssistPayload | null): string | null => {
  if (!payload) return null;
  const currentTier: GeminiCliUserTier | null | undefined =
    payload.currentTier ?? payload.current_tier;
  const paidTier: GeminiCliUserTier | null | undefined = payload.paidTier ?? payload.paid_tier;
  const rawId = normalizeStringValue(paidTier?.id) ?? normalizeStringValue(currentTier?.id);
  return rawId ? rawId.toLowerCase() : null;
};

const resolveGeminiCliCreditBalance = (
  payload: GeminiCliCodeAssistPayload | null
): number | null => {
  if (!payload) return null;
  const paidTier: GeminiCliUserTier | null | undefined = payload.paidTier ?? payload.paid_tier;
  const currentTier: GeminiCliUserTier | null | undefined =
    payload.currentTier ?? payload.current_tier;
  const tier = paidTier ?? currentTier;
  if (!tier) return null;
  const credits: GeminiCliCredits[] = tier.availableCredits ?? tier.available_credits ?? [];
  let total = 0;
  let found = false;
  for (const credit of credits) {
    const creditType = normalizeStringValue(credit.creditType ?? credit.credit_type);
    if (creditType !== GEMINI_CLI_G1_CREDIT_TYPE) continue;
    const amount = normalizeNumberValue(credit.creditAmount ?? credit.credit_amount);
    if (amount !== null) {
      total += amount;
      found = true;
    }
  }
  return found ? total : null;
};

const emptyGeminiCliSupplementaryData = (): GeminiCliSupplementaryData => ({
  tierLabel: null,
  tierId: null,
  creditBalance: null,
});

const parseGeminiCliSupplementaryResult = (
  result: ApiCallResult,
  t: TFunction
): GeminiCliSupplementaryData => {
  if (result.statusCode < 200 || result.statusCode >= 300) {
    return emptyGeminiCliSupplementaryData();
  }

  const payload = parseGeminiCliCodeAssistPayload(result.body ?? result.bodyText);
  return {
    tierLabel: resolveGeminiCliTierLabel(payload, t),
    tierId: resolveGeminiCliTierId(payload),
    creditBalance: resolveGeminiCliCreditBalance(payload),
  };
};

const buildGeminiCliCodeAssistRequest = (authIndex: string, projectId: string): ApiCallRequest => ({
  authIndex,
  method: 'POST',
  url: GEMINI_CLI_CODE_ASSIST_URL,
  header: { ...GEMINI_CLI_REQUEST_HEADERS },
  data: JSON.stringify({
    cloudaicompanionProject: projectId,
    metadata: {
      ideType: 'IDE_UNSPECIFIED',
      platform: 'PLATFORM_UNSPECIFIED',
      pluginType: 'GEMINI',
      duetProject: projectId,
    },
  }),
});

const fetchGeminiCliCodeAssist = async (
  authIndex: string,
  projectId: string,
  t: TFunction
): Promise<GeminiCliSupplementaryData> => {
  try {
    const result = await apiCallApi.request(buildGeminiCliCodeAssistRequest(authIndex, projectId));

    return parseGeminiCliSupplementaryResult(result, t);
  } catch {
    return emptyGeminiCliSupplementaryData();
  }
};

const readGeminiCliSupplementarySnapshot = (
  fileName: string,
  requestId: number
): { tierLabel: string | null; tierId: string | null; creditBalance: number | null } => {
  const cached = geminiCliSupplementaryCache.get(fileName);
  if (!cached || cached.requestId !== requestId) {
    return { tierLabel: null, tierId: null, creditBalance: null };
  }

  return {
    tierLabel: cached.tierLabel,
    tierId: cached.tierId,
    creditBalance: cached.creditBalance,
  };
};

const scheduleGeminiCliSupplementaryRefresh = (
  fileName: string,
  authIndex: string,
  projectId: string,
  t: TFunction
): number => {
  const requestId = (geminiCliSupplementaryRequestIds.get(fileName) ?? 0) + 1;
  geminiCliSupplementaryRequestIds.set(fileName, requestId);
  geminiCliSupplementaryCache.delete(fileName);

  void (async () => {
    const supplementary = await fetchGeminiCliCodeAssist(authIndex, projectId, t);
    if (geminiCliSupplementaryRequestIds.get(fileName) !== requestId) {
      return;
    }

    geminiCliSupplementaryCache.set(fileName, { requestId, ...supplementary });

    useQuotaStore.getState().setGeminiCliQuota((prev) => {
      const current = prev[fileName];
      if (!current || current.status !== 'success') {
        return prev;
      }

      if (
        current.tierLabel === supplementary.tierLabel &&
        current.tierId === supplementary.tierId &&
        current.creditBalance === supplementary.creditBalance
      ) {
        return prev;
      }

      return {
        ...prev,
        [fileName]: {
          ...current,
          tierLabel: supplementary.tierLabel,
          tierId: supplementary.tierId,
          creditBalance: supplementary.creditBalance,
        },
      };
    });
  })();

  return requestId;
};

const parseGeminiCliQuotaBuckets = (quotaResponse: ApiCallResult): GeminiCliQuotaBucketState[] => {
  if (quotaResponse.statusCode < 200 || quotaResponse.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(quotaResponse), quotaResponse.statusCode);
  }

  const payload = parseGeminiCliQuotaPayload(quotaResponse.body ?? quotaResponse.bodyText);
  const buckets = Array.isArray(payload?.buckets) ? payload.buckets : [];
  const parsedBuckets = buckets
    .map((bucket) => {
      const modelId = normalizeGeminiCliModelId(bucket.modelId ?? bucket.model_id);
      if (!modelId) return null;
      const tokenType = normalizeStringValue(bucket.tokenType ?? bucket.token_type);
      const remainingFractionRaw = normalizeQuotaFraction(
        bucket.remainingFraction ?? bucket.remaining_fraction
      );
      const remainingAmount = normalizeNumberValue(
        bucket.remainingAmount ?? bucket.remaining_amount
      );
      const resetTime = normalizeStringValue(bucket.resetTime ?? bucket.reset_time) ?? undefined;
      let fallbackFraction: number | null = null;
      if (remainingAmount !== null) {
        fallbackFraction = remainingAmount <= 0 ? 0 : null;
      } else if (resetTime) {
        fallbackFraction = 0;
      }
      return {
        modelId,
        tokenType,
        remainingFraction: remainingFractionRaw ?? fallbackFraction,
        remainingAmount,
        resetTime,
      };
    })
    .filter((bucket): bucket is GeminiCliParsedBucket => bucket !== null);

  return buildGeminiCliQuotaBuckets(parsedBuckets);
};

const fetchGeminiCliQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<GeminiCliQuotaData> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('gemini_cli_quota.missing_auth_index'));
  }

  const projectId = resolveGeminiCliProjectId(file);
  if (!projectId) {
    throw new Error(t('gemini_cli_quota.missing_project_id'));
  }

  const quotaResponse = await apiCallApi.request({
    authIndex,
    method: 'POST',
    url: GEMINI_CLI_QUOTA_URL,
    header: { ...GEMINI_CLI_REQUEST_HEADERS },
    data: JSON.stringify({ project: projectId }),
  });
  const builtBuckets = parseGeminiCliQuotaBuckets(quotaResponse);
  const supplementaryRequestId = scheduleGeminiCliSupplementaryRefresh(
    file.name,
    authIndex,
    projectId,
    t
  );
  const supplementarySnapshot = readGeminiCliSupplementarySnapshot(
    file.name,
    supplementaryRequestId
  );

  return {
    fileName: file.name,
    supplementaryRequestId,
    buckets: builtBuckets,
    tierLabel: supplementarySnapshot.tierLabel,
    tierId: supplementarySnapshot.tierId,
    creditBalance: supplementarySnapshot.creditBalance,
  };
};

const fetchGeminiCliQuotaBatch = (files: AuthFileItem[], t: TFunction) =>
  executeQuotaBatch(
    files,
    (file, translate) => {
      const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
      if (!authIndex) throw new Error(translate('gemini_cli_quota.missing_auth_index'));
      const projectId = resolveGeminiCliProjectId(file);
      if (!projectId) throw new Error(translate('gemini_cli_quota.missing_project_id'));
      return {
        requests: [
          {
            key: 'quota',
            request: {
              authIndex,
              method: 'POST',
              url: GEMINI_CLI_QUOTA_URL,
              header: { ...GEMINI_CLI_REQUEST_HEADERS },
              data: JSON.stringify({ project: projectId }),
            },
          },
          {
            key: 'supplementary',
            request: buildGeminiCliCodeAssistRequest(authIndex, projectId),
          },
        ],
        resolve: (results): GeminiCliQuotaData => {
          const supplementary = results.get('supplementary');
          const supplementaryData =
            supplementary?.status === 'success'
              ? parseGeminiCliSupplementaryResult(supplementary.value, translate)
              : emptyGeminiCliSupplementaryData();
          return {
            fileName: file.name,
            supplementaryRequestId: 0,
            buckets: parseGeminiCliQuotaBuckets(requireBatchValue(results, 'quota')),
            ...supplementaryData,
          };
        },
      };
    },
    t
  );

const ANTIGRAVITY_PREMIUM_PLANS = new Set(['ultra', 'ultra-lite']);

const ANTIGRAVITY_GROUP_LABEL_KEYS = new Map<string, string>([
  ['gemini models', 'group_gemini_models'],
  ['claude and gpt models', 'group_claude_gpt_models'],
]);

const ANTIGRAVITY_BUCKET_LABEL_KEYS = new Map<string, string>([
  ['weekly limit', 'weekly_limit'],
  ['daily limit', 'daily_limit'],
  ['5 hour limit', 'five_hour_limit'],
  ['5-hour limit', 'five_hour_limit'],
  ['five hour limit', 'five_hour_limit'],
  ['monthly limit', 'monthly_limit'],
]);

const normalizeAntigravityQuotaText = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, ' ');

const translateAntigravityQuotaLabel = (
  value: string,
  keys: Map<string, string>,
  t: TFunction
): string => {
  const key = keys.get(normalizeAntigravityQuotaText(value));
  return key ? t(`antigravity_quota.${key}`) : value;
};

const translateAntigravityQuotaDescription = (
  value: string | undefined,
  t: TFunction
): string | undefined => {
  if (!value) return undefined;
  const modelsMatch = value.match(/^models within this group:\s*(.+)$/i);
  if (modelsMatch) {
    return t('antigravity_quota.group_models_description', {
      models: modelsMatch[1].trim(),
    });
  }
  return value;
};

const getAntigravityPlanLabel = (
  subscription: AntigravityQuotaSubscription | null | undefined,
  t: TFunction
): string | null => {
  if (!subscription) return null;
  if (subscription.plan === 'free') return t('antigravity_subscription.plan_free');
  if (subscription.plan === 'pro') return t('antigravity_subscription.plan_pro');
  if (subscription.plan === 'ultra') return t('antigravity_subscription.plan_ultra');
  if (subscription.plan === 'ultra-lite') return t('antigravity_subscription.plan_ultra_lite');
  return (
    subscription.tierName ||
    subscription.tierId ||
    (subscription.plan === 'unknown' ? t('antigravity_subscription.plan_unknown') : null)
  );
};

const formatAntigravityDuration = (t: TFunction, deltaMs: number): string => {
  const totalMinutes = Math.max(1, Math.ceil(deltaMs / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return t('antigravity_quota.duration_day_hour', { days, hours });
  }
  if (hours > 0) {
    return t('antigravity_quota.duration_hour_minute', { hours, minutes });
  }
  if (minutes > 0) {
    return t('antigravity_quota.duration_minute', { minutes });
  }
  return t('antigravity_quota.duration_less_than_minute');
};

const formatAntigravityResetLabel = (
  resetTime: string | undefined,
  t: TFunction,
  nowMs: number
): string => {
  if (!resetTime) return '-';
  const resetMs = new Date(resetTime).getTime();
  if (Number.isNaN(resetMs)) return '-';
  const deltaMs = resetMs - nowMs;
  if (deltaMs <= 0) return t('antigravity_quota.refresh_available');
  return t('antigravity_quota.refreshes_in', {
    duration: formatAntigravityDuration(t, deltaMs),
  });
};

const renderAntigravityItems = (
  quota: AntigravityQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h, Fragment } = React;
  const groups = quota.groups ?? [];
  const nodes: ReactNode[] = [];

  const planLabel = getAntigravityPlanLabel(quota.subscription, t);
  const isPremiumPlan = ANTIGRAVITY_PREMIUM_PLANS.has(quota.subscription?.plan ?? '');
  if (planLabel) {
    nodes.push(
      h(
        'div',
        { key: 'plan', className: styleMap.codexPlan },
        h(
          'span',
          { key: 'plan-label', className: styleMap.codexPlanLabel },
          t('antigravity_quota.plan_label')
        ),
        h(
          'span',
          {
            key: 'plan-value',
            className: isPremiumPlan ? styleMap.premiumPlanValue : styleMap.codexPlanValue,
          },
          planLabel
        )
      )
    );
  }

  if (groups.length === 0) {
    nodes.push(
      h(
        'div',
        { key: 'empty', className: styleMap.quotaMessage },
        t('antigravity_quota.empty_models')
      )
    );
    return h(Fragment, null, ...nodes);
  }

  const nowMs = Date.now() + (quota.serverTimeOffsetMs ?? 0);

  nodes.push(
    ...groups.map((group) => {
      const groupLabel = translateAntigravityQuotaLabel(
        group.label,
        ANTIGRAVITY_GROUP_LABEL_KEYS,
        t
      );
      const groupDescription = translateAntigravityQuotaDescription(group.description, t);

      return h(
        'div',
        { key: group.id, className: styleMap.antigravityQuotaGroup },
        h(
          'div',
          { className: styleMap.antigravityQuotaGroupHeader },
          h('span', { className: styleMap.antigravityQuotaGroupTitle }, groupLabel),
          groupDescription
            ? h('span', { className: styleMap.antigravityQuotaGroupDescription }, groupDescription)
            : null
        ),
        ...group.buckets.map((bucket) => {
          const clamped = Math.max(0, Math.min(1, bucket.remainingFraction));
          const percent = clamped * 100;
          const percentLabel =
            bucket.remainingFraction === 1
              ? t('antigravity_quota.quota_available')
              : t('antigravity_quota.remaining_percent', {
                  percent: Math.round(percent),
                });
          const resetLabel = formatAntigravityResetLabel(bucket.resetTime, t, nowMs);
          const bucketLabel = translateAntigravityQuotaLabel(
            bucket.label,
            ANTIGRAVITY_BUCKET_LABEL_KEYS,
            t
          );
          const bucketDescription = translateAntigravityQuotaDescription(bucket.description, t);

          return h(
            'div',
            { key: bucket.id, className: styleMap.quotaRow },
            h(
              'div',
              { className: styleMap.quotaRowHeader },
              h('span', { className: styleMap.quotaModel, title: bucketDescription }, bucketLabel),
              h(
                'div',
                { className: styleMap.quotaMeta },
                h('span', { className: styleMap.quotaPercent }, percentLabel),
                h('span', { className: styleMap.quotaReset }, resetLabel)
              )
            ),
            h(QuotaProgressBar, {
              percent,
              highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
              mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
            })
          );
        })
      );
    })
  );

  return h(Fragment, null, ...nodes);
};

const PREMIUM_GEMINI_CLI_TIER_IDS = new Set(['g1-ultra-tier']);
const PREMIUM_CODEX_PLAN_TYPES = new Set(['pro', 'prolite', 'pro-lite', 'pro_lite']);

const renderCodexItems = (
  quota: CodexQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar, resetQuotaAction: resetQuotaActionHelper } = helpers;
  const { createElement: h, Fragment } = React;
  const windows = quota.windows ?? [];
  const planType = quota.planType ?? null;
  const subscriptionActiveUntil = quota.subscriptionActiveUntil ?? null;
  const rateLimitResetCreditsAvailableCount = quota.rateLimitResetCreditsAvailableCount ?? null;
  const rateLimitResetCredits = quota.rateLimitResetCredits ?? [];
  const rateLimitResetCreditsError = quota.rateLimitResetCreditsError ?? '';

  const getPlanLabel = (pt?: string | null): string | null => {
    const normalized = normalizePlanType(pt);
    if (!normalized) return null;
    if (normalized === 'pro') return t('codex_quota.plan_pro');
    if (PREMIUM_CODEX_PLAN_TYPES.has(normalized) && normalized !== 'pro') {
      return t('codex_quota.plan_prolite');
    }
    if (normalized === 'plus') return t('codex_quota.plan_plus');
    if (normalized === 'team') return t('codex_quota.plan_team');
    if (normalized === 'free') return t('codex_quota.plan_free');
    return pt || normalized;
  };

  const planLabel = getPlanLabel(planType);
  const isPremiumPlan = PREMIUM_CODEX_PLAN_TYPES.has(normalizePlanType(planType) ?? '');
  const expiryLabel = subscriptionActiveUntil ? formatUnixTimestamp(subscriptionActiveUntil) : '';
  const resetQuotaAction =
    rateLimitResetCreditsAvailableCount !== null ? (resetQuotaActionHelper ?? null) : null;
  const nodes: ReactNode[] = [];

  if (planLabel || rateLimitResetCreditsAvailableCount !== null || expiryLabel) {
    const planValueClass = isPremiumPlan ? styleMap.premiumPlanValue : styleMap.codexPlanValue;
    const planNodes: ReactNode[] = [];
    const appendSeparator = (key: string) => {
      if (planNodes.length === 0) return;
      planNodes.push(h('span', { key, className: styleMap.codexPlanSeparator }));
    };

    if (planLabel) {
      planNodes.push(
        h(
          'span',
          { key: 'plan-label', className: styleMap.codexPlanLabel },
          t('codex_quota.plan_label')
        ),
        h('span', { key: 'plan-value', className: planValueClass }, planLabel)
      );
    }

    if (expiryLabel) {
      appendSeparator('subscription-expiry-separator');
      planNodes.push(
        h(
          'span',
          { key: 'subscription-expiry-label', className: styleMap.codexPlanLabel },
          t('codex_quota.expires_label')
        ),
        h(
          'span',
          { key: 'subscription-expiry-value', className: styleMap.codexPlanValue },
          expiryLabel
        )
      );
    }

    if (rateLimitResetCreditsAvailableCount !== null) {
      appendSeparator('reset-credits-separator');
      planNodes.push(
        h(
          'span',
          { key: 'reset-credits-label', className: styleMap.codexPlanLabel },
          t('codex_quota.reset_credits_label')
        ),
        h(
          'span',
          { key: 'reset-credits-value', className: styleMap.codexPlanValue },
          rateLimitResetCreditsAvailableCount.toString()
        )
      );
      if (resetQuotaAction) {
        planNodes.push(h(Fragment, { key: 'reset-credits-action' }, resetQuotaAction));
      }
    }

    nodes.push(h('div', { key: 'plan', className: styleMap.codexPlan }, ...planNodes));
  }

  if (rateLimitResetCredits.length > 0) {
    nodes.push(
      h(
        'div',
        { key: 'reset-credit-expiries', className: styleMap.codexResetCredits },
        h(
          'div',
          { className: styleMap.codexResetCreditsTitle },
          t('codex_quota.reset_credits_expiry_label')
        ),
        ...rateLimitResetCredits.map((credit, index) =>
          h(
            'div',
            {
              key: credit.id || `${credit.expiresAt}-${index}`,
              className: styleMap.codexResetCreditRow,
            },
            h(
              'span',
              { className: styleMap.codexResetCreditLabel },
              t('codex_quota.reset_credit_number', { index: index + 1 })
            ),
            h(
              'span',
              { className: styleMap.codexResetCreditTime },
              formatShanghaiDateTime(credit.expiresAt) || credit.expiresAt
            )
          )
        )
      )
    );
  } else if (rateLimitResetCreditsError) {
    nodes.push(
      h(
        'div',
        { key: 'reset-credit-expiry-error', className: styleMap.codexResetCreditsError },
        t('codex_quota.reset_credits_expiry_failed', {
          message: rateLimitResetCreditsError,
        })
      )
    );
  }

  if (windows.length === 0) {
    nodes.push(
      h('div', { key: 'empty', className: styleMap.quotaMessage }, t('codex_quota.empty_windows'))
    );
    return h(Fragment, null, ...nodes);
  }

  nodes.push(
    ...windows.map((window) => {
      const used = window.usedPercent;
      const clampedUsed = used === null ? null : Math.max(0, Math.min(100, used));
      const remaining = clampedUsed === null ? null : Math.max(0, Math.min(100, 100 - clampedUsed));
      const percentLabel = remaining === null ? '--' : `${Math.round(remaining)}%`;
      const windowLabel = window.labelKey
        ? t(window.labelKey, window.labelParams as Record<string, string | number>)
        : window.label;

      return h(
        'div',
        { key: window.id, className: styleMap.quotaRow },
        h(
          'div',
          { className: styleMap.quotaRowHeader },
          h('span', { className: styleMap.quotaModel }, windowLabel),
          h(
            'div',
            { className: styleMap.quotaMeta },
            h('span', { className: styleMap.quotaPercent }, percentLabel),
            h('span', { className: styleMap.quotaReset }, window.resetLabel)
          )
        ),
        h(QuotaProgressBar, {
          percent: remaining,
          highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
          mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
        })
      );
    })
  );

  return h(Fragment, null, ...nodes);
};

const renderGeminiCliItems = (
  quota: GeminiCliQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h, Fragment } = React;
  const buckets = quota.buckets ?? [];
  const tierLabel = quota.tierLabel ?? null;
  const tierId = quota.tierId ?? null;
  const creditBalance = quota.creditBalance ?? null;
  const isPremiumTier = tierId !== null && PREMIUM_GEMINI_CLI_TIER_IDS.has(tierId);
  const nodes: ReactNode[] = [];

  if (tierLabel) {
    const valueClass = isPremiumTier ? styleMap.premiumPlanValue : styleMap.codexPlanValue;
    nodes.push(
      h(
        'div',
        { key: 'tier', className: styleMap.codexPlan },
        h('span', { className: styleMap.codexPlanLabel }, t('gemini_cli_quota.tier_label')),
        h('span', { className: valueClass }, tierLabel)
      )
    );
  }

  if (creditBalance !== null) {
    nodes.push(
      h(
        'div',
        { key: 'credits', className: styleMap.codexPlan },
        h('span', { className: styleMap.codexPlanLabel }, t('gemini_cli_quota.credit_label')),
        h(
          'span',
          { className: styleMap.codexPlanValue },
          t('gemini_cli_quota.credit_amount', { count: creditBalance })
        )
      )
    );
  }

  if (buckets.length === 0) {
    nodes.push(
      h(
        'div',
        { key: 'empty', className: styleMap.quotaMessage },
        t('gemini_cli_quota.empty_buckets')
      )
    );
    return h(Fragment, null, ...nodes);
  }

  nodes.push(
    ...buckets.map((bucket) => {
      const fraction = bucket.remainingFraction;
      const clamped = fraction === null ? null : Math.max(0, Math.min(1, fraction));
      const percent = clamped === null ? null : Math.round(clamped * 100);
      const percentLabel = percent === null ? '--' : `${percent}%`;
      const remainingAmountLabel =
        bucket.remainingAmount === null || bucket.remainingAmount === undefined
          ? null
          : t('gemini_cli_quota.remaining_amount', {
              count: bucket.remainingAmount,
            });
      const titleBase =
        bucket.modelIds && bucket.modelIds.length > 0 ? bucket.modelIds.join(', ') : bucket.label;
      const title = bucket.tokenType ? `${titleBase} (${bucket.tokenType})` : titleBase;

      const resetLabel = formatQuotaResetTime(bucket.resetTime);

      return h(
        'div',
        { key: bucket.id, className: styleMap.quotaRow },
        h(
          'div',
          { className: styleMap.quotaRowHeader },
          h('span', { className: styleMap.quotaModel, title }, bucket.label),
          h(
            'div',
            { className: styleMap.quotaMeta },
            h('span', { className: styleMap.quotaPercent }, percentLabel),
            remainingAmountLabel
              ? h('span', { className: styleMap.quotaAmount }, remainingAmountLabel)
              : null,
            h('span', { className: styleMap.quotaReset }, resetLabel)
          )
        ),
        h(QuotaProgressBar, {
          percent,
          highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
          mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
        })
      );
    })
  );

  return h(Fragment, null, ...nodes);
};

const buildClaudeQuotaWindows = (
  payload: ClaudeUsagePayload,
  t: TFunction
): ClaudeQuotaWindow[] => {
  const windows: ClaudeQuotaWindow[] = [];

  for (const { key, id, labelKey } of CLAUDE_USAGE_WINDOW_KEYS) {
    const window = payload[key as keyof ClaudeUsagePayload];
    if (!window || typeof window !== 'object' || !('utilization' in window)) continue;
    const typedWindow = window as { utilization: number; resets_at: string };
    const usedPercent = normalizeNumberValue(typedWindow.utilization);
    const resetLabel = formatQuotaResetTime(typedWindow.resets_at);
    windows.push({
      id,
      label: t(labelKey),
      labelKey,
      usedPercent,
      resetLabel,
    });
  }

  return windows;
};

const normalizeFlagValue = (value: unknown): boolean | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(trimmed)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(trimmed)) return false;
  }
  return undefined;
};

const parseClaudeProfilePayload = (payload: unknown): ClaudeProfileResponse | null => {
  if (payload === undefined || payload === null) return null;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed) as ClaudeProfileResponse;
    } catch {
      return null;
    }
  }
  if (typeof payload === 'object') {
    return payload as ClaudeProfileResponse;
  }
  return null;
};

const resolveClaudePlanType = (profile: ClaudeProfileResponse | null): string | null => {
  if (!profile) return null;

  const hasClaudeMax = normalizeFlagValue(profile.account?.has_claude_max);
  if (hasClaudeMax) return 'plan_max';

  const hasClaudePro = normalizeFlagValue(profile.account?.has_claude_pro);
  if (hasClaudePro) return 'plan_pro';

  const organizationType = normalizeStringValue(
    profile.organization?.organization_type
  )?.toLowerCase();
  const subscriptionStatus = normalizeStringValue(
    profile.organization?.subscription_status
  )?.toLowerCase();

  if (organizationType === 'claude_team' && subscriptionStatus === 'active') {
    return 'plan_team';
  }

  if (hasClaudeMax === false && hasClaudePro === false) return 'plan_free';

  return null;
};

const parseClaudeQuotaResults = (
  usageResult: ApiCallResult,
  profileResult: ApiCallResult | null,
  t: TFunction
): {
  windows: ClaudeQuotaWindow[];
  extraUsage?: ClaudeExtraUsage | null;
  planType?: string | null;
} => {
  if (usageResult.statusCode < 200 || usageResult.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(usageResult), usageResult.statusCode);
  }

  const payload = parseClaudeUsagePayload(usageResult.body ?? usageResult.bodyText);
  if (!payload) {
    throw new Error(t('claude_quota.empty_windows'));
  }

  const windows = buildClaudeQuotaWindows(payload, t);
  const planType =
    profileResult && profileResult.statusCode >= 200 && profileResult.statusCode < 300
      ? resolveClaudePlanType(
          parseClaudeProfilePayload(profileResult.body ?? profileResult.bodyText)
        )
      : null;

  return { windows, extraUsage: payload.extra_usage, planType };
};

const fetchClaudeQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<{
  windows: ClaudeQuotaWindow[];
  extraUsage?: ClaudeExtraUsage | null;
  planType?: string | null;
}> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('claude_quota.missing_auth_index'));
  }

  const [usageResult, profileResult] = await Promise.allSettled([
    apiCallApi.request({
      authIndex,
      method: 'GET',
      url: CLAUDE_USAGE_URL,
      header: { ...CLAUDE_REQUEST_HEADERS },
    }),
    apiCallApi.request({
      authIndex,
      method: 'GET',
      url: CLAUDE_PROFILE_URL,
      header: { ...CLAUDE_REQUEST_HEADERS },
    }),
  ]);

  if (usageResult.status === 'rejected') {
    throw usageResult.reason;
  }

  return parseClaudeQuotaResults(
    usageResult.value,
    profileResult.status === 'fulfilled' ? profileResult.value : null,
    t
  );
};

const fetchClaudeQuotaBatch = (files: AuthFileItem[], t: TFunction) =>
  executeQuotaBatch(
    files,
    (file, translate) => {
      const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
      if (!authIndex) throw new Error(translate('claude_quota.missing_auth_index'));
      return {
        requests: [
          {
            key: 'usage',
            request: {
              authIndex,
              method: 'GET',
              url: CLAUDE_USAGE_URL,
              header: { ...CLAUDE_REQUEST_HEADERS },
            },
          },
          {
            key: 'profile',
            request: {
              authIndex,
              method: 'GET',
              url: CLAUDE_PROFILE_URL,
              header: { ...CLAUDE_REQUEST_HEADERS },
            },
          },
        ],
        resolve: (results) => {
          const profile = results.get('profile');
          return parseClaudeQuotaResults(
            requireBatchValue(results, 'usage'),
            profile?.status === 'success' ? profile.value : null,
            translate
          );
        },
      };
    },
    t
  );

const renderClaudeItems = (
  quota: ClaudeQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h, Fragment } = React;
  const windows = quota.windows ?? [];
  const extraUsage = quota.extraUsage ?? null;
  const planType = quota.planType ?? null;
  const nodes: ReactNode[] = [];

  if (planType) {
    nodes.push(
      h(
        'div',
        { key: 'plan', className: styleMap.codexPlan },
        h('span', { className: styleMap.codexPlanLabel }, t('claude_quota.plan_label')),
        h('span', { className: styleMap.codexPlanValue }, t(`claude_quota.${planType}`))
      )
    );
  }

  if (extraUsage && extraUsage.is_enabled) {
    const usedLabel = `$${(extraUsage.used_credits / 100).toFixed(2)} / $${(extraUsage.monthly_limit / 100).toFixed(2)}`;
    nodes.push(
      h(
        'div',
        { key: 'extra', className: styleMap.codexPlan },
        h('span', { className: styleMap.codexPlanLabel }, t('claude_quota.extra_usage_label')),
        h('span', { className: styleMap.codexPlanValue }, usedLabel)
      )
    );
  }

  if (windows.length === 0) {
    nodes.push(
      h('div', { key: 'empty', className: styleMap.quotaMessage }, t('claude_quota.empty_windows'))
    );
    return h(Fragment, null, ...nodes);
  }

  nodes.push(
    ...windows.map((window) => {
      const used = window.usedPercent;
      const clampedUsed = used === null ? null : Math.max(0, Math.min(100, used));
      const remaining = clampedUsed === null ? null : Math.max(0, Math.min(100, 100 - clampedUsed));
      const percentLabel = remaining === null ? '--' : `${Math.round(remaining)}%`;
      const windowLabel = window.labelKey ? t(window.labelKey) : window.label;

      return h(
        'div',
        { key: window.id, className: styleMap.quotaRow },
        h(
          'div',
          { className: styleMap.quotaRowHeader },
          h('span', { className: styleMap.quotaModel }, windowLabel),
          h(
            'div',
            { className: styleMap.quotaMeta },
            h('span', { className: styleMap.quotaPercent }, percentLabel),
            h('span', { className: styleMap.quotaReset }, window.resetLabel)
          )
        ),
        h(QuotaProgressBar, {
          percent: remaining,
          highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
          mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
        })
      );
    })
  );

  return h(Fragment, null, ...nodes);
};

export const CLAUDE_CONFIG: QuotaConfig<
  ClaudeQuotaState,
  { windows: ClaudeQuotaWindow[]; extraUsage?: ClaudeExtraUsage | null; planType?: string | null }
> = {
  type: 'claude',
  i18nPrefix: 'claude_quota',
  cardIdleMessageKey: 'quota_management.card_idle_hint',
  filterFn: (file) => isClaudeFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchClaudeQuota,
  fetchQuotaBatch: fetchClaudeQuotaBatch,
  storeSelector: (state) => state.claudeQuota,
  storeSetter: 'setClaudeQuota',
  buildLoadingState: () => ({ status: 'loading', windows: [] }),
  buildSuccessState: (data) => ({
    status: 'success',
    windows: data.windows,
    extraUsage: data.extraUsage,
    planType: data.planType,
  }),
  buildErrorState: (message, status) => ({
    status: 'error',
    windows: [],
    error: message,
    errorStatus: status,
  }),
  cardClassName: styles.claudeCard,
  controlsClassName: styles.claudeControls,
  controlClassName: styles.claudeControl,
  gridClassName: styles.claudeGrid,
  renderQuotaItems: renderClaudeItems,
};

export const ANTIGRAVITY_CONFIG: QuotaConfig<AntigravityQuotaState, AntigravityQuotaData> = {
  type: 'antigravity',
  i18nPrefix: 'antigravity_quota',
  cardIdleMessageKey: 'quota_management.card_idle_hint',
  filterFn: (file) => isAntigravityFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchAntigravityQuota,
  fetchQuotaBatch: fetchAntigravityQuotaBatch,
  storeSelector: (state) => state.antigravityQuota,
  storeSetter: 'setAntigravityQuota',
  buildLoadingState: () => ({
    status: 'loading',
    groups: [],
    subscription: null,
    serverTimeOffsetMs: null,
  }),
  buildSuccessState: (data) => ({
    status: 'success',
    groups: data.groups,
    subscription: data.subscription,
    serverTimeOffsetMs: data.serverTimeOffsetMs,
  }),
  buildErrorState: (message, status) => ({
    status: 'error',
    groups: [],
    subscription: null,
    serverTimeOffsetMs: null,
    error: message,
    errorStatus: status,
  }),
  cardClassName: styles.antigravityCard,
  controlsClassName: styles.antigravityControls,
  controlClassName: styles.antigravityControl,
  gridClassName: styles.antigravityGrid,
  renderQuotaItems: renderAntigravityItems,
};

export const CODEX_CONFIG: QuotaConfig<CodexQuotaState, CodexQuotaData> = {
  type: 'codex',
  i18nPrefix: 'codex_quota',
  cardIdleMessageKey: 'quota_management.card_idle_hint',
  filterFn: (file) => isCodexFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchCodexQuota,
  fetchQuotaBatch: fetchCodexQuotaBatch,
  resetQuota: resetCodexQuota,
  canResetQuota: (quota) => (quota.rateLimitResetCreditsAvailableCount ?? 0) > 0,
  storeSelector: (state) => state.codexQuota,
  storeSetter: 'setCodexQuota',
  buildLoadingState: () => ({
    status: 'loading',
    windows: [],
    rateLimitResetCredits: [],
    rateLimitResetCreditsError: '',
  }),
  buildSuccessState: (data) => ({
    status: 'success',
    windows: data.windows,
    planType: data.planType,
    subscriptionActiveUntil: data.subscriptionActiveUntil,
    rateLimitResetCreditsAvailableCount: data.rateLimitResetCreditsAvailableCount,
    rateLimitResetCredits: data.rateLimitResetCredits,
    rateLimitResetCreditsError: data.rateLimitResetCreditsError,
  }),
  buildErrorState: (message, status) => ({
    status: 'error',
    windows: [],
    rateLimitResetCredits: [],
    rateLimitResetCreditsError: '',
    error: message,
    errorStatus: status,
  }),
  cardClassName: styles.codexCard,
  controlsClassName: styles.codexControls,
  controlClassName: styles.codexControl,
  gridClassName: styles.codexGrid,
  renderQuotaItems: renderCodexItems,
};

export const GEMINI_CLI_CONFIG: QuotaConfig<GeminiCliQuotaState, GeminiCliQuotaData> = {
  type: 'gemini-cli',
  i18nPrefix: 'gemini_cli_quota',
  cardIdleMessageKey: 'quota_management.card_idle_hint',
  filterFn: (file) =>
    isGeminiCliFile(file) && !isRuntimeOnlyAuthFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchGeminiCliQuota,
  fetchQuotaBatch: fetchGeminiCliQuotaBatch,
  storeSelector: (state) => state.geminiCliQuota,
  storeSetter: 'setGeminiCliQuota',
  buildLoadingState: () => ({
    status: 'loading',
    buckets: [],
    tierLabel: null,
    tierId: null,
    creditBalance: null,
  }),
  buildSuccessState: (data) => {
    const supplementarySnapshot = readGeminiCliSupplementarySnapshot(
      data.fileName,
      data.supplementaryRequestId
    );

    return {
      status: 'success',
      buckets: data.buckets,
      tierLabel: supplementarySnapshot.tierLabel ?? data.tierLabel,
      tierId: supplementarySnapshot.tierId ?? data.tierId,
      creditBalance: supplementarySnapshot.creditBalance ?? data.creditBalance,
    };
  },
  buildErrorState: (message, status) => ({
    status: 'error',
    buckets: [],
    error: message,
    errorStatus: status,
  }),
  cardClassName: styles.geminiCliCard,
  controlsClassName: styles.geminiCliControls,
  controlClassName: styles.geminiCliControl,
  gridClassName: styles.geminiCliGrid,
  renderQuotaItems: renderGeminiCliItems,
};

// Kimi quota functions

const parseKimiQuotaResult = (result: ApiCallResult, t: TFunction): KimiQuotaRow[] => {
  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseKimiUsagePayload(result.body ?? result.bodyText);
  if (!payload) {
    throw new Error(t('kimi_quota.empty_data'));
  }

  return buildKimiQuotaRows(payload);
};

const fetchKimiQuota = async (file: AuthFileItem, t: TFunction): Promise<KimiQuotaRow[]> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('kimi_quota.missing_auth_index'));
  }

  const result = await apiCallApi.request({
    authIndex,
    method: 'GET',
    url: KIMI_USAGE_URL,
    header: { ...KIMI_REQUEST_HEADERS },
  });

  return parseKimiQuotaResult(result, t);
};

const fetchKimiQuotaBatch = (files: AuthFileItem[], t: TFunction) =>
  executeQuotaBatch(
    files,
    (file, translate) => {
      const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
      if (!authIndex) throw new Error(translate('kimi_quota.missing_auth_index'));
      return {
        requests: [
          {
            key: 'usage',
            request: {
              authIndex,
              method: 'GET',
              url: KIMI_USAGE_URL,
              header: { ...KIMI_REQUEST_HEADERS },
            },
          },
        ],
        resolve: (results) => parseKimiQuotaResult(requireBatchValue(results, 'usage'), translate),
      };
    },
    t
  );

const renderKimiItems = (
  quota: KimiQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h } = React;
  const rows = quota.rows ?? [];

  if (rows.length === 0) {
    return h('div', { className: styleMap.quotaMessage }, t('kimi_quota.empty_data'));
  }

  return rows.map((row) => {
    const limit = row.limit;
    const used = row.used;
    const remaining =
      limit > 0
        ? Math.max(0, Math.min(100, Math.round(((limit - used) / limit) * 100)))
        : used > 0
          ? 0
          : null;
    const percentLabel = remaining === null ? '--' : `${remaining}%`;
    const rowLabel = row.labelKey
      ? t(row.labelKey, (row.labelParams ?? {}) as Record<string, string | number>)
      : (row.label ?? '');
    const resetLabel = formatKimiResetHint(t, row.resetHint);

    return h(
      'div',
      { key: row.id, className: styleMap.quotaRow },
      h(
        'div',
        { className: styleMap.quotaRowHeader },
        h('span', { className: styleMap.quotaModel }, rowLabel),
        h(
          'div',
          { className: styleMap.quotaMeta },
          h('span', { className: styleMap.quotaPercent }, percentLabel),
          resetLabel ? h('span', { className: styleMap.quotaReset }, resetLabel) : null
        )
      ),
      h(QuotaProgressBar, {
        percent: remaining,
        highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
        mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
      })
    );
  });
};

const toXaiRecord = (value: unknown): Record<string, unknown> | null => {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
};

const resolveXaiUserId = (file: AuthFileItem): string | null => {
  const metadata = toXaiRecord(file.metadata);
  const attributes = toXaiRecord(file.attributes);
  const oauth = toXaiRecord(file.oauth ?? metadata?.oauth ?? attributes?.oauth);
  const user = toXaiRecord(file.user ?? metadata?.user ?? attributes?.user);

  const candidates = [
    file.sub,
    file.subject,
    file.user_id,
    file.userId,
    metadata?.sub,
    metadata?.subject,
    metadata?.user_id,
    metadata?.userId,
    attributes?.sub,
    attributes?.subject,
    attributes?.user_id,
    attributes?.userId,
    oauth?.sub,
    oauth?.subject,
    user?.sub,
    user?.id,
  ];

  for (const candidate of candidates) {
    const userId = normalizeStringValue(candidate);
    if (userId) return userId;
  }

  return null;
};

const buildXaiRequestHeaders = (file: AuthFileItem): Record<string, string> => {
  const headers: Record<string, string> = { ...XAI_REQUEST_HEADERS };
  const userId = resolveXaiUserId(file);
  if (userId) {
    headers['x-userid'] = userId;
  }
  return headers;
};

const parseXaiBillingResult = (result: ApiCallResult): XaiBillingSummary | null => {
  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseXaiBillingPayload(result.body ?? result.bodyText);
  return buildXaiBillingSummary(payload?.config);
};

const requestXaiBilling = async (
  authIndex: string,
  url: string,
  header: Record<string, string>
): Promise<XaiBillingSummary | null> => {
  const result = await apiCallApi.request({
    authIndex,
    method: 'GET',
    url,
    header,
  });

  return parseXaiBillingResult(result);
};

const parseXaiPaidHealthResults = (
  profileResult: ApiCallResult | null,
  chatResult: ApiCallResult
): XaiBillingSummary => {
  if (chatResult.statusCode < 200 || chatResult.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(chatResult), chatResult.statusCode);
  }

  const profile =
    profileResult && profileResult.statusCode >= 200 && profileResult.statusCode < 300
      ? profileResult.body
      : null;
  return buildXaiPaidHealthSummary(profile);
};

const requestXaiPaidHealth = async (authIndex: string): Promise<XaiBillingSummary> => {
  const [profileRequest, chatRequest] = await Promise.allSettled([
    apiCallApi.request(
      {
        authIndex,
        method: 'GET',
        url: XAI_API_ME_URL,
        header: XAI_API_REQUEST_HEADERS,
      },
      { timeout: XAI_PAID_HEALTH_REQUEST_TIMEOUT_MS }
    ),
    apiCallApi.request(
      {
        authIndex,
        method: 'POST',
        url: XAI_API_CHAT_URL,
        header: {
          ...XAI_API_REQUEST_HEADERS,
          'Content-Type': 'application/json',
        },
        data: JSON.stringify({
          model: XAI_PAID_HEALTH_MODEL,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false,
        }),
      },
      { timeout: XAI_PAID_HEALTH_REQUEST_TIMEOUT_MS }
    ),
  ]);

  if (chatRequest.status === 'rejected') throw chatRequest.reason;
  return parseXaiPaidHealthResults(
    profileRequest.status === 'fulfilled' ? profileRequest.value : null,
    chatRequest.value
  );
};

const fetchXaiQuota = async (file: AuthFileItem, t: TFunction): Promise<XaiBillingSummary> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('xai_quota.missing_auth_index'));
  }

  if (isPaidXaiAuthFile(file)) {
    return requestXaiPaidHealth(authIndex);
  }

  const requestHeader = buildXaiRequestHeaders(file);
  const [weeklyResult, monthlyResult] = await Promise.allSettled([
    requestXaiBilling(authIndex, XAI_BILLING_WEEKLY_URL, requestHeader),
    requestXaiBilling(authIndex, XAI_BILLING_MONTHLY_URL, requestHeader),
  ]);
  const weeklySummary = weeklyResult.status === 'fulfilled' ? weeklyResult.value : null;
  const monthlySummary = monthlyResult.status === 'fulfilled' ? monthlyResult.value : null;
  const summary = mergeXaiBillingSummaries(weeklySummary, monthlySummary);
  if (summary) return summary;

  const billingError =
    weeklyResult.status === 'rejected' && monthlyResult.status === 'rejected'
      ? weeklyResult.reason
      : new Error(t('xai_quota.empty_data'));

  try {
    return await requestXaiPaidHealth(authIndex);
  } catch {
    // Preserve the original free billing error when neither account mode can be queried.
    throw billingError;
  }
};

const fetchXaiQuotaBatch = (files: AuthFileItem[], t: TFunction) =>
  executeQuotaBatch(
    files,
    (file, translate) => {
      const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
      if (!authIndex) throw new Error(translate('xai_quota.missing_auth_index'));

      if (isPaidXaiAuthFile(file)) {
        return {
          requests: [
            {
              key: 'profile',
              request: {
                authIndex,
                method: 'GET',
                url: XAI_API_ME_URL,
                header: XAI_API_REQUEST_HEADERS,
              },
            },
            {
              key: 'chat',
              request: {
                authIndex,
                method: 'POST',
                url: XAI_API_CHAT_URL,
                header: { ...XAI_API_REQUEST_HEADERS, 'Content-Type': 'application/json' },
                data: JSON.stringify({
                  model: XAI_PAID_HEALTH_MODEL,
                  messages: [{ role: 'user', content: 'ping' }],
                  max_tokens: 1,
                  stream: false,
                }),
              },
            },
          ],
          resolve: (results) => {
            const profile = results.get('profile');
            return parseXaiPaidHealthResults(
              profile?.status === 'success' ? profile.value : null,
              requireBatchValue(results, 'chat')
            );
          },
        };
      }

      // The paid health fallback sends a real chat request. Bulk refresh must not
      // speculatively execute it for credentials that are not identified as paid.
      const requestHeader = buildXaiRequestHeaders(file);
      return {
        requests: [
          {
            key: 'weekly',
            request: {
              authIndex,
              method: 'GET',
              url: XAI_BILLING_WEEKLY_URL,
              header: requestHeader,
            },
          },
          {
            key: 'monthly',
            request: {
              authIndex,
              method: 'GET',
              url: XAI_BILLING_MONTHLY_URL,
              header: requestHeader,
            },
          },
        ],
        resolve: (results) => {
          let weeklySummary: XaiBillingSummary | null = null;
          let monthlySummary: XaiBillingSummary | null = null;
          let weeklyError: unknown;
          let monthlyError: unknown;
          try {
            weeklySummary = parseXaiBillingResult(requireBatchValue(results, 'weekly'));
          } catch (error: unknown) {
            weeklyError = error;
          }
          try {
            monthlySummary = parseXaiBillingResult(requireBatchValue(results, 'monthly'));
          } catch (error: unknown) {
            monthlyError = error;
          }
          const summary = mergeXaiBillingSummaries(weeklySummary, monthlySummary);
          if (summary) return summary;
          if (weeklyError && monthlyError) throw weeklyError;
          throw new Error(translate('xai_quota.empty_data'));
        },
      };
    },
    t
  );

const formatUsdFromCents = (cents: number | null): string => {
  if (cents === null) return '--';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
};

const formatXaiRemainingAmount = (billing: XaiBillingSummary, t: TFunction): string => {
  const remainingCents =
    billing.monthlyLimitCents !== null && billing.includedUsedCents !== null
      ? Math.max(0, billing.monthlyLimitCents - billing.includedUsedCents)
      : null;
  const remaining = formatUsdFromCents(remainingCents);
  const limit = formatUsdFromCents(billing.monthlyLimitCents);
  if (billing.monthlyLimitCents === null) return remaining;
  return t('xai_quota.remaining_format', { remaining, limit });
};

const formatXaiOnDemandAmount = (billing: XaiBillingSummary): string => {
  const remainingCents =
    billing.onDemandCapCents !== null && billing.onDemandUsedCents !== null
      ? Math.max(0, billing.onDemandCapCents - billing.onDemandUsedCents)
      : null;
  const remaining = formatUsdFromCents(remainingCents);
  const cap = formatUsdFromCents(billing.onDemandCapCents);
  if (billing.onDemandCapCents === null) return remaining;
  return `${remaining} / ${cap}`;
};

const formatXaiPercent = (value: number | null): string => {
  if (value === null) return '--';
  return `${Math.round(value)}%`;
};

const XAI_SUPERGROK_LIMIT_CENTS = 15_000;
const XAI_SUPERGROK_HEAVY_LIMIT_CENTS = 150_000;

const resolveXaiPlan = (
  monthlyLimitCents: number | null
): { labelKey: string; premium: boolean } | null => {
  if (monthlyLimitCents === XAI_SUPERGROK_LIMIT_CENTS) {
    return { labelKey: 'plan_supergrok', premium: false };
  }
  if (monthlyLimitCents === XAI_SUPERGROK_HEAVY_LIMIT_CENTS) {
    return { labelKey: 'plan_supergrok_heavy', premium: true };
  }
  return null;
};

const renderXaiItems = (
  quota: XaiQuotaState,
  t: TFunction,
  helpers: QuotaRenderHelpers
): ReactNode => {
  const { styles: styleMap, QuotaProgressBar } = helpers;
  const { createElement: h, Fragment } = React;
  const billing = quota.billing;

  if (!billing) {
    return h('div', { className: styleMap.quotaMessage }, t('xai_quota.empty_data'));
  }

  if (billing.mode === 'paid-health') {
    return h(
      Fragment,
      null,
      h(
        'div',
        { className: styleMap.codexPlan },
        h('span', { className: styleMap.codexPlanLabel }, t('xai_quota.plan_label')),
        h('span', { className: styleMap.premiumPlanValue }, t('xai_quota.plan_paid'))
      ),
      h('div', { className: styleMap.quotaMessage }, t('xai_quota.paid_health'))
    );
  }

  const clampedUsed =
    billing.usedPercent === null ? null : Math.max(0, Math.min(100, billing.usedPercent));
  const remaining = clampedUsed === null ? null : Math.max(0, Math.min(100, 100 - clampedUsed));
  const percentLabel = formatXaiPercent(remaining);
  const amountLabel = formatXaiRemainingAmount(billing, t);
  const resetLabel = formatQuotaResetTime(billing.billingPeriodEnd);
  const onDemandCap = billing.onDemandCapCents ?? 0;
  const clampedOnDemandUsed =
    billing.onDemandUsedPercent === null
      ? null
      : Math.max(0, Math.min(100, billing.onDemandUsedPercent));
  const onDemandRemaining =
    clampedOnDemandUsed === null ? null : Math.max(0, Math.min(100, 100 - clampedOnDemandUsed));
  const onDemandPercentLabel = formatXaiPercent(onDemandRemaining);
  const onDemandAmountLabel = formatXaiOnDemandAmount(billing);
  const plan = resolveXaiPlan(billing.monthlyLimitCents);
  const weeklyUsed =
    billing.periodType === 'weekly' && billing.usagePercent !== null
      ? Math.max(0, Math.min(100, billing.usagePercent))
      : null;
  const weeklyRemaining = weeklyUsed === null ? null : Math.max(0, Math.min(100, 100 - weeklyUsed));
  const weeklyResetLabel = formatQuotaResetTime(billing.periodEnd);
  const hasWeeklyData =
    billing.periodType === 'weekly' &&
    (weeklyUsed !== null || Boolean(billing.periodEnd) || billing.productUsage.length > 0);
  const hasMonthlyData =
    billing.monthlyLimitCents !== null ||
    billing.usedCents !== null ||
    Boolean(billing.billingPeriodEnd);

  return h(
    Fragment,
    null,
    plan
      ? h(
          'div',
          { key: 'plan', className: styleMap.codexPlan },
          h('span', { className: styleMap.codexPlanLabel }, t('xai_quota.plan_label')),
          h(
            'span',
            { className: plan.premium ? styleMap.premiumPlanValue : styleMap.codexPlanValue },
            t(`xai_quota.${plan.labelKey}`)
          )
        )
      : null,
    hasWeeklyData
      ? h(
          'div',
          { key: 'weekly-limit', className: styleMap.quotaRow },
          h(
            'div',
            { className: styleMap.quotaRowHeader },
            h('span', { className: styleMap.quotaModel }, t('xai_quota.weekly_limit')),
            h(
              'div',
              { className: styleMap.quotaMeta },
              h(
                'span',
                { className: styleMap.quotaPercent },
                t('xai_quota.used_percent', {
                  percent: formatXaiPercent(weeklyUsed),
                })
              ),
              weeklyResetLabel !== '-'
                ? h(
                    'span',
                    { className: styleMap.quotaReset },
                    t('xai_quota.reset_at', {
                      time: weeklyResetLabel,
                    })
                  )
                : null
            )
          ),
          h(QuotaProgressBar, {
            percent: weeklyRemaining,
            highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
            mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
          })
        )
      : null,
    ...billing.productUsage.map((item) => {
      const used =
        item.usagePercent === null ? null : Math.max(0, Math.min(100, item.usagePercent));
      const remainingPercent = used === null ? null : Math.max(0, Math.min(100, 100 - used));
      return h(
        'div',
        { key: `product-${item.product}`, className: styleMap.quotaRow },
        h(
          'div',
          { className: styleMap.quotaRowHeader },
          h(
            'span',
            { className: styleMap.quotaModel },
            t('xai_quota.product_usage', { product: item.product })
          ),
          h(
            'div',
            { className: styleMap.quotaMeta },
            h(
              'span',
              { className: styleMap.quotaPercent },
              t('xai_quota.used_percent', {
                percent: formatXaiPercent(used),
              })
            )
          )
        ),
        h(QuotaProgressBar, {
          percent: remainingPercent,
          highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
          mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
        })
      );
    }),
    onDemandCap > 0
      ? h(
          'div',
          { key: 'pay-as-you-go', className: styleMap.quotaRow },
          h(
            'div',
            { className: styleMap.quotaRowHeader },
            h('span', { className: styleMap.quotaModel }, t('xai_quota.pay_as_you_go_label')),
            h(
              'div',
              { className: styleMap.quotaMeta },
              h('span', { className: styleMap.quotaPercent }, onDemandPercentLabel),
              h('span', { className: styleMap.quotaAmount }, onDemandAmountLabel)
            )
          ),
          h(QuotaProgressBar, {
            percent: onDemandRemaining,
            highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
            mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
          })
        )
      : h(
          'div',
          { key: 'pay-as-you-go', className: styleMap.codexPlan },
          h('span', { className: styleMap.codexPlanLabel }, t('xai_quota.pay_as_you_go_label')),
          h('span', { className: styleMap.codexPlanValue }, t('xai_quota.pay_as_you_go_disabled'))
        ),
    hasMonthlyData
      ? h(
          'div',
          { key: 'monthly-credits', className: styleMap.quotaRow },
          h(
            'div',
            { className: styleMap.quotaRowHeader },
            h('span', { className: styleMap.quotaModel }, t('xai_quota.monthly_credits')),
            h(
              'div',
              { className: styleMap.quotaMeta },
              h('span', { className: styleMap.quotaPercent }, percentLabel),
              h('span', { className: styleMap.quotaAmount }, amountLabel),
              resetLabel !== '-' ? h('span', { className: styleMap.quotaReset }, resetLabel) : null
            )
          ),
          h(QuotaProgressBar, {
            percent: remaining,
            highThreshold: QUOTA_PROGRESS_HIGH_THRESHOLD,
            mediumThreshold: QUOTA_PROGRESS_MEDIUM_THRESHOLD,
          })
        )
      : null
  );
};

export const KIMI_CONFIG: QuotaConfig<KimiQuotaState, KimiQuotaRow[]> = {
  type: 'kimi',
  i18nPrefix: 'kimi_quota',
  cardIdleMessageKey: 'quota_management.card_idle_hint',
  filterFn: (file) => isKimiFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchKimiQuota,
  fetchQuotaBatch: fetchKimiQuotaBatch,
  storeSelector: (state) => state.kimiQuota,
  storeSetter: 'setKimiQuota',
  buildLoadingState: () => ({ status: 'loading', rows: [] }),
  buildSuccessState: (rows) => ({ status: 'success', rows }),
  buildErrorState: (message, status) => ({
    status: 'error',
    rows: [],
    error: message,
    errorStatus: status,
  }),
  cardClassName: styles.kimiCard,
  controlsClassName: styles.kimiControls,
  controlClassName: styles.kimiControl,
  gridClassName: styles.kimiGrid,
  renderQuotaItems: renderKimiItems,
};

export const XAI_CONFIG: QuotaConfig<XaiQuotaState, XaiBillingSummary> = {
  type: 'xai',
  i18nPrefix: 'xai_quota',
  cardIdleMessageKey: 'quota_management.card_idle_hint',
  filterFn: (file) => isXaiFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchXaiQuota,
  fetchQuotaBatch: fetchXaiQuotaBatch,
  storeSelector: (state) => state.xaiQuota,
  storeSetter: 'setXaiQuota',
  buildLoadingState: () => ({ status: 'loading', billing: null }),
  buildSuccessState: (billing) => ({ status: 'success', billing }),
  buildErrorState: (message, status) => ({
    status: 'error',
    billing: null,
    error: message,
    errorStatus: status,
  }),
  cardClassName: styles.xaiCard,
  controlsClassName: styles.xaiControls,
  controlClassName: styles.xaiControl,
  gridClassName: styles.xaiGrid,
  renderQuotaItems: renderXaiItems,
};
