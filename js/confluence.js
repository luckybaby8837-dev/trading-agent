// 중첩 지도: 구름대·기준선·내가 그린 채널/피보·직전 고점/저점이 겹치는 가격대를 찾아 점수 매김
// (사용자 방식: 겹치는 근거가 많을수록 확신, 큰 시간봉일수록 신뢰도 높음)
const Conf = (() => {
  const TOL = { "15m": 0.002, "1h": 0.0035, "4h": 0.006, "1d": 0.01, "1w": 0.018 }; // 같은 자리로 볼 간격 (가격 대비)
  const RANGE = { "15m": 0.06, "1h": 0.1, "4h": 0.18, "1d": 0.35, "1w": 0.6 };     // 현재가에서 이만큼 안쪽만
  const ORDER = ["15m", "1h", "4h", "1d", "1w"];

  // 좌우 k봉보다 높은/낮은 봉 = 고점/저점
  function pivots(bars, k = 5, look = 200) {
    const hi = [], lo = [], n = bars.length;
    for (let i = Math.max(k, n - look); i < n - k; i++) {
      let h = true, l = true;
      for (let j = i - k; j <= i + k; j++) {
        if (j === i) continue;
        if (bars[j].h >= bars[i].h) h = false;
        if (bars[j].l <= bars[i].l) l = false;
      }
      if (h) hi.push(i);
      if (l) lo.push(i);
    }
    return { hi, lo };
  }

  function ichiNow(bars) {
    const ichi = Ind.ichimoku(bars), n = bars.length - 1, sh = ichi.shift - 1;
    const a = ichi.spanA[n - sh], b = ichi.spanB[n - sh];
    return { top: Math.max(a, b), bot: Math.min(a, b), kijun: ichi.kijun[n] };
  }

  function build(bars, tf, drawings, big, lineNow) {
    if (!bars || bars.length < 80) return [];
    const n = bars.length - 1, price = bars[n].c, src = [];
    const add = (p, label, w, tag) => { if (isFinite(p) && p > 0) src.push({ p, label, w, tag: tag || label }); };
    const name = (k) => Market.TF[k].name;

    // 지금 시간봉 일목
    const I = ichiNow(bars);
    add(I.top, "구름 상단", 2, "cloud"); add(I.bot, "구름 하단", 2, "cloud"); add(I.kijun, "기준선", 1, "kijun");
    // 큰 시간봉 일목 (더 무겁게)
    for (const [k, b] of Object.entries(big || {})) {
      if (!b || b.length < 80) continue;
      const J = ichiNow(b);
      add(J.top, `${name(k)} 구름 상단`, 2.5, "cloud_" + k); add(J.bot, `${name(k)} 구름 하단`, 2.5, "cloud_" + k); add(J.kijun, `${name(k)} 기준선`, 1.5, "kijun_" + k);
    }
    // 직전 고점·저점 (거래량 터진 자리는 더 무겁게)
    const vma = Ind.sma(bars.map((x) => x.v), 20), pv = pivots(bars);
    const volHit = (i) => vma[i] && bars[i].v >= vma[i] * 1.8;
    for (const i of pv.hi.slice(-6)) add(bars[i].h, volHit(i) ? "거래량 터진 고점" : "직전 고점", volHit(i) ? 1.5 : 1, "swing");
    for (const i of pv.lo.slice(-6)) add(bars[i].l, volHit(i) ? "거래량 터진 저점" : "직전 저점", volHit(i) ? 1.5 : 1, "swing");
    // 내가 그린 선
    for (const d of drawings || []) {
      const v = lineNow(d); if (!v) continue;
      if (v.kind === "수평선") add(v.price, "수평선", 1.5, "draw_" + d.id);
      if (v.kind === "추세선") add(v.now, "추세선", 1.5, "draw_" + d.id);
      if (v.kind === "평행채널") { add(Math.max(v.line1, v.line2), "채널 상단", 1.5, "draw_" + d.id); add(Math.min(v.line1, v.line2), "채널 하단", 1.5, "draw_" + d.id); add(v.mid, "채널 중앙", 0.5, "draw_" + d.id); }
      if (v.kind === "피보나치") for (const [r, p] of v.levels) { const w = { 0.382: 1.5, 0.5: 1, 0.618: 1.5 }[r]; if (w) add(p, `피보 ${r}`, w, "draw_" + d.id); }
      if (v.kind === "확장 피보나치") for (const [r, p] of v.levels) { const w = { 1: 1.5, 1.272: 1, 1.618: 1 }[r]; if (w) add(p, r === 1 ? "확장 1:1" : `확장 ${r}`, w, "draw_" + d.id); }
    }

    // RSI 다이버전스 (최근 두 저점/고점)
    const rsi = Ind.rsi(bars), div = [];
    const [l1, l2] = pv.lo.slice(-2);
    if (l2 != null && n - l2 <= 40 && bars[l2].l < bars[l1].l && rsi[l2] > rsi[l1]) div.push({ p: bars[l2].l, label: "상승 다이버전스" });
    const [h1, h2] = pv.hi.slice(-2);
    if (h2 != null && n - h2 <= 40 && bars[h2].h > bars[h1].h && rsi[h2] < rsi[h1]) div.push({ p: bars[h2].h, label: "하락 다이버전스" });

    // 가까운 가격끼리 묶기
    const tol = price * (TOL[tf] || 0.006), far = price * (RANGE[tf] || 0.2);
    const list = src.filter((s) => Math.abs(s.p - price) <= far).sort((a, b) => a.p - b.p);
    const groups = [];
    for (const s of list) {
      const g = groups[groups.length - 1];
      if (g && s.p - g.hi <= tol) { g.items.push(s); g.hi = s.p; } else groups.push({ lo: s.p, hi: s.p, items: [s] });
    }
    const zones = [];
    for (const g of groups) {
      // 같은 선에서 나온 값은 한 번만 (예: 같은 채널의 상단·중앙)
      const byTag = new Map();
      for (const s of g.items) if (!byTag.has(s.tag) || byTag.get(s.tag).w < s.w) byTag.set(s.tag, s);
      const items = [...byTag.values()];
      if (items.length < 2) continue;
      const z = { lo: g.lo, hi: g.hi, items, score: items.reduce((a, s) => a + s.w, 0), labels: items.map((s) => s.label) };
      for (const d of div) if (d.p >= g.lo - tol && d.p <= g.hi + tol) { z.score += 1; z.labels.push(d.label); }
      const pad = tol / 2; z.lo -= pad; z.hi += pad;
      z.mid = (z.lo + z.hi) / 2;
      z.side = z.mid > price ? "위" : "아래";
      z.dist = (z.mid / price - 1) * 100;
      zones.push(z);
    }
    zones.sort((a, b) => b.score - a.score);
    const top = zones.slice(0, 6);
    const maxS = Math.max(...top.map((z) => z.score), 1);
    top.forEach((z) => { z.level = z.score >= 6 ? 3 : z.score >= 4 ? 2 : 1; z.rel = z.score / maxS; });
    return top.sort((a, b) => b.mid - a.mid);
  }

  // 지금 시간봉보다 큰 시간봉 두 개
  const bigger = (tf) => ORDER.slice(ORDER.indexOf(tf) + 1, ORDER.indexOf(tf) + 3);

  function text(zones, price) {
    if (!zones.length) return "중첩 자리: 두 가지 이상 겹치는 자리 없음";
    return "중첩 자리 (근거가 겹치는 가격대, 점수 높을수록 많이 겹침):\n" + zones.map((z) =>
      `- ${Chart.fmtP(z.lo)}~${Chart.fmtP(z.hi)} (현재가 ${z.side} ${z.dist >= 0 ? "+" : ""}${z.dist.toFixed(2)}%, 점수 ${z.score.toFixed(1)}): ${z.labels.join(" · ")}`).join("\n");
  }
  return { build, bigger, text };
})();
