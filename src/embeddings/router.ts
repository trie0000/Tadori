// 埋め込みの provider 振り分け。
//   - provider='claude' … Voyage AI (ブラウザ直接)
//   - provider='corp'   … Azure OpenAI 互換 (中継サーバ経由)
// クエリ側・ドキュメント側いずれもここを通す。

import type { RuntimeSettings } from '../api/aiSettings';
import { embedTexts } from './client';
import { embedVoyageQuery, embedVoyageDocs } from './voyage';
import { recordEmbed } from '../usage/tracker';
import { estimateTokens } from '../usage/pricing';

function recordTexts(texts: string[]): void {
  let t = 0;
  for (const x of texts) t += estimateTokens(x);
  recordEmbed(t);
}

export async function embedQueryFor(text: string, s: RuntimeSettings): Promise<Float32Array> {
  recordTexts([text]);
  if (s.provider === 'claude') {
    const [v] = await embedVoyageQuery(text, s);
    return v;
  }
  const [v] = await embedTexts([text], s, { apiKey: s.apiKey });
  return v;
}

export async function embedDocsFor(texts: string[], s: RuntimeSettings, signal?: AbortSignal): Promise<Float32Array[]> {
  recordTexts(texts);
  if (s.provider === 'claude') {
    return embedVoyageDocs(texts, s, signal);
  }
  return embedTexts(texts, s, { apiKey: s.apiKey }, signal);
}
