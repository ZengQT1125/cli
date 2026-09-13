import { apiClient } from './client';

export interface DashboardSummary {
  api_keys: number;
  auth_files: number;
  models: number;
  providers: {
    gemini: number;
    codex: number;
    claude: number;
    openai: number;
  };
}

export const dashboardApi = {
  getSummary: () => apiClient.get<DashboardSummary>('/custom/dashboard'),
};
