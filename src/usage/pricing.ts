// AI 利用料金の目安算出。
// Panasonic OE の料金表 (LLM利用料10,000円分の QA回数の目安) からモデル別の
// 円/トークンを逆算する。資料の前提: 1QA = input 1,200 + output 300 = 1,500 トークン。
//   円/QA   = 10,000 / 目安回数
//   円/token = (10,000 / 目安回数) / 1,500   (input/output 混合の目安)
// ※ あくまで目安。実請求は為替・実トークン数で変動する。

const TOKENS_PER_QA = 1500; // input 1,200 + output 300 (資料の前提)

/** 10,000 円分で利用できる QA 回数の目安 (資料の表)。 */
const QA_PER_10000: Record<string, number> = {
  'gpt-4o': 7800,
  'gpt-4o-mini': 130000,
  'gpt-4.1': 10000,
  'gpt-4.1-mini': 54000,
  'gpt-4.1-nano': 217000,
  'o3': 10000,
  'o4-mini': 19000,
  'gpt-5': 14000,
  'gpt-5-mini': 71000,
  'gpt-5-nano': 350000,
};

/** 表に無いモデルは gpt-4.1 (10,000回) 相当で概算。 */
const DEFAULT_QA = 10000;

/** 埋め込みは公開価格が無いため、表の最安 (gpt-5-nano: 350,000回) の円/トークンで暫定算出。 */
const EMBED_YEN_PER_TOKEN = (10000 / 350000) / TOKENS_PER_QA;

function normalizeModel(model: string): string {
  const m = (model || '').toLowerCase();
  // 長いキー優先 (gpt-4.1-nano を gpt-4.1 より先に当てる)。
  const keys = Object.keys(QA_PER_10000).sort((a, b) => b.length - a.length);
  for (const k of keys) if (m.includes(k)) return k;
  return '';
}

/** モデルの円/トークン (input/output 混合の目安)。 */
export function yenPerToken(model: string): number {
  const n = QA_PER_10000[normalizeModel(model)] ?? DEFAULT_QA;
  return (10000 / n) / TOKENS_PER_QA;
}

export function chatYen(model: string, totalTokens: number): number {
  return Math.max(0, totalTokens) * yenPerToken(model);
}

export function embedYen(tokens: number): number {
  return Math.max(0, tokens) * EMBED_YEN_PER_TOKEN;
}

/** トークン数の目安。実トークナイザは積まないので、ASCII と非ASCII で粗く換算する。
 *  ASCII ≒ 4 文字/トークン、日本語等 ≒ 1.5 文字/トークン。 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let ascii = 0, other = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) ascii++; else other++;
  }
  return Math.ceil(ascii / 4 + other / 1.5);
}
