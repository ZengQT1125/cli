import { describe, expect, spyOn, test } from 'bun:test';
import { apiCallApi } from '@/services/api/apiCall';
import { apiClient } from '@/services/api/client';

describe('apiCallApi.batch', () => {
  test('sends one custom management request and preserves item failures', async () => {
    const postSpy = spyOn(apiClient, 'post').mockResolvedValue({
      results: [
        {
          id: 'first',
          status_code: 200,
          header: { Date: ['Wed, 29 Jul 2026 00:00:00 GMT'] },
          body: '{"ok":true}',
        },
        {
          id: 'second',
          status_code: 0,
          header: null,
          body: '',
          error: 'request failed',
          error_status: 502,
        },
      ],
    });

    try {
      const requests = [
        { id: 'first', authIndex: 'auth-1', method: 'GET', url: 'https://example.com/one' },
        { id: 'second', authIndex: 'auth-2', method: 'GET', url: 'https://example.com/two' },
      ];
      const results = await apiCallApi.batch(requests);

      expect(postSpy).toHaveBeenCalledTimes(1);
      expect(postSpy).toHaveBeenCalledWith(
        '/custom/api-call/batch',
        { requests },
        { timeout: 120_000 }
      );
      expect(results).toEqual([
        {
          id: 'first',
          status: 'success',
          value: {
            statusCode: 200,
            header: { Date: ['Wed, 29 Jul 2026 00:00:00 GMT'] },
            bodyText: '{"ok":true}',
            body: { ok: true },
          },
        },
        {
          id: 'second',
          status: 'error',
          error: { message: 'request failed', status: 502 },
        },
      ]);
    } finally {
      postSpy.mockRestore();
    }
  });

  test('rejects a response whose ids do not match the request order', async () => {
    const postSpy = spyOn(apiClient, 'post').mockResolvedValue({
      results: [{ id: 'wrong', status_code: 200, header: {}, body: '{}' }],
    });

    try {
      await expect(
        apiCallApi.batch([{ id: 'expected', method: 'GET', url: 'https://example.com' }])
      ).rejects.toThrow('Invalid batch API response');
    } finally {
      postSpy.mockRestore();
    }
  });
});
