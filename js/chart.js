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
  if (show.band == null) show.band = true;
  if (show.dbl == null) show.dbl = true; // 내 눌림 진입
  for (const k of ["st", "pd", "ch", "lq"]) if (show[k] == null) show[k] = true; // 시장 구조 · 50% 선 · 초크 · 유동성 선
  // 손절 범위: 현재가 위아래 1% (20배면 자산 20%)
  const BAND = 0.01, LEV = 20;
  let bandLines = [];
  function updateBand() {
    for (const l of bandLines) try { S.candle.removePriceLine(l); } catch {}
    bandLines = [];
    if (!show.band || !bars.length) return;
    const p = bars[bars.length - 1].c, col = css("--band") || "#e8a23d";
    const add = (price, title) => bandLines.push(S.candle.createPriceLine({ price, color: col, title, lineStyle: 2, lineWidth: 1, axisLabelVisible: true }));
    add(p * (1 + BAND), "");
    add(p * (1 - BAND), "");
  }
  let bandP = 0;
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
    // 현재로 버튼: 예전 차트를 보고 있을 때만 보임
    nowBtn = document.createElement("button");
    nowBtn.className = "nowBtn"; nowBtn.type = "button"; nowBtn.hidden = true; nowBtn.textContent = "현재로 ›";
    nowBtn.onclick = () => goNow();
    el.appendChild(nowBtn);
    chart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
      if (!r || !bars.length) return;
      nowBtn.hidden = r.to >= bars.length - 1;
      if (r.from < 60) loadOlder(); // 왼쪽 끝 가까이 오면 예전 캔들 더 불러옴
    });
    loop();
  }

  function fmtP(p) {
    if (!isFinite(p)) return "";
    return p >= 1000 ? p.toLocaleString("en-US", { maximumFractionDigits: 1 }) : p.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }

  // ---------- 데이터 ----------
  function setData(c, t, list) {
    coin = c; tf = t; bars = list; older = { busy: false, done: false, key: c + "|" + t };
    recalc(true);
    goNow(); requestAnimationFrame(fitRecent);
  }
  // 현재(가장 최근 캔들)로 돌아오기 + 가격 축 자동 맞춤 (코인 바꿔도 현재 차트가 보이게)
  function goNow() {
    moved = false;
    chart.priceScale("right").applyOptions({ autoScale: true });
    fitRecent();
  }
  // 예전 캔들 더 불러오기 (한 번에 1000개, 최대 2만 개)
  let older = { busy: false, done: false, key: "" }, nowBtn = null;
  async function loadOlder() {
    if (older.busy || older.done || !bars.length || bars.length >= 20000) return;
    const key = older.key, st = older; st.busy = true;
    try {
      const more = (await Market.klines(coin, tf, 1000, bars[0].t - 1)).filter((b) => b.t < bars[0].t);
      if (st.key !== key || older !== st) return; // 그사이 코인·시간 바뀜
      if (!more.length) { st.done = true; return; }
      const r = chart.timeScale().getVisibleLogicalRange();
      bars = more.concat(bars);
      recalc(true);
      if (r) chart.timeScale().setVisibleLogicalRange({ from: r.from + more.length, to: r.to + more.length });
      if (more.length < 1000) st.done = true;
    } catch { /* 다음에 다시 시도 */ } finally { st.busy = false; }
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
    ind.dbl = Ind.myPull(bars, ind.bb, ind.rsi);
    ind.st = Ind.structure(bars, 8); ind.sti = Ind.structure(bars, 3); ind.lq = Ind.liquidity(bars, 3);
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
      // 내 눌림 진입: 노란 캔들만 색칠
      const cW = css("--db-watch"), cL = css("--db-long"), cS = css("--db-short");
      const ent = new Map(); // 진입 캔들은 색칠 안 함 (진입 판단은 사용자)
      S.candle.setData(bars.map((b, i) => {
        const col = ent.get(i) || (show.dbl && ind.dbl.watch.has(i) ? cW : null);
        const d = { time: lt(b.t), open: b.o, high: b.h, low: b.l, close: b.c };
        return col ? { ...d, color: col, borderColor: col, wickColor: col } : d;
      }));
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
    bandP = bars[n - 1].c; updateBand();
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
    if (Math.abs(k.c - bandP) / k.c > 0.0003) { bandP = k.c; updateBand(); }
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
  // 로그 차트면 로그 가격 기준 직선, 일반 차트면 일반 가격 기준 직선 (어느 쪽이든 화면에서 곧게 보임)
  const lineAt = (a, b, t) => { const k = (t - a.t) / ((b.t - a.t) || 1); return log ? Math.exp(Math.log(a.p) + (Math.log(b.p) - Math.log(a.p)) * k) : a.p + (b.p - a.p) * k; };
  // 채널 폭: 로그면 비율, 일반이면 가격 차이
  const offOf = (p, base) => (log ? Math.log(p) - Math.log(base) : p - base);
  const shiftP = (p, off) => (log ? p * Math.exp(off) : p + off);

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
    if (show.dbl) dblPaint(P);
    structPaint(P);
    for (const d of drawings) paint(d, P, false);
    if (tool && temp.length && hover) paint(preview(), P, true);
    ctx.restore();
    if (show.rsi) rsiAxis(P, W);
  }
  // 가격 눈금이 RSI 칸까지 내려오지 않게 가리고, RSI 눈금을 따로 표시
  // 진입 구간 상자(노란 음봉 몸통, 장악 양봉 다음 봉부터 진입·무효까지) + 손절 점선
  function dblPaint(P) {
    const cL = css("--db-long"), cS = css("--db-short"), cSL = css("--dn");
    const n = bars.length, half = (chart.timeScale().options().barSpacing || 7) / 2;
    for (const z of ind.dbl.setups) {
      const xa = X(bars[z.from] ? bars[z.from].t : bars[n - 1].t), xb0 = X(bars[Math.min(z.to, n - 1)].t);
      if (xa == null || xb0 == null || xb0 < -50 || xa > P.w + 50) continue;
      const live = !z.entry && z.to >= n - 1;
      const x1 = xa - half, x2 = xb0 + half + (live ? half * 6 : 0);
      const y1 = Y(z.zTop), y2 = Y(z.zBot), ys = Y(z.sl);
      if (y1 == null || y2 == null) continue;
      const col = z.dir > 0 ? cL : cS;
      ctx.save();
      ctx.globalAlpha = live ? 0.2 : 0.12; ctx.fillStyle = col;
      ctx.fillRect(x1, Math.min(y1, y2), x2 - x1, Math.max(2, Math.abs(y2 - y1)));
      ctx.globalAlpha = live ? 0.9 : 0.55; ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.strokeRect(x1, Math.min(y1, y2), x2 - x1, Math.max(2, Math.abs(y2 - y1)));
      if (ys != null) { ctx.strokeStyle = cSL; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(x1, ys); ctx.lineTo(x2, ys); ctx.stroke(); }
      ctx.restore();
    }
  }
  // 시장 구조: 50% 선(위 비싼 구간·아래 싼 구간), 스윙 점, BOS·CHoCH·FB, 강·약, 초크 ▲▼, 유동성 선
  function structPaint(P) {
    if (!ind.st) return;
    const ts = chart.timeScale(), xi = (i) => ts.logicalToCoordinate(i), n = bars.length;
    const up = css("--up"), dn = css("--dn"), mut = css("--mut"), S0 = ind.st;
    const on = (x) => x != null && x > -40 && x < P.w + 40;
    const ln = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
    ctx.save(); ctx.lineWidth = 1; ctx.textAlign = "center";
    if (show.pd && S0.mid != null) {
      const hiP = Math.max(S0.strong.p, S0.weak.p), loP = Math.min(S0.strong.p, S0.weak.p);
      const x1 = Math.max(0, xi(Math.min(S0.strong.i, S0.weak.i)) ?? 0), yH = Y(hiP), yM = Y(S0.mid), yL = Y(loP);
      if (yH != null && yM != null && yL != null && x1 < P.w) {
        ctx.globalAlpha = 0.08; ctx.fillStyle = dn; ctx.fillRect(x1, yH, P.w - x1, yM - yH);
        ctx.fillStyle = up; ctx.fillRect(x1, yM, P.w - x1, yL - yM);
        ctx.globalAlpha = 0.75; ctx.strokeStyle = mut; ctx.setLineDash([6, 4]); ln(x1, yM, P.w, yM); ctx.setLineDash([]);
      }
    }
    if (show.lq) for (const q of ind.lq) {
      const xa = xi(q.from), xb = q.swept ? xi(q.end) : P.w, y = Y(q.p);
      if (xa == null || xb == null || y == null || xb < 0 || xa > P.w) continue;
      ctx.globalAlpha = q.swept ? 0.3 : 0.85; ctx.strokeStyle = css("--lq"); ctx.lineWidth = 1.5; ctx.setLineDash([1, 3]);
      ln(xa, y, xb, y); ctx.setLineDash([]); ctx.lineWidth = 1;
    }
    if (show.st) {
      ctx.fillStyle = mut; ctx.globalAlpha = 0.7;
      for (const p of S0.H.concat(S0.L)) { const x = xi(p.i), y = Y(p.p); if (on(x) && y != null) { ctx.beginPath(); ctx.arc(x, y + (p.h ? -5 : 5), 1.8, 0, 7); ctx.fill(); } }
      ctx.font = "10px " + css("--mono");
      for (const e of S0.ev) {
        const xa = xi(e.from), xb = xi(e.i), y = Y(e.p);
        if (xa == null || xb == null || y == null || xb < -40 || xa > P.w + 40) continue;
        const fb = e.type === "FB", col = fb ? mut : e.dir > 0 ? up : dn;
        ctx.globalAlpha = fb ? 0.75 : 0.9; ctx.strokeStyle = col; ctx.fillStyle = col;
        ctx.setLineDash(fb ? [2, 3] : []); ln(xa, y, xb, y); ctx.setLineDash([]);
        const above = fb ? e.dir < 0 : e.dir > 0;
        // FB는 꼬리가 넘은 봉 위(아래)에, BOS·CHoCH는 선 가운데에
        if (fb) { const b = bars[e.i], yy = Y(above ? b.h : b.l); if (yy != null) ctx.fillText("FB", xb, yy + (above ? -5 : 13)); }
        else ctx.fillText(e.type, (xa + xb) / 2, y + (above ? -4 : 11));
      }
      ctx.globalAlpha = 1; ctx.font = "bold 11px " + css("--font");
      for (const [pt, txt] of [[S0.strong, "강"], [S0.weak, "약"]]) {
        if (!pt) continue; const x = xi(pt.i), y = Y(pt.p); if (!on(x) || y == null) continue;
        ctx.fillStyle = css("--tx"); ctx.fillText(txt, x, y + (pt.low ? 19 : -11));
      }
    }
    if (show.ch && ind.sti) {
      const from = S0.strong ? Math.min(S0.strong.i, S0.weak.i) : n;
      for (const e of ind.sti.ev) {
        if (e.type !== "CHoCH") continue;
        const x = xi(e.i), b = bars[e.i]; if (!on(x)) continue;
        const good = S0.mid != null && e.i >= from && (e.dir > 0 ? b.c <= S0.mid : b.c >= S0.mid);
        ctx.globalAlpha = e.i < from ? 0.45 : good ? 1 : 0.3; ctx.fillStyle = e.dir > 0 ? up : dn;
        const y = e.dir > 0 ? Y(b.l) + 9 : Y(b.h) - 9; if (y == null) continue;
        ctx.beginPath();
        if (e.dir > 0) { ctx.moveTo(x, y - 4); ctx.lineTo(x - 4, y + 3); ctx.lineTo(x + 4, y + 3); }
        else { ctx.moveTo(x, y + 4); ctx.lineTo(x - 4, y - 3); ctx.lineTo(x + 4, y - 3); }
        ctx.closePath(); ctx.fill();
      }
    }
    ctx.restore();
  }
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
      const off = offOf(d.c.p, lineAt(d.a, d.b, d.c.t));
      const a2 = { t: d.a.t, p: shiftP(d.a.p, off) }, b2 = { t: d.b.t, p: shiftP(d.b.p, off) };
      const m1 = { t: d.a.t, p: shiftP(d.a.p, off / 2) }, m2 = { t: d.b.t, p: shiftP(d.b.p, off / 2) };
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
    const N = 1, pts = [];
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
      const lo = lineAt(d.a, d.b, t), off = offOf(d.c.p, lineAt(d.a, d.b, d.c.t)), hi = shiftP(lo, off);
      return { kind: "평행채널", line1: lo, line2: hi, mid: shiftP(lo, off / 2), from: d.a, to: d.b };
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
