// 실시간 차트 (TradingView lightweight-charts) + 구름대 채우기 + 직접 그린 선
const Chart = (() => {
  const LW = window.LightweightCharts;
  const TZ = -new Date().getTimezoneOffset() * 60; // 한국 시간으로 표시
  const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618];
  // 확장 피보나치 (추세 기반): A→B 길이를 C에서 다시 잼
  const FIBX = [0, 0.382, 0.618, 1, 1.272, 1.618, 2, 2.618];
  const fibxP = (d, r) => d.c.p + (d.b.p - d.a.p) * r;
  const PRICE_BAND = 0.76; // 위쪽 76%는 가격, 아래는 RSI

  let el, ov, ctx, chart, S = {}, bars = [], ind = null, coin = "BTC", tf = "4h";
  let drawings = [], tool = null, temp = [], hover = null, onDrawDone = null, magnet = true;
  let show = Store.pref.get("show", { ichi: true, bb: true, vol: true, rsi: true });
  let log = Store.pref.get("log", true);
  let sig = "", raf = 0, liveT = 0;

  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const lt = (t) => t / 1000 + TZ;

  function theme() {
    return {
      layout: { background: { type: "solid", color: css("--chart-bg") }, textColor: css("--mut"), fontFamily: css("--mono") || "monospace", fontSize: 11 },
      grid: { vertLines: { color: css("--grid") }, horzLines: { color: css("--grid") } },
      rightPriceScale: { borderColor: css("--bd") },
      timeScale: { borderColor: css("--bd") },
    };
  }

  function init(container) {
    el = container;
    chart = LW.createChart(el, {
      autoSize: true, ...theme(),
      rightPriceScale: { ...theme().rightPriceScale, mode: log ? LW.PriceScaleMode.Logarithmic : LW.PriceScaleMode.Normal, scaleMargins: { top: 0.06, bottom: 1 - PRICE_BAND + 0.04 } },
      timeScale: { ...theme().timeScale, timeVisible: true, secondsVisible: false, rightOffset: 12, barSpacing: 7 },
      crosshair: { mode: LW.CrosshairMode.Normal },
      localization: { locale: "ko-KR", priceFormatter: (p) => fmtP(p) },
    });
    const up = css("--up"), dn = css("--dn");
    S.candle = chart.addCandlestickSeries({ upColor: up, downColor: dn, borderUpColor: up, borderDownColor: dn, wickUpColor: up, wickDownColor: dn });
    const line = (color, w = 1, extra = {}) => chart.addLineSeries({ color, lineWidth: w, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...extra });
    S.tenkan = line(css("--ichi-t"));
    S.kijun = line(css("--ichi-k"), 2);
    S.spanA = line(css("--cloud-up-line"));
    S.spanB = line(css("--cloud-dn-line"));
    S.bbU = line(css("--bb"), 1, { lineStyle: 2 });
    S.bbM = line(css("--bb"), 1, { lineStyle: 1 });
    S.bbL = line(css("--bb"), 1, { lineStyle: 2 });
    S.vol = chart.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: PRICE_BAND - 0.18, bottom: 1 - PRICE_BAND + 0.01 } });
    S.rsi = line(css("--rsi"), 1.5, { priceScaleId: "rsi", lastValueVisible: false, autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });
    chart.priceScale("rsi").applyOptions({ scaleMargins: { top: PRICE_BAND + 0.03, bottom: 0.02 } });

    ov = document.createElement("canvas");
    ov.className = "overlay";
    el.appendChild(ov);
    ctx = ov.getContext("2d");
    ov.addEventListener("pointerdown", onDown);
    ov.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", () => { hover = null; sig = ""; });
    ["pointerdown", "wheel", "touchstart"].forEach((e) => el.addEventListener(e, () => (moved = true), { passive: true }));
    let lastW = 0;
    new ResizeObserver(() => { const w = el.clientWidth; if (Math.abs(w - lastW) > 30 && !moved && bars.length) fitRecent(); lastW = w; }).observe(el);
    loop();
  }

  function fmtP(p) {
    if (!isFinite(p)) return "";
    return p >= 1000 ? p.toLocaleString("en-US", { maximumFractionDigits: 1 }) : p.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }

  // ---------- 데이터 ----------
  function setData(c, t, list) {
    coin = c; tf = t; bars = list;
    recalc(true);
    moved = false; fitRecent(); requestAnimationFrame(fitRecent);
  }
  // 최근 봉이 화면에 보기 좋게 들어오도록 (화면 폭에 맞춰 봉 간격 조절)
  let moved = false;
  function fitRecent() {
    const w = el.clientWidth || 600;
    chart.timeScale().applyOptions({ barSpacing: Math.max(2.5, Math.min(9, w / 110)) });
    chart.timeScale().scrollToPosition(8, false);
  }
  function recalc(full) {
    if (!bars.length) return;
    const ms = Market.TF[tf].ms, n = bars.length, last = bars[n - 1].t;
    ind = { ichi: Ind.ichimoku(bars), bb: Ind.bollinger(bars), rsi: Ind.rsi(bars), volMa: Ind.sma(bars.map((b) => b.v), 20) };
    const T = (i) => lt(i < n ? bars[i].t : last + (i - n + 1) * ms);
    const ser = (arr, shift = 0, extra = 0) => {
      const out = [];
      for (let i = 0; i < n + extra; i++) {
        const src = i - shift, v = src >= 0 && src < n ? arr[src] : null;
        out.push(v == null ? { time: T(i) } : { time: T(i), value: v });
      }
      return out;
    };
    const sh = ind.ichi.shift - 1; // 26번째 봉 위치(현재 봉 포함)로 앞당겨 그림
    {
      S.candle.setData(bars.map((b) => ({ time: lt(b.t), open: b.o, high: b.h, low: b.l, close: b.c })));
      const vis = (s, on) => s.applyOptions({ visible: on });
      S.tenkan.setData(ser(ind.ichi.tenkan)); S.kijun.setData(ser(ind.ichi.kijun));
      S.spanA.setData(ser(ind.ichi.spanA, sh, sh)); S.spanB.setData(ser(ind.ichi.spanB, sh, sh));
      [S.tenkan, S.kijun, S.spanA, S.spanB].forEach((s) => vis(s, show.ichi));
      S.bbU.setData(ser(ind.bb.up)); S.bbM.setData(ser(ind.bb.mid)); S.bbL.setData(ser(ind.bb.lo));
      [S.bbU, S.bbM, S.bbL].forEach((s) => vis(s, show.bb));
      const up = css("--up-a"), dn = css("--dn-a");
      S.vol.setData(bars.map((b) => ({ time: lt(b.t), value: b.v, color: b.c >= b.o ? up : dn })));
      vis(S.vol, show.vol);
      // RSI: 과매수(70 이상) 빨강, 과매도(30 이하) 파랑
      const rHi = css("--rsi-hi"), rLo = css("--rsi-lo"), rN = css("--rsi");
      S.rsi.setData(ser(ind.rsi).map((p) => (p.value == null ? p : { ...p, color: p.value >= 70 ? rHi : p.value <= 30 ? rLo : rN })));
      const rv = ind.rsi[n - 1];
      S.rsi.applyOptions({ color: rv >= 70 ? rHi : rv <= 30 ? rLo : rN });
      vis(S.rsi, show.rsi);
    }
    sig = "";
  }
  // 실시간 캔들 반영 (너무 잦은 재계산은 0.3초로 묶음)
  function live(c, iv, k) {
    if (c !== coin || iv !== Market.TF[tf].iv || !bars.length) return;
    const last = bars[bars.length - 1];
    if (k.t === last.t) bars[bars.length - 1] = k;
    else if (k.t > last.t) bars.push(k);
    else return;
    S.candle.update({ time: lt(k.t), open: k.o, high: k.h, low: k.l, close: k.c });
    const now = Date.now();
    if (now - liveT > 300) {
      liveT = now;
      const r = chart.timeScale().getVisibleLogicalRange();
      recalc(false);
      if (r) chart.timeScale().setVisibleLogicalRange(r);
    }
  }

  // ---------- 좌표 변환 ----------
  const ms = () => Market.TF[tf].ms;
  const tToL = (t) => (t - bars[bars.length - 1].t) / ms() + (bars.length - 1);
  const lToT = (l) => bars[bars.length - 1].t + (l - (bars.length - 1)) * ms();
  const X = (t) => chart.timeScale().logicalToCoordinate(tToL(t));
  const Y = (p) => S.candle.priceToCoordinate(p);
  // 선은 로그 가격 기준으로 직선 (로그 차트에서 곧게 보임)
  const lineAt = (a, b, t) => Math.exp(Math.log(a.p) + (Math.log(b.p) - Math.log(a.p)) * (t - a.t) / ((b.t - a.t) || 1));

  function pane() {
    const w = el.clientWidth - chart.priceScale("right").width();
    const h = el.clientHeight - (chart.timeScale().height ? chart.timeScale().height() : 28);
    return { w, h, ph: h * PRICE_BAND };
  }

  // ---------- 그리기 루프 ----------
  function loop() {
    raf = requestAnimationFrame(loop);
    if (!bars.length) return;
    const r = chart.timeScale().getVisibleLogicalRange();
    const s = [el.clientWidth, el.clientHeight, r && r.from.toFixed(3), r && r.to.toFixed(3), Y(bars[bars.length - 1].c), Y(bars[0].c), drawings.length, temp.length, hover && hover.x, hover && hover.y, tool].join("|");
    if (s === sig) return;
    sig = s;
    render();
  }

  function render() {
    const dpr = window.devicePixelRatio || 1, W = el.clientWidth, H = el.clientHeight;
    if (ov.width !== W * dpr || ov.height !== H * dpr) { ov.width = W * dpr; ov.height = H * dpr; ov.style.width = W + "px"; ov.style.height = H + "px"; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const P = pane();
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, P.w, P.h); ctx.clip();
    if (show.ichi) cloud(P);
    if (show.rsi) rsiGuides(P);
    ctx.beginPath(); ctx.rect(0, 0, P.w, P.ph); ctx.clip();
    for (const d of drawings) paint(d, P, false);
    if (tool && temp.length && hover) paint(preview(), P, true);
    ctx.restore();
    if (show.rsi) rsiAxis(P, W);
  }
  // 가격 눈금이 RSI 칸까지 내려오지 않게 가리고, RSI 눈금을 따로 표시
  function rsiAxis(P, W) {
    ctx.fillStyle = css("--chart-bg");
    ctx.fillRect(P.w + 1, P.ph - 7, W - P.w, P.h - P.ph + 6);
    ctx.strokeStyle = css("--bd"); ctx.beginPath(); ctx.moveTo(P.w, P.ph + 0.5); ctx.lineTo(W, P.ph + 0.5); ctx.stroke();
    ctx.font = "11px " + css("--mono"); ctx.fillStyle = css("--mut");
    for (const lv of [30, 70]) { const y = S.rsi.priceToCoordinate(lv); if (y != null) ctx.fillText(String(lv), P.w + 8, y + 4); }
    const v = ind.rsi[bars.length - 1], y = v != null ? S.rsi.priceToCoordinate(v) : null;
    if (y != null) {
      ctx.fillStyle = v >= 70 ? css("--rsi-hi") : v <= 30 ? css("--rsi-lo") : css("--rsi"); ctx.fillRect(P.w + 2, y - 9, W - P.w - 4, 18);
      ctx.fillStyle = "#fff"; ctx.fillText(v.toFixed(1), P.w + 8, y + 4);
    }
  }

  function cloud(P) {
    const a = ind.ichi.spanA, b = ind.ichi.spanB, sh = ind.ichi.shift - 1, n = bars.length;
    const ts = chart.timeScale();
    const pts = [];
    for (let i = 0; i < n; i++) {
      if (a[i] == null || b[i] == null) continue;
      const x = ts.logicalToCoordinate(i + sh);
      if (x == null || x < -50 || x > P.w + 50) continue;
      pts.push({ x, ya: Y(a[i]), yb: Y(b[i]), up: a[i] >= b[i] });
    }
    for (let k = 1; k < pts.length; k++) {
      const p = pts[k - 1], q = pts[k];
      ctx.fillStyle = css(p.up ? "--cloud-up" : "--cloud-dn");
      ctx.beginPath(); ctx.moveTo(p.x, p.ya); ctx.lineTo(q.x, q.ya); ctx.lineTo(q.x, q.yb); ctx.lineTo(p.x, p.yb); ctx.closePath(); ctx.fill();
    }
  }
  // RSI 과매수(70 위) 빨강 · 과매도(30 아래) 파랑 면적 (투명도 30%)
  function rsiFill(P) {
    const r = ind.rsi, ts = chart.timeScale(), pts = [];
    for (let i = 0; i < r.length; i++) {
      if (r[i] == null) continue;
      const x = ts.logicalToCoordinate(i);
      if (x == null || x < -20 || x > P.w + 20) continue;
      pts.push([x, S.rsi.priceToCoordinate(r[i])]);
    }
    if (pts.length < 2) return;
    const y70 = S.rsi.priceToCoordinate(70), y30 = S.rsi.priceToCoordinate(30);
    if (y70 == null || y30 == null) return;
    const area = (yBase, clipTop, clipBot, color) => {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, clipTop, P.w, clipBot - clipTop); ctx.clip();
      ctx.beginPath(); ctx.moveTo(pts[0][0], yBase);
      for (const [x, y] of pts) ctx.lineTo(x, y);
      ctx.lineTo(pts[pts.length - 1][0], yBase); ctx.closePath();
      ctx.globalAlpha = 0.3; ctx.fillStyle = color; ctx.fill();
      ctx.restore();
    };
    area(y70, P.ph, y70, css("--rsi-hi"));
    area(y30, y30, P.h, css("--rsi-lo"));
  }
  function rsiGuides(P) {
    rsiFill(P);
    ctx.strokeStyle = css("--bd"); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, P.ph + 0.5); ctx.lineTo(P.w, P.ph + 0.5); ctx.stroke();
    ctx.setLineDash([3, 4]); ctx.strokeStyle = css("--mut");
    for (const lv of [30, 70]) {
      const y = S.rsi.priceToCoordinate(lv);
      if (y == null) continue;
      ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(P.w, y); ctx.stroke(); ctx.globalAlpha = 1;
    }
    ctx.setLineDash([]);
    ctx.font = "11px " + css("--mono");
    const v = ind.rsi[bars.length - 1];
    ctx.fillStyle = v >= 70 ? css("--rsi-hi") : v <= 30 ? css("--rsi-lo") : css("--mut");
    ctx.fillText("RSI 14  " + (v != null ? v.toFixed(1) : "") + (v >= 70 ? "  과매수" : v <= 30 ? "  과매도" : ""), 8, P.ph + 14);
  }

  // ---------- 선 모양 ----------
  function geom(d, P) {
    const right = lToT(chart.timeScale().coordinateToLogical(P.w) || bars.length);
    if (d.type === "hline") return { segs: [[0, Y(d.p), P.w, Y(d.p)]], labels: [[P.w - 4, Y(d.p), fmtP(d.p)]] };
    if (d.type === "tline") {
      const end = Math.max(right, d.b.t, d.a.t);
      return { segs: [seg(d.a, d.b, d.a.t, d.b.t)], ext: [seg(d.a, d.b, Math.max(d.a.t, d.b.t), end)] };
    }
    if (d.type === "channel") {
      const off = Math.log(d.c.p) - Math.log(lineAt(d.a, d.b, d.c.t));
      const a2 = { t: d.a.t, p: d.a.p * Math.exp(off) }, b2 = { t: d.b.t, p: d.b.p * Math.exp(off) };
      const m1 = { t: d.a.t, p: d.a.p * Math.exp(off / 2) }, m2 = { t: d.b.t, p: d.b.p * Math.exp(off / 2) };
      const t0 = Math.min(d.a.t, d.b.t), t1 = Math.max(d.a.t, d.b.t), end = Math.max(right, t1);
      return { segs: [seg(d.a, d.b, t0, t1), seg(a2, b2, t0, t1)], mid: [seg(m1, m2, t0, t1)], ext: [seg(d.a, d.b, t1, end), seg(a2, b2, t1, end)], fill: [d.a, d.b, a2, b2, t0, t1] };
    }
    if (d.type === "fib") {
      const x0 = X(Math.min(d.a.t, d.b.t)), segs = [], labels = [];
      for (const r of FIB) {
        const p = d.b.p + (d.a.p - d.b.p) * r, y = Y(p);
        segs.push([x0, y, P.w, y]); labels.push([P.w - 4, y, r + "  " + fmtP(p)]);
      }
      return { segs, labels, diag: [[X(d.a.t), Y(d.a.p), X(d.b.t), Y(d.b.p)]] };
    }
    if (d.type === "fibx") {
      const x0 = X(d.c.t), segs = [], labels = [];
      for (const r of FIBX) {
        const p = fibxP(d, r), y = Y(p);
        segs.push([x0, y, P.w, y]); labels.push([P.w - 4, y, r + "  " + fmtP(p)]);
      }
      return { segs, labels, diag: [[X(d.a.t), Y(d.a.p), X(d.b.t), Y(d.b.p)], [X(d.b.t), Y(d.b.p), X(d.c.t), Y(d.c.p)]] };
    }
    return { segs: [] };
  }
  function seg(a, b, t0, t1) {
    // 로그 직선을 화면에 그릴 때 선형 차트에서도 맞도록 잘게 나눔
    const N = log ? 1 : 24, pts = [];
    for (let i = 0; i <= N; i++) { const t = t0 + (t1 - t0) * i / N; pts.push(X(t), Y(lineAt(a, b, t))); }
    return pts;
  }
  function poly(ctx, pts) { ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]); ctx.stroke(); }

  function paint(d, P, isTemp) {
    const g = geom(d, P), col = d.color || css("--draw");
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = d === hoverHit ? 2.5 : 1.5;
    if (g.fill && !isTemp) {
      const [a, b, a2, b2, t0, t1] = g.fill;
      ctx.globalAlpha = 0.07; ctx.beginPath();
      ctx.moveTo(X(t0), Y(lineAt(a, b, t0))); ctx.lineTo(X(t1), Y(lineAt(a, b, t1)));
      ctx.lineTo(X(t1), Y(lineAt(a2, b2, t1))); ctx.lineTo(X(t0), Y(lineAt(a2, b2, t0))); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    }
    for (const s of g.segs) poly(ctx, s);
    ctx.setLineDash([2, 4]);
    for (const s of g.mid || []) poly(ctx, s);
    ctx.setLineDash([6, 5]); ctx.globalAlpha = 0.55;
    for (const s of g.ext || []) poly(ctx, s);
    for (const s of g.diag || []) poly(ctx, s);
    ctx.globalAlpha = 1; ctx.setLineDash([]);
    ctx.font = "11px " + css("--mono"); ctx.textAlign = "right";
    for (const [x, y, t] of g.labels || []) ctx.fillText(t, x, y - 4);
    ctx.textAlign = "left";
  }

  // ---------- 그리기 입력 ----------
  const NEED = { hline: 1, tline: 2, channel: 3, fib: 2, fibx: 3 };
  function setTool(t, done) {
    tool = t; temp = []; onDrawDone = done; sig = "";
    ov.style.pointerEvents = t ? "auto" : "none";
    ov.style.cursor = t === "erase" ? "pointer" : t ? "crosshair" : "default";
    chart.applyOptions({ handleScroll: !t, handleScale: !t });
  }
  function pt(ev) {
    const r = ov.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    const L = chart.timeScale().coordinateToLogical(x);
    let t = lToT(L), p = S.candle.coordinateToPrice(y);
    if (magnet) {
      const i = Math.round(L);
      if (i >= 0 && i < bars.length) {
        const b = bars[i];
        let best = null, bd = 16;
        for (const v of [b.h, b.l, b.o, b.c]) { const dy = Math.abs(Y(v) - y); if (dy < bd) { bd = dy; best = v; } }
        if (best != null) { p = best; t = b.t; }
      }
    }
    return { x, y, t, p };
  }
  function preview() {
    const h = { t: hover.t, p: hover.p };
    if (tool === "tline" || tool === "fib") return { type: tool, a: temp[0], b: h };
    if (tool === "channel") return temp.length === 1 ? { type: "tline", a: temp[0], b: h } : { type: "channel", a: temp[0], b: temp[1], c: h };
    if (tool === "fibx") return temp.length === 1 ? { type: "tline", a: temp[0], b: h } : { type: "fibx", a: temp[0], b: temp[1], c: h };
    return { type: "hline", p: h.p };
  }
  let hoverHit = null;
  function onMove(ev) {
    if (!tool) return;
    const q = pt(ev); hover = q;
    if (tool === "erase") { hoverHit = hit(q.x, q.y); sig = ""; }
  }
  function onDown(ev) {
    if (!tool) return;
    ev.preventDefault();
    const q = pt(ev); hover = q;
    if (q.y > pane().ph) return;
    if (tool === "erase") {
      const d = hit(q.x, q.y);
      if (d && onDrawDone) onDrawDone({ erase: d });
      return;
    }
    temp.push({ t: q.t, p: q.p });
    if (temp.length >= NEED[tool]) {
      const d = tool === "hline" ? { type: "hline", p: temp[0].p } : tool === "channel" || tool === "fibx" ? { type: tool, a: temp[0], b: temp[1], c: temp[2] } : { type: tool, a: temp[0], b: temp[1] };
      temp = [];
      if (onDrawDone) onDrawDone({ add: d });
    }
    sig = "";
  }
  function hit(x, y) {
    const P = pane();
    let best = null, bd = 12;
    for (const d of drawings) {
      const g = geom(d, P);
      for (const s of [...g.segs, ...(g.ext || [])]) {
        for (let i = 2; i < s.length; i += 2) {
          const dist = segDist(x, y, s[i - 2], s[i - 1], s[i], s[i + 1]);
          if (dist < bd) { bd = dist; best = d; }
        }
      }
    }
    return best;
  }
  function segDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
    let t = L ? ((px - x1) * dx + (py - y1) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - x1 - t * dx, py - y1 - t * dy);
  }

  // ---------- 현재 상태 읽기 (분석용) ----------
  function valueNow(d) {
    const t = bars[bars.length - 1].t;
    if (d.type === "hline") return { kind: "수평선", price: d.p };
    if (d.type === "tline") return { kind: "추세선", now: lineAt(d.a, d.b, t), from: d.a, to: d.b };
    if (d.type === "channel") {
      const lo = lineAt(d.a, d.b, t), off = Math.log(d.c.p) - Math.log(lineAt(d.a, d.b, d.c.t)), hi = lo * Math.exp(off);
      return { kind: "평행채널", line1: lo, line2: hi, mid: lo * Math.exp(off / 2), from: d.a, to: d.b };
    }
    if (d.type === "fib") return { kind: "피보나치", from: d.a, to: d.b, levels: FIB.map((r) => [r, d.b.p + (d.a.p - d.b.p) * r]) };
    if (d.type === "fibx") return { kind: "확장 피보나치", from: d.a, to: d.b, at: d.c, levels: FIBX.map((r) => [r, fibxP(d, r)]) };
  }

  function setDrawings(list) { drawings = list; hoverHit = null; sig = ""; }
  // 진행 중 포지션: 진입·손절·익절 가격선
  let posLines = [];
  function setPositions(list) {
    for (const l of posLines) try { S.candle.removePriceLine(l); } catch {}
    posLines = [];
    const add = (price, color, title, style, w) => posLines.push(S.candle.createPriceLine({ price, color, title, lineStyle: style, lineWidth: w, axisLabelVisible: true }));
    for (const t of list) {
      const c = t.side === "short" ? css("--dn") : css("--up"), nm = t.side === "short" ? "숏" : "롱";
      if (t.en) add(t.en, c, `${nm} 진입${t.qty ? " " + t.qty : ""}`, 0, 2);
      if (t.sl) add(t.sl, css("--mut"), "손절", 2, 1);
      if (t.tp) add(t.tp, css("--draw"), "익절", 2, 1);
    }
  }
  function setShow(k, v) { show[k] = v; Store.pref.set("show", show); recalc(true); }
  function setLog(v) { log = v; Store.pref.set("log", v); chart.priceScale("right").applyOptions({ mode: v ? LW.PriceScaleMode.Logarithmic : LW.PriceScaleMode.Normal }); sig = ""; }
  function retheme() {
    chart.applyOptions(theme());
    const up = css("--up"), dn = css("--dn");
    S.candle.applyOptions({ upColor: up, downColor: dn, borderUpColor: up, borderDownColor: dn, wickUpColor: up, wickDownColor: dn });
    recalc(true);
  }
  function snapshot() {
    if (!el.clientWidth || !el.clientHeight) return null;
    sig = ""; render();
    const base = chart.takeScreenshot(), c = document.createElement("canvas");
    if (!base.width || !ov.width) return null;
    c.width = base.width; c.height = base.height;
    const x = c.getContext("2d");
    x.drawImage(base, 0, 0);
    x.drawImage(ov, 0, 0, ov.width, ov.height, 0, 0, base.width, base.height);
    return c;
  }
  return {
    init, setData, live, setDrawings, setPositions, setTool, setShow, setLog, retheme, snapshot, valueNow, fmtP,
    get bars() { return bars; }, get ind() { return ind; }, get show() { return show; }, get log() { return log; },
    get magnet() { return magnet; }, set magnet(v) { magnet = v; },
  };
})();
