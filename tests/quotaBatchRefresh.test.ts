import { afterEach, describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { CLAUDE_CONFIG, KIMI_CONFIG, XAI_CONFIG } from '@/components/quota/quotaConfigs';
import { apiCallApi, type ApiCallBatchRequest, type ApiCallBatchResult } from '@/services/api';
import {
  CLAUDE_PROFILE_URL,
  CLAUDE_USAGE_URL,
  KIMI_USAGE_URL,
  XAI_API_CHAT_URL,
  XAI_API_ME_URL,
  XAI_BILLING_MONTHLY_URL,
  XAI_BILLING_WEEKLY_URL,
} from '@/utils/quota';

const t = ((key: string) => key) as unknown as TFunction;
const originalBatch = apiCallApi.batch;

describe('quota batch refresh', () => {
  afterEach(() => {
    apiCallApi.batch = originalBatch;
  });

  test('refreshes multiple credentials through one batch API call and keeps partial errors', async () => {
    const calls: ApiCallBatchRequest[][] = [];
    apiCallApi.batch = async (requests): Promise<ApiCallBatchResult[]> => {
      calls.push(requests);
      return requests.map((request) =>
        request.authIndex === 'kimi:bad'
          ? {
              id: request.id,
              status: 'error' as const,
              error: { message: 'request failed', status: 502 },
            }
          : {
              id: request.id,
              status: 'success' as const,
              value: {
                statusCode: 200,
                header: {},
                bodyText: '{"usage":{"used":20,"limit":100}}',
                body: { usage: { used: 20, limit: 100 } },
              },
            }
      );
    };

    const results = await KIMI_CONFIG.fetchQuotaBatch(
      [
        { name: 'good.json', type: 'kimi', auth_index: 'kimi:good' },
        { name: 'bad.json', type: 'kimi', auth_index: 'kimi:bad' },
      ],
      t
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(2);
    expect(calls[0]?.map(({ authIndex, method, url }) => ({ authIndex, method, url }))).toEqual([
      { authIndex: 'kimi:good', method: 'GET', url: KIMI_USAGE_URL },
      { authIndex: 'kimi:bad', method: 'GET', url: KIMI_USAGE_URL },
    ]);
    expect(results).toEqual([
      {
        name: 'good.json',
        status: 'success',
        data: [
          {
            id: 'summary',
            labelKey: 'kimi_quota.weekly_limit',
            used: 20,
            limit: 100,
            resetHint: undefined,
          },
        ],
      },
      {
        name: 'bad.json',
        status: 'error',
        error: expect.objectContaining({ message: 'request failed', status: 502 }),
      },
    ]);
  });

  test('associates multiple upstream responses with the right credential in one batch', async () => {
    const calls: ApiCallBatchRequest[][] = [];
    apiCallApi.batch = async (requests): Promise<ApiCallBatchResult[]> => {
      calls.push(requests);
      return requests.map((request) => {
        const body =
          request.url === CLAUDE_USAGE_URL
            ? {
                five_hour: {
                  utilization: request.authIndex === 'claude:first' ? 25 : 75,
                  resets_at: '2026-07-29T12:00:00Z',
                },
              }
            : {
                account:
                  request.authIndex === 'claude:first'
                    ? { has_claude_pro: true }
                    : { has_claude_pro: false, has_claude_max: false },
              };
        return {
          id: request.id,
          status: 'success' as const,
          value: {
            statusCode: 200,
            header: {},
            bodyText: JSON.stringify(body),
            body,
          },
        };
      });
    };

    const results = await CLAUDE_CONFIG.fetchQuotaBatch(
      [
        { name: 'first.json', type: 'claude', auth_index: 'claude:first' },
        { name: 'second.json', type: 'claude', auth_index: 'claude:second' },
      ],
      t
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toHaveLength(4);
    expect(calls[0]?.map((request) => request.url)).toEqual([
      CLAUDE_USAGE_URL,
      CLAUDE_PROFILE_URL,
      CLAUDE_USAGE_URL,
      CLAUDE_PROFILE_URL,
    ]);
    expect(results).toEqual([
      expect.objectContaining({
        name: 'first.json',
        status: 'success',
        data: expect.objectContaining({
          planType: 'plan_pro',
          windows: [expect.objectContaining({ usedPercent: 25 })],
        }),
      }),
      expect.objectContaining({
        name: 'second.json',
        status: 'success',
        data: expect.objectContaining({
          planType: 'plan_free',
          windows: [expect.objectContaining({ usedPercent: 75 })],
        }),
      }),
    ]);
  });

  test('does not send speculative paid xAI chat probes for unclassified credentials', async () => {
    const calls: ApiCallBatchRequest[][] = [];
    apiCallApi.batch = async (requests): Promise<ApiCallBatchResult[]> => {
      calls.push(requests);
      return requests.map((request) => {
        const body =
          request.url === XAI_BILLING_WEEKLY_URL
            ? { config: { currentPeriod: { type: 'weekly' }, creditUsagePercent: 10 } }
            : { config: { monthlyLimit: { val: 10000 }, used: { val: 1000 } } };
        return {
          id: request.id,
          status: 'success' as const,
          value: {
            statusCode: 200,
            header: {},
            bodyText: JSON.stringify(body),
            body,
          },
        };
      });
    };

    const results = await XAI_CONFIG.fetchQuotaBatch(
      [{ name: 'unknown.json', type: 'xai', auth_index: 'xai:unknown' }],
      t
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.map((request) => request.url)).toEqual([
      XAI_BILLING_WEEKLY_URL,
      XAI_BILLING_MONTHLY_URL,
    ]);
    expect(calls[0]?.map((request) => request.url)).not.toContain(XAI_API_ME_URL);
    expect(calls[0]?.map((request) => request.url)).not.toContain(XAI_API_CHAT_URL);
    expect(results[0]).toEqual(
      expect.objectContaining({
        name: 'unknown.json',
        status: 'success',
        data: expect.objectContaining({ mode: 'billing', usagePercent: 10 }),
      })
    );
  });
});
