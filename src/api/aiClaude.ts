// Anthropic Claude API クライアント (ブラウザ直接呼び出し)。
// Spira の src/api/aiClaude.ts を Tadori 用に簡略化したもの (text-in / text-out)。
//
// セキュリティ注意: ブラウザ直接呼び出しには
// `anthropic-dangerous-direct-browser-access: true` が必要。開発者モード限定の
// テスト用途であり、本番は社内 AI (corp / 中継サーバ) 経路を使う。

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamClaudeOpts {
  apiKey: string;
  model: string;
  system: string;
  messages: ClaudeMessage[];
  maxTokens?: number;
  onText: (delta: string) => void;
  signal?: AbortSignal;
}

/** Claude にストリーミングで問い合わせ、テキスト delta を onText に流す。
 *  完了時に連結済みの全文を返す。 */
export async function streamClaude(opts: StreamClaudeOpts): Promise<string> {
  if (!opts.apiKey) throw new Error('Claude API キーが未設定です');

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'x-api-key': opts.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    signal: opts.signal,
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens ?? 2048,
      system: opts.system,
      messages: opts.messages,
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    let detail = '';
    try {
      const j = await res.json() as { error?: { message?: string } };
      if (j.error?.message) detail = ' — ' + j.error.message;
    } catch { /* ignore */ }
    throw new Error(`Claude API 失敗: HTTP ${res.status}${detail}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let answer = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      let evName = '';
      let evData = '';
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) evName = line.slice(6).trim();
        else if (line.startsWith('data:')) evData += line.slice(5).trim();
      }
      if (evName === 'content_block_delta' && evData) {
        try {
          const ev = JSON.parse(evData) as { delta?: { type?: string; text?: string } };
          if (ev.delta?.type === 'text_delta' && ev.delta.text) {
            answer += ev.delta.text;
            opts.onText(ev.delta.text);
          }
        } catch { /* keep-alive 等 */ }
      }
    }
  }
  return answer;
}
