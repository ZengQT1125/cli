import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi, type AuthFileFieldsPatch } from '@/services/api';
import type { AuthFileCooldown, AuthFileItem } from '@/types';
import { useNotificationStore } from '@/stores';
import {
  applyAuthFileWebsockets,
  parseDisableCoolingValue,
  readAuthFileWebsockets,
  supportsAuthFileWebsockets,
} from '@/features/authFiles/websockets';
import {
  applyAuthFileUsingApi,
  readAuthFileUsingApi,
  supportsAuthFileUsingApi,
} from '@/features/authFiles/usingApi';
import {
  normalizeExcludedModels,
  parseExcludedModelsText,
  parsePriorityValue,
} from '@/features/authFiles/constants';

type AuthFileHeaders = Record<string, string>;
type AuthFileHeadersErrorKey =
  | 'auth_files.headers_invalid_json'
  | 'auth_files.headers_invalid_object'
  | 'auth_files.headers_invalid_value';

export type PrefixProxyEditorField =
  | 'prefix'
  | 'proxyUrl'
  | 'priority'
  | 'excludedModelsText'
  | 'disableCooling'
  | 'websockets'
  | 'usingApi'
  | 'note'
  | 'headersText';

type AuthFileContentErrorKey =
  | 'auth_files.prefix_proxy_invalid_json'
  | 'auth_files.prefix_proxy_html_challenge';

export type PrefixProxyEditorFieldValue = string | boolean;

export type PrefixProxyEditorState = {
  fileName: string;
  fileInfoText: string;
  authIndex: string;
  cooldowns: AuthFileCooldown[];
  cooldownResetting: boolean;
  providerKey: string;
  supportsWebsockets: boolean;
  supportsUsingApi: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  originalText: string;
  rawText: string;
  invalidContentPreview: string;
  json: Record<string, unknown> | null;
  prefix: string;
  proxyUrl: string;
  priority: string;
  excludedModelsText: string;
  disableCooling: string;
  websockets: boolean;
  websocketsTouched: boolean;
  usingApi: boolean;
  usingApiTouched: boolean;
  note: string;
  noteTouched: boolean;
  headersText: string;
  headersTouched: boolean;
  headersError: string | null;
};

export type UseAuthFilesPrefixProxyEditorOptions = {
  disableControls: boolean;
  loadFiles: () => Promise<void>;
};

export type UseAuthFilesPrefixProxyEditorResult = {
  prefixProxyEditor: PrefixProxyEditorState | null;
  prefixProxyUpdatedText: string;
  prefixProxyDirty: boolean;
  openPrefixProxyEditor: (file: AuthFileItem) => Promise<void>;
  closePrefixProxyEditor: () => void;
  handlePrefixProxyChange: (
    field: PrefixProxyEditorField,
    value: PrefixProxyEditorFieldValue
  ) => void;
  handlePrefixProxySave: () => Promise<void>;
  handleCooldownReset: () => Promise<void>;
};

const INVALID_CONTENT_PREVIEW_LIMIT = 1000;

const readActiveCooldowns = (file: AuthFileItem): AuthFileCooldown[] => {
  if (!Array.isArray(file.cooldowns)) return [];
  const now = Date.now();
  return file.cooldowns.filter((cooldown) => {
    if (!cooldown || cooldown.status !== 'cooling') return false;
    const nextRetryAt = Date.parse(cooldown.next_retry_after);
    return Number.isFinite(nextRetryAt) && nextRetryAt > now;
  });
};

const clearCooldownsFromFileInfo = (text: string): string => {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return JSON.stringify({ ...parsed, cooldowns: [] }, null, 2);
  } catch {
    return text;
  }
};

const buildInvalidContentPreview = (text: string): string => {
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (trimmed.length <= INVALID_CONTENT_PREVIEW_LIMIT) return trimmed;
  return `${trimmed.slice(0, INVALID_CONTENT_PREVIEW_LIMIT)}\n...`;
};

const getAuthFileContentErrorKey = (text: string): AuthFileContentErrorKey => {
  const head = text.trimStart().slice(0, 4096).toLowerCase();
  const looksLikeHtml =
    head.startsWith('<!doctype html') ||
    head.startsWith('<html') ||
    head.includes('<head') ||
    head.includes('<body');
  const looksLikeChallenge =
    head.includes('cf_chl') ||
    head.includes('__cf_chl_tk') ||
    head.includes('challenge-platform') ||
    head.includes('cloudflare');

  return looksLikeHtml || looksLikeChallenge
    ? 'auth_files.prefix_proxy_html_challenge'
    : 'auth_files.prefix_proxy_invalid_json';
};

const buildInvalidAuthFileContentState = (
  text: string,
  resolveError: (key: AuthFileContentErrorKey) => string
): Pick<
  PrefixProxyEditorState,
  'loading' | 'error' | 'rawText' | 'originalText' | 'invalidContentPreview'
> => ({
  loading: false,
  error: resolveError(getAuthFileContentErrorKey(text)),
  rawText: text,
  originalText: text,
  invalidContentPreview: buildInvalidContentPreview(text),
});

const isRecordObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const validateHeadersValue = (value: unknown): AuthFileHeadersErrorKey | null => {
  if (!isRecordObject(value)) {
    return 'auth_files.headers_invalid_object';
  }
  return Object.values(value).every((item) => typeof item === 'string')
    ? null
    : 'auth_files.headers_invalid_value';
};

const parseHeadersText = (
  text: string
): { value: AuthFileHeaders | null; errorKey: AuthFileHeadersErrorKey | null } => {
  const trimmed = text.trim();
  if (!trimmed) {
    return { value: null, errorKey: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { value: null, errorKey: 'auth_files.headers_invalid_json' };
  }

  const errorKey = validateHeadersValue(parsed);
  if (errorKey) {
    return { value: null, errorKey };
  }

  return { value: parsed as AuthFileHeaders, errorKey: null };
};

const normalizeTextField = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const hasKeys = (value: AuthFileFieldsPatch | null): boolean =>
  Boolean(value && Object.keys(value).length > 0);

const normalizeHeaders = (value: unknown): AuthFileHeaders => {
  if (!isRecordObject(value)) return {};

  return Object.entries(value).reduce<AuthFileHeaders>((result, [key, rawValue]) => {
    if (typeof rawValue !== 'string') return result;
    const name = key.trim();
    const headerValue = rawValue.trim();
    if (!name || !headerValue) return result;
    result[name] = headerValue;
    return result;
  }, {});
};

const buildHeadersPatch = (
  originalHeaders: AuthFileHeaders,
  nextHeaders: AuthFileHeaders
): AuthFileHeaders | undefined => {
  const patch: AuthFileHeaders = {};
  const nextNames = new Set(Object.keys(nextHeaders));

  Object.entries(nextHeaders).forEach(([name, value]) => {
    if (originalHeaders[name] !== value) {
      patch[name] = value;
    }
  });

  Object.keys(originalHeaders).forEach((name) => {
    if (!nextNames.has(name)) {
      patch[name] = '';
    }
  });

  return Object.keys(patch).length > 0 ? patch : undefined;
};

const applyHeadersPatch = (
  value: Record<string, unknown>,
  headersPatch: AuthFileHeaders | undefined
) => {
  if (!headersPatch) return;

  const nextHeaders = normalizeHeaders(value.headers);
  Object.entries(headersPatch).forEach(([name, rawValue]) => {
    const headerName = name.trim();
    if (!headerName) return;
    const headerValue = rawValue.trim();
    if (!headerValue) {
      delete nextHeaders[headerName];
      return;
    }
    nextHeaders[headerName] = headerValue;
  });

  if (Object.keys(nextHeaders).length > 0) {
    value.headers = nextHeaders;
  } else {
    delete value.headers;
  }
};

const sameStrings = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const buildAuthFileFieldsPatch = (
  editor: PrefixProxyEditorState,
  resolveHeadersError: (key: AuthFileHeadersErrorKey) => string
): AuthFileFieldsPatch => {
  const original = editor.json ?? {};
  const patch: AuthFileFieldsPatch = {};

  const originalPrefix = normalizeTextField(original.prefix);
  const nextPrefix = editor.prefix.trim();
  if (nextPrefix !== originalPrefix) {
    patch.prefix = nextPrefix;
  }

  const originalProxyURL = normalizeTextField(original.proxy_url);
  const nextProxyURL = editor.proxyUrl.trim();
  if (nextProxyURL !== originalProxyURL) {
    patch.proxy_url = nextProxyURL;
  }

  const originalPriority = parsePriorityValue(original.priority);
  const priorityText = editor.priority.trim();
  const nextPriority = parsePriorityValue(priorityText);
  if (!priorityText) {
    if (originalPriority !== undefined && originalPriority !== 0) {
      patch.priority = 0;
    }
  } else if (nextPriority !== undefined && nextPriority !== originalPriority) {
    patch.priority = nextPriority;
  }

  const originalExcludedModels = normalizeExcludedModels(original.excluded_models);
  const nextExcludedModels = parseExcludedModelsText(editor.excludedModelsText);
  if (!sameStrings(nextExcludedModels, originalExcludedModels)) {
    patch.excluded_models = nextExcludedModels;
  }

  const originalDisableCooling = parseDisableCoolingValue(original.disable_cooling);
  const nextDisableCooling = parseDisableCoolingValue(editor.disableCooling);
  if (nextDisableCooling !== originalDisableCooling) {
    if (nextDisableCooling !== undefined) {
      patch.disable_cooling = nextDisableCooling;
    } else if (originalDisableCooling === true) {
      patch.disable_cooling = false;
    }
  }

  if (editor.noteTouched) {
    const originalNote = normalizeTextField(original.note);
    const nextNote = editor.note.trim();
    if (nextNote !== originalNote) {
      patch.note = nextNote;
    }
  }

  if (editor.supportsWebsockets && editor.websocketsTouched) {
    const originalWebsockets = readAuthFileWebsockets(original);
    const nextWebsockets = Boolean(editor.websockets);
    if (nextWebsockets !== originalWebsockets) {
      patch.websockets = nextWebsockets;
    }
  }

  if (editor.supportsUsingApi && editor.usingApiTouched) {
    const originalUsingApi = readAuthFileUsingApi(original);
    const nextUsingApi = Boolean(editor.usingApi);
    if (nextUsingApi !== originalUsingApi) {
      patch.using_api = nextUsingApi;
    }
  }

  if (editor.headersTouched) {
    const { value: parsedHeaders, errorKey } = parseHeadersText(editor.headersText);
    if (errorKey) {
      throw new Error(resolveHeadersError(errorKey));
    }
    const headersPatch = buildHeadersPatch(
      normalizeHeaders(original.headers),
      normalizeHeaders(parsedHeaders ?? {})
    );
    if (headersPatch) {
      patch.headers = headersPatch;
    }
  }

  return patch;
};

const buildPrefixProxyUpdatedText = (
  editor: PrefixProxyEditorState | null,
  resolveHeadersError: (key: AuthFileHeadersErrorKey) => string
): string => {
  if (!editor?.json) return editor?.rawText ?? '';
  const patch = buildAuthFileFieldsPatch(editor, resolveHeadersError);
  let next: Record<string, unknown> = { ...editor.json };
  if (patch.prefix !== undefined) {
    if (patch.prefix) {
      next.prefix = patch.prefix;
    } else {
      delete next.prefix;
    }
  }
  if (patch.proxy_url !== undefined) {
    if (patch.proxy_url) {
      next.proxy_url = patch.proxy_url;
    } else {
      delete next.proxy_url;
    }
  }

  if (patch.priority !== undefined) {
    if (patch.priority === 0) {
      delete next.priority;
    } else {
      next.priority = patch.priority;
    }
  }

  if (patch.excluded_models !== undefined) {
    if (patch.excluded_models.length > 0) {
      next.excluded_models = patch.excluded_models;
    } else {
      delete next.excluded_models;
    }
  }

  if (patch.disable_cooling !== undefined) {
    next.disable_cooling = patch.disable_cooling;
  }

  if (patch.note !== undefined) {
    if (patch.note) {
      next.note = patch.note;
    } else {
      delete next.note;
    }
  }

  applyHeadersPatch(next, patch.headers);

  if (patch.websockets !== undefined) {
    next = applyAuthFileWebsockets(next, patch.websockets);
  }
  if (patch.using_api !== undefined) {
    next = applyAuthFileUsingApi(next, patch.using_api);
  }
  return JSON.stringify(next);
};

export function useAuthFilesPrefixProxyEditor(
  options: UseAuthFilesPrefixProxyEditorOptions
): UseAuthFilesPrefixProxyEditorResult {
  const { disableControls, loadFiles } = options;
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);

  const [prefixProxyEditor, setPrefixProxyEditor] = useState<PrefixProxyEditorState | null>(null);

  const hasBlockingValidationError = Boolean(
    prefixProxyEditor?.headersTouched && prefixProxyEditor.headersError
  );
  const prefixProxyUpdatedText =
    prefixProxyEditor?.json && !hasBlockingValidationError
      ? buildPrefixProxyUpdatedText(prefixProxyEditor, (key) => t(key))
      : '';

  const prefixProxyPatch =
    prefixProxyEditor?.json && !hasBlockingValidationError
      ? buildAuthFileFieldsPatch(prefixProxyEditor, (key) => t(key))
      : null;

  const prefixProxyDirty = hasKeys(prefixProxyPatch);

  const closePrefixProxyEditor = () => {
    setPrefixProxyEditor(null);
  };

  const openPrefixProxyEditor = async (file: AuthFileItem) => {
    const name = file.name;
    const normalizedType = String(file.type ?? '')
      .trim()
      .toLowerCase();
    const normalizedProvider = String(file.provider ?? '')
      .trim()
      .toLowerCase();
    const providerKey =
      supportsAuthFileWebsockets(normalizedType) || supportsAuthFileUsingApi(normalizedType)
        ? normalizedType
        : normalizedProvider;
    const supportsWebsockets = supportsAuthFileWebsockets(providerKey);
    const supportsUsingApi = supportsAuthFileUsingApi(providerKey);

    if (disableControls) return;
    if (prefixProxyEditor?.fileName === name) {
      setPrefixProxyEditor(null);
      return;
    }

    setPrefixProxyEditor({
      fileName: name,
      fileInfoText: JSON.stringify(file, null, 2),
      authIndex: String(file['auth_index'] ?? file.authIndex ?? '').trim(),
      cooldowns: readActiveCooldowns(file),
      cooldownResetting: false,
      providerKey,
      supportsWebsockets,
      supportsUsingApi,
      loading: true,
      saving: false,
      error: null,
      originalText: '',
      rawText: '',
      invalidContentPreview: '',
      json: null,
      prefix: '',
      proxyUrl: '',
      priority: '',
      excludedModelsText: '',
      disableCooling: '',
      websockets: false,
      websocketsTouched: false,
      usingApi: false,
      usingApiTouched: false,
      note: '',
      noteTouched: false,
      headersText: '',
      headersTouched: false,
      headersError: null,
    });

    try {
      const rawText = await authFilesApi.downloadText(name);
      const trimmed = rawText.trim();

      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed) as unknown;
      } catch {
        setPrefixProxyEditor((prev) => {
          if (!prev || prev.fileName !== name) return prev;
          return {
            ...prev,
            ...buildInvalidAuthFileContentState(rawText, (key) => t(key)),
          };
        });
        return;
      }

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setPrefixProxyEditor((prev) => {
          if (!prev || prev.fileName !== name) return prev;
          return {
            ...prev,
            ...buildInvalidAuthFileContentState(rawText, (key) => t(key)),
          };
        });
        return;
      }

      const json = { ...(parsed as Record<string, unknown>) };
      if (supportsWebsockets) {
        const normalizedWebsockets = readAuthFileWebsockets(json);
        delete json.websocket;
        json.websockets = normalizedWebsockets;
      }
      const originalText = JSON.stringify(json);
      const prefix = typeof json.prefix === 'string' ? json.prefix : '';
      const proxyUrl = typeof json.proxy_url === 'string' ? json.proxy_url : '';
      const priority = parsePriorityValue(json.priority);
      const excludedModels = normalizeExcludedModels(json.excluded_models);
      const disableCoolingValue = parseDisableCoolingValue(json.disable_cooling);
      const websocketsValue = supportsWebsockets ? readAuthFileWebsockets(json) : false;
      const usingApi = supportsUsingApi ? readAuthFileUsingApi(json) : false;
      const note = typeof json.note === 'string' ? json.note : '';
      const headers = json.headers;
      let headersText = '';
      let headersError: string | null = null;
      if (headers !== undefined) {
        headersText = JSON.stringify(headers, null, 2);
        const { errorKey } = parseHeadersText(headersText);
        headersError = errorKey ? t(errorKey) : null;
      }

      setPrefixProxyEditor((prev) => {
        if (!prev || prev.fileName !== name) return prev;
        return {
          ...prev,
          loading: false,
          originalText,
          rawText: originalText,
          invalidContentPreview: '',
          json,
          prefix,
          proxyUrl,
          priority: priority !== undefined ? String(priority) : '',
          excludedModelsText: excludedModels.join('\n'),
          disableCooling:
            disableCoolingValue === undefined ? '' : disableCoolingValue ? 'true' : 'false',
          websockets: websocketsValue,
          websocketsTouched: false,
          usingApi,
          usingApiTouched: false,
          note,
          noteTouched: false,
          headersText,
          headersTouched: false,
          headersError,
          error: null,
        };
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.download_failed');
      setPrefixProxyEditor((prev) => {
        if (!prev || prev.fileName !== name) return prev;
        return { ...prev, loading: false, error: errorMessage, rawText: '' };
      });
      showNotification(`${t('notification.download_failed')}: ${errorMessage}`, 'error');
    }
  };

  const handlePrefixProxyChange = (
    field: PrefixProxyEditorField,
    value: PrefixProxyEditorFieldValue
  ) => {
    setPrefixProxyEditor((prev) => {
      if (!prev) return prev;
      if (field === 'prefix') return { ...prev, prefix: String(value) };
      if (field === 'proxyUrl') return { ...prev, proxyUrl: String(value) };
      if (field === 'priority') return { ...prev, priority: String(value) };
      if (field === 'excludedModelsText') return { ...prev, excludedModelsText: String(value) };
      if (field === 'disableCooling') return { ...prev, disableCooling: String(value) };
      if (field === 'websockets') {
        return { ...prev, websockets: Boolean(value), websocketsTouched: true };
      }
      if (field === 'usingApi') {
        return { ...prev, usingApi: Boolean(value), usingApiTouched: true };
      }
      if (field === 'note') return { ...prev, note: String(value), noteTouched: true };
      if (field === 'headersText') {
        const headersText = String(value);
        const { errorKey } = parseHeadersText(headersText);
        return {
          ...prev,
          headersText,
          headersTouched: true,
          headersError: errorKey ? t(errorKey) : null,
        };
      }
      return prev;
    });
  };

  const handlePrefixProxySave = async () => {
    if (!prefixProxyEditor?.json) return;
    if (!prefixProxyDirty) return;

    const name = prefixProxyEditor.fileName;
    let payload: AuthFileFieldsPatch;
    try {
      payload = buildAuthFileFieldsPatch(prefixProxyEditor, (key) => t(key));
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Invalid format';
      showNotification(errorMessage, 'error');
      return;
    }
    if (!hasKeys(payload)) return;

    setPrefixProxyEditor((prev) => {
      if (!prev || prev.fileName !== name) return prev;
      return { ...prev, saving: true };
    });

    try {
      await authFilesApi.patchFields(name, payload);
      showNotification(t('auth_files.prefix_proxy_saved_success', { name }), 'success');
      await loadFiles();
      setPrefixProxyEditor(null);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '';
      showNotification(`${t('notification.update_failed')}: ${errorMessage}`, 'error');
      setPrefixProxyEditor((prev) => {
        if (!prev || prev.fileName !== name) return prev;
        return { ...prev, saving: false };
      });
    }
  };

  const handleCooldownReset = async () => {
    if (!prefixProxyEditor || prefixProxyEditor.cooldownResetting) return;
    if (!prefixProxyEditor.authIndex || prefixProxyEditor.cooldowns.length === 0) return;

    const { authIndex, fileName } = prefixProxyEditor;
    setPrefixProxyEditor((prev) => {
      if (!prev || prev.fileName !== fileName) return prev;
      return { ...prev, cooldownResetting: true };
    });

    try {
      await authFilesApi.clearCooldown(authIndex);
      setPrefixProxyEditor((prev) => {
        if (!prev || prev.fileName !== fileName) return prev;
        return {
          ...prev,
          cooldowns: [],
          cooldownResetting: false,
          fileInfoText: clearCooldownsFromFileInfo(prev.fileInfoText),
        };
      });
      showNotification(t('auth_files.clear_cooldown_success', { name: fileName }), 'success');
      await loadFiles();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '';
      showNotification(`${t('auth_files.clear_cooldown_failed')}: ${errorMessage}`, 'error');
      setPrefixProxyEditor((prev) => {
        if (!prev || prev.fileName !== fileName) return prev;
        return { ...prev, cooldownResetting: false };
      });
    }
  };

  return {
    prefixProxyEditor,
    prefixProxyUpdatedText,
    prefixProxyDirty,
    openPrefixProxyEditor,
    closePrefixProxyEditor,
    handlePrefixProxyChange,
    handlePrefixProxySave,
    handleCooldownReset,
  };
}

