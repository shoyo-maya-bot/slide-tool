// SVG ファイルの検査
import { DEFAULTS } from "./config.mjs";
import { pathContext, svgDangers } from "./dangers.mjs";
import { bannedMessage, findBanned, readText } from "./text.mjs";

export function lintSvg(path, conf = DEFAULTS) {
  const text = readText(path);
  const out = [];
  const add = (severity, rule_id, message) => out.push({ rule_id, severity, message, location: path });
  for (const f of findBanned(text, conf.bannedTerms)) {
    out.push({ rule_id: "svg.banned_term", severity: "error", message: bannedMessage(f.term), location: `${path}:${f.line}` });
  }
  if (!/<svg[^>]*\bviewBox=/.test(text)) add("error", "svg.no_viewbox", "viewBox がありません（拡大縮小で崩れます）");
  for (const d of svgDangers(text, pathContext(path))) add(d.severity, d.rule_id, d.message);
  if (/<text\b/.test(text) && !/font-family/.test(text)) add("warning", "svg.no_font", "文字があるのに font-family がありません（環境で字形が変わります）");
  if (!/<title\b/.test(text)) add("warning", "svg.no_title", "<title> がありません（読み上げ・検索用）");
  return out;
}
