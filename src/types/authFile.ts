/**
 * 认证文件相关类型
 * 基于原项目 src/modules/auth-files.js
 */

export type AuthFileType =
  | 'qwen'
  | 'kimi'
  | 'gemini'
  | 'gemini-cli'
  | 'aistudio'
  | 'claude'
  | 'codex'
  | 'antigravity'
  | 'xai'
  | 'iflow'
  | 'vertex'
  | 'empty'
  | 'unknown';

export interface AuthFileRequestError {
  message?: string;
  code?: string;
  status_code?: number;
  timestamp?: string;
}

export interface AuthFileCooldown {
  model?: string;
  status: string;
  reason?: string;
  next_retry_after: string;
}

export interface AuthFileItem {
  name: string;
  type?: AuthFileType | string;
  provider?: string;
  size?: number;
  authIndex?: string | number | null;
  runtimeOnly?: boolean | string;
  disabled?: boolean;
  unavailable?: boolean;
  status?: string;
  statusMessage?: string;
  cooldowns?: AuthFileCooldown[];
  last_request_error?: AuthFileRequestError;
  lastRefresh?: string | number;
  modified?: number;
  [key: string]: unknown;
}

export interface AuthFilesResponse {
  files: AuthFileItem[];
  total?: number;
}

export interface AuthFilesPageResponse extends AuthFilesResponse {
  total: number;
  page: number;
  page_size: number;
  types: string[];
  type_counts: Record<string, number>;
  enabled_type_counts: Record<string, number>;
}
