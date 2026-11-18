// 화면 동작: 차트 · 매매 · 일지 · 회계
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 10); };
  const nowHM = () => new Date().toTimeString().slice(0, 5);
  const usd = (v, d = 2) => (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
  const krw = (v) => (v < 0 ? "-₩" : "₩") + Math.round(Math.abs(v)).toLocaleString("ko-KR");
  const sgn = (v) => (v > 0 ? "up" : v < 0 ? "dn" : "");
  const pctS = (v) => (v > 0 ? "+" : "") + v.toFixed(2) + "%";

  const BASIS = ["일목균형표", "볼린저밴드", "RSI", "다이버전스", "거래량", "평행채널", "피보나치", "추세선", "캔들패턴", "삼각수렴", "쌍봉", "임펄스파동", "ABC", "지지·저항"];
  const MOODS = ["차분함", "확신", "설렘", "불안", "조급함", "욕심", "두려움", "후회", "복수심", "지루함", "피곤함"];

  const st = {
    coin: Store.pref.get("coin", "BTC"), tf: Store.pref.get("tf", "4h"),
    tick: {}, upbit: {}, fx: null, trades: [], journal: [], drawings: [],
  };

  // ---------- 공통 UI ----------
  function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 2200); }
  function sheet(html) { $("sheetIn").innerHTML = html; $("sheet").hidden = $("sheetBg").hidden = false; $("sheet").scrollTop = 0; }
  function closeSheet() { $("sheet").hidden = $("sheetBg").hidden = true; $("sheetIn").innerHTML = ""; }
  $("sheetBg").onclick = closeSheet;
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("sheet").hidden) closeSheet(); });
  function seg(box, opts, cur, cb) {
    box.innerHTML = "";
    const bs = opts.map(([label, v]) => {
      const b = document.createElement("button"); b.textContent = label; b.type = "button";
      b.onclick = () => { bs.forEach((x) => x.classList.toggle("on", x === b)); cb(v); };
      if (v === cur) b.classList.add("on");
      box.appendChild(b); return b;
    });
  }
  function chips(box, opts, sel, multi, cls) {
    box.innerHTML = "";
    const set = new Set(sel);
    for (const o of opts) {
      const [label, v] = Array.isArray(o) ? o : [o, o];
      const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.dataset.v = v;
      if (cls) b.classList.add(cls(v));
      if (set.has(v)) b.classList.add("on");
      b.onclick = () => {
        if (multi) { set.has(v) ? set.delete(v) : set.add(v); b.classList.toggle("on"); }
        else { set.clear(); set.add(v); [...box.children].forEach((x) => x.classList.toggle("on", x === b)); }
      };
      box.appendChild(b);
    }
    return () => [...set];
  }
  async function shrink(file, max = 1400) {
    const url = await new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(file); });
    return shrinkUrl(url, max);
  }
  function shrinkUrl(url, max = 1400) {
    return new Promise((r) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement("canvas");
        c.width = img.width * k; c.height = img.height * k;
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        r(c.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = () => r(url);
      img.src = url;
    });
  }

  // 차트 그림 찍기 (다른 탭에 있어도 잠깐 화면 밖에 펼쳐서 찍음)
  async function chartShot() {
    const v = $("vChart"), hidden = !v.classList.contains("on");
    if (hidden) {
      Object.assign(v.style, { display: "flex", flexDirection: "column", position: "fixed", left: "-10000px", top: "0", width: "1100px", height: "640px" });
      await new Promise((r) => setTimeout(r, 180));
    }
    const c = Chart.snapshot();
    if (hidden) { v.removeAttribute("style"); fitChartView(); await new Promise((r) => setTimeout(r, 50)); }
    return c ? shrinkUrl(c.toDataURL("image/png"), 1600) : null;
  }

  // ---------- 탭 ----------
  let lastTab = "vHome";
  function showView(v) {
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("on", x.dataset.v === v));
    document.querySelectorAll(".view").forEach((x) => x.classList.toggle("on", x.id === v));
    document.body.dataset.v = v;
    scrollTo(0, 0);
    if (v === "vChart") fitChartView();
    if (v === "vHome") renderHome();
    if (v === "vSet") renderSet();
    if (v !== "vChart") stopTool();
  }
  $("setBtn").onclick = () => showView("vSet");
  $("setX").onclick = () => showView(lastTab);
  document.querySelectorAll(".tabs button").forEach((b) => b.onclick = () => {
    lastTab = b.dataset.v; showView(b.dataset.v);
    if (b.dataset.v === "vTrade") renderTrades();
    if (b.dataset.v === "vJournal") renderJournal();
    if (b.dataset.v === "vAcct") renderAcct();
  });

  // ---------- 상단 시세 ----------
  seg($("coinSeg"), Market.COINS.map((c) => [c, c]), st.coin, (c) => { st.coin = c; Store.pref.set("coin", c); loadChart(); renderTop(); });
  Market.on("ticker", (sym, d) => {
    const o = (st.tick[sym] = st.tick[sym] || {});
    if (d.lastPrice) o.last = +d.lastPrice;
    if (d.price24hPcnt) o.chg = +d.price24hPcnt * 100;
    if (sym === st.coin) renderTop();
    liveDot(); homeSoon();
  });
  Market.on("kline", (sym, iv, k) => { Chart.live(sym, iv, k); liveDot(); });
  let dotT = 0;
  function liveDot() { $("liveDot").classList.add("on"); clearTimeout(dotT); dotT = setTimeout(() => $("liveDot").classList.remove("on"), 15000); }
  function price(coin = st.coin) { return (st.tick[coin] && st.tick[coin].last) || (coin === st.coin && Chart.bars.length ? Chart.bars[Chart.bars.length - 1].c : 0); }
  function kimp(coin) {
    const u = st.upbit[coin], p = price(coin);
    if (!u || !p || !st.fx) return null;
    return (u.price / (p * st.fx.rate) - 1) * 100;
  }
  function renderTop() {
    const t = st.tick[st.coin] || {}, p = price();
    $("pxMain").textContent = p ? Chart.fmtP(p) : "—";
    const c = $("pxChg");
    c.textContent = t.chg != null ? pctS(t.chg) : "—";
    c.className = "chg " + sgn(t.chg || 0);
    const k = kimp(st.coin);
    $("kpLine").innerHTML = "김프 " + (k == null ? "—" : `<b class="${sgn(k)}">${pctS(k)}</b>`);
    $("fxLine").textContent = st.fx ? "환율 ₩" + st.fx.rate.toFixed(1) : "환율 —";
    document.title = (p ? Chart.fmtP(p) + " · " : "") + st.coin + " 트레이딩 에이전트";
  }
  async function pollUpbit() {
    if (document.hidden) return;
    try { st.upbit = await Market.upbit(); renderTop(); if ($("vAcct").classList.contains("on")) renderAcct(); homeSoon(); } catch {}
  }
  async function loadFx() {
    const f = await Market.usdkrw();
    if (f) { st.fx = f; Store.pref.set("fx", f); } else st.fx = Store.pref.get("fx", null);
    renderTop();
  }

  // ---------- 차트 ----------
  // 차트 화면 높이를 상단·하단 막대 크기에 맞춰 정확히 채움
  function fitChartView() {
    if (!$("vChart").classList.contains("on")) return;
    const h = innerHeight - $("topChart").offsetHeight - document.querySelector(".tabs").offsetHeight - 10;
    $("vChart").style.height = Math.max(380, h) + "px";
  }
  addEventListener("resize", fitChartView); fitChartView();
  new ResizeObserver(fitChartView).observe($("topChart"));
  Chart.init($("chart"));
  seg($("tfSeg"), Object.entries(Market.TF).map(([k, v]) => [v.name, k]), st.tf, (t) => { st.tf = t; Store.pref.set("tf", t); loadChart(); });
  let curTopics = [];
  async function loadChart() {
    stopTool();
    const coin = st.coin, tf = st.tf;
    try {
      const bars = await Market.klines(coin, tf, 1000);
      if (coin !== st.coin || tf !== st.tf) return;
      Chart.setData(coin, tf, bars);
      await loadDrawings();
      renderTop();
    } catch (e) { toast("시세를 불러오지 못했어요. 인터넷 연결을 확인해 주세요."); }
    const topics = [`kline.${Market.TF[tf].iv}.${coin}USDT`];
    Market.unsub(curTopics.filter((t) => !topics.includes(t)));
    Market.sub(topics); curTopics = topics;
  }
  Market.sub(Market.COINS.map((c) => `tickers.${c}USDT`));

  // 지표 메뉴
  const IND = [["ichi", "일목균형표"], ["bb", "볼린저밴드"], ["vol", "거래량"], ["rsi", "RSI"]];
  function buildIndMenu() {
    const m = $("indMenu");
    m.innerHTML = IND.map(([k, n]) => `<label><input type="checkbox" data-k="${k}" ${Chart.show[k] ? "checked" : ""}>${n}</label>`).join("")
      + `<label><input type="checkbox" data-k="log" ${Chart.log ? "checked" : ""}>로그 차트</label>`
      + `<label><input type="checkbox" data-k="mag" ${Chart.magnet ? "checked" : ""}>선 그릴 때 캔들에 붙이기</label>`;
    m.querySelectorAll("input").forEach((i) => i.onchange = () => {
      const k = i.dataset.k;
      if (k === "log") Chart.setLog(i.checked);
      else if (k === "mag") { Chart.magnet = i.checked; Store.pref.set("magnet", i.checked); }
      else Chart.setShow(k, i.checked);
    });
  }
  Chart.magnet = Store.pref.get("magnet", true);
  $("indBtn").onclick = (e) => {
    const m = $("indMenu");
    if (!m.hidden) { m.hidden = true; return; }
    buildIndMenu();
    const r = e.currentTarget.getBoundingClientRect();
    m.style.left = Math.min(r.left, innerWidth - 190) + "px"; m.style.top = r.bottom + 6 + scrollY + "px"; m.hidden = false;
  };
  document.addEventListener("click", (e) => { if (!$("indMenu").contains(e.target) && e.target !== $("indBtn")) $("indMenu").hidden = true; });

  // 그리기 도구
  const ICON = {
    hline: '<svg viewBox="0 0 24 24"><path d="M3 12h18"/></svg>',
    tline: '<svg viewBox="0 0 24 24"><path d="M4 19L20 5"/><circle cx="4" cy="19" r="1.6"/><circle cx="20" cy="5" r="1.6"/></svg>',
    channel: '<svg viewBox="0 0 24 24"><path d="M3 15L15 4M9 20L21 9"/></svg>',
    fib: '<svg viewBox="0 0 24 24"><path d="M3 5h18M3 10h18M3 14h18M3 19h18"/></svg>',
    erase: '<svg viewBox="0 0 24 24"><path d="M5 5l14 14M19 5L5 19"/></svg>',
  };
  const TOOLS = [["hline", "수평선"], ["tline", "추세선"], ["channel", "평행채널"], ["fib", "피보"], ["erase", "지우기"]];
  const HINT = {
    hline: ["가격을 한 번 누르세요"], tline: ["시작점을 누르세요", "끝점을 누르세요"], fib: ["시작점(1)을 누르세요", "끝점(0)을 누르세요"],
    channel: ["기준선 시작점을 누르세요", "기준선 끝점을 누르세요", "반대쪽 선 위치를 누르세요"], erase: ["지울 선을 누르세요"],
  };
  let activeTool = null, step = 0;
  function buildTools() {
    $("toolSeg").innerHTML = TOOLS.map(([k, n]) => `<button data-t="${k}" class="${activeTool === k ? "on" : ""}">${ICON[k]}${n}</button>`).join("");
    $("toolSeg").querySelectorAll("button").forEach((b) => b.onclick = () => (activeTool === b.dataset.t ? stopTool() : startTool(b.dataset.t)));
  }
  function hint() { const h = $("drawHint"); if (!activeTool) { h.hidden = true; return; } h.textContent = HINT[activeTool][Math.min(step, HINT[activeTool].length - 1)]; h.hidden = false; }
  function startTool(t) {
    activeTool = t; step = 0; buildTools(); hint();
    Chart.setTool(t, async (r) => {
      if (r.add) {
        const d = { id: Store.uid("d"), coin: st.coin, ...r.add };
        await Store.put("drawings", d); await loadDrawings();
        toast("선을 저장했어요"); stopTool();
      } else if (r.erase) {
        await Store.del("drawings", r.erase.id); await loadDrawings(); toast("선을 지웠어요");
      }
    });
  }
  function stepCount() { if (activeTool && activeTool !== "erase") { step++; hint(); } }
  function stopTool() { activeTool = null; step = 0; Chart.setTool(null); buildTools(); hint(); }
  async function loadDrawings() {
    st.drawings = (await Store.all("drawings")).filter((d) => d.coin === st.coin).sort((a, b) => a.u - b.u);
    Chart.setDrawings(st.drawings);
  }
  buildTools();
  $("chart").querySelector(".overlay").addEventListener("pointerdown", stepCount);

  // 분석 자료
  $("anaBtn").onclick = async () => {
    stopTool();
    sheet(`<div class="sh"><h2>분석 자료</h2><button class="ghost" id="shX">닫기</button></div><p class="mut sm">만드는 중이에요… (시간봉 5개를 함께 읽어요)</p>`);
    $("shX").onclick = closeSheet;
    const text = await Analysis.build(st.coin, st.tf, st.drawings, price());
    sheet(`<div class="sh"><h2>분석 자료</h2><button class="ghost" id="shX">닫기</button></div>
      <p class="mut sm" style="margin-top:0">무료 방식이에요. 아래 순서대로 복사해서 Claude 대화창에 붙여 넣으면, 내가 그린 선까지 포함해서 차트를 읽어 줘요.</p>
      <div class="steps">
        <button id="cpText"><i>1</i>분석 글 복사</button>
        <button id="cpImg"><i>2</i>차트 그림 복사 (그린 선 포함)</button>
        <button id="opClaude" class="primary"><i>3</i>Claude 열기</button>
      </div>
      <label>복사될 내용 미리보기</label><textarea class="anaText" id="anaTa" readonly>${esc(text)}</textarea>`);
    $("shX").onclick = closeSheet;
    $("cpText").onclick = async () => {
      try { await navigator.clipboard.writeText(text); } catch { $("anaTa").select(); document.execCommand("copy"); }
      toast("분석 글을 복사했어요");
    };
    $("cpImg").onclick = async () => {
      const c = Chart.snapshot(); if (!c) { toast("차트를 그리지 못했어요"); return; }
      const r = await Analysis.copyImage(c);
      toast(r === "copied" ? "차트 그림을 복사했어요" : "차트 그림을 저장했어요 (사진으로 첨부하세요)");
    };
    $("opClaude").onclick = () => window.open("https://claude.ai/new", "_blank", "noopener");
  };

  // ---------- 매매 ----------
  const venueName = { bybit: "바이비트", upbit: "업비트" };
  const sideName = { long: "롱", short: "숏", buy: "현물" };
  function tradePnl(t, exitPrice) {
    const ex = exitPrice ?? t.exit;
    if (!ex || !t.en || !t.qty) return null;
    const s = t.side === "short" ? -1 : 1;
    return s * (ex - t.en) * t.qty - (t.fee || 0);
  }
  const curOf = (t) => (t.venue === "upbit" ? "KRW" : "USD");
  const money = (v, cur) => (cur === "KRW" ? krw(v) : usd(v));
  function livePrice(t) { return t.venue === "upbit" ? st.upbit[t.coin] && st.upbit[t.coin].price : price(t.coin); }
  function toKrw(v, cur) { return cur === "KRW" ? v : st.fx ? v * st.fx.rate : null; }

  let trFilter = "all";
  seg($("trFilter"), [["전체", "all"], ["진행 중", "open"], ["종료", "closed"]], trFilter, (v) => { trFilter = v; renderTrades(); });
  async function loadData() {
    st.trades = (await Store.all("trades")).sort((a, b) => (b.date + (b.time || "")).localeCompare(a.date + (a.time || "")));
    st.journal = (await Store.all("journal")).sort((a, b) => (b.date + (b.time || "")).localeCompare(a.date + (a.time || "")));
  }
  function renderTrades() {
    const list = st.trades.filter((t) => trFilter === "all" || t.status === trFilter);
    $("trList").innerHTML = list.length ? list.map(tradeRow).join("") : `<div class="empty">아직 기록이 없어요. <b>+ 새 매매</b>로 시작해 보세요.</div>`;
    $("trList").querySelectorAll(".item").forEach((el) => el.onclick = () => tradeDetail(el.dataset.id));
  }
  function tradeRow(t) {
    const cur = curOf(t), lp = t.status === "open" ? livePrice(t) : null;
    const pnl = t.status === "open" ? (lp ? tradePnl(t, lp) : null) : (t.pnl ?? tradePnl(t));
    const pct = t.status === "open" && lp && t.en ? ((lp / t.en - 1) * 100 * (t.side === "short" ? -1 : 1)) : null;
    return `<div class="item" data-id="${t.id}">
      <div class="l1"><div><span class="badge ${t.side === "buy" ? "spot" : t.side}">${sideName[t.side]}</span><b>${esc(t.coin)}</b> <span class="mut sm">${venueName[t.venue]}${t.src === "bybit" ? " 자동" : ""} ·${esc(Market.TF[t.tf] ? Market.TF[t.tf].name : t.tf || "")}</span>${t.status === "open" ? ' <span class="badge open">진행 중</span>' : t.hit ? ` <span class="badge spot">${esc(t.hit)}</span>` : ""}</div>
      <b class="num ${sgn(pnl || 0)}">${pnl == null ? "—" : money(pnl, cur)}</b></div>
      <div class="l2"><span>${esc(t.date)} ${esc(t.time || "")} · 진입 ${t.en ? Chart.fmtP(t.en) : "—"}${t.exit ? " → " + Chart.fmtP(t.exit) : ""}</span><span>${pct != null ? `<b class="${sgn(pct)}">${pctS(pct)}</b>` : esc((t.basis || []).slice(0, 3).join(" · "))}</span></div>
    </div>`;
  }

  $("newTrade").onclick = () => tradeForm();
  function tradeForm(old) {
    const t = old || { venue: "bybit", coin: st.coin, side: "long", tf: st.tf, basis: [], mood: [] };
    sheet(`<div class="sh"><h2>${old ? "매매 수정" : "새 매매"}</h2><button class="ghost" id="shX">닫기</button></div>
      <div class="card">
        <label>거래소</label><div class="chips" id="fVen"></div>
        <div class="row"><div><label>종목</label><div class="chips" id="fCoin"></div></div><div id="sideW"><label>방향</label><div class="chips side" id="fSide"></div></div></div>
        <label>기준 시간봉</label><div class="chips" id="fTf"></div>
        <div class="row">
          <div><label for="fEn">진입가</label><div class="inp"><input id="fEn" type="number" inputmode="decimal" step="any" value="${t.en || ""}"><button type="button" id="fNow">현재가</button></div></div>
          <div><label for="fQty">수량 (코인 개수)</label><input id="fQty" type="number" inputmode="decimal" step="any" value="${t.qty || ""}" placeholder="예: 0.05"></div>
        </div>
        <div class="row">
          <div><label for="fSl">손절가</label><input id="fSl" type="number" inputmode="decimal" step="any" value="${t.sl || ""}"></div>
          <div><label for="fTp">익절가</label><input id="fTp" type="number" inputmode="decimal" step="any" value="${t.tp || ""}"></div>
        </div>
        <div class="mut sm" id="fRisk" style="margin-top:8px"></div>
      </div>
      <div class="card">
        <label>매매 근거</label><div class="chips" id="fBasis"></div>
        <label for="fWhy">근거 메모</label><textarea id="fWhy" rows="3" placeholder="왜 이 자리에서 들어가는지">${esc(t.why || "")}</textarea>
      </div>
      <div class="card">
        <label>지금 심리 상태</label><div class="chips" id="fMood"></div>
        <label for="fMoodT">떠오르는 생각</label><textarea id="fMoodT" rows="2" placeholder="지금 머릿속에 있는 말을 그대로">${esc(t.moodText || "")}</textarea>
        <label class="chk" style="display:flex;gap:8px;align-items:center;color:var(--tx);font-weight:500"><input type="checkbox" id="fSnap" ${old ? "" : "checked"} style="width:18px;min-height:0">지금 차트 그림을 같이 저장 (그린 선 포함)</label>
      </div>
      <div class="err" id="fErr"></div>
      <button class="primary" id="fSave" style="width:100%;min-height:50px;margin-top:4px">${old ? "수정 저장" : "기록 저장"}</button>`);
    $("shX").onclick = closeSheet;
    let venue = t.venue, side = t.side, coin = t.coin, tf = t.tf;
    const sideBox = () => {
      $("sideW").style.display = venue === "upbit" ? "none" : "";
      if (venue === "upbit") side = "buy"; else if (side === "buy") side = "long";
      chips($("fSide"), [["롱", "long"], ["숏", "short"]], [side], false, (v) => v);
      $("fSide").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { side = b.dataset.v; risk(); }));
    };
    chips($("fVen"), [["바이비트 선물", "bybit"], ["업비트 현물", "upbit"]], [venue], false);
    $("fVen").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { venue = b.dataset.v; sideBox(); risk(); }));
    chips($("fCoin"), Market.COINS, [coin], false);
    $("fCoin").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => (coin = b.dataset.v)));
    chips($("fTf"), Object.entries(Market.TF).map(([k, v]) => [v.name, k]), [tf], false);
    $("fTf").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => (tf = b.dataset.v)));
    sideBox();
    const getBasis = chips($("fBasis"), BASIS.concat((t.basis || []).filter((b) => !BASIS.includes(b))), t.basis || [], true);
    const getMood = chips($("fMood"), MOODS, t.mood || [], true);
    $("fNow").onclick = () => { const p = venue === "upbit" ? st.upbit[coin] && st.upbit[coin].price : price(coin); if (p) { $("fEn").value = p; risk(); } };
    function risk() {
      const en = +$("fEn").value, q = +$("fQty").value, sl = +$("fSl").value, tp = +$("fTp").value, cur = venue === "upbit" ? "KRW" : "USD";
      const s = side === "short" ? -1 : 1, out = [];
      if (en && sl) out.push(`손절까지 ${((sl / en - 1) * 100).toFixed(2)}%` + (q ? ` (${money(s * (sl - en) * q, cur)})` : ""));
      if (en && tp) out.push(`익절까지 ${((tp / en - 1) * 100).toFixed(2)}%` + (q ? ` (${money(s * (tp - en) * q, cur)})` : ""));
      if (en && sl && tp && (tp - en) * s > 0 && (en - sl) * s > 0) out.push(`손익비 1 : ${((tp - en) / (en - sl)).toFixed(2)}`);
      $("fRisk").textContent = out.join(" · ");
    }
    ["fEn", "fQty", "fSl", "fTp"].forEach((i) => $(i).addEventListener("input", risk)); risk();
    $("fSave").onclick = async () => {
      const en = +$("fEn").value;
      if (!en) { $("fErr").textContent = "진입가를 넣어 주세요."; return; }
      const n = Object.assign(old || { id: Store.uid("t"), date: today(), time: nowHM(), status: "open" }, {
        venue, coin, side: venue === "upbit" ? "buy" : side, tf, en, qty: +$("fQty").value || 0, sl: +$("fSl").value || 0, tp: +$("fTp").value || 0,
        basis: getBasis(), why: $("fWhy").value.trim(), mood: getMood(), moodText: $("fMoodT").value.trim(),
      });
      if ($("fSnap").checked && coin === st.coin) n.img = (await chartShot()) || n.img || null;
      await Store.put("trades", n); await loadData(); closeSheet(); renderTrades(); toast("매매를 기록했어요");
    };
  }

  function tradeDetail(id) {
    const t = st.trades.find((x) => x.id === id); if (!t) return;
    const cur = curOf(t), lp = livePrice(t), pnl = t.status === "open" ? (lp ? tradePnl(t, lp) : null) : (t.pnl ?? tradePnl(t));
    sheet(`<div class="sh"><h2><span class="badge ${t.side === "buy" ? "spot" : t.side}">${sideName[t.side]}</span>${esc(t.coin)} ${venueName[t.venue]}</h2><button class="ghost" id="shX">닫기</button></div>
      <div class="card"><div class="kv">
        <span>날짜</span><b>${esc(t.date)} ${esc(t.time || "")}</b>
        <span>시간봉</span><b>${esc(Market.TF[t.tf] ? Market.TF[t.tf].name : t.tf || "—")}</b>
        <span>진입가 · 수량</span><b>${Chart.fmtP(t.en)} · ${t.qty || "—"}</b>
        <span>손절 · 익절</span><b>${t.sl ? Chart.fmtP(t.sl) : "—"} · ${t.tp ? Chart.fmtP(t.tp) : "—"}</b>
        ${t.status === "open" ? `<span>현재가</span><b>${lp ? Chart.fmtP(lp) : "—"}</b><span>평가 손익</span><b class="${sgn(pnl || 0)}">${pnl == null ? "—" : money(pnl, cur)}</b>`
        : `<span>청산가</span><b>${t.exit ? Chart.fmtP(t.exit) : "—"} (${esc(t.closeDate || "")})</b><span>실현 손익</span><b class="${sgn(pnl || 0)}">${pnl == null ? "—" : money(pnl, cur)}</b><span>결과</span><b>${esc(t.hit || "—")}</b>`}
      </div></div>
      <div class="card"><h3>매매 근거</h3><div class="chips">${(t.basis || []).map((b) => `<button class="on" disabled>${esc(b)}</button>`).join("") || '<span class="mut sm">없음</span>'}</div>${t.why ? `<p style="white-space:pre-wrap;margin:10px 0 0">${esc(t.why)}</p>` : ""}</div>
      <div class="card"><h3>심리 상태</h3><div class="chips">${(t.mood || []).map((b) => `<button class="on" disabled>${esc(b)}</button>`).join("") || '<span class="mut sm">없음</span>'}</div>${t.moodText ? `<p style="white-space:pre-wrap;margin:10px 0 0">${esc(t.moodText)}</p>` : ""}
        ${t.lesson ? `<h3 style="margin-top:14px">청산 후 생각</h3><p style="white-space:pre-wrap;margin:0">${esc(t.lesson)}</p>` : ""}</div>
      ${t.img ? `<div class="card"><h3>진입 때 차트</h3><img class="pic" src="${t.img}" alt="진입 때 차트"></div>` : ""}
      ${t.imgRes ? `<div class="card"><h3>결과 차트</h3><img class="pic" src="${t.imgRes}" alt="결과 차트"></div>` : ""}
      <div class="row wrap">${t.status === "open" ? '<button class="primary" id="dClose">청산 기록</button>' : '<button id="dReopen">진행 중으로 되돌리기</button>'}<button id="dEdit">수정</button><button class="danger" id="dDel">삭제</button></div>`);
    $("shX").onclick = closeSheet;
    $("dEdit").onclick = () => tradeForm(t);
    if ($("dClose")) $("dClose").onclick = () => closeForm(t);
    if ($("dReopen")) $("dReopen").onclick = async () => { Object.assign(t, { status: "open", exit: 0, pnl: null, hit: "" }); await Store.put("trades", t); await loadData(); tradeDetail(t.id); renderTrades(); };
    $("dDel").onclick = async (e) => {
      if (e.target.dataset.s !== "1") { e.target.dataset.s = "1"; e.target.textContent = "한 번 더 누르면 삭제"; return; }
      await Store.del("trades", t.id); await loadData(); closeSheet(); renderTrades(); toast("삭제했어요");
    };
  }
  function closeForm(t) {
    sheet(`<div class="sh"><h2>청산 기록</h2><button class="ghost" id="shX">닫기</button></div>
      <div class="card">
        <div class="row" style="margin-top:0"><div><label for="cEx">청산가</label><div class="inp"><input id="cEx" type="number" inputmode="decimal" step="any"><button type="button" id="cNow">현재가</button></div></div>
        <div><label for="cFee">수수료 (${curOf(t) === "KRW" ? "원" : "$"})</label><input id="cFee" type="number" inputmode="decimal" step="any" value="${t.fee || ""}"></div></div>
        <div class="row"><button type="button" id="cTp" ${t.tp ? "" : "disabled"}>익절가로</button><button type="button" id="cSl" ${t.sl ? "" : "disabled"}>손절가로</button></div>
        <div class="mut sm" id="cRes" style="margin-top:8px"></div>
        <label>결과</label><div class="chips" id="cHit"></div>
        <label>지금 심리 상태</label><div class="chips" id="cMood"></div>
        <label for="cLes">청산 후 생각 · 배운 점</label><textarea id="cLes" rows="3">${esc(t.lesson || "")}</textarea>
        <label class="chk" style="display:flex;gap:8px;align-items:center;color:var(--tx);font-weight:500"><input type="checkbox" id="cSnap" checked style="width:18px;min-height:0">지금 차트 그림을 결과로 저장</label>
      </div>
      <button class="primary" id="cSave" style="width:100%;min-height:50px">청산 저장</button>`);
    $("shX").onclick = closeSheet;
    let hit = "";
    const getMood = chips($("cMood"), MOODS, [], true);
    const setHit = (h) => { hit = h; chips($("cHit"), [["적중 O", "O"], ["미적중 X", "X"], ["부분", "부분"]], [h], false); $("cHit").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => (hit = b.dataset.v))); };
    setHit("");
    const calc = () => { const ex = +$("cEx").value; t.fee = +$("cFee").value || 0; const p = ex ? tradePnl(t, ex) : null; $("cRes").innerHTML = p == null ? "" : `실현 손익 <b class="${sgn(p)}">${money(p, curOf(t))}</b>`; if (p != null && !hit) setHit(p > 0 ? "O" : p < 0 ? "X" : "부분"); };
    $("cNow").onclick = () => { const p = livePrice(t); if (p) { $("cEx").value = p; calc(); } };
    $("cTp").onclick = () => { $("cEx").value = t.tp; setHit("O"); calc(); };
    $("cSl").onclick = () => { $("cEx").value = t.sl; setHit("X"); calc(); };
    ["cEx", "cFee"].forEach((i) => $(i).addEventListener("input", calc));
    $("cSave").onclick = async () => {
      const ex = +$("cEx").value; if (!ex) { toast("청산가를 넣어 주세요"); return; }
      Object.assign(t, { status: "closed", exit: ex, closeDate: today(), fee: +$("cFee").value || 0, hit, lesson: $("cLes").value.trim() });
      t.pnl = tradePnl(t);
      const m = getMood(); if (m.length) t.closeMood = m;
      if ($("cSnap").checked && t.coin === st.coin) t.imgRes = (await chartShot()) || t.imgRes || null;
      await Store.put("trades", t); await loadData(); closeSheet(); renderTrades(); toast("청산을 기록했어요");
    };
  }

  // ---------- 일지 ----------
  $("jDate").value = today();
  let getMood = chips($("moodChips"), MOODS, [], true), jImg = null, jEdit = null;
  const memoTa = $("memoText");
  memoTa.addEventListener("input", () => { memoTa.style.height = "auto"; memoTa.style.height = memoTa.scrollHeight + "px"; });
  $("memoSave").onclick = async () => {
    const v = memoTa.value.trim(); if (!v) return;
    await Store.put("journal", { id: Store.uid("m"), kind: "memo", date: today(), time: nowHM(), text: v });
    memoTa.value = ""; memoTa.style.height = "auto"; $("memoMsg").textContent = "저장했어요 · " + nowHM();
    await loadData(); renderJournal();
  };
  $("jImgBtn").onclick = () => $("jImg").click();
  $("jImg").onchange = async (e) => { const f = e.target.files[0]; if (!f) return; jImg = await shrink(f); $("jImgPrev").innerHTML = `<img class="pic" src="${jImg}" alt="첨부 사진">`; e.target.value = ""; };
  $("jDate").onchange = () => { jEdit = null; renderJournal(); };
  $("jSave").onclick = async () => {
    const text = $("jText").value.trim(), mood = getMood();
    if (!text && !mood.length && !jImg) { $("jMsg").textContent = "내용을 적어 주세요."; return; }
    const d = $("jDate").value || today();
    const e = Object.assign(jEdit || { id: Store.uid("j"), kind: "diary", date: d, time: nowHM() }, { text, mood, img: jImg || (jEdit && jEdit.img) || null });
    await Store.put("journal", e); jEdit = e;
    $("jMsg").textContent = "저장했어요 · " + nowHM(); await loadData(); renderJournal(true);
  };
  function renderJournal(keepForm) {
    const d = $("jDate").value || today();
    const diary = st.journal.find((j) => j.kind === "diary" && j.date === d && !j.src);
    if (!keepForm) {
      jEdit = diary || null; jImg = null;
      $("jText").value = diary ? diary.text || "" : "";
      getMood = chips($("moodChips"), MOODS, diary ? diary.mood || [] : [], true);
      $("jImgPrev").innerHTML = diary && diary.img ? `<img class="pic" src="${diary.img}" alt="첨부 사진">` : "";
      $("jMsg").textContent = "";
    }
    const items = [
      ...st.journal.filter((j) => j.date === d && j !== diary).map((j) => ({ t: j.time || "", html: `<span class="badge spot">${j.kind === "memo" ? "메모" : "일지"}</span>${j.mood && j.mood.length ? esc(j.mood.join(" · ")) : ""}<p>${esc(j.text || "")}</p>${j.img ? `<img class="pic" src="${j.img}" alt="">` : ""}`, id: j.id })),
      ...st.trades.filter((t) => t.date === d).map((t) => ({ t: t.time || "", html: `<span class="badge ${t.side === "buy" ? "spot" : t.side}">${sideName[t.side]}</span><b>${esc(t.coin)}</b> 진입 ${Chart.fmtP(t.en)}${t.why ? `<p>${esc(t.why)}</p>` : ""}${t.mood && t.mood.length ? `<p class="mut sm">심리: ${esc(t.mood.join(" · "))}${t.moodText ? " — " + esc(t.moodText) : ""}</p>` : ""}` })),
      ...st.trades.filter((t) => t.closeDate === d && t.status === "closed").map((t) => ({ t: "", html: `<span class="badge spot">청산</span><b>${esc(t.coin)}</b> ${t.pnl != null ? `<b class="${sgn(t.pnl)}">${money(t.pnl, curOf(t))}</b>` : ""}${t.lesson ? `<p>${esc(t.lesson)}</p>` : ""}` })),
    ].sort((a, b) => b.t.localeCompare(a.t));
    $("dayList").innerHTML = items.length ? `<div class="tl">${items.map((i) => `<div class="ent"><div class="t">${esc(i.t)}</div>${i.html}${i.id ? ` <button class="ghost sm danger" data-del="${i.id}">삭제</button>` : ""}</div>`).join("")}</div>` : `<div class="empty">이날의 메모·매매가 없어요.</div>`;
    $("dayList").querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
      if (b.dataset.s !== "1") { b.dataset.s = "1"; b.textContent = "한 번 더 누르면 삭제"; return; }
      await Store.del("journal", b.dataset.del); await loadData(); renderJournal(true);
    });
    const days = [...new Set(st.journal.filter((j) => j.date !== d).map((j) => j.date))].sort().reverse().slice(0, 30);
    $("pastList").innerHTML = days.length ? days.map((day) => {
      const js = st.journal.filter((j) => j.date === day), first = js.find((j) => j.kind === "diary") || js[0];
      const moods = [...new Set(js.flatMap((j) => j.mood || []))];
      return `<div class="item" data-d="${day}"><div class="l1"><b class="num">${day}</b><span class="mut sm">${js.length}개</span></div><div class="l2"><span>${esc((first.text || "").slice(0, 60))}</span><span>${esc(moods.slice(0, 3).join(" · "))}</span></div></div>`;
    }).join("") : `<div class="empty">지난 일지가 없어요.</div>`;
    $("pastList").querySelectorAll(".item").forEach((el) => el.onclick = () => { $("jDate").value = el.dataset.d; renderJournal(); scrollTo({ top: 0, behavior: "smooth" }); });
  }

  // ---------- 회계 ----------
  let pnlRange = "month";
  seg($("pnlSeg"), [["이번 달", "month"], ["지난달", "prev"], ["올해", "year"], ["전체", "all"]], pnlRange, (v) => { pnlRange = v; renderAcct(); });
  function inRange(d) {
    if (!d) return false;
    const n = new Date(), y = n.getFullYear(), m = n.getMonth() + 1, ym = (yy, mm) => `${yy}-${String(mm).padStart(2, "0")}`;
    if (pnlRange === "month") return d.startsWith(ym(y, m));
    if (pnlRange === "prev") return d.startsWith(m === 1 ? ym(y - 1, 12) : ym(y, m - 1));
    if (pnlRange === "year") return d.startsWith(String(y));
    return true;
  }
  function renderAcct() {
    $("aFx").textContent = st.fx ? "₩" + st.fx.rate.toFixed(2) : "—";
    $("aFxNote").textContent = st.fx ? "기준 " + new Date(st.fx.at).toLocaleDateString("ko-KR") + " · 하루 한 번 갱신" : "불러오는 중";
    const u = st.upbit.USDT;
    $("aUsdt").textContent = u ? "₩" + u.price.toLocaleString("ko-KR") : "—";
    $("aUsdtNote").textContent = u && st.fx ? `환율 대비 ${pctS((u.price / st.fx.rate - 1) * 100)}` : "";
    $("kpTable").innerHTML = `<table><tr><th>종목</th><th>업비트</th><th>바이비트(원화)</th><th>김프</th></tr>${Market.COINS.map((c) => {
      const up = st.upbit[c], p = price(c), k = kimp(c);
      return `<tr><td><b>${c}</b></td><td>${up ? krw(up.price) : "—"}</td><td>${p && st.fx ? krw(p * st.fx.rate) : "—"}</td><td class="${sgn(k || 0)}">${k == null ? "—" : pctS(k)}</td></tr>`;
    }).join("")}</table>`;
    const closed = st.trades.filter((t) => t.status === "closed" && inRange(t.closeDate || t.date));
    const sum = (v) => closed.filter((t) => t.venue === v).reduce((a, t) => a + (t.pnl ?? tradePnl(t) ?? 0), 0);
    const by = sum("bybit"), ub = sum("upbit"), tot = (toKrw(by, "USD") ?? 0) + ub;
    const wins = closed.filter((t) => (t.pnl ?? 0) > 0).length;
    $("pnlBody").innerHTML = `<div class="kv" style="margin-top:12px">
      <span>바이비트 (선물)</span><b class="${sgn(by)}">${usd(by)}${st.fx ? ` <span class="mut sm">${krw(by * st.fx.rate)}</span>` : ""}</b>
      <span>업비트 (현물)</span><b class="${sgn(ub)}">${krw(ub)}</b>
      <span>합계 (원화)</span><b class="${sgn(tot)}" style="font-size:18px">${krw(tot)}</b>
      <span>종료한 매매</span><b>${closed.length}건 · 수익 ${wins}건${closed.length ? ` (${Math.round(wins / closed.length * 100)}%)` : ""}</b>
    </div>`;
    const open = st.trades.filter((t) => t.status === "open");
    $("openBody").innerHTML = open.length ? `<table><tr><th>포지션</th><th>진입</th><th>현재</th><th>평가 손익</th></tr>${open.map((t) => {
      const lp = livePrice(t), p = lp ? tradePnl(t, lp) : null;
      return `<tr><td><span class="badge ${t.side === "buy" ? "spot" : t.side}">${sideName[t.side]}</span>${t.coin}</td><td>${Chart.fmtP(t.en)}</td><td>${lp ? Chart.fmtP(lp) : "—"}</td><td class="${sgn(p || 0)}">${p == null ? "—" : money(p, curOf(t))}</td></tr>`;
    }).join("")}</table>` : `<div class="empty">진행 중인 포지션이 없어요.</div>`;
  }

  // ---------- 홈 ----------
  let cur = Store.pref.get("cur", "USD");
  const fmtC = (v, c = cur) => (c === "KRW" ? krw(v) : usd(v));
  const sgC = (v, c = cur) => (v > 0 ? "+" : "") + fmtC(v, c);
  const conv = (v, from, to = cur) => { if (from === to) return v; if (!st.fx) return null; return from === "USD" ? v * st.fx.rate : v / st.fx.rate; };
  $("curBtn").onclick = () => { cur = cur === "USD" ? "KRW" : "USD"; Store.pref.set("cur", cur); renderHome(); };
  const ymNow = () => today().slice(0, 7);
  function sumPnl(list) {
    let v = 0, ok = true;
    for (const t of list) { const p = t.pnl ?? tradePnl(t); if (p == null) continue; const c = conv(p, curOf(t)); if (c == null) ok = false; else v += c; }
    return ok ? v : null;
  }
  function renderHero() {
    const closed = st.trades.filter((t) => t.status === "closed");
    const mPl = sumPnl(closed.filter((t) => (t.closeDate || t.date || "").startsWith(ymNow()))), pl = sumPnl(closed);
    let un = 0;
    for (const t of st.trades.filter((x) => x.status === "open")) { const lp = livePrice(t), p = lp ? tradePnl(t, lp) : null, c = p == null ? null : conv(p, curOf(t)); if (c != null) un += c; }
    const bbAuto = Bybit.equity, bb = bbAuto ? bbAuto.v : +Store.pref.get("asBybit", 0) || 0, ub = +Store.pref.get("asUpbit", 0) || 0;
    const eqU = bb ? conv(bb, "USD") : 0, eqK = ub ? conv(ub, "KRW") : 0, has = !!(bb || ub);
    const eq = has && eqU != null && eqK != null ? eqU + eqK : null;
    // 바이비트 자동 잔고에는 미실현이 이미 들어 있음. 손으로 넣은 값엔 더해 줌
    const eqShow = eq == null ? null : eq + (bbAuto ? 0 : un);
    const base = eqShow == null ? 0 : eqShow - un;
    const pc = (x, b) => (b > 0 ? `${x >= 0 ? "+" : "−"}${Math.abs(x / b * 100).toFixed(1)}%` : "");
    const sym = cur === "KRW" ? "₩" : "$";
    const num = (v) => fmtC(Math.abs(v)).slice(1);
    $("hHero").innerHTML = `<div class="hl">현재 자산</div>`
      + (eqShow == null
        ? `<div class="hv empty">${has ? "환율을 불러오는 중…" : "자산을 아직 몰라요"}</div>${has ? "" : `<button class="primary" id="hSet">설정에서 바이비트 연결 · 자산 입력</button>`}`
        : `<div class="hv"><span class="cs">${eqShow < 0 ? "-" : ""}${sym}</span>${num(eqShow)}</div>`
          + `<div class="hsub">${bb ? `<span>바이비트 <b>${usd(bb)}</b>${bbAuto ? " · 자동" : ""}</span>` : ""}${ub ? `<span>업비트 <b>${krw(ub)}</b></span>` : ""}${un ? `<span>미실현 <b class="${sgn(un)}">${sgC(un)}</b></span>` : ""}</div>`)
      + `<div class="hrow"><div><span>이번 달</span><b class="${sgn(mPl || 0)}">${mPl == null ? "—" : sgC(mPl)}</b><small class="${sgn(mPl || 0)}">${mPl == null ? "" : pc(mPl, base - mPl)}</small></div>`
      + `<div><span>누적</span><b class="${sgn(pl || 0)}">${pl == null ? "—" : sgC(pl)}</b><small class="${sgn(pl || 0)}">${pl == null ? "" : pc(pl, base - pl)}</small></div></div>`;
    if ($("hSet")) $("hSet").onclick = () => showView("vSet");
    $("curSym").textContent = sym;
  }
  function pickCoin(c) {
    if (st.coin === c) return;
    st.coin = c; Store.pref.set("coin", c);
    seg($("coinSeg"), Market.COINS.map((x) => [x, x]), st.coin, (x) => { st.coin = x; Store.pref.set("coin", x); loadChart(); renderTop(); });
    loadChart(); renderTop();
  }
  function renderTicks() {
    $("hTick").innerHTML = Market.COINS.map((c) => {
      const t = st.tick[c] || {}, p = price(c), k = kimp(c);
      return `<button class="tick" data-c="${c}"><span class="t1">${c}<span class="chg ${sgn(t.chg || 0)}">${t.chg != null ? pctS(t.chg) : "—"}</span></span><b>${p ? Chart.fmtP(p) : "—"}</b><small>김프 <span class="${sgn(k || 0)}">${k == null ? "—" : pctS(k)}</span></small></button>`;
    }).join("");
    $("hTick").querySelectorAll(".tick").forEach((b) => b.onclick = () => { pickCoin(b.dataset.c); lastTab = "vChart"; showView("vChart"); });
  }
  function renderOpen() {
    const open = st.trades.filter((t) => t.status === "open");
    const td = new Date(today()).getTime();
    $("hOpen").innerHTML = open.length ? open.map((t) => {
      const days = Math.max(1, Math.round((td - new Date(t.date).getTime()) / 864e5) + 1);
      return tradeRow(t).replace(`<b>${esc(t.coin)}</b>`, `<i class="live"></i><b>${esc(t.coin)}</b>`).replace(/(<div class="l2"><span>)/, `$1보유 ${days}일 · `);
    }).join("") : `<div class="empty">진행 중인 포지션이 없어요.</div>`;
    $("hOpen").querySelectorAll(".item").forEach((el) => el.onclick = () => tradeDetail(el.dataset.id));
  }
  function renderHome() {
    $("topDate").textContent = new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
    renderHero(); renderTicks(); renderOpen();
  }
  let hT = 0;
  function homeSoon() { if (hT || !$("vHome").classList.contains("on") || document.hidden) return; hT = setTimeout(() => { hT = 0; renderHero(); renderTicks(); }, 1000); }
  function renderSet() {
    const a = Bybit.equity;
    $("asBybit").value = a ? a.v.toFixed(2) : Store.pref.get("asBybit", "") || "";
    $("asBybit").disabled = !!a;
    $("asUpbit").value = Store.pref.get("asUpbit", "") || "";
  }
  $("asBybit").oninput = () => Store.pref.set("asBybit", $("asBybit").value);
  $("asUpbit").oninput = () => Store.pref.set("asUpbit", $("asUpbit").value);

  // ---------- 노트 가져오기 · 백업 ----------
  async function importNote(json) {
    let data; try { data = typeof json === "string" ? JSON.parse(json) : json; } catch { throw new Error("형식이 맞지 않아요"); }
    if (data && data.app === "trade-agent") return restore(data);
    const entries = (data && data.entries) || (Array.isArray(data) ? data : null);
    if (!entries) throw new Error("노트 백업이 아니에요");
    const trades = [], journal = [], legacy = [];
    for (const e of entries) {
      legacy.push({ id: "note_" + e.id, raw: e });
      if (e.del) continue;
      if (e.nd) { journal.push({ id: "note_" + e.id, src: "note", kind: "diary", date: e.date, time: e.time || "", text: e.text || "", mood: [], img: e.imgPred || null }); continue; }
      if (e.wd || e.pat) continue;
      if (!e.en && !e.why) continue;
      const venue = e.venue === "업비트" ? "upbit" : "bybit";
      const tfMap = { "15분봉": "15m", "1시간": "1h", "4시간": "4h", "일봉": "1d", "주봉": "1w" };
      const closed = !!(e.hit || e.ex || (e.pnl !== "" && e.pnl != null && !isNaN(parseFloat(e.pnl))));
      trades.push({
        id: "note_" + e.id, src: "note", venue, coin: e.sym || "BTC", side: venue === "upbit" ? "buy" : e.dir === "하락" ? "short" : "long",
        tf: tfMap[e.tf] || e.tf || "", date: e.date, time: "", en: +e.en || 0, qty: +e.qty || 0, sl: +e.sl || 0, tp: +e.tp || 0,
        basis: e.basis || [], why: e.why || "", mood: [], moodText: "", trend: e.dtr || "", ses: e.ses || "",
        status: closed ? "closed" : "open", exit: +e.ex || 0, pnl: isNaN(parseFloat(e.pnl)) ? null : parseFloat(e.pnl), fee: +e.fee || 0,
        hit: e.hit || "", lesson: e.lesson || "", closeDate: e.cd || e.date, img: e.imgPred || null, imgRes: e.imgRes || null,
      });
    }
    await Store.putMany("trades", trades); await Store.putMany("journal", journal); await Store.putMany("legacy", legacy);
    if (data.seed || data.seedU) Store.pref.set("noteSeed", { bybit: data.seed, upbit: data.seedU });
    await loadData();
    return `노트에서 매매 ${trades.length}건, 일지 ${journal.length}개를 가져왔어요.`;
  }
  async function backup() {
    return { app: "trade-agent", v: 1, at: new Date().toISOString(), trades: await Store.all("trades"), journal: await Store.all("journal"), drawings: await Store.all("drawings"), legacy: await Store.all("legacy") };
  }
  async function restore(d) {
    for (const k of ["trades", "journal", "drawings", "legacy"]) if (d[k]) await Store.putMany(k, d[k]);
    await loadData(); await loadDrawings();
    return `백업을 불러왔어요 (매매 ${(d.trades || []).length}건, 일지 ${(d.journal || []).length}개).`;
  }
  $("impFileBtn").onclick = () => $("impFile").click();
  $("impFile").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { $("impMsg").textContent = await importNote(await f.text()); renderAcct(); } catch (x) { $("impMsg").textContent = "불러오지 못했어요: " + x.message; }
    e.target.value = "";
  };
  $("impTextBtn").onclick = () => {
    sheet(`<div class="sh"><h2>백업 텍스트 붙여넣기</h2><button class="ghost" id="shX">닫기</button></div>
      <p class="mut sm" style="margin-top:0">노트 설정 → 데이터 → <b>백업 텍스트 보기</b>에서 전체를 복사해 아래에 붙여 넣으세요.</p>
      <textarea id="impTa" class="anaText" placeholder="여기에 붙여넣기"></textarea>
      <button class="primary" id="impGo" style="width:100%;margin-top:10px;min-height:48px">가져오기</button><div class="err" id="impErr"></div>`);
    $("shX").onclick = closeSheet;
    $("impGo").onclick = async () => {
      try { const m = await importNote($("impTa").value); closeSheet(); $("impMsg").textContent = m; toast(m); renderAcct(); } catch (x) { $("impErr").textContent = "불러오지 못했어요: " + x.message; }
    };
  };
  $("expBtn").onclick = async () => {
    const blob = new Blob([JSON.stringify(await backup())], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `trade-agent-backup-${today()}.json`; a.click();
    toast("백업 파일을 저장했어요");
  };

  // ---------- 폰·PC 동기화 ----------
  Sync.init(async () => {
    await loadData(); await loadDrawings();
    if ($("vHome").classList.contains("on")) renderHome();
    if ($("vTrade").classList.contains("on")) renderTrades();
    if ($("vJournal").classList.contains("on")) renderJournal(true);
    if ($("vAcct").classList.contains("on")) renderAcct();
  }, (s, u) => {
    $("syncMsg").innerHTML = u ? `<b>${esc(u.email || "로그인됨")}</b> · ${esc(s.msg)}` : esc(s.msg);
    $("syncErr").textContent = s.err || "";
    const b = $("syncBtn");
    b.disabled = !u && /연결 정보|인터넷/.test(s.msg);
    b.textContent = u ? "로그아웃" : "구글로 로그인";
    b.className = u ? "" : "primary";
  });
  $("syncBtn").onclick = () => (Sync.user ? Sync.logout() : Sync.login());

  // ---------- 바이비트 연결 ----------
  const refreshViews = async () => {
    await loadData();
    if ($("vHome").classList.contains("on")) renderHome();
    if ($("vTrade").classList.contains("on")) renderTrades();
    if ($("vJournal").classList.contains("on")) renderJournal(true);
    if ($("vAcct").classList.contains("on")) renderAcct();
  };
  function bbView(s, on, live) {
    if (!on) {
      if (!$("bbKey")) {
        $("bbBody").innerHTML = `<p class="mut sm" style="margin-top:0">바이비트에서 만든 <b>읽기 전용</b> 열쇠를 넣으면 매매가 자동으로 기록돼요. 열쇠는 이 기기에만 저장되고 동기화로 올라가지 않아요. (기록은 동기화돼요)</p>
          <label for="bbKey">API Key</label><input id="bbKey" autocomplete="off" spellcheck="false">
          <label for="bbSec">API Secret</label><input id="bbSec" type="password" autocomplete="off" spellcheck="false">
          <div class="row"><button class="primary" id="bbGo">연결</button></div>`;
        $("bbGo").onclick = async () => {
          $("bbGo").disabled = true; $("bbErr").textContent = "";
          try { const n = await Bybit.connect($("bbKey").value, $("bbSec").value); toast(`바이비트 연결됨 · 최근 30일 기록 ${n}건 반영`); await refreshViews(); }
          catch (e) { $("bbErr").textContent = e.message; }
          finally { if ($("bbGo")) $("bbGo").disabled = false; }
        };
      }
      $("bbMsg").textContent = s.msg || "";
    } else {
      $("bbBody").innerHTML = `<p style="margin-top:0"><b class="${live ? "up" : ""}">● ${live ? "실시간 연결됨" : "연결됨 (실시간 다시 잇는 중)"}</b></p>
        <div class="row wrap"><button id="bbNow">지금 새로 읽기</button><button id="bbHist">지난 1년 기록 가져오기</button><button class="danger" id="bbOff">연결 끊기</button></div>`;
      $("bbMsg").textContent = s.msg || (s.at ? "마지막 확인 " + new Date(s.at).toTimeString().slice(0, 5) : "");
      $("bbNow").onclick = () => Bybit.refresh(Date.now() - 7 * 864e5).then((n) => toast(n ? `${n}건 반영했어요` : "새 기록이 없어요")).catch(() => {});
      $("bbHist").onclick = async (e) => {
        e.target.disabled = true;
        try { const n = await Bybit.refresh(Date.now() - 365 * 864e5, (p, c) => ($("bbMsg").textContent = `가져오는 중… ${Math.round(p * 100)}% (${c}건)`)); toast(`지난 1년 · ${n}건 반영했어요`); }
        catch {} finally { if (e.target) e.target.disabled = false; }
      };
      $("bbOff").onclick = (e) => {
        if (e.target.dataset.s !== "1") { e.target.dataset.s = "1"; e.target.textContent = "한 번 더 누르면 끊기 (기록은 남아요)"; return; }
        Bybit.disconnect();
      };
    }
    $("bbErr").textContent = s.err || "";
  }
  Bybit.init(bbView, refreshViews);

  // ---------- 시작 ----------
  (async () => {
    document.body.dataset.v = "vHome";
    await loadData();
    renderHome();
    loadFx(); setInterval(loadFx, 6 * 3600e3);
    pollUpbit(); setInterval(pollUpbit, 4000);
    await loadChart();
    setInterval(() => { if (document.hidden) return; if ($("vTrade").classList.contains("on")) renderTrades(); if ($("vAcct").classList.contains("on")) renderAcct(); if ($("vHome").classList.contains("on")) renderOpen(); }, 3000);
  })();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => Chart.retheme());
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
