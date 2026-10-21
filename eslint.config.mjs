// ESLint（npm run lint:js. CI の slides ジョブで実行し、error でも warning でも失敗にする: --max-warnings 0）
// 規則は @eslint/js の recommended（明らかな誤りを見る最小の集合）. 書式は Prettier に任せる（npm run format:check）
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/", "dist/", "build/", ".preview-trusted/", ".preview-trusted.*/"] },
  js.configs.recommended,
  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.node } },
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  {
    // inspectPage・inspectFonts はブラウザの中で実行する（page.evaluate）
    files: ["scripts/check-overflow.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
