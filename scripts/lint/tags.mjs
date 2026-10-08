// HTML の開始タグの読み取り（属性・文字参照）
/**
 * HTML の開始タグを読む. → [{ name, attrs: [{ name, value }], index }]（name は小文字）
 * ブラウザと同じく、属性の区切りは空白と / （<svg/onload=…>）、値は引用符あり・なしの両方.
 * 引用符の中の > でタグを終わりにしない. 取りこぼさないよう、どの < からも読み直す（安全側に多めに拾う）
 */
export function scanTags(text) {
  const tags = [];
  const n = text.length;
  for (const m of text.matchAll(/<([a-zA-Z][^\s/>]*)/g)) {
    let i = m.index + m[0].length;
    const attrs = [];
    while (i < n) {
      while (i < n && /[\s/]/.test(text[i])) i++;
      if (i >= n || text[i] === ">") break;
      const start = i++;
      while (i < n && !/[\s/>=]/.test(text[i])) i++;
      const name = text.slice(start, i).toLowerCase();
      let j = i;
      while (j < n && /\s/.test(text[j])) j++;
      let value = "";
      if (text[j] === "=") {
        i = j + 1;
        while (i < n && /\s/.test(text[i])) i++;
        const q = text[i];
        if (q === '"' || q === "'") {
          const end = text.indexOf(q, i + 1);
          value = text.slice(i + 1, end < 0 ? n : end);
          i = end < 0 ? n : end + 1;
        } else {
          const s = i;
          while (i < n && !/[\s>]/.test(text[i])) i++;
          value = text.slice(s, i);
        }
      }
      attrs.push({ name, value });
    }
    tags.push({ name: m[1].toLowerCase(), attrs, index: m.index });
  }
  return tags;
}

/** 文字参照（&#106; &#x6A; &colon; など）を戻す（javascript: を文字参照で隠したものを見つけるため） */
export function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&colon;/gi, ":")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lpar;/gi, "(")
    .replace(/&rpar;/gi, ")")
    .replace(/&sol;/gi, "/")
    .replace(/&tab;/gi, "\t")
    .replace(/&newline;/gi, "\n");
}
