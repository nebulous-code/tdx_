/* line-diff.js — a tiny dependency-free line diff (LCS) for the note version-history panel.
   window.LineDiff.diff(oldStr, newStr) → [{ op: 'eq' | 'add' | 'del', line }] — old lines that
   are gone are 'del', new lines are 'add', unchanged are 'eq'. Notes are small, so the O(n·m)
   table is fine. */
(function () {
  function diff(oldStr, newStr) {
    const a = (oldStr || '').split('\n');
    const b = (newStr || '').split('\n');
    const n = a.length;
    const m = b.length;
    // dp[i][j] = LCS length of a[i..] and b[j..]
    const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const out = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { out.push({ op: 'eq', line: a[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ op: 'del', line: a[i] }); i++; }
      else { out.push({ op: 'add', line: b[j] }); j++; }
    }
    while (i < n) { out.push({ op: 'del', line: a[i] }); i++; }
    while (j < m) { out.push({ op: 'add', line: b[j] }); j++; }
    return out;
  }
  window.LineDiff = { diff };
})();
