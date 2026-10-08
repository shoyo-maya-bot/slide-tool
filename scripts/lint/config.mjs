// lint の既定の設定
export const DEFAULTS = {
  maxBullets: 6,
  maxBodyChars: 260,
  maxTitleChars: 32,
  maxDepth: 2,
  layouts: [],
  noTitleLayouts: ["title", "section", "big-number"],
  bannedTerms: [],
  // 検査しないファイル（今の作業フォルダからの相対パスのパターン。/ 区切り、* は / 以外、** は何でも）
  exclude: ["README.md", "docs/**"],
};
