// AI / Tadori 設定の永続化 (localStorage)。
//
// ★ AI 接続設定は Spira と「共通」にする ★
// Tadori は Spira と同じ SharePoint オリジン上で動くため localStorage を共有する。
// 中継サーバ URL・API キー・モデル等は Spira と同じ `spira:ai:corp:*` キーに保存し、
// どちらのツールで設定しても両方に効くようにする (二重設定の手間をなくす)。
//
// Tadori 固有の設定 (対象 ML / 次元数 / 同期間隔 / チャットデプロイ) は
// `tadori:*` キーに保存する。

const AI = {
  // Spira と共有するキー (prefix を合わせること)
  corpBaseUrl: 'spira:ai:corp:base-url',   // = 中継サーバのベース URL
  corpKey: 'spira:ai:corp:key',
  corpModel: 'spira:ai:corp:model',         // チャット(回答)モデルのデプロイ名
} as const;

const TD = {
  embeddingDeployment: 'tadori:embedding-deployment',
  apiVersion: 'tadori:api-version',
  dimensions: 'tadori:dimensions',
  listTitle: 'tadori:list-title',
  mlAddresses: 'tadori:ml-addresses',
  ingestIntervalSec: 'tadori:ingest-interval-sec',
} as const;

function get(k: string, fallback = ''): string {
  try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; }
}
function set(k: string, v: string): void {
  try { localStorage.setItem(k, v); } catch { /* quota */ }
}

export interface RuntimeSettings {
  relayBaseUrl: string;
  apiKey: string;
  chatDeployment: string;
  embeddingDeployment: string;
  apiVersion: string;
  dimensions: number;
  listTitle: string;
  mlAddresses: string[];
  ingestIntervalSec: number;
}

export function loadSettings(): RuntimeSettings {
  return {
    relayBaseUrl: get(AI.corpBaseUrl, 'http://localhost:18080'),
    apiKey: get(AI.corpKey),
    chatDeployment: get(AI.corpModel, 'gpt-4o-mini'),
    embeddingDeployment: get(TD.embeddingDeployment, 'text-embedding-3-small'),
    apiVersion: get(TD.apiVersion, '2024-02-01'),
    dimensions: Number(get(TD.dimensions, '256')) || 256,
    listTitle: get(TD.listTitle, '受信メールリスト'),
    mlAddresses: parseAddressList(get(TD.mlAddresses)),
    ingestIntervalSec: Number(get(TD.ingestIntervalSec, '30')) || 30,
  };
}

export function saveSettings(s: Partial<RuntimeSettings>): void {
  if (s.relayBaseUrl !== undefined) set(AI.corpBaseUrl, s.relayBaseUrl);
  if (s.apiKey !== undefined) set(AI.corpKey, s.apiKey);
  if (s.chatDeployment !== undefined) set(AI.corpModel, s.chatDeployment);
  if (s.embeddingDeployment !== undefined) set(TD.embeddingDeployment, s.embeddingDeployment);
  if (s.apiVersion !== undefined) set(TD.apiVersion, s.apiVersion);
  if (s.dimensions !== undefined) set(TD.dimensions, String(s.dimensions));
  if (s.listTitle !== undefined) set(TD.listTitle, s.listTitle);
  if (s.mlAddresses !== undefined) set(TD.mlAddresses, s.mlAddresses.join('\n'));
  if (s.ingestIntervalSec !== undefined) set(TD.ingestIntervalSec, String(s.ingestIntervalSec));
}

export function parseAddressList(raw: string): string[] {
  return raw.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
}
