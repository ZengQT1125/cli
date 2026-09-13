import { describe, expect, spyOn, test } from 'bun:test';
import { dashboardApi, type DashboardSummary } from '@/services/api/dashboard';
import { apiClient } from '@/services/api/client';

describe('dashboardApi.getSummary', () => {
  test('loads all dashboard counts with one custom management request', async () => {
    const summary: DashboardSummary = {
      api_keys: 3,
      auth_files: 361,
      models: 40,
      providers: {
        gemini: 1,
        codex: 2,
        claude: 3,
        openai: 4,
      },
    };
    const getSpy = spyOn(apiClient, 'get').mockResolvedValue(summary);

    try {
      await expect(dashboardApi.getSummary()).resolves.toEqual(summary);
      expect(getSpy).toHaveBeenCalledTimes(1);
      expect(getSpy).toHaveBeenCalledWith('/custom/dashboard');
    } finally {
      getSpy.mockRestore();
    }
  });
});
