// Outlook からの既存メールインポート。
// ローカル relay (tadori-ai-relay.ps1 の /tadori/outlook/import) が Outlook COM で
// To/Cc 条件 + 受信期間でメールを読み出して返す。それを埋め込み → List 保存する。

import type { RuntimeSettings } from '../api/aiSettings';
import { ingestToSegments } from '../db/writer';

export interface OutlookMail {
  messageId: string;
  subject: string;
  from: string;
  to: string[];
  cc: string[];
  date: string;
  body: string;
}

export interface ImportFilter {
  to: string[];
  cc: string[];
  since?: string; // ISO date (YYYY-MM-DD)
  until?: string;
  max?: number;
}

export interface ImportResult {
  fetched: number;
  added: number;
  skipped: number;
  segments: number;
}

/** relay 経由で Outlook からメールを取得。 */
export async function fetchOutlookMails(relayBaseUrl: string, f: ImportFilter): Promise<OutlookMail[]> {
  if (!relayBaseUrl) throw new Error('中継サーバ URL が未設定です (AI 接続で設定)');
  const p = new URLSearchParams();
  if (f.to.length) p.set('to', f.to.join(';'));
  if (f.cc.length) p.set('cc', f.cc.join(';'));
  if (f.since) p.set('since', f.since);
  if (f.until) p.set('until', f.until);
  if (f.max) p.set('max', String(f.max));

  const url = `${relayBaseUrl.replace(/\/+$/, '')}/tadori/outlook/import?${p.toString()}`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    const b = await res.text().catch(() => '');
    throw new Error(`Outlook インポート失敗: HTTP ${res.status} ${b.slice(0, 300)}`);
  }
  const json = await res.json() as { mails?: OutlookMail[] };
  return json.mails ?? [];
}

/** Outlook から取得 → 埋め込み → セグメント書き込み (ベクトルDB)。 */
export async function importFromOutlook(
  s: RuntimeSettings,
  siteUrl: string,
  f: ImportFilter,
  onProgress?: (phase: 'fetch' | 'embed' | 'store', done: number, total: number) => void,
): Promise<ImportResult> {
  onProgress?.('fetch', 0, 0);
  const mails = await fetchOutlookMails(s.relayBaseUrl, f);
  if (mails.length === 0) return { fetched: 0, added: 0, skipped: 0, segments: 0 };

  const r = await ingestToSegments(
    mails.map(m => ({
      messageId: m.messageId || `<${m.date}|${m.from}>`,
      subject: m.subject || '(件名なし)',
      from: m.from,
      to: m.to ?? [],
      cc: m.cc ?? [],
      date: m.date,
      body: m.body,
    })),
    s,
    siteUrl,
    (phase, done, total) => onProgress?.(phase === 'upload' ? 'store' : phase === 'sync' ? 'fetch' : 'embed', done, total),
  );

  return { fetched: mails.length, added: r.added, skipped: r.skipped, segments: r.segments };
}
