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
  // 내 방식 (하락 중 롱 자리, 숏은 위아래 뒤집음)
  // 1) 노란 캔들: RSI 30 밑 + 하단 밴드 밖에서 마감하고, ①긴 음봉(최근 20개 평균 몸통의 1.5배) ②음봉 3개 이상 연속 ③역망치형(색 상관없음) 중 하나
  //    역망치형 = 윗꼬리가 몸통의 2배 이상, 아랫꼬리는 몸통 이하·윗꼬리의 1/3 이하 (숏은 위아래 뒤집은 모양)
  // 2) 노란 음봉 몸통을 통째로 덮는 양봉이 마감하면 → 그 뒤 진입 자리를 봄
  // 3) 진입 구간 = 노란 캔들의 몸통. 상자로만 보여 주고 진입 판단은 사용자가 함 (진입 캔들 색칠 안 함)
  //    상자는 장악 양봉 다음 봉부터 손절가 밖 마감·새 노란 캔들·30봉 지남 중 먼저 오는 때까지
  // 손절 = 노란 캔들(들)의 가장 낮은 저가. 그 아래로 마감하면 무효. 마지막(안 끝난) 봉은 진입 판단에서 뺌
  function myPull(bars, bb, r, o = { lo: 30, hi: 70, big: 1.5, wait: 60, box: 30 }) {
    const n = bars.length, watch = new Set(), setups = [];
    const body = (i) => Math.abs(bars[i].c - bars[i].o);
    const avgBody = (i) => { let s = 0, k = 0; for (let j = Math.max(0, i - 20); j < i; j++) { s += body(j); k++; } return k ? s / k : 0; };
    for (const dir of [1, -1]) {
      const against = (i) => dir > 0 ? bars[i].c < bars[i].o : bars[i].c > bars[i].o; // 롱이면 음봉
      const outside = (i) => bb.lo[i] != null && (dir > 0 ? bars[i].c < bb.lo[i] : bars[i].c > bb.up[i]);
      const rsiOk = (i) => r[i] != null && (dir > 0 ? r[i] < o.lo : r[i] > o.hi);
      const run = (i) => { let k = 0; while (i - k >= 0 && against(i - k)) k++; return k; }; // 연속 음봉 수
      const invHammer = (i) => { // 롱: 역망치형 / 숏: 뒤집은 모양(긴 아랫꼬리)
        const b = bars[i], bd = Math.max(body(i), (b.h - b.l) * 0.02), top = Math.max(b.o, b.c), bot = Math.min(b.o, b.c);
        const far = dir > 0 ? b.h - top : bot - b.l, near = dir > 0 ? bot - b.l : b.h - top;
        return b.h > b.l && far >= bd * 2 && near <= bd && near <= far / 3;
      };
      const yellow = (i) => rsiOk(i) && outside(i) && ((against(i) && (body(i) >= avgBody(i) * o.big || run(i) >= 3)) || invHammer(i));
      const ext = (i) => dir > 0 ? bars[i].l : bars[i].h;
      const worse = (x, y) => dir > 0 ? x < y : x > y;
      let cur = null; // { y: 마지막 노란 캔들, ys: [], sl, e: 장악 양봉, start }
      const close = (end, entry) => { if (cur && cur.e >= 0) setups.push({ dir, ys: cur.ys, e: cur.e, zTop: cur.zTop, zBot: cur.zBot, sl: cur.sl, from: cur.e + 1, to: end, entry }); cur = null; };
      for (let i = 0; i < n; i++) {
        const last = i === n - 1;
        if (!last && yellow(i)) {
          watch.add(i);
          if (cur && cur.e >= 0) close(i - 1, null); // 장악 뒤 새 노랑 → 이전 건 끝
          if (!cur) cur = { ys: [], sl: ext(i), e: -1, start: i };
          cur.ys.push(i); cur.y = i; cur.start = i;
          if (worse(ext(i), cur.sl)) cur.sl = ext(i);
          continue;
        }
        if (!cur) continue;
        if (worse(ext(i), cur.sl) && cur.e < 0) cur.sl = ext(i); // 장악 전 더 내려간 꼬리도 손절 기준에 포함
        if (cur.e < 0) { // 노란 음봉 몸통을 덮는 양봉 기다림
          const y = bars[cur.y], b = bars[i];
          const yt = Math.max(y.o, y.c), yb = Math.min(y.o, y.c); // 노란 캔들 몸통을 통째로 덮음
          const eng = dir > 0 ? b.c > b.o && b.c >= yt && b.o <= yb : b.c < b.o && b.c <= yb && b.o >= yt;
          if (!last && eng) { cur.e = i; cur.zTop = Math.max(y.o, y.c); cur.zBot = Math.min(y.o, y.c); }
          else if (i - cur.start > o.wait) cur = null;
          continue;
        }
        if (last) { close(i, null); break; } // 아직 진입 전 → 지금 봉까지 구간 그림
        const b = bars[i];
        if (dir > 0 ? b.c < cur.sl : b.c > cur.sl) { close(i, null); continue; } // 손절가 밖 마감 → 무효
        if (i - cur.e >= o.box) close(i, null);
      }
    }
    return { watch, setups: setups.sort((a, b) => a.from - b.from), entries: setups.filter((s) => s.entry).map((s) => ({ i: s.entry.i, dir: s.dir })) };
  }
  // ---------- 시장 구조 (팔콘 방식) ----------
  // 스윙 고점·저점: 양옆 k개 봉보다 높은(낮은) 봉. 오른쪽 k개 봉이 끝나야 확정
  function pivots(bars, k) {
    const H = [], L = [], n = bars.length;
    for (let i = k; i < n - k; i++) {
      let h = true, l = true;
      for (let j = i - k; j <= i + k && (h || l); j++) {
        if (j === i) continue;
        if (j < i ? bars[j].h >= bars[i].h : bars[j].h > bars[i].h) h = false;
        if (j < i ? bars[j].l <= bars[i].l : bars[j].l < bars[i].l) l = false;
      }
      if (h) H.push({ i, p: bars[i].h, h: true });
      if (l) L.push({ i, p: bars[i].l, h: false });
    }
    return { H, L };
  }
  // 구조 이탈: 몸통(종가)이 직전 스윙 고점(저점)을 넘어 마감해야 인정
  //  같은 방향이면 BOS, 추세가 바뀌면 CHoCH, 꼬리만 넘고 다시 들어오면 FB(가짜 돌파)
  //  강한 저점(롱) = 고점을 깨게 만든 저점, 약한 고점 = 그 뒤 가장 높은 고점(목표)
  function structure(bars, k = 8) {
    const n = bars.length, { H, L } = pivots(bars, k), ev = [];
    let hi = 0, lo = 0, lastH = null, lastL = null, trend = 0, strong = null;
    for (let i = 0; i < n - 1; i++) { // 마지막(안 끝난) 봉은 판단에서 뺌
      while (hi < H.length && H[hi].i + k <= i) { lastH = { ...H[hi], used: false, fb: false }; hi++; }
      while (lo < L.length && L[lo].i + k <= i) { lastL = { ...L[lo], used: false, fb: false }; lo++; }
      const b = bars[i];
      if (lastH && !lastH.used && lastH.i < i) {
        if (b.c > lastH.p) {
          let m = lastH.i; for (let j = lastH.i; j <= i; j++) if (bars[j].l < bars[m].l) m = j;
          ev.push({ type: trend < 0 ? "CHoCH" : "BOS", dir: 1, i, from: lastH.i, p: lastH.p });
          trend = 1; lastH.used = true; strong = { i: m, p: bars[m].l, low: true };
        } else if (b.h > lastH.p && !lastH.fb) { lastH.fb = true; ev.push({ type: "FB", dir: -1, i, from: lastH.i, p: lastH.p }); }
      }
      if (lastL && !lastL.used && lastL.i < i) {
        if (b.c < lastL.p) {
          let m = lastL.i; for (let j = lastL.i; j <= i; j++) if (bars[j].h > bars[m].h) m = j;
          ev.push({ type: trend > 0 ? "CHoCH" : "BOS", dir: -1, i, from: lastL.i, p: lastL.p });
          trend = -1; lastL.used = true; strong = { i: m, p: bars[m].h, low: false };
        } else if (b.l < lastL.p && !lastL.fb) { lastL.fb = true; ev.push({ type: "FB", dir: 1, i, from: lastL.i, p: lastL.p }); }
      }
    }
    let weak = null;
    if (strong) {
      let m = strong.i;
      for (let j = strong.i; j < n; j++) if (trend > 0 ? bars[j].h > bars[m].h : bars[j].l < bars[m].l) m = j;
      weak = { i: m, p: trend > 0 ? bars[m].h : bars[m].l, low: trend < 0 };
    }
    const mid = strong && weak ? (strong.p + weak.p) / 2 : null;
    return { trend, ev, H, L, strong, weak, mid, k };
  }
  // 유동성 선: 거의 같은 높이의 고점(저점) 2개 → 그 너머에 손절 주문이 몰려 있음. 꼬리로 쓸고 가면 끝
  function liquidity(bars, k = 3, max = 5) {
    const n = bars.length, { H, L } = pivots(bars, k), out = [];
    let rs = 0, c = 0; for (let j = Math.max(0, n - 200); j < n; j++) { rs += bars[j].h - bars[j].l; c++; }
    const tol = c ? (rs / c) * 0.2 : 0;
    for (const [arr, dir] of [[H, 1], [L, -1]]) {
      let got = 0, used = new Set();
      for (let a = arr.length - 1; a >= 1 && got < max; a--) {
        if (used.has(a)) continue;
        const q = arr[a];
        for (let b = a - 1; b >= Math.max(0, a - 6); b--) {
          const p = arr[b];
          if (Math.abs(p.p - q.p) > tol) continue;
          const lv = dir > 0 ? Math.max(p.p, q.p) : Math.min(p.p, q.p);
          let ok = true;
          for (let j = p.i + 1; j < q.i; j++) if (dir > 0 ? bars[j].h > lv : bars[j].l < lv) { ok = false; break; }
          if (!ok) continue;
          let end = n - 1, swept = false;
          for (let j = q.i + 1; j < n; j++) if (dir > 0 ? bars[j].h > lv : bars[j].l < lv) { end = j; swept = true; break; }
          out.push({ dir, from: p.i, to: q.i, end, p: lv, swept }); got++; used.add(b); break;
        }
      }
    }
    return out;
  }
  return { ichimoku, bollinger, rsi, sma, myPull, structure, liquidity };
})();
