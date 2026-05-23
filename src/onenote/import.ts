// OneNote 取り込み: relay 経由で COM から階層/ページを取得し、チャンク化して
// ベクトル DB に投入する。メール取り込み (outlook/import.ts) と同じ作法。

import type { IngestMail } from '../db/writer';
import { splitIntoChunks } from '../lib/chunk';

export interface OneNotePage {
  pageId: string;
  title: string;
  notebook: string;
  section: string;
  lastModified: string;
  body: string;
}
export interface OneNoteSection { id: string; name: string; pages: { id: string; name: string; lastModified?: string }[]; }
export interface OneNoteNotebook { id: string; name: string; sections: OneNoteSection[]; }

function trim(s: string): string { return s.replace(/\/+$/, ''); }

/** relay から OneNote の階層 (ノートブック → セクション → ページ) を取得。 */
export async function fetchOneNoteHierarchy(relayBaseUrl: string, signal?: AbortSignal): Promise<OneNoteNotebook[]> {
  if (!relayBaseUrl) throw new Error('中継サーバ URL が未設定です (AI 接続で設定)');
  const res = await fetch(`${trim(relayBaseUrl)}/tadori/onenote/hierarchy`, { method: 'GET', signal });
  if (!res.ok) {
    const b = await res.text().catch(() => '');
    throw new Error(`OneNote 階層取得失敗: HTTP ${res.status} ${b.slice(0, 300)}`);
  }
  const json = await res.json() as { ok?: boolean; notebooks?: OneNoteNotebook[] };
  return json.notebooks ?? [];
}

/** 指定したページ ID 群の本文を抽出 (ids 省略時は max まで全部)。 */
export async function fetchOneNotePages(
  relayBaseUrl: string,
  opts: { ids?: string[]; since?: string; max?: number },
  signal?: AbortSignal,
): Promise<OneNotePage[]> {
  if (!relayBaseUrl) throw new Error('中継サーバ URL が未設定です (AI 接続で設定)');
  const p = new URLSearchParams();
  if (opts.ids?.length) p.set('ids', opts.ids.join(';'));
  if (opts.since) p.set('since', opts.since);
  if (opts.max) p.set('max', String(opts.max));
  const res = await fetch(`${trim(relayBaseUrl)}/tadori/onenote/pages?${p.toString()}`, { method: 'GET', signal });
  if (!res.ok) {
    const b = await res.text().catch(() => '');
    throw new Error(`OneNote ページ取得失敗: HTTP ${res.status} ${b.slice(0, 300)}`);
  }
  const json = await res.json() as { pages?: OneNotePage[] };
  return json.pages ?? [];
}

/** OneNote ページ群をチャンク化して IngestMail 配列に変換 (既存パイプラインに流す)。 */
export function pagesToIngestMails(pages: OneNotePage[]): IngestMail[] {
  const out: IngestMail[] = [];
  for (const p of pages) {
    const docPath = `onenote://${p.notebook}/${p.section}/${p.title}`;
    const chunks = splitIntoChunks(p.body, { maxChars: 800, overlap: 80 });
    if (chunks.length === 0) continue;
    chunks.forEach((c, i) => {
      out.push({
        messageId: `${p.pageId}#${i}`,
        internetMessageId: '',
        conversationId: p.pageId,   // 親ドキュメント = ページ ID
        kind: 'onenote',
        chunkIdx: i,
        chunkCount: chunks.length,
        docPath,
        subject: c.heading ? `${p.title} - ${c.heading}` : p.title,
        from: `${p.notebook} › ${p.section}`,
        to: [],
        cc: [],
        date: p.lastModified || new Date().toISOString(),
        body: c.text,
        isHtml: false,
      });
    });
  }
  return out;
}

/** OneNote 上でページを表示。 */
export async function openOneNotePage(relayBaseUrl: string, pageId: string, signal?: AbortSignal): Promise<void> {
  if (!relayBaseUrl) throw new Error('中継サーバ URL が未設定です');
  if (!pageId) throw new Error('pageId がありません');
  const res = await fetch(`${trim(relayBaseUrl)}/tadori/onenote/open?id=${encodeURIComponent(pageId)}`, { method: 'GET', signal });
  if (!res.ok) {
    const b = await res.text().catch(() => '');
    throw new Error(`OneNote 表示失敗: HTTP ${res.status} ${b.slice(0, 200)}`);
  }
}
