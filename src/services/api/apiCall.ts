/**
 * Generic API call helper (proxied via management API).
 */

import type { AxiosRequestConfig } from 'axios';
import { apiClient } from './client';

const API_CALL_BATCH_TIMEOUT_MS = 120_000;

export interface ApiCallRequest {
  authIndex?: string;
  method: string;
  url: string;
  header?: Record<string, string>;
  data?: string;
}

export type ApiCallBatchRequest = ApiCallRequest & {
  id: string;
};

export interface ApiCallResult<T = unknown> {
  statusCode: number;
  header: Record<string, string[]>;
  bodyText: string;
  body: T | null;
}

export type ApiCallBatchResult =
  | { id: string; status: 'success'; value: ApiCallResult }
  | { id: string; status: 'error'; error: { message: string; status: number } };

type ApiCallBatchWireResult = {
  id?: unknown;
  status_code?: unknown;
  header?: unknown;
  body?: unknown;
  error?: unknown;
  error_status?: unknown;
};

const normalizeBody = (input: unknown): { bodyText: string; body: unknown | null } => {
  if (input === undefined || input === null) {
    return { bodyText: '', body: null };
  }

  if (typeof input === 'string') {
    const text = input;
    const trimmed = text.trim();
    if (!trimmed) {
      return { bodyText: text, body: null };
    }
    try {
      return { bodyText: text, body: JSON.parse(trimmed) };
    } catch {
      return { bodyText: text, body: text };
    }
  }

  try {
    return { bodyText: JSON.stringify(input), body: input };
  } catch {
    return { bodyText: String(input), body: input };
  }
};

export const getApiCallErrorMessage = (result: ApiCallResult): string => {
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object';

  const status = result.statusCode;
  const body = result.body;
  const bodyText = result.bodyText;
  let message = '';

  if (isRecord(body)) {
    const errorValue = body.error;
    if (isRecord(errorValue) && typeof errorValue.message === 'string') {
      message = errorValue.message;
    } else if (typeof errorValue === 'string') {
      message = errorValue;
    }
    if (!message && typeof body.message === 'string') {
      message = body.message;
    }
  } else if (typeof body === 'string') {
    message = body;
  }

  if (!message && bodyText) {
    message = bodyText;
  }

  if (status && message) return `${status} ${message}`.trim();
  if (status) return `HTTP ${status}`;
  return message || 'Request failed';
};

export const apiCallApi = {
  request: async (payload: ApiCallRequest, config?: AxiosRequestConfig): Promise<ApiCallResult> => {
    const response = await apiClient.post<Record<string, unknown>>('/api-call', payload, config);
    const statusCode = Number(response?.status_code ?? response?.statusCode ?? 0);
    const header = (response?.header ?? response?.headers ?? {}) as Record<string, string[]>;
    const { bodyText, body } = normalizeBody(response?.body);

    return {
      statusCode,
      header,
      bodyText,
      body,
    };
  },

  batch: async (requests: ApiCallBatchRequest[]): Promise<ApiCallBatchResult[]> => {
    const response = await apiClient.post<{ results?: ApiCallBatchWireResult[] }>(
      '/custom/api-call/batch',
      { requests },
      { timeout: API_CALL_BATCH_TIMEOUT_MS }
    );
    const results = response?.results;
    if (!Array.isArray(results) || results.length !== requests.length) {
      throw new Error('Invalid batch API response');
    }

    return results.map((result, index): ApiCallBatchResult => {
      const expectedId = requests[index]?.id;
      if (typeof result?.id !== 'string' || result.id !== expectedId) {
        throw new Error('Invalid batch API response');
      }
      if (typeof result.error === 'string' && result.error) {
        return {
          id: result.id,
          status: 'error',
          error: {
            message: result.error,
            status: Number(result.error_status ?? 0),
          },
        };
      }

      const statusCode = Number(result.status_code ?? 0);
      const header =
        result.header && typeof result.header === 'object' && !Array.isArray(result.header)
          ? (result.header as Record<string, string[]>)
          : {};
      const { bodyText, body } = normalizeBody(result.body);
      return {
        id: result.id,
        status: 'success',
        value: { statusCode, header, bodyText, body },
      };
    });
  },
};
