import { describe, expect, spyOn, test } from 'bun:test';
import { authFilesApi, buildManualRefreshExpiredAt } from '@/services/api/authFiles';
import { apiClient } from '@/services/api/client';
import { supportsAuthFileManualRefresh } from '@/features/authFiles/constants';

describe('buildManualRefreshExpiredAt', () => {
  test('returns an ISO timestamp 60 seconds before the given time', () => {
    const now = Date.parse('2026-07-27T00:00:00.000Z');

    expect(buildManualRefreshExpiredAt(now)).toBe('2026-07-26T23:59:00.000Z');
  });
});

describe('authFilesApi.requestManualRefresh', () => {
  test('patches the auth file with an already-expired timestamp', async () => {
    const patchSpy = spyOn(apiClient, 'patch').mockResolvedValue({ status: 'ok' });

    try {
      await authFilesApi.requestManualRefresh('claude-1.json');

      expect(patchSpy).toHaveBeenCalledTimes(1);
      const [url, payload] = patchSpy.mock.calls[0] as [string, { name: string; expired: string }];
      expect(url).toBe('/auth-files/fields');
      expect(payload.name).toBe('claude-1.json');
      expect(Date.parse(payload.expired)).toBeLessThan(Date.now());
    } finally {
      patchSpy.mockRestore();
    }
  });
});

describe('authFilesApi.clearCooldown', () => {
  test('resets local cooldown by auth index', async () => {
    const postSpy = spyOn(apiClient, 'post').mockResolvedValue({
      status: 'ok',
      auth_index: 'auth-1',
      models: ['gpt-5.4'],
    });

    try {
      await authFilesApi.clearCooldown('auth-1');

      expect(postSpy).toHaveBeenCalledWith('/reset-quota', { auth_index: 'auth-1' });
    } finally {
      postSpy.mockRestore();
    }
  });
});

describe('supportsAuthFileManualRefresh', () => {
  test('accepts OAuth providers whose credentials refresh via the expired metadata field', () => {
    for (const provider of ['antigravity', 'claude', 'codex', 'kimi', 'xai']) {
      expect(supportsAuthFileManualRefresh(provider)).toBe(true);
    }
    expect(supportsAuthFileManualRefresh('  Claude ')).toBe(true);
    expect(supportsAuthFileManualRefresh('XAI')).toBe(true);
  });

  test('rejects providers without a refreshable OAuth credential', () => {
    for (const provider of ['gemini-cli', 'gemini', 'qwen', 'iflow', 'aistudio', '']) {
      expect(supportsAuthFileManualRefresh(provider)).toBe(false);
    }
    expect(supportsAuthFileManualRefresh(undefined)).toBe(false);
    expect(supportsAuthFileManualRefresh(null)).toBe(false);
  });
});
