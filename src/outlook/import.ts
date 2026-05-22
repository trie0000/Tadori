// Outlook からの既存メールインポート。
// ローカル relay (tadori-ai-relay.ps1 の /tadori/outlook/import) が Outlook COM で
// To/Cc 条件 + 受信期間でメールを読み出して返す。取得は UI 側でまず件数を出してから
// ingestToSegments に渡す (UI 二段階フロー)。

import type { IngestMail } from '../db/writer';

export interface OutlookMail {
  messageId: string;
  /** RFC2822 Internet-Message-Id。Outlook クライアントでの再検索に使う。 */
  internetMessageId?: string;
  /** スレッド識別子 (Outlook ConversationID)。経緯要約のグルーピング用。 */
  conversationId?: string;
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  date: string;
  body: string;
  isHtml?: boolean;
}

export interface ImportFilter {
  to: string[];
  cc: string[];
  since?: string; // ISO date (YYYY-MM-DD)
  until?: string;
  max?: number;
}

/** relay 経由で Outlook からメールを取得。 */
export async function fetchOutlookMails(relayBaseUrl: string, f: ImportFilter, signal?: AbortSignal): Promise<OutlookMail[]> {
  if (!relayBaseUrl) throw new Error('中継サーバ URL が未設定です (AI 接続で設定)');
  const p = new URLSearchParams();
  if (f.to.length) p.set('to', f.to.join(';'));
  if (f.cc.length) p.set('cc', f.cc.join(';'));
  if (f.since) p.set('since', f.since);
  if (f.until) p.set('until', f.until);
  if (f.max) p.set('max', String(f.max));

  const url = `${relayBaseUrl.replace(/\/+$/, '')}/tadori/outlook/import?${p.toString()}`;
  const res = await fetch(url, { method: 'GET', signal });
  if (!res.ok) {
    const b = await res.text().catch(() => '');
    throw new Error(`Outlook インポート失敗: HTTP ${res.status} ${b.slice(0, 300)}`);
  }
  const json = await res.json() as { mails?: OutlookMail[] };
  return json.mails ?? [];
}

/** relay 経由で Outlook クライアント上に該当メールを表示する。
 *  internetMessageId で受信トレイ配下を検索し、見つかればインスペクタを開く。 */
export async function openMailInOutlook(relayBaseUrl: string, internetMessageId: string, signal?: AbortSignal): Promise<void> {
  if (!relayBaseUrl) throw new Error('中継サーバ URL が未設定です (AI 接続で設定)');
  if (!internetMessageId) throw new Error('このメールには Internet-Message-Id がありません');
  const url = `${relayBaseUrl.replace(/\/+$/, '')}/tadori/outlook/open?id=${encodeURIComponent(internetMessageId)}`;
  const res = await fetch(url, { method: 'GET', signal });
  if (!res.ok) {
    const b = await res.text().catch(() => '');
    throw new Error(`Outlook 表示失敗: HTTP ${res.status} ${b.slice(0, 300)}`);
  }
  const json = await res.json() as { ok?: boolean; found?: boolean };
  if (!json.found) throw new Error('Outlook 内に該当メールが見つかりませんでした');
}

/** OutlookMail → ベクトルDB 書き込み用の IngestMail に変換。 */
export function toIngestMails(mails: OutlookMail[]): IngestMail[] {
  return mails.map(m => ({
    messageId: m.messageId || `<${m.date}|${m.from}>`,
    internetMessageId: m.internetMessageId || m.messageId || '',
    conversationId: m.conversationId || '',
    subject: m.subject || '(件名なし)',
    from: m.from,
    to: m.to ?? [],
    cc: m.cc ?? [],
    date: m.date,
    body: m.body,
    isHtml: !!m.isHtml,
  }));
}
