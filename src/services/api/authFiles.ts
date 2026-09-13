/**
 * 认证文件与 OAuth 排除模型相关 API
 */

import type { AxiosProgressEvent } from 'axios';
import { apiClient } from './client';
import {
  buildAuthFilesUploadFormData,
  normalizeAuthFilesUploadResponse,
  toAuthFilesUploadProgress,
  type AuthFilesUploadProgressHandler,
  type AuthFilesUploadResult,
} from './authFilesUpload';
import { buildAuthFilesListParams, type AuthFilesListQuery } from '@/features/authFiles/listQuery';
import type { AuthFilesPageResponse, AuthFilesResponse } from '@/types/authFile';
import type { OAuthModelAliasEntry } from '@/types';

type StatusError = { status?: number };
type AuthFileStatusResponse = { status: string; disabled: boolean };
type AuthFileCooldownResetResponse = {
  status: string;
  auth_index: string;
  models: string[];
};
type DownloadedAuthFile = { blob: Blob; filename: string };
type AuthFilesUploadOptions = { onProgress?: AuthFilesUploadProgressHandler };
export type AuthFilesDeleteResult = {
  status?: string;
  deleted?: number;
  files?: string[];
  failed?: Array<{ name?: string; error?: string }>;
};

export type AuthFilesDeleteProgressEvent =
  | { type: 'start'; total: number }
  | {
      type: 'progress';
      index: number;
      total: number;
      name: string;
      deleted?: boolean;
      error?: string;
    }
  | {
      type: 'done';
      total: number;
      deleted: number;
      failed: number;
      files: string[];
      failed_items: Array<{ name?: string; error?: string }>;
    };

export type AuthFilesDeleteProgressHandler = (event: AuthFilesDeleteProgressEvent) => void;

type AuthFilesDeleteStreamOptions = {
  onProgress?: AuthFilesDeleteProgressHandler;
  signal?: AbortSignal;
};

const buildAuthFilesDeleteQuery = (params: Record<string, string | boolean | undefined>) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === false || value === '') return;
    search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `?${query}` : '';
};

const readAuthFilesDeleteStream = async (
  pathWithQuery: string,
  options: AuthFilesDeleteStreamOptions = {}
): Promise<AuthFilesDeleteResult> => {
  const { baseUrl, managementKey } = apiClient.getFetchContext();
  const resp = await fetch(`${baseUrl}${pathWithQuery}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${managementKey}`,
      Accept: 'application/x-ndjson',
    },
    signal: options.signal,
  });

  if (!resp.ok) {
    let message = `delete auth files failed: ${resp.status}`;
    try {
      const payload = (await resp.json()) as { error?: unknown; message?: unknown };
      if (typeof payload.error === 'string' && payload.error.trim()) {
        message = payload.error;
      } else if (typeof payload.message === 'string' && payload.message.trim()) {
        message = payload.message;
      }
    } catch {
      /* keep status message */
    }
    throw new Error(message);
  }

  if (!resp.body) {
    throw new Error('delete auth files stream unavailable');
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: AuthFilesDeleteResult = { status: 'ok', deleted: 0, files: [], failed: [] };

  const handleEvent = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    let event: AuthFilesDeleteProgressEvent;
    try {
      event = JSON.parse(trimmed) as AuthFilesDeleteProgressEvent;
    } catch {
      return;
    }
    options.onProgress?.(event);
    if (event.type === 'done') {
      result = {
        status: event.failed > 0 ? 'partial' : 'ok',
        deleted: event.deleted,
        files: event.files ?? [],
        failed: event.failed_items ?? [],
      };
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    lines.forEach(handleEvent);
  }
  if (buffer.trim()) {
    handleEvent(buffer);
  }

  return result;
};
export type AuthFileFieldsPatch = {
  prefix?: string;
  proxy_url?: string;
  headers?: Record<string, string>;
  priority?: number;
  excluded_models?: string[];
  disable_cooling?: boolean;
  websockets?: boolean;
  using_api?: boolean;
  note?: string;
  expired?: string;
};

export type AuthFileFieldsBatchUpdate = {
  name: string;
  fields: AuthFileFieldsPatch;
};

export type AuthFileFieldsBatchResult = {
  updated: number;
  failed: Array<{ name: string; error: string }>;
};

export type CodexCleanupEvent =
  | { type: 'start'; total: number; provider?: string }
  | {
      type: 'progress';
      index: number;
      total: number;
      name: string;
      auth_index: string;
      provider?: string;
      status_code?: number;
      deleted?: boolean;
      error?: string;
    }
  | { type: 'done'; total: number; deleted: number; provider?: string };

/** Providers that support validate-and-delete credential cleanup. */
export const AUTH_CLEANUP_SUPPORTED_TYPES = ['codex', 'xai'] as const;
export type AuthCleanupProvider = (typeof AUTH_CLEANUP_SUPPORTED_TYPES)[number];

export const isAuthCleanupProvider = (value: string): value is AuthCleanupProvider =>
  (AUTH_CLEANUP_SUPPORTED_TYPES as readonly string[]).includes(value);

const getStatusCode = (err: unknown): number | undefined => {
  if (!err || typeof err !== 'object') return undefined;
  if ('status' in err) return (err as StatusError).status;
  return undefined;
};

const normalizeOauthExcludedModels = (payload: unknown): Record<string, string[]> => {
  if (!payload || typeof payload !== 'object') return {};

  const record = payload as Record<string, unknown>;
  const source = record['oauth-excluded-models'] ?? record.items ?? payload;
  if (!source || typeof source !== 'object') return {};

  const result: Record<string, string[]> = {};

  Object.entries(source as Record<string, unknown>).forEach(([provider, models]) => {
    const key = String(provider ?? '')
      .trim()
      .toLowerCase();
    if (!key) return;

    const rawList = Array.isArray(models)
      ? models
      : typeof models === 'string'
        ? models.split(/[\n,]+/)
        : [];

    const seen = new Set<string>();
    const normalized: string[] = [];
    rawList.forEach((item) => {
      const trimmed = String(item ?? '').trim();
      if (!trimmed) return;
      const modelKey = trimmed.toLowerCase();
      if (seen.has(modelKey)) return;
      seen.add(modelKey);
      normalized.push(trimmed);
    });

    result[key] = normalized;
  });

  return result;
};

export const normalizeOauthModelAlias = (
  payload: unknown
): Record<string, OAuthModelAliasEntry[]> => {
  if (!payload || typeof payload !== 'object') return {};

  const record = payload as Record<string, unknown>;
  const source = record['oauth-model-alias'] ?? record.items ?? payload;
  if (!source || typeof source !== 'object') return {};

  const result: Record<string, OAuthModelAliasEntry[]> = {};

  Object.entries(source as Record<string, unknown>).forEach(([channel, mappings]) => {
    const key = String(channel ?? '')
      .trim()
      .toLowerCase();
    if (!key) return;
    if (!Array.isArray(mappings)) return;

    const seen = new Set<string>();
    const normalized = mappings
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const entry = item as Record<string, unknown>;
        const name = String(entry.name ?? entry.id ?? entry.model ?? '').trim();
        const alias = String(entry.alias ?? '').trim();
        if (!name || !alias) return null;
        const fork = entry.fork === true;
        const forceMappingValue = entry['force-mapping'] ?? entry.forceMapping;
        const normalizedEntry: OAuthModelAliasEntry = { name, alias };
        if (fork) normalizedEntry.fork = true;
        if (typeof forceMappingValue === 'boolean') {
          normalizedEntry.forceMapping = forceMappingValue;
        }
        return normalizedEntry;
      })
      .filter(Boolean)
      .filter((entry) => {
        const aliasEntry = entry as OAuthModelAliasEntry;
        const dedupeKey = `${aliasEntry.name.toLowerCase()}::${aliasEntry.alias.toLowerCase()}::${aliasEntry.fork ? '1' : '0'}`;
        if (seen.has(dedupeKey)) return false;
        seen.add(dedupeKey);
        return true;
      }) as OAuthModelAliasEntry[];

    if (normalized.length) {
      result[key] = normalized;
    }
  });

  return result;
};

export const serializeOauthModelAliases = (
  aliases: OAuthModelAliasEntry[]
): Array<Record<string, unknown>> =>
  aliases.map((entry) => {
    const payload: Record<string, unknown> = {
      name: entry.name,
      alias: entry.alias,
    };
    if (entry.fork) payload.fork = true;
    if (typeof entry.forceMapping === 'boolean') {
      payload['force-mapping'] = entry.forceMapping;
    }
    return payload;
  });

const OAUTH_MODEL_ALIAS_ENDPOINT = '/oauth-model-alias';

const readDownloadFilename = (contentDisposition: string | undefined, fallback: string): string => {
  const trimmed = String(contentDisposition ?? '').trim();
  if (!trimmed) return fallback;

  const utf8Match = trimmed.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      return utf8Match[1].trim();
    }
  }

  const plainMatch = trimmed.match(/filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/i);
  const candidate = plainMatch?.[1] ?? plainMatch?.[2];
  if (!candidate) return fallback;
  return candidate.trim();
};

const downloadAuthFileBlob = async (url: string, fallback: string): Promise<DownloadedAuthFile> => {
  const response = await apiClient.getRaw(url, { responseType: 'blob' });
  return {
    blob: response.data as Blob,
    filename: readDownloadFilename(response.headers['content-disposition'], fallback),
  };
};

// 手动刷新把 expired 写成「刚过期」，后端调度器据此立即重新走 OAuth 刷新流程
const MANUAL_REFRESH_EXPIRY_OFFSET_MS = 60_000;

export const buildManualRefreshExpiredAt = (nowMs = Date.now()): string =>
  new Date(nowMs - MANUAL_REFRESH_EXPIRY_OFFSET_MS).toISOString();

export const authFilesApi = {
  list: () => apiClient.get<AuthFilesResponse>('/auth-files'),

  listPage: (query: AuthFilesListQuery, signal?: AbortSignal) =>
    apiClient.get<AuthFilesPageResponse>('/auth-files', {
      params: buildAuthFilesListParams(query),
      signal,
    }),

  setStatus: (name: string, disabled: boolean) =>
    apiClient.patch<AuthFileStatusResponse>('/auth-files/status', { name, disabled }),

  clearCooldown: (authIndex: string) =>
    apiClient.post<AuthFileCooldownResetResponse>('/reset-quota', { auth_index: authIndex }),

  patchFields: (name: string, fields: AuthFileFieldsPatch) =>
    apiClient.patch('/auth-files/fields', { name, ...fields }),

  requestManualRefresh: (name: string) =>
    apiClient.patch('/auth-files/fields', {
      name,
      expired: buildManualRefreshExpiredAt(),
    }),

  patchFieldsBatch: (updates: AuthFileFieldsBatchUpdate[]) =>
    apiClient.patch<AuthFileFieldsBatchResult>('/auth-files/fields/batch', { updates }),

  upload: (file: File, options?: AuthFilesUploadOptions): Promise<AuthFilesUploadResult> =>
    authFilesApi.uploadBatch([file], options),

  uploadBatch: async (
    files: File[],
    options: AuthFilesUploadOptions = {}
  ): Promise<AuthFilesUploadResult> => {
    const formData = buildAuthFilesUploadFormData(files);
    const data = await apiClient.postForm<unknown>('/auth-files', formData, {
      onUploadProgress: options.onProgress
        ? (event: AxiosProgressEvent) => {
            options.onProgress?.(toAuthFilesUploadProgress(event));
          }
        : undefined,
    });
    return normalizeAuthFilesUploadResponse(data, files.length);
  },

  deleteFile: (name: string) => apiClient.delete(`/auth-files?name=${encodeURIComponent(name)}`),

  deleteAll: (options: AuthFilesDeleteStreamOptions = {}) =>
    readAuthFilesDeleteStream(`/auth-files${buildAuthFilesDeleteQuery({ all: true })}`, options),

  deleteFiltered: (query: AuthFilesListQuery, options: AuthFilesDeleteStreamOptions = {}) => {
    const { type, problem_only, disabled_only, enabled_only } = buildAuthFilesListParams(query);
    return readAuthFilesDeleteStream(
      `/auth-files${buildAuthFilesDeleteQuery({
        all: true,
        type,
        problem_only,
        disabled_only,
        enabled_only,
      })}`,
      options
    );
  },

  downloadFile: (name: string) =>
    downloadAuthFileBlob(`/auth-files/download?name=${encodeURIComponent(name)}`, name),

  downloadAll: () => downloadAuthFileBlob('/auth-files/download?all=true', 'auth-files.zip'),

  downloadText: async (name: string): Promise<string> => {
    const { blob } = await authFilesApi.downloadFile(name);
    return blob.text();
  },

  // OAuth 排除模型
  async getOauthExcludedModels(): Promise<Record<string, string[]>> {
    const data = await apiClient.get('/oauth-excluded-models');
    return normalizeOauthExcludedModels(data);
  },

  saveOauthExcludedModels: (provider: string, models: string[]) =>
    apiClient.patch('/oauth-excluded-models', { provider, models }),

  deleteOauthExcludedEntry: (provider: string) =>
    apiClient.delete(`/oauth-excluded-models?provider=${encodeURIComponent(provider)}`),

  replaceOauthExcludedModels: (map: Record<string, string[]>) =>
    apiClient.put('/oauth-excluded-models', normalizeOauthExcludedModels(map)),

  // OAuth 模型别名
  async getOauthModelAlias(): Promise<Record<string, OAuthModelAliasEntry[]>> {
    const data = await apiClient.get(OAUTH_MODEL_ALIAS_ENDPOINT);
    return normalizeOauthModelAlias(data);
  },

  saveOauthModelAlias: async (channel: string, aliases: OAuthModelAliasEntry[]) => {
    const normalizedChannel = String(channel ?? '')
      .trim()
      .toLowerCase();
    const normalizedAliases =
      normalizeOauthModelAlias({ [normalizedChannel]: aliases })[normalizedChannel] ?? [];
    await apiClient.patch(OAUTH_MODEL_ALIAS_ENDPOINT, {
      channel: normalizedChannel,
      aliases: serializeOauthModelAliases(normalizedAliases),
    });
  },

  deleteOauthModelAlias: async (channel: string) => {
    const normalizedChannel = String(channel ?? '')
      .trim()
      .toLowerCase();

    try {
      await apiClient.patch(OAUTH_MODEL_ALIAS_ENDPOINT, {
        channel: normalizedChannel,
        aliases: [],
      });
    } catch (err: unknown) {
      const status = getStatusCode(err);
      if (status !== 405) throw err;
      await apiClient.delete(
        `${OAUTH_MODEL_ALIAS_ENDPOINT}?channel=${encodeURIComponent(normalizedChannel)}`
      );
    }
  },

  // 获取认证凭证支持的模型
  async getModelsForAuthFile(
    name: string
  ): Promise<{ id: string; display_name?: string; type?: string; owned_by?: string }[]> {
    const data = await apiClient.get<Record<string, unknown>>(
      `/auth-files/models?name=${encodeURIComponent(name)}`
    );
    const models = data.models ?? data['models'];
    return Array.isArray(models)
      ? (models as { id: string; display_name?: string; type?: string; owned_by?: string }[])
      : [];
  },

  // 获取指定 channel 的模型定义
  async getModelDefinitions(
    channel: string
  ): Promise<{ id: string; display_name?: string; type?: string; owned_by?: string }[]> {
    const normalizedChannel = String(channel ?? '')
      .trim()
      .toLowerCase();
    if (!normalizedChannel) return [];
    const data = await apiClient.get<Record<string, unknown>>(
      `/model-definitions/${encodeURIComponent(normalizedChannel)}`
    );
    const models = data.models ?? data['models'];
    return Array.isArray(models)
      ? (models as { id: string; display_name?: string; type?: string; owned_by?: string }[])
      : [];
  },

  // 按凭证类型清理无效凭证（NDJSON 流式）。provider 默认 codex（兼容旧后端）。
  async codexCleanup(
    onEvent: (event: CodexCleanupEvent) => void,
    signal?: AbortSignal,
    provider: string = 'codex'
  ): Promise<void> {
    const { baseUrl, managementKey } = apiClient.getFetchContext();
    const normalizedProvider = provider.trim().toLowerCase() || 'codex';
    const resp = await fetch(`${baseUrl}/custom/codex-cleanup`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${managementKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ provider: normalizedProvider }),
      signal,
    });
    if (!resp.ok || !resp.body) {
      throw new Error(`auth-cleanup failed: ${resp.status}`);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          onEvent(JSON.parse(trimmed) as CodexCleanupEvent);
        } catch {
          /* skip malformed lines */
        }
      }
    }
    if (buffer.trim()) {
      try {
        onEvent(JSON.parse(buffer.trim()) as CodexCleanupEvent);
      } catch {
        /* skip */
      }
    }
  },
};
