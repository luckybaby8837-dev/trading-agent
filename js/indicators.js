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
  // RSI 쌍바닥 (로스 카메론): RSI 30 밑 + 하단 밴드 밖 마감 = 지켜볼 자리(노랑) →
  // 상승 장악형 → 한 번 더 눌린 두 번째 바닥이 밴드 안 → 다시 상승 장악형 마감에 롱(파랑).
  // 손절 = 두 번째 바닥 저가, 목표 = 손절 폭 3배. 숏(보라)은 반대 (RSI 70 위, 상단 밴드).
  // 마지막(아직 안 끝난) 봉은 진입 판단에서 뺌
  function rsiDouble(bars, bb, r, o = { lo: 30, hi: 70, rr: 3, wait: 40 }) {
    const n = bars.length, watch = new Set(), entries = [];
    const engulf = (i, dir) => {
      if (i < 1) return false;
      const a = bars[i - 1], b = bars[i];
      return dir > 0 ? a.c < a.o && b.c > b.o && b.c >= a.o && b.o <= a.c
        : a.c > a.o && b.c < b.o && b.c <= a.o && b.o >= a.c;
    };
    for (const dir of [1, -1]) {
      const ext = (i) => dir > 0 ? bars[i].l : bars[i].h; // 바닥(저가) / 꼭대기(고가)
      const worse = (x, y) => dir > 0 ? x < y : x > y;
      const outside = (i) => bb.lo[i] != null && (dir > 0 ? bars[i].c < bb.lo[i] : bars[i].c > bb.up[i]);
      const inside = (i) => bb.lo[i] != null && (dir > 0 ? ext(i) >= bb.lo[i] : ext(i) <= bb.up[i]);
      const trig = (i) => r[i] != null && (dir > 0 ? r[i] < o.lo : r[i] > o.hi) && outside(i);
      let st = 0, start = 0, b1 = -1, e1 = -1, b2 = -1;
      for (let i = 0; i < n - 1; i++) {
        if (trig(i)) { watch.add(i); if (st !== 1) { st = 1; start = i; b1 = i; } }
        if (st === 0) continue;
        if (i - start > o.wait) { st = 0; continue; }
        if (st === 1) { // 첫 바닥 다지는 중 → 첫 장악형 기다림
          if (worse(ext(i), ext(b1))) b1 = i;
          if (engulf(i, dir)) { st = 2; e1 = i; b2 = -1; }
          continue;
        }
        // st 2: 첫 장악형 뒤 → 다시 눌림(두 번째 바닥)과 그 뒤 장악형
        if (outside(i)) { st = 1; start = i; b1 = i; continue; } // 다시 밴드 밖이면 처음부터
        if (i > e1 && (b2 < 0 || worse(ext(i), ext(b2)))) b2 = i;
        if (i > e1 + 1 && engulf(i, dir) && inside(b2) && inside(i)) {
          const en = bars[i].c, sl = ext(b2), risk = Math.abs(en - sl); // b2는 첫 장악형 뒤 가장 낮은(높은) 봉, 이번 봉 포함
          if (risk > 0) entries.push({ i, dir, b1: { i: b1, p: ext(b1) }, b2: { i: b2, p: ext(b2) }, en, sl, tp: en + dir * risk * o.rr });
          st = 0;
        }
      }
    }
    return { watch, entries: entries.sort((a, b) => a.i - b.i) };
  }
  return { ichimoku, bollinger, rsi, sma, rsiDouble };
})();
