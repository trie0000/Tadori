// RAG 回答合成クライアント。中継サーバ経由で Azure OpenAI chat/completions を叩く。
// 上位メールを文脈に詰め、出典 [n] 付きの回答をストリーミングで返す。

import type { RuntimeSettings } from '../api/aiSettings';
import { streamClaude } from '../api/aiClaude';
import { recordChat } from '../usage/tracker';
import { chatYen, estimateTokens } from '../usage/pricing';

export interface ChatUsage { model: string; inputTokens: number; outputTokens: number; yen: number; }

export interface RagSource {
  /** 1 始まりの出典番号 (回答中の [n] と対応)。 */
  n: number;
  subject: string;
  from: string;
  date: string;
  body: string;
}

const SYSTEM_PROMPT = [
  'あなたは社内メーリングリストの過去ログに基づいて回答するアシスタントです。',
  '与えられた「参照メール」だけを根拠に、日本語で回答してください。',
  '直前までの会話があれば文脈として踏まえ、フォローアップ質問にも答えてください。',
  '',
  '出力の1行目には必ず「TITLE: <この質問を表す15文字以内の短い見出し>」だけを書き、',
  '2行目以降に回答本文を書いてください。見出しに記号・引用符は付けないでください。',
  '',
  '回答本文は Markdown で読みやすく整形してください:',
  '- 要点が複数あるときは箇条書き (- ) を使う。',
  '- 話題が分かれるときは見出し (##) で区切る。',
  '- 段落の間は空行を入れる。必要に応じて区切り線 (---) を使う。',
  '- ただし1〜2文で済む短い回答は箇条書きにせず普通の文で答える。',
  '',
  '根拠にしたメールは文末に [1] [2] のように出典番号を付けて示します。',
  '参照メールに答えが無い場合は、推測せず「該当するメールが見つかりませんでした」と正直に答えてください。',
  '',
  '回答の最後の行に必ず「@@SUGGEST@@ 質問1 || 質問2 || 質問3」の形式で、',
  'この内容に関連する短いフォローアップ質問を3つ (各15文字程度) 付けてください。',
].join('\n');

function buildUserPrompt(question: string, sources: RagSource[]): string {
  const ctx = sources.map(s =>
    `[${s.n}] 件名: ${s.subject}\n送信者: ${s.from} / ${s.date}\n本文:\n${s.body}`,
  ).join('\n\n---\n\n');
  return `参照メール:\n\n${ctx}\n\n---\n\n質問: ${question}`;
}

export interface ChatHistoryMsg { role: 'user' | 'assistant'; content: string; }

function cleanTitle(t: string): string {
  return (t || '')
    .split('\n')[0]
    .replace(/^["'「『（(]+|["'」』）)]+$/g, '')
    .trim()
    .slice(0, 30);
}

const TITLE_MARK = 'TITLE:';
const SUGGEST_MARK = '@@SUGGEST@@';

/** ストリームを整形するパーサ。
 *  - 先頭の "TITLE: xxx" 行 → onTitle (本文には出さない)
 *  - 末尾の "@@SUGGEST@@ a || b || c" → onSuggest (本文には出さない)
 *  本文だけを onDelta へ流す。マーカーがチャンク境界で割れても拾えるよう末尾を保留する。 */
function makeStreamParser(
  onDelta: (t: string) => void,
  onTitle?: (t: string) => void,
  onSuggest?: (qs: string[]) => void,
) {
  let pre = '';            // タイトル検出前の蓄積
  let bodyStarted = false;
  let titleSent = false;
  let body = '';           // onDelta へ出した確定本文
  let buf = '';            // 本文の全蓄積 (SUGGEST 検出用)
  let suggestMode = false;
  let suggestRaw = '';

  function pushBody(text: string): void {
    if (suggestMode) { suggestRaw += text; return; }
    buf += text;
    const idx = buf.indexOf(SUGGEST_MARK);
    if (idx >= 0) {
      const head = buf.slice(0, idx);
      const toEmit = head.slice(body.length);
      if (toEmit) { body += toEmit; onDelta(toEmit); }
      suggestMode = true;
      suggestRaw += buf.slice(idx + SUGGEST_MARK.length);
      return;
    }
    // マーカーがチャンク境界で割れる可能性があるので末尾を保留。
    const safe = Math.max(body.length, buf.length - (SUGGEST_MARK.length - 1));
    const toEmit = buf.slice(body.length, safe);
    if (toEmit) { body += toEmit; onDelta(toEmit); }
  }

  function emitSuggest(): void {
    if (!suggestRaw || !onSuggest) return;
    const qs = suggestRaw.split(/\|\||\n/).map(x => x.replace(/^[\s\-・*]+/, '').trim()).filter(Boolean).slice(0, 4);
    if (qs.length) onSuggest(qs);
  }

  return {
    feed(chunk: string): void {
      if (bodyStarted) { pushBody(chunk); return; }
      pre += chunk;
      const consistent = pre.length < TITLE_MARK.length ? TITLE_MARK.startsWith(pre) : pre.startsWith(TITLE_MARK);
      if (!consistent) { bodyStarted = true; pushBody(pre); return; }
      const nl = pre.indexOf('\n');
      if (nl === -1) return;
      const title = cleanTitle(pre.slice(0, nl).replace(/^TITLE:\s*/i, ''));
      if (title && !titleSent) { onTitle?.(title); titleSent = true; }
      bodyStarted = true;
      pushBody(pre.slice(nl + 1).replace(/^\n+/, ''));
    },
    flush(): void {
      if (!bodyStarted) { if (!pre.startsWith(TITLE_MARK)) pushBody(pre); bodyStarted = true; }
      if (!suggestMode) { const tail = buf.slice(body.length); if (tail) { body += tail; onDelta(tail); } }
      emitSuggest();
    },
    get body(): string { return body; },
  };
}

/** chat/completions をストリーミング呼び出し。onDelta で本文を逐次受け取る。
 *  onTitle で 1 行目のタイトル、onSuggest で末尾のフォローアップ質問を受け取る。
 *  history で直前までの会話 (マルチターン文脈) を渡せる。戻り値は本文。 */
export async function generateAnswer(
  question: string,
  sources: RagSource[],
  s: RuntimeSettings,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
  onTitle?: (title: string) => void,
  history?: ChatHistoryMsg[],
  onSuggest?: (qs: string[]) => void,
  onUsage?: (u: ChatUsage) => void,
): Promise<string> {
  const userPrompt = buildUserPrompt(question, sources);
  const hist = history ?? [];
  const inputTokens = estimateTokens(SYSTEM_PROMPT) + estimateTokens(userPrompt)
    + hist.reduce((n, m) => n + estimateTokens(m.content), 0);
  const sep = makeStreamParser(onDelta, onTitle, onSuggest);

  if (s.provider === 'claude') {
    await streamClaude({
      apiKey: s.claudeApiKey,
      model: s.claudeModel,
      system: SYSTEM_PROMPT,
      messages: [...hist, { role: 'user', content: userPrompt }],
      onText: (t) => sep.feed(t),
      signal,
    });
    sep.flush();
    const outTok = estimateTokens(sep.body);
    recordChat(s.claudeModel, inputTokens, outTok);
    onUsage?.({ model: s.claudeModel, inputTokens, outputTokens: outTok, yen: chatYen(s.claudeModel, inputTokens + outTok) });
    return sep.body;
  }

  const url = `${s.chatBaseUrl.replace(/\/+$/, '')}`
    + `/openai/deployments/${encodeURIComponent(s.chatDeployment)}`
    + `/chat/completions?api-version=${encodeURIComponent(s.chatApiVersion)}`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (s.apiKey) headers['api-key'] = s.apiKey;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    credentials: 'omit',
    signal,
    // temperature は送らない: モデルによっては既定(1)以外を拒否する
    // ("Unsupported value: 'temperature' ... Only the default value is supported")。
    body: JSON.stringify({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...hist,
        { role: 'user', content: userPrompt },
      ],
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    throw new Error(`chat failed: HTTP ${res.status} ${body.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const data = t.slice(5).trim();
      if (data === '[DONE]') {
        sep.flush();
        const out = estimateTokens(sep.body);
        recordChat(s.chatModel, inputTokens, out);
        onUsage?.({ model: s.chatModel, inputTokens, outputTokens: out, yen: chatYen(s.chatModel, inputTokens + out) });
        return sep.body;
      }
      try {
        const json = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) sep.feed(delta);
      } catch { /* keep-alive 等は無視 */ }
    }
  }
  sep.flush();
  const outTok = estimateTokens(sep.body);
  recordChat(s.chatModel, inputTokens, outTok);
  onUsage?.({ model: s.chatModel, inputTokens, outputTokens: outTok, yen: chatYen(s.chatModel, inputTokens + outTok) });
  return sep.body;
}
