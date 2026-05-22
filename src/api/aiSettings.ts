// AI / Tadori 設定の永続化 (localStorage)。
//
// ★ AI 接続設定は Spira と「共通」にする ★
// Tadori は Spira と同じ SharePoint オリジン上で動くため localStorage を共有する。
// 中継サーバ URL・API キー・モデル等は Spira と同じ `spira:ai:*` キーに保存し、
// どちらのツールで設定しても両方に効くようにする (二重設定の手間をなくす)。
//
// provider:
//   - 'corp'   … 社内 AI (Azure OpenAI 互換) を中継サーバ経由で利用 (本番)
//   - 'claude' … Anthropic Claude API + Voyage 埋め込みを直接利用 (開発者モード限定)
//
// 開発者モード OFF のときは provider が 'claude' でも 'corp' に丸める (Spira と同じ)。

import { isDeveloperMode } from '../utils/devMode';

export type Provider = 'corp' | 'claude';

// Spira と共有するキー
const AI = {
  provider:    'spira:ai:provider',
  corpBaseUrl: 'spira:ai:corp:base-url',   // = 中継サーバのベース URL
  corpKey:     'spira:ai:corp:key',
  corpModel:   'spira:ai:corp:model',       // チャット(回答)モデルのデプロイ名
  claudeKey:   'spira:ai:claude:key',
  claudeModel: 'spira:ai:claude:model',
} as const;

// Tadori 固有キー
const TD = {
  embeddingDeployment: 'tadori:embedding-deployment',
  apiVersion:          'tadori:api-version',
  dimensions:          'tadori:dimensions',
  listTitle:           'tadori:list-title',
  mlAddresses:         'tadori:ml-addresses',
  ingestIntervalSec:   'tadori:ingest-interval-sec',
  voyageKey:           'tadori:voyage:key',
  voyageModel:         'tadori:voyage:model',
} as const;

export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-5';
export const DEFAULT_VOYAGE_MODEL = 'voyage-3.5-lite';

function get(k: string, fallback = ''): string {
  try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; }
}
function set(k: string, v: string): void {
  try { localStorage.setItem(k, v); } catch { /* quota */ }
}

export interface RuntimeSettings {
  provider: Provider;
  // corp (Azure OpenAI 互換 / 中継サーバ)
  relayBaseUrl: string;
  apiKey: string;
  chatDeployment: string;
  embeddingDeployment: string;
  apiVersion: string;
  dimensions: number;
  // claude (開発者モード)
  claudeApiKey: string;
  claudeModel: string;
  // voyage 埋め込み (開発者モード)
  voyageApiKey: string;
  voyageModel: string;
  // tadori 取り込み
  listTitle: string;
  mlAddresses: string[];
  ingestIntervalSec: number;
}

/** provider を解決。開発者モード OFF のときは 'claude' を 'corp' に丸める。 */
export function resolveProvider(): Provider {
  const raw = get(AI.provider);
  if (raw === 'claude' && isDeveloperMode()) return 'claude';
  return 'corp';
}

export function loadSettings(): RuntimeSettings {
  return {
    provider: resolveProvider(),
    relayBaseUrl: get(AI.corpBaseUrl, 'http://localhost:18080'),
    apiKey: get(AI.corpKey),
    chatDeployment: get(AI.corpModel, 'gpt-4o-mini'),
    embeddingDeployment: get(TD.embeddingDeployment, 'text-embedding-3-small'),
    apiVersion: get(TD.apiVersion, '2024-02-01'),
    dimensions: Number(get(TD.dimensions, '256')) || 256,
    claudeApiKey: get(AI.claudeKey),
    claudeModel: get(AI.claudeModel, DEFAULT_CLAUDE_MODEL),
    voyageApiKey: get(TD.voyageKey),
    voyageModel: get(TD.voyageModel, DEFAULT_VOYAGE_MODEL),
    listTitle: get(TD.listTitle, '受信メールリスト'),
    mlAddresses: parseAddressList(get(TD.mlAddresses)),
    ingestIntervalSec: Number(get(TD.ingestIntervalSec, '30')) || 30,
  };
}

export function saveSettings(s: Partial<RuntimeSettings>): void {
  if (s.provider !== undefined) set(AI.provider, s.provider);
  if (s.relayBaseUrl !== undefined) set(AI.corpBaseUrl, s.relayBaseUrl);
  if (s.apiKey !== undefined) set(AI.corpKey, s.apiKey);
  if (s.chatDeployment !== undefined) set(AI.corpModel, s.chatDeployment);
  if (s.embeddingDeployment !== undefined) set(TD.embeddingDeployment, s.embeddingDeployment);
  if (s.apiVersion !== undefined) set(TD.apiVersion, s.apiVersion);
  if (s.dimensions !== undefined) set(TD.dimensions, String(s.dimensions));
  if (s.claudeApiKey !== undefined) set(AI.claudeKey, s.claudeApiKey.trim());
  if (s.claudeModel !== undefined) set(AI.claudeModel, s.claudeModel);
  if (s.voyageApiKey !== undefined) set(TD.voyageKey, s.voyageApiKey.trim());
  if (s.voyageModel !== undefined) set(TD.voyageModel, s.voyageModel);
  if (s.listTitle !== undefined) set(TD.listTitle, s.listTitle);
  if (s.mlAddresses !== undefined) set(TD.mlAddresses, s.mlAddresses.join('\n'));
  if (s.ingestIntervalSec !== undefined) set(TD.ingestIntervalSec, String(s.ingestIntervalSec));
}

export function parseAddressList(raw: string): string[] {
  return raw.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
}
