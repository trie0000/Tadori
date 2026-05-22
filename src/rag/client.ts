// RAG 回答合成クライアント。中継サーバ経由で Azure OpenAI chat/completions を叩く。
// 上位メールを文脈に詰め、出典 [n] 付きの回答をストリーミングで返す。

import type { RuntimeSettings } from '../api/aiSettings';
import { streamClaude } from '../api/aiClaude';
import { recordChat } from '../usage/tracker';
import { estimateTokens } from '../usage/pricing';

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
].join('\n');

function buildUserPrompt(question: string, sources: RagSource[]): string {
  const ctx = sources.map(s =>
    `[${s.n}] 件名: ${s.subject}\n送信者: ${s.from} / ${s.date}\n本文:\n${s.body}`,
  ).join('\n\n---\n\n');
  return `参照メール:\n\n${ctx}\n\n---\n\n質問: ${question}`;
}

function cleanTitle(t: string): string {
  return (t || '')
    .split('\n')[0]
    .replace(/^["'「『（(]+|["'」』）)]+$/g, '')
    .trim()
    .slice(0, 30);
}

const TITLE_MARK = 'TITLE:';

/** ストリームの 1 行目 "TITLE: xxx" を拾い、本文だけを onDelta へ流すスプリッタ。
 *  モデルが指示に従わず本文から始めた場合は、そのまま本文として扱う。 */
function makeTitleSplitter(onDelta: (t: string) => void, onTitle?: (t: string) => void) {
  let raw = '';
  let bodyStarted = false;
  let titleSent = false;
  let body = '';
  const emit = (text: string): void => { if (text) { body += text; onDelta(text); } };
  return {
    feed(chunk: string): void {
      if (bodyStarted) { emit(chunk); return; }
      raw += chunk;
      // raw が "TITLE:" と整合しているか (まだ短いなら前方一致で判定)。
      const consistent = raw.length < TITLE_MARK.length
        ? TITLE_MARK.startsWith(raw)
        : raw.startsWith(TITLE_MARK);
      if (!consistent) { bodyStarted = true; emit(raw); return; } // タイトル行ではない
      const nl = raw.indexOf('\n');
      if (nl === -1) return; // タイトル行がまだ完結していない → 何も出さない
      const title = cleanTitle(raw.slice(0, nl).replace(/^TITLE:\s*/i, ''));
      if (title && !titleSent) { onTitle?.(title); titleSent = true; }
      bodyStarted = true;
      emit(raw.slice(nl + 1).replace(/^\n+/, ''));
    },
    flush(): void {
      if (bodyStarted) return;
      if (!raw.startsWith(TITLE_MARK)) emit(raw); // タイトル行未完のまま終了 → 本文扱い
      bodyStarted = true;
    },
    get body(): string { return body; },
  };
}

/** chat/completions をストリーミング呼び出し。onDelta で本文を逐次受け取る。
 *  onTitle で 1 行目のタイトルを受け取る (履歴タイトル用)。戻り値は本文。 */
export async function generateAnswer(
  question: string,
  sources: RagSource[],
  s: RuntimeSettings,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
  onTitle?: (title: string) => void,
): Promise<string> {
  const userPrompt = buildUserPrompt(question, sources);
  const inputTokens = estimateTokens(SYSTEM_PROMPT) + estimateTokens(userPrompt);
  const sep = makeTitleSplitter(onDelta, onTitle);

  if (s.provider === 'claude') {
    await streamClaude({
      apiKey: s.claudeApiKey,
      model: s.claudeModel,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
      onText: (t) => sep.feed(t),
      signal,
    });
    sep.flush();
    recordChat(s.claudeModel, inputTokens, estimateTokens(sep.body));
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
        recordChat(s.chatModel, inputTokens, estimateTokens(sep.body));
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
  recordChat(s.chatModel, inputTokens, estimateTokens(sep.body));
  return sep.body;
}
