// Marp と同じ markdown-it（package-lock.json で固定）を読み込む. 読めないとき（npm ci の前）は null
let MarkdownIt = null;
try {
  ({ default: MarkdownIt } = await import("markdown-it"));
} catch {
  MarkdownIt = null;
}
/** 見出し・箇条書き・スライドの区切りを読む方法（"markdown-it" か、読めないときの "fallback"） */
export const parser = MarkdownIt ? "markdown-it" : "fallback";
export const md = MarkdownIt ? new MarkdownIt({ html: true }) : null;
