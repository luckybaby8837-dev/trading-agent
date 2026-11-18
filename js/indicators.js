// 보조지표 계산 (일목균형표, 볼린저밴드, RSI, 거래량 평균)
const Ind = (() => {
  function midline(bars, n, i) {
    if (i < n - 1) return null;
    let hi = -Infinity, lo = Infinity;
    for (let k = i - n + 1; k <= i; k++) { if (bars[k].h > hi) hi = bars[k].h; if (bars[k].l < lo) lo = bars[k].l; }
    return (hi + lo) / 2;
  }
  // 선행스팬은 계산된 봉 기준 26칸 앞(미래)에 그림 → spanA[i]는 i번째 봉에서 계산된 값
  function ichimoku(bars, p = { t: 9, k: 26, s: 52, shift: 26 }) {
    const n = bars.length, tenkan = [], kijun = [], spanA = [], spanB = [];
    for (let i = 0; i < n; i++) {
      tenkan[i] = midline(bars, p.t, i);
      kijun[i] = midline(bars, p.k, i);
      spanA[i] = tenkan[i] != null && kijun[i] != null ? (tenkan[i] + kijun[i]) / 2 : null;
      spanB[i] = midline(bars, p.s, i);
    }
    return { tenkan, kijun, spanA, spanB, shift: p.shift };
  }
  function bollinger(bars, n = 20, k = 2) {
    const mid = [], up = [], lo = [];
    for (let i = 0; i < bars.length; i++) {
      if (i < n - 1) { mid[i] = up[i] = lo[i] = null; continue; }
      let s = 0; for (let j = i - n + 1; j <= i; j++) s += bars[j].c;
      const m = s / n; let v = 0;
      for (let j = i - n + 1; j <= i; j++) v += (bars[j].c - m) ** 2;
      const sd = Math.sqrt(v / n);
      mid[i] = m; up[i] = m + k * sd; lo[i] = m - k * sd;
    }
    return { mid, up, lo };
  }
  function rsi(bars, n = 14) {
    const out = new Array(bars.length).fill(null);
    let ag = 0, al = 0;
    for (let i = 1; i < bars.length; i++) {
      const d = bars[i].c - bars[i - 1].c, g = Math.max(d, 0), l = Math.max(-d, 0);
      if (i <= n) { ag += g / n; al += l / n; if (i === n) out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
      else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); }
    }
    return out;
  }
  function sma(arr, n) {
    const out = []; let s = 0;
    for (let i = 0; i < arr.length; i++) { s += arr[i]; if (i >= n) s -= arr[i - n]; out[i] = i >= n - 1 ? s / n : null; }
    return out;
  }
  return { ichimoku, bollinger, rsi, sma };
})();
