// 화면 동작: 차트 · 매매 · 일지 · 회계
(() => {
  const $ = (id) => document.getElementById(id);
  // 글칸 자동완성·자동고침 끄기 (나중에 생기는 글칸도 포함)
  const noAuto = (root) => root.querySelectorAll && root.querySelectorAll('textarea, input:not([type]), input[type="text"], input[type="search"], input[type="number"]').forEach((el) => {
    el.setAttribute("autocomplete", "off"); el.setAttribute("autocorrect", "off"); el.setAttribute("autocapitalize", "off"); el.spellcheck = false;
  });
  noAuto(document);
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.nodeType === 1 && (noAuto(n), n.matches("textarea, input") && noAuto(n.parentNode))))).observe(document.body, { childList: true, subtree: true });
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
    tick: {}, upbit: {}, fx: null, trades: [], journal: [], drawings: [], cash: [],
  };

  // ---------- 공통 UI ----------
  function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 2200); }
  // 폰 뒤로가기: 팝업·하위 화면을 하나씩 닫고, 앱은 나가지 않게
  let layers = [], ignorePop = 0;
  const pushLayer = (l) => { layers.push(l); history.pushState({ ta: layers.length }, ""); };
  addEventListener("popstate", () => {
    if (ignorePop) { ignorePop--; return; }
    const l = layers.pop();
    if (!l) return;
    if (l.type === "sheet") hideSheet();
    else if (l.type === "markup") Markup.cancel();
    else showView(l.back, true);
  });
  function hideSheet() { $("sheet").hidden = $("sheetBg").hidden = true; $("sheetIn").innerHTML = ""; }
  function sheet(html) {
    if ($("sheet").hidden) pushLayer({ type: "sheet" });
    $("sheetIn").innerHTML = html; $("sheet").hidden = $("sheetBg").hidden = false; $("sheet").scrollTop = 0;
  }
  function closeSheet() {
    if ($("sheet").hidden) return;
    hideSheet();
    if (layers.length && layers[layers.length - 1].type === "sheet") { layers.pop(); ignorePop++; history.back(); }
  }
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
  const isSub = (v) => v === "vSet" || v === "vAcct" || /^vT[A-Z]/.test(v);
  function showView(v, fromBack) {
    const cur = document.body.dataset.v;
    if (!fromBack && v !== cur) {
      if (isSub(v)) pushLayer({ type: "view", back: cur || "vHome" });
      else layers = layers.filter((l) => l.type !== "view");
    }
    const tabV = /^vT[A-Z]/.test(v) ? "vTeam" : v === "vAcct" ? "vHome" : v;
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("on", x.dataset.v === tabV));
    document.querySelectorAll(".view").forEach((x) => x.classList.toggle("on", x.id === v));
    document.body.dataset.v = v;
    scrollTo(0, 0);
    if (v === "vChart") fitChartView();
    if (v === "vHome") renderHome();
    if (v === "vSet") { renderSet(); if (!Upbit.local) ubView(Upbit.status, { local: false }); }
    if (v === "vTeam") renderTeamList();
    if (v === "vTRisk") renderRisk();
    if (v === "vTMind") renderMind();
    if (v === "vTData") renderData();
    if (v === "vTTalk") renderTalk();
    if (v === "vAcct") renderAcct();
    if (v !== "vChart") stopTool();
  }
  $("setBtn").onclick = () => showView("vSet");
  // 화면 안의 닫기·‹ 버튼도 뒤로가기와 똑같이
  function goBack(fallback) {
    const l = layers.length && layers[layers.length - 1];
    if (l && l.type === "view") { layers.pop(); ignorePop++; history.back(); showView(l.back, true); } else showView(fallback);
  }
  $("setX").onclick = () => goBack(lastTab);
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
    if (d.fundingRate) o.fr = +d.fundingRate;
    if (d.openInterestValue) o.oi = +d.openInterestValue;
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
  function buildTfSeg() { seg($("tfSeg"), Object.entries(Market.TF).map(([k, v]) => [v.name, k]), st.tf, (t) => { st.tf = t; Store.pref.set("tf", t); loadChart(); }); }
  buildTfSeg();
  function buildCoinSeg() { seg($("coinSeg"), Market.COINS.map((c) => [c, c]), st.coin, (c) => { st.coin = c; Store.pref.set("coin", c); loadChart(); renderTop(); }); }
  async function setChart(coin, tf) {
    if (coin === st.coin && (!tf || tf === st.tf)) return;
    st.coin = coin; Store.pref.set("coin", coin);
    if (tf && Market.TF[tf]) { st.tf = tf; Store.pref.set("tf", tf); }
    buildCoinSeg(); buildTfSeg(); renderTop();
    await loadChart();
  }
  let curTopics = [];
  async function loadChart() {
    stopTool();
    const coin = st.coin, tf = st.tf;
    try {
      const bars = await Market.klines(coin, tf, 1000);
      if (coin !== st.coin || tf !== st.tf) return;
      Chart.setData(coin, tf, bars);
      updatePosLines();
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
    fibx: '<svg viewBox="0 0 24 24"><path d="M3 19l5-9 4 5"/><path d="M12 4h9M12 8h9M12 12h9"/></svg>',
    erase: '<svg viewBox="0 0 24 24"><path d="M5 5l14 14M19 5L5 19"/></svg>',
  };
  const TOOLS = [["hline", "수평선"], ["tline", "추세선"], ["channel", "평행채널"], ["fib", "피보"], ["fibx", "확장 피보"], ["erase", "지우기"]];
  const HINT = {
    hline: ["가격을 한 번 누르세요"], tline: ["시작점을 누르세요", "끝점을 누르세요"], fib: ["시작점(1)을 누르세요", "끝점(0)을 누르세요"], fibx: ["추세 시작점(A)을 누르세요", "추세 끝점(B)을 누르세요", "되돌림 지점(C)을 누르세요"],
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
        const d = { id: Store.uid("d"), coin: st.coin, tf: st.tf, ...r.add };
        await Store.put("drawings", d); await loadDrawings();
        toast("선을 저장했어요"); stopTool();
      } else if (r.erase) {
        await Store.del("drawings", r.erase.id); await loadDrawings(); toast("선을 지웠어요");
      }
    });
  }
  function stepCount() { if (activeTool && activeTool !== "erase") { step++; hint(); } }
  function stopTool() { activeTool = null; step = 0; Chart.setTool(null); buildTools(); hint(); }
  // 선은 그린 시간봉과 그보다 작은 시간봉에서만 보임 (15분봉에 그린 채널이 주봉에서 한 캔들 안에 뭉개지지 않게)
  // 예전에 그린 선(시간봉 기록 없음)은, 지금 시간봉 캔들 2개보다 짧으면 숨김
  const TF_ORDER = ["15m", "1h", "4h", "1d", "1w"];
  function showOnTf(d, tf) {
    if (d.type === "hline") return true;
    if (d.tf) return TF_ORDER.indexOf(tf) <= TF_ORDER.indexOf(d.tf);
    const ts = [d.a, d.b, d.c].filter(Boolean).map((p) => p.t);
    return Math.max(...ts) - Math.min(...ts) >= 2 * Market.TF[tf].ms;
  }
  async function loadDrawings() {
    st.drawings = (await Store.all("drawings")).filter((d) => d.coin === st.coin && showOnTf(d, st.tf)).sort((a, b) => a.u - b.u);
    Chart.setDrawings(st.drawings);
  }
  buildTools();
  $("chart").querySelector(".overlay").addEventListener("pointerdown", stepCount);

  // 지금 차트(그린 선·포지션 선 포함)를 일지에 넣기
  $("shotBtn").onclick = async () => {
    stopTool();
    const img = await chartShot();
    if (!img) { toast("차트를 찍지 못했어요"); return; }
    const p = price();
    const e = { id: Store.uid("s"), kind: "shot", date: today(), time: nowHM(), text: `${st.coin} ${Market.TF[st.tf].name}${p ? " · " + Chart.fmtP(p) : ""}`, mood: [], img, imgEdit: null };
    await Store.put("journal", e); await loadData();
    sheet(`<div class="sh"><h2>일지에 넣었어요</h2><button class="ghost" id="shX">닫기</button></div>
      <p class="mut sm" style="margin-top:0">${esc(e.date)} ${esc(e.time)} · ${esc(e.text)}</p><img class="pic" src="${img}" alt="차트">
      <div class="row"><button class="primary" id="shotDraw">✏️ 지금 그리기·글씨</button><button id="shotGo">일지 보기</button></div>`);
    $("shX").onclick = closeSheet;
    $("shotDraw").onclick = async () => { closeSheet(); await new Promise((r) => setTimeout(r, 50)); await editRecordImage("journal", e, "img"); };
    $("shotGo").onclick = () => { closeSheet(); lastTab = "vJournal"; $("jDate").value = today(); showView("vJournal"); renderJournal(); };
  };

  // 분석 자료
  $("anaBtn").onclick = async () => {
    stopTool();
    sheet(`<div class="sh"><h2>분석 자료</h2><button class="ghost" id="shX">닫기</button></div><p class="mut sm">만드는 중이에요… (시간봉 5개를 함께 읽어요)</p>`);
    $("shX").onclick = closeSheet;
    let text = await Analysis.build(st.coin, st.tf, st.drawings, price());
    if ($("sheet").hidden) return;
    const myPos = st.trades.filter((t) => t.status === "open" && t.coin === st.coin && t.venue !== "upbit");
    if (myPos.length) text += "\n\n[내 진행 중 포지션]\n" + myPos.map((t) => `- ${sideName[t.side]} 진입 ${Chart.fmtP(t.en)}${t.qty ? ` · ${t.qty}개` : ""}${t.sl ? ` · 손절 ${Chart.fmtP(t.sl)}` : ""}${t.tp ? ` · 익절 ${Chart.fmtP(t.tp)}` : ""} (${t.date})`
      + `\n  근거: ${[...(t.basis || [])].join(", ") || "없음"}${t.tf ? ` / 기준 ${Market.TF[t.tf] ? Market.TF[t.tf].name : t.tf}` : ""}${t.why ? `\n  메모: ${t.why}` : ""}${(t.notes || []).slice(-5).map((n) => `\n  포지션 중 생각 (${n.d} ${n.tm}): ${n.text}`).join("")}`).join("\n");
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
  seg($("trFilter"), [["전체", "all"], ["진행 중", "open"], ["종료", "closed"], ["달력", "cal"]], trFilter, (v) => { trFilter = v; renderTrades(); });
  async function loadData() {
    st.trades = (await Store.all("trades")).sort((a, b) => (b.date + (b.time || "")).localeCompare(a.date + (a.time || "")));
    st.journal = (await Store.all("journal")).sort((a, b) => (b.date + (b.time || "")).localeCompare(a.date + (a.time || "")));
    st.cash = await Store.all("cash");
    const bbDates = st.trades.filter((t) => t.src === "bybit" && t.status === "closed").map((t) => t.closeDate || t.date).sort();
    st.bybitFrom = bbDates[0] || null;
    const ubDates = st.trades.filter((t) => t.src === "upbit" && t.status === "closed").map((t) => t.closeDate || t.date).sort();
    st.upbitFrom = ubDates[0] || null;
    st.upSnap = (await Store.get("legacy", "upbit_snapshot")) || null;
    st.bbSnap = (await Store.get("legacy", "bybit_snapshot")) || null;
    updatePosLines();
  }
  // 손익 계산용: 바이비트 자동 기록이 있는 기간의 '노트에서 옮긴 바이비트 매매'는 빼고 셈 (같은 매매가 두 번 잡히지 않게)
  const shadowed = (t) => {
    if (t.src !== "note") return false;
    const from = t.venue === "upbit" ? st.upbitFrom : st.bybitFrom;
    return !!from && (t.closeDate || t.date) >= from;
  };
  const realPnl = (t) => (shadowed(t) ? null : t.pnl ?? tradePnl(t));
  // 차트에 진행 중 포지션의 진입·손절·익절 선 (바이비트 차트라 업비트 원화 기록은 제외)
  function updatePosLines() { Chart.setPositions(st.trades.filter((t) => t.status === "open" && t.coin === st.coin && t.venue !== "upbit")); }
  // 매매 목록: 진행 중 → 달(요약, 접기) → 날짜(그날 손익) → 한 줄 매매
  const openMonths = new Set([today().slice(0, 7)]);
  const WD = ["일", "월", "화", "수", "목", "금", "토"];
  function tradeLine(t) {
    const cur = curOf(t), open = t.status === "open", lp = open ? livePrice(t) : null;
    const p = open ? (lp ? tradePnl(t, lp) : null) : realPnl(t) ?? (t.pnl ?? tradePnl(t));
    const ex = open ? lp : t.exit, s = t.side === "short" ? -1 : 1;
    const pct = ex && t.en ? (ex / t.en - 1) * 100 * s : null;
    const dup = shadowed(t);
    return `<div class="tline${dup ? " dup" : ""}" data-id="${t.id}"${dup ? ' title="자동 기록과 겹쳐서 손익 합계에서 뺐어요"' : ""}><span class="badge ${t.side === "buy" ? "spot" : t.side}">${sideName[t.side]}</span><b class="tc">${esc(t.coin)}</b><span class="tv">${venueName[t.venue]}${dup ? " · 노트 (중복, 합계 제외)" : ""}</span>
      <span class="tp"><b class="${sgn(p || 0)}">${p == null ? "—" : (p > 0 ? "+" : "") + money(p, cur)}</b><small class="${sgn(pct || 0)}">${pct == null ? "" : pctS(pct)}</small></span></div>`;
  }
  // 달력: 날마다 손익(색), 익절·손절 수, 보유 중인 포지션 띠. 날짜를 누르면 그날 매매가 아래에 보임
  let calM = today().slice(0, 7), calSel = today();
  const shortC = (v) => {
    const a = Math.abs(v), s = v > 0 ? "+" : v < 0 ? "-" : "";
    if (cur === "KRW") return s + (a >= 1e8 ? (a / 1e8).toFixed(1) + "억" : a >= 1e4 ? Math.round(a / 1e4) + "만" : Math.round(a));
    return s + "$" + (a >= 1e4 ? Math.round(a / 1e3) + "k" : a >= 1e3 ? (a / 1e3).toFixed(1) + "k" : Math.round(a));
  };
  function renderCalendar(box) {
    const dOf = (t) => t.closeDate || t.date || "", td = today();
    const [y, mo] = calM.split("-").map(Number), first = new Date(y, mo - 1, 1), nDays = new Date(y, mo, 0).getDate();
    const live = st.trades.filter((t) => !shadowed(t));
    const closedOn = (d) => live.filter((t) => t.status === "closed" && dOf(t) === d);
    const heldOn = (d) => live.filter((t) => t.date && t.date <= d && (t.status === "open" ? d <= td : d <= dOf(t)) && !(t.status === "closed" && t.date === dOf(t)));
    const cells = [];
    for (let i = 0; i < first.getDay(); i++) cells.push(`<div class="cd empty"></div>`);
    let mSum = 0, mOk = true, mTp = 0, mSl = 0;
    for (let n = 1; n <= nDays; n++) {
      const d = calM + "-" + String(n).padStart(2, "0"), cl = closedOn(d), held = heldOn(d), sum = sumPnl(cl);
      const tp = cl.filter((t) => realPnl(t) > 0).length, sl = cl.filter((t) => realPnl(t) < 0).length;
      mTp += tp; mSl += sl; if (sum == null) mOk = false; else mSum += sum;
      const ins = live.filter((t) => t.date === d).length;
      const sides = [...new Set(held.map((t) => t.side === "buy" ? "spot" : t.side))];
      cells.push(`<button class="cd${cl.length ? (sum > 0 ? " win" : sum < 0 ? " loss" : "") : ""}${d === td ? " today" : ""}${d === calSel ? " sel" : ""}" data-d="${d}">
        <span class="cn">${n}</span>
        ${cl.length && sum != null ? `<b class="${sgn(sum)}">${shortC(sum)}</b>` : ""}
        <span class="cm">${tp ? `<i class="tp">익${tp > 1 ? tp : ""}</i>` : ""}${sl ? `<i class="sl">손${sl > 1 ? sl : ""}</i>` : ""}${ins ? `<i class="in">●${ins > 1 ? ins : ""}</i>` : ""}</span>
        ${sides.length ? `<span class="hold">${sides.map((s) => `<i class="${s}"></i>`).join("")}</span>` : ""}
      </button>`);
    }
    const wr = mTp + mSl ? Math.round(mTp / (mTp + mSl) * 100) : 0;
    const sel = calSel.startsWith(calM) ? calSel : null;
    let detail = "";
    if (sel) {
      const cl = st.trades.filter((t) => t.status === "closed" && dOf(t) === sel);
      const ins = st.trades.filter((t) => t.date === sel && !cl.includes(t));
      const held = heldOn(sel).filter((t) => !cl.includes(t) && !ins.includes(t));
      const w = WD[new Date(sel + "T00:00:00").getDay()], ds = sumPnl(cl);
      const grp = (title, list) => list.length ? `<div class="tday"><span>${title}</span><span>${list.length}건</span></div>${list.map(tradeLine).join("")}` : "";
      detail = `<div class="tgroup"><div class="tmon static"><b>${+sel.slice(5, 7)}/${+sel.slice(8)} (${w})</b><span>${cl.length ? `손익 <b class="${sgn(ds || 0)}">${ds == null ? "—" : sgC(ds)}</b>` : "종료한 매매 없음"}</span></div>
        ${grp("종료 (익절·손절)", cl)}${grp("진입", ins)}${grp("보유 중", held)}
        ${!cl.length && !ins.length && !held.length ? `<div class="empty" style="padding:14px">이날은 매매가 없어요.</div>` : ""}</div>`;
    }
    box.innerHTML = `<div class="tgroup cal">
      <div class="calh"><button id="calPrev" aria-label="이전 달">‹</button><b>${y}년 ${mo}월</b><button id="calNext" aria-label="다음 달">›</button></div>
      <div class="cals"><span>손익 <b class="${sgn(mSum)}">${mOk ? sgC(mSum) : "—"}</b></span><span><i class="tp">익절</i> ${mTp}</span><span><i class="sl">손절</i> ${mSl}</span><span>승률 ${wr}%</span></div>
      <div class="cgrid">${WD.map((w, i) => `<span class="cw${i === 0 ? " sun" : i === 6 ? " sat" : ""}">${w}</span>`).join("")}${cells.join("")}</div>
      <div class="clg"><span><i class="hold-k long"></i>롱 보유</span><span><i class="hold-k short"></i>숏 보유</span><span><i class="hold-k spot"></i>현물 보유</span><span>● 진입</span></div>
    </div>${detail}`;
    const mv = (k) => { const x = new Date(y, mo - 1 + k, 1); calM = x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0"); renderTrades(); };
    $("calPrev").onclick = () => mv(-1); $("calNext").onclick = () => mv(1);
    box.querySelectorAll(".cd[data-d]").forEach((b) => b.onclick = () => { calSel = b.dataset.d; renderTrades(); });
    box.querySelectorAll(".tline").forEach((el) => el.onclick = () => tradeDetail(el.dataset.id));
  }
  function renderTrades() {
    const box = $("trList"), out = [];
    if (trFilter === "cal") return renderCalendar(box);
    const open = st.trades.filter((t) => t.status === "open");
    const closed = st.trades.filter((t) => t.status === "closed");
    if (trFilter !== "closed" && open.length) out.push(`<div class="tgroup"><div class="tmon static"><b>진행 중</b><span>${open.length}건</span></div>${open.map(tradeLine).join("")}</div>`);
    if (trFilter !== "open") {
      const dOf = (t) => t.closeDate || t.date || "";
      const sorted = closed.slice().sort((a, b) => (dOf(b) + (b.time || "")).localeCompare(dOf(a) + (a.time || "")));
      const months = [...new Set(sorted.map((t) => dOf(t).slice(0, 7)))];
      for (const m of months) {
        const ts = sorted.filter((t) => dOf(t).startsWith(m)), counted = ts.filter((t) => realPnl(t) != null);
        const wins = counted.filter((t) => realPnl(t) > 0).length, sum = sumPnl(ts);
        const isOpen = openMonths.has(m);
        let body = "";
        if (isOpen) {
          const days = [...new Set(ts.map(dOf))];
          body = days.map((d) => {
            const dt = ts.filter((t) => dOf(t) === d), ds = sumPnl(dt), w = WD[new Date(d + "T00:00:00").getDay()];
            return `<div class="tday"><span>${+d.slice(5, 7)}/${+d.slice(8)} (${w})</span><b class="${sgn(ds || 0)}">${ds == null ? "" : sgC(ds)}</b></div>${dt.map(tradeLine).join("")}`;
          }).join("");
        }
        out.push(`<div class="tgroup"><button class="tmon" data-m="${m}"><b>${+m.slice(5)}월 <small>${m.slice(0, 4)}</small></b><span>${ts.length}건 · 승률 ${counted.length ? Math.round(wins / counted.length * 100) : 0}% · <b class="${sgn(sum || 0)}">${sum == null ? "—" : sgC(sum)}</b></span><i>${isOpen ? "▾" : "▸"}</i></button>${body}</div>`);
      }
    }
    box.innerHTML = out.length ? out.join("") : `<div class="empty">아직 기록이 없어요. <b>+ 새 매매</b>로 시작해 보세요.</div>`;
    box.querySelectorAll(".tline").forEach((el) => el.onclick = () => tradeDetail(el.dataset.id));
    box.querySelectorAll(".tmon[data-m]").forEach((b) => b.onclick = () => { const m = b.dataset.m; openMonths.has(m) ? openMonths.delete(m) : openMonths.add(m); renderTrades(); });
  }
  function tradeRow(t) {
    const cur = curOf(t), lp = t.status === "open" ? livePrice(t) : null;
    const pnl = t.status === "open" ? (lp ? tradePnl(t, lp) : null) : (t.pnl ?? tradePnl(t));
    const pct = t.status === "open" && lp && t.en ? ((lp / t.en - 1) * 100 * (t.side === "short" ? -1 : 1)) : null;
    return `<div class="item" data-id="${t.id}">
      <div class="l1"><div><span class="badge ${t.side === "buy" ? "spot" : t.side}">${sideName[t.side]}</span><b>${esc(t.coin)}</b> <span class="mut sm">${venueName[t.venue]}${t.src === "bybit" || t.src === "upbit" ? " 자동" : ""} ·${esc(Market.TF[t.tf] ? Market.TF[t.tf].name : t.tf || "")}</span>${t.status === "open" ? ' <span class="badge open">진행 중</span>' : t.hit ? ` <span class="badge spot">${esc(t.hit)}</span>` : ""}</div>
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
        <label class="chk" style="display:flex;gap:8px;align-items:center;color:var(--tx);font-weight:500"><input type="checkbox" id="fSnap" ${old ? "" : "checked"} style="width:18px;min-height:0">기준 시간봉 차트를 매매 기록과 일지에 저장 (그린 선 포함)</label>
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
      const shot = $("fSnap").checked ? await captureEntry(n) : null;
      await Store.put("trades", n); await loadData(); closeSheet(); renderTrades(); renderHome();
      toast(shot ? `매매 기록 · ${Market.TF[tf].name} 차트를 일지에 넣었어요` : "매매를 기록했어요");
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
      ${(t.notes || []).length ? `<div class="card"><h3>포지션 동안 남긴 생각</h3>${t.notes.map((n) => noteLine(n, t.id, true)).join("")}</div>` : ""}
      ${["img", "imgRes"].map((f) => {
        const name = f === "img" ? "진입 때 차트" : "결과 차트";
        return t[f] ? `<div class="card"><div class="sh" style="margin-bottom:8px"><h3 style="margin:0">${name}</h3><button class="sm" data-draw="${f}">✏️ 그리기·수정</button></div><img class="pic" src="${t[f]}" alt="${name}" data-view="${f}"></div>`
          : `<button class="addPic" data-add="${f}">+ ${name} 사진 넣기 <small>(스크린샷)</small></button>`;
      }).join("")}
      <input type="file" id="dPic" accept="image/*" hidden>
      <div class="row wrap">${t.status === "open" ? `${t.src === "bybit" || t.src === "upbit" ? "" : '<button id="dClose">청산 기록</button>'}<button class="primary" id="dBasis">근거 적기</button>` : '<button id="dReopen">진행 중으로 되돌리기</button>'}<button id="dEdit">수정</button><button class="danger" id="dDel">삭제</button></div>`);
    $("shX").onclick = closeSheet;
    $("dEdit").onclick = () => tradeForm(t);
    $("sheetIn").querySelectorAll("[data-nd]").forEach((b) => b.onclick = async () => { if (await delNote(t.id, b.dataset.at)) { tradeDetail(t.id); renderOpen(); } });
    $("sheetIn").querySelectorAll("[data-draw]").forEach((b) => b.onclick = async () => { closeSheet(); await new Promise((r) => setTimeout(r, 50)); await editRecordImage("trades", t, b.dataset.draw); tradeDetail(t.id); });
    $("sheetIn").querySelectorAll("[data-view]").forEach((im) => im.onclick = () => viewImg(im.src));
    let addField = null;
    $("sheetIn").querySelectorAll("[data-add]").forEach((b) => b.onclick = () => { addField = b.dataset.add; $("dPic").click(); });
    $("dPic").onchange = async (e) => {
      const f = e.target.files[0]; if (!f || !addField) return;
      t[addField] = await shrink(f, 1600); t[addField + "Edit"] = null;
      await Store.put("trades", t); await loadData(); toast("사진을 넣었어요"); tradeDetail(t.id);
    };
    if ($("dClose")) $("dClose").onclick = () => closeForm(t);
    if ($("dBasis")) $("dBasis").onclick = () => basisForm(t.id);
    if ($("dReopen")) $("dReopen").onclick = async () => { Object.assign(t, { status: "open", exit: 0, pnl: null, hit: "" }); await Store.put("trades", t); await loadData(); tradeDetail(t.id); renderTrades(); };
    $("dDel").onclick = async (e) => {
      if (e.target.dataset.s !== "1") { e.target.dataset.s = "1"; e.target.textContent = "한 번 더 누르면 삭제"; return; }
      await Store.del("trades", t.id); await loadData(); closeSheet(); renderTrades(); toast("삭제했어요");
    };
  }
  // 진입 차트 자동 캡처: 근거에 적은 시간봉(15분이면 15분, 1시간이면 1시간)으로 찍어서
  // ① 매매 기록의 '진입 때 차트' ② 일지(차트 기록)에 넣음. 다 찍으면 보던 차트로 돌아감
  async function captureEntry(t) {
    if (!Market.COINS.includes(t.coin)) return null;
    const tf = Market.TF[t.tf] ? t.tf : st.tf, prev = { coin: st.coin, tf: st.tf };
    await setChart(t.coin, tf);
    const img = await chartShot();
    if (prev.coin !== st.coin || prev.tf !== st.tf) setChart(prev.coin, prev.tf);
    if (!img) return null;
    if (!t.imgEdit) t.img = img;
    const sid = "shot_" + t.id + "_" + (t.date || today()), old = await Store.get("journal", sid);
    const text = `${t.coin} ${Market.TF[tf].name} · ${sideName[t.side]} 진입 ${t.en ? Chart.fmtP(t.en) : ""}${(t.basis || []).length ? " · " + t.basis.join(", ") : ""}${t.why ? " · " + t.why : ""}`;
    if (old && old.imgEdit) {
      // 이미 그림을 그려 둔 캡처는 덮지 않고 새로 하나 더 남김
      await Store.put("journal", { id: sid + "_" + Date.now().toString(36), kind: "shot", trade: t.id, date: today(), time: nowHM(), text, mood: t.mood || [], img, imgEdit: null });
    } else {
      await Store.put("journal", Object.assign(old || { id: sid, kind: "shot", trade: t.id, date: today(), time: nowHM() }, { text, mood: t.mood || [], img, imgEdit: null }));
    }
    return img;
  }
  // 진입 근거 빠른 입력 (칩 · 시간봉 · 한 줄 메모 · 심리 · 차트 그림)
  function basisForm(id) {
    const t = st.trades.find((x) => x.id === id); if (!t) return;
    const chartOk = t.venue !== "upbit" && Market.COINS.includes(t.coin);
    sheet(`<div class="sh"><h2><span class="badge ${t.side === "buy" ? "spot" : t.side}">${sideName[t.side]}</span>${esc(t.coin)} 진입 근거</h2><button class="ghost" id="shX">닫기</button></div>
      <div class="card">
        <div class="mut sm">진입 ${t.en ? Chart.fmtP(t.en) : "—"}${t.qty ? ` · ${t.qty}개` : ""}${t.sl ? ` · 손절 ${Chart.fmtP(t.sl)}` : ""}${t.tp ? ` · 익절 ${Chart.fmtP(t.tp)}` : ""}</div>
        <label>근거</label><div class="chips" id="bBasis"></div>
        <label>기준 시간봉</label><div class="chips" id="bTf"></div>
        <label for="bWhy">한 줄 메모</label><textarea id="bWhy" rows="2" placeholder="예: 4시간 채널 하단 + RSI 다이버전스">${esc(t.why || "")}</textarea>
        <label>지금 심리</label><div class="chips" id="bMood"></div>
        <label>감정 세기</label><div class="chips" id="bLv"></div>
        <div class="row" style="margin-top:0"><div><label>잠</label><div class="chips" id="bSleep"></div></div><div><label>잃은 걸 되찾고 싶은 마음</label><div class="chips" id="bChase"></div></div></div>
        ${chartOk ? `<p class="mut sm" id="bShotNote" style="margin:12px 0 0">📷 저장하면 고른 시간봉 차트(그린 선 · 진입선 포함)가 <b>매매 기록과 일지에 자동으로</b> 들어가요.</p>` : ""}
      </div>
      <button class="primary" id="bSave" style="width:100%;min-height:50px">저장</button>`);
    $("shX").onclick = closeSheet;
    const getB = chips($("bBasis"), BASIS.concat((t.basis || []).filter((b) => !BASIS.includes(b))), t.basis || [], true);
    let tf = t.tf || st.tf;
    chips($("bTf"), Object.entries(Market.TF).map(([k, v]) => [v.name, k]), [tf], false);
    $("bTf").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => (tf = b.dataset.v)));
    const getM = chips($("bMood"), MOODS, t.mood || [], true);
    const feel = Object.assign({ lv: "", sleep: "", chase: "" }, t.feel || {});
    const one = (el, items, k) => { chips(el, items, [String(feel[k])], false); el.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => (feel[k] = b.dataset.v))); };
    one($("bLv"), [["1 잔잔", "1"], ["2", "2"], ["3 보통", "3"], ["4", "4"], ["5 매우 셈", "5"]], "lv");
    one($("bSleep"), [["잘 잠", "충분"], ["부족", "부족"]], "sleep");
    one($("bChase"), [["없음", "없음"], ["조금", "조금"], ["강함", "강함"]], "chase");
    $("bSave").onclick = async () => {
      $("bSave").disabled = true; $("bSave").textContent = "저장하는 중…";
      Object.assign(t, { basis: getB(), tf, why: $("bWhy").value.trim(), mood: getM(), feel });
      const shot = chartOk ? await captureEntry(t) : null;
      await Store.put("trades", t); await loadData(); closeSheet(); renderHome(); renderTrades();
      toast(shot ? `진입 근거 저장 · ${Market.TF[tf].name} 차트를 일지에 넣었어요` : "진입 근거를 저장했어요");
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
  let getMood = chips($("moodChips"), MOODS, [], true), jImg, jImgEdit, jEdit = null;
  // 그리기 편집기 열기 (뒤로가기로도 닫힘). 저장하면 { img: 합친 그림, edit: { base, marks } }
  async function editImage(base, marks) {
    const layer = { type: "markup" };
    layers.push(layer); history.pushState({ ta: layers.length }, "");
    const r = await Markup.open(base, marks);
    if (layers[layers.length - 1] === layer) { layers.pop(); ignorePop++; history.back(); }
    return r;
  }
  function jPrev(src) {
    $("jImgPrev").innerHTML = src ? `<div class="thumbW"><img class="thumb" src="${src}" alt="첨부 사진"><button type="button" class="thumbX" aria-label="사진 지우기">✕</button></div><button type="button" class="sm" id="jDraw">✏️ 그리기·글씨</button>` : "";
    if (src) $("jDraw").onclick = async () => {
      const same = jEdit && jEdit.date === ($("jDate").value || today());
      const ed = jImgEdit !== undefined ? jImgEdit : same ? jEdit.imgEdit : null;
      const r = await editImage((ed && ed.base) || src, ed && ed.marks);
      if (!r) return;
      jImg = r.img; jImgEdit = r.edit || (ed ? null : null); if (!r.edit && ed) jImg = ed.base;
      jPrev(jImg); $("jMsg").textContent = "그림을 고쳤어요. 일지 저장을 눌러야 반영돼요.";
    };
    if (!src) return;
    $("jImgPrev").querySelector(".thumb").onclick = () => viewImg(src);
    $("jImgPrev").querySelector(".thumbX").onclick = () => { jImg = null; jImgEdit = null; jPrev(null); $("jMsg").textContent = "사진을 뺐어요. 일지 저장을 눌러야 반영돼요."; };
  }
  // 사진 크게 보기
  function viewImg(src, onEdit) {
    sheet(`<div class="sh"><h2>사진</h2><div class="row" style="margin:0;flex:none;gap:6px">${onEdit ? '<button class="sm" id="shDraw">✏️ 그리기·수정</button>' : ""}<button class="ghost" id="shX">닫기</button></div></div><img class="pic" src="${src}" alt="사진">`);
    $("shX").onclick = closeSheet;
    if (onEdit) $("shDraw").onclick = () => { closeSheet(); setTimeout(onEdit, 50); };
  }
  // 저장된 기록의 사진 그리기·수정 (field: "img" / "imgRes")
  async function editRecordImage(store, rec, field) {
    const ed = rec[field + "Edit"];
    const r = await editImage((ed && ed.base) || rec[field], ed && ed.marks);
    if (!r) return false;
    rec[field] = r.edit ? r.img : (ed ? ed.base : r.img);
    rec[field + "Edit"] = r.edit || null;
    await Store.put(store, rec); await loadData();
    toast("그림을 저장했어요");
    return true;
  }
  const memoTa = $("memoText");
  memoTa.addEventListener("input", () => { memoTa.style.height = "auto"; memoTa.style.height = memoTa.scrollHeight + "px"; });
  $("memoSave").onclick = async () => {
    const v = memoTa.value.trim(); if (!v) return;
    await Store.put("journal", { id: Store.uid("m"), kind: "memo", date: today(), time: nowHM(), text: v });
    memoTa.value = ""; memoTa.style.height = "auto"; $("memoMsg").textContent = "저장했어요 · " + nowHM();
    await loadData(); renderJournal();
  };
  $("jImgBtn").onclick = () => $("jImg").click();
  $("jImg").onchange = async (e) => { const f = e.target.files[0]; if (!f) return; jImg = await shrink(f); jImgEdit = null; jPrev(jImg); e.target.value = ""; };
  // PC: 일지 화면에서 Ctrl+V로 스크린샷 붙여넣기
  document.addEventListener("paste", async (e) => {
    if (!$("vJournal").classList.contains("on") || Markup.isOpen()) return;
    const it = [...(e.clipboardData ? e.clipboardData.items : [])].find((x) => x.type.startsWith("image/"));
    if (!it) return;
    e.preventDefault();
    jImg = await shrink(it.getAsFile()); jImgEdit = null; jPrev(jImg);
    $("jMsg").textContent = "스크린샷을 붙여 넣었어요. 일지 저장을 눌러야 반영돼요.";
  });
  $("jDate").onchange = () => { jEdit = null; renderJournal(); };
  $("jSave").onclick = async () => {
    const text = $("jText").value.trim(), mood = getMood();
    const d0 = $("jDate").value || today(), same = jEdit && jEdit.date === d0;
    const img = jImg === undefined ? (same && jEdit.img) || null : jImg;
    const imgEdit = jImgEdit === undefined ? (same && jEdit.imgEdit) || null : jImgEdit;
    if (!text && !mood.length && !img) { $("jMsg").textContent = "내용을 적어 주세요."; return; }
    $("jSave").disabled = true; $("jMsg").textContent = "저장하는 중…";
    try {
      const d = $("jDate").value || today();
      const e = Object.assign(jEdit && jEdit.date === d ? jEdit : { id: Store.uid("j"), kind: "diary", date: d, time: nowHM() }, { text, mood, img, imgEdit: img ? imgEdit : null });
      const wasEdit = !!jEdit;
      await Store.put("journal", e);
      await loadData(); renderJournal();
      $("jMsg").textContent = (wasEdit ? "고쳤어요 · " : "저장했어요 · ") + nowHM(); toast(wasEdit ? "일지를 고쳤어요" : "일지를 저장했어요");
    } catch (x) {
      $("jMsg").textContent = "저장하지 못했어요: " + (x && (x.message || x.name) || x);
    } finally { $("jSave").disabled = false; }
  };
  function renderJournal(keepForm) {
    const d = $("jDate").value || today();
    // 글칸은 늘 새 일지용으로 비워 둠. 지난 일지는 아래 목록의 '수정'으로 불러와 고침
    const fillForm = (j) => {
      jEdit = j || null; jImg = undefined; jImgEdit = undefined;
      $("jText").value = j ? j.text || "" : "";
      getMood = chips($("moodChips"), MOODS, j ? j.mood || [] : [], true);
      jPrev(j && j.img);
      $("jSave").textContent = j ? "고친 내용 저장" : "일지 저장";
    };
    if (!keepForm) { fillForm(null); $("jMsg").textContent = ""; }
    const items = [
      ...st.journal.filter((j) => j.date === d).map((j) => ({ t: j.time || "", html: `<span class="badge ${j.kind === "talk" ? "open" : "spot"}">${j.kind === "memo" ? "메모" : j.kind === "shot" ? "차트" : j.kind === "talk" ? "상담" : "일지"}</span>${j.mood && j.mood.length ? esc(j.mood.join(" · ")) : ""}<p${j.kind === "talk" ? ' class="talkTxt"' : ""}>${esc(j.text || "")}</p>${j.img ? `<img class="thumb" data-img="${j.id}" src="${j.img}" alt="첨부 사진">` : ""}`, id: j.id, edit: j.kind === "diary" })),
      ...st.trades.filter((t) => t.date === d).map((t) => ({ t: t.time || "", html: `<span class="badge ${t.side === "buy" ? "spot" : t.side}">${sideName[t.side]}</span><b>${esc(t.coin)}</b> 진입 ${Chart.fmtP(t.en)}${t.why ? `<p>${esc(t.why)}</p>` : ""}${t.mood && t.mood.length ? `<p class="mut sm">심리: ${esc(t.mood.join(" · "))}${t.moodText ? " — " + esc(t.moodText) : ""}</p>` : ""}` })),
      ...st.trades.filter((t) => t.closeDate === d && t.status === "closed").map((t) => ({ t: "", html: `<span class="badge spot">청산</span><b>${esc(t.coin)}</b> ${t.pnl != null ? `<b class="${sgn(t.pnl)}">${money(t.pnl, curOf(t))}</b>` : ""}${t.lesson ? `<p>${esc(t.lesson)}</p>` : ""}` })),
    ].sort((a, b) => b.t.localeCompare(a.t));
    $("dayList").innerHTML = items.length ? `<div class="tl">${items.map((i) => `<div class="ent"><div class="t">${esc(i.t)}</div>${i.html}${i.edit ? ` <button class="ghost sm" data-edit="${i.id}">수정</button>` : ""}${i.id ? ` <button class="ghost sm danger" data-del="${i.id}">삭제</button>` : ""}</div>`).join("")}</div>` : `<div class="empty">이날의 메모·매매가 없어요.</div>`;
    $("dayList").querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => {
      fillForm(st.journal.find((x) => x.id === b.dataset.edit));
      $("jMsg").textContent = "수정하는 중이에요 · 저장하면 이 일지가 고쳐져요";
      $("jText").scrollIntoView({ behavior: "smooth", block: "center" }); $("jText").focus();
    });
    $("dayList").querySelectorAll("[data-img]").forEach((im) => im.onclick = () => {
      const j = st.journal.find((x) => x.id === im.dataset.img);
      viewImg(im.src, j ? async () => { if (await editRecordImage("journal", j, "img")) renderJournal(); } : null);
    });
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
    if ($("wdBody")) renderCash();
    $("aFx").textContent = st.fx ? "₩" + st.fx.rate.toFixed(2) : "—";
    $("aFxNote").textContent = st.fx ? "기준 " + new Date(st.fx.at).toLocaleDateString("ko-KR") + " · 하루 한 번 갱신" : "불러오는 중";
    const u = st.upbit.USDT;
    $("aUsdt").textContent = u ? "₩" + u.price.toLocaleString("ko-KR") : "—";
    $("aUsdtNote").textContent = u && st.fx ? `환율 대비 ${pctS((u.price / st.fx.rate - 1) * 100)}` : "";
    $("kpTable").innerHTML = `<table><tr><th>종목</th><th>업비트</th><th>바이비트(원화)</th><th>김프</th></tr>${Market.COINS.map((c) => {
      const up = st.upbit[c], p = price(c), k = kimp(c);
      return `<tr><td><b>${c}</b></td><td>${up ? krw(up.price) : "—"}</td><td>${p && st.fx ? krw(p * st.fx.rate) : "—"}</td><td class="${sgn(k || 0)}">${k == null ? "—" : pctS(k)}</td></tr>`;
    }).join("")}</table>`;
    const closed = st.trades.filter((t) => t.status === "closed" && inRange(t.closeDate || t.date) && !shadowed(t));
    const sum = (v) => closed.filter((t) => t.venue === v).reduce((a, t) => a + (realPnl(t) ?? 0), 0);
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
    for (const t of list) { const p = realPnl(t); if (p == null) continue; const c = conv(p, curOf(t)); if (c == null) ok = false; else v += c; }
    return ok ? v : null;
  }
  // 업비트 자산 = 원화 + 코인 수량 × 지금 업비트 가격 (PC가 남긴 잔고 기록으로 계산, 폰에서도 보임)
  function bybitEquity() {
    if (Bybit.equity) return Bybit.equity;
    const s = st.bbSnap; return s && s.v ? { v: s.v, at: s.at } : null;
  }
  function upbitEquity() {
    const s = st.upSnap; if (!s) return null;
    let v = s.krw || 0;
    for (const [c, a] of Object.entries(s.coins || {})) v += a.qty * ((st.upbit[c] && st.upbit[c].price) || a.avg || 0);
    return Math.round(v);
  }
  function renderHero() {
    const closed = st.trades.filter((t) => t.status === "closed");
    const mPl = sumPnl(closed.filter((t) => (t.closeDate || t.date || "").startsWith(ymNow()))), pl = sumPnl(closed);
    let un = 0, unB = 0, unU = 0;
    for (const t of st.trades.filter((x) => x.status === "open")) { const lp = livePrice(t), p = lp ? tradePnl(t, lp) : null, c = p == null ? null : conv(p, curOf(t)); if (c != null) { un += c; if (t.venue === "upbit") unU += c; else unB += c; } }
    const ubAuto = upbitEquity();
    const bbAuto = bybitEquity(), bb = bbAuto ? bbAuto.v : +Store.pref.get("asBybit", 0) || 0, ub = ubAuto != null ? ubAuto : +Store.pref.get("asUpbit", 0) || 0;
    const eqU = bb ? conv(bb, "USD") : 0, eqK = ub ? conv(ub, "KRW") : 0, has = !!(bb || ub);
    const eq = has && eqU != null && eqK != null ? eqU + eqK : null;
    // 바이비트 자동 잔고에는 미실현이 이미 들어 있음. 손으로 넣은 값엔 더해 줌
    const eqShow = eq == null ? null : eq + (bbAuto ? 0 : unB) + (ubAuto != null ? 0 : unU);
    const base = eqShow == null ? 0 : eqShow - un;
    const pc = (x, b) => (eqShow != null && b > 0 ? `${x >= 0 ? "+" : "−"}${Math.abs(x / b * 100).toFixed(1)}%` : "");
    const sym = cur === "KRW" ? "₩" : "$";
    const num = (v) => fmtC(Math.abs(v)).slice(1);
    $("hHero").innerHTML = `<div class="hl">현재 자산</div>`
      + (eqShow == null
        ? `<div class="hv empty">${has ? "환율을 불러오는 중…" : "자산을 아직 몰라요"}</div>${has ? "" : `<button class="primary" id="hSet">설정에서 바이비트 연결 · 자산 입력</button>`}`
        : `<div class="hv"><span class="cs">${eqShow < 0 ? "-" : ""}${sym}</span>${num(eqShow)}</div>`
          + `<div class="hsub">${bb ? `<span>바이비트 <b>${usd(bb)}</b>${bbAuto ? " · 자동" : ""}</span>` : ""}${ub ? `<span>업비트 <b>${krw(ub)}</b>${ubAuto != null ? " · 자동" : ""}</span>` : ""}${un ? `<span>미실현 <b class="${sgn(un)}">${sgC(un)}</b></span>` : ""}</div>`)
      + `<div class="hrow"><div><span>이번 달</span><b class="${sgn(mPl || 0)}">${mPl == null ? "—" : sgC(mPl)}</b><small class="${sgn(mPl || 0)}">${mPl == null ? "" : pc(mPl, base - mPl)}</small></div>`
      + `<div><span>누적</span><b class="${sgn(pl || 0)}">${pl == null ? "—" : sgC(pl)}</b><small class="${sgn(pl || 0)}">${pl == null ? "" : pc(pl, base - pl)}</small></div></div>`;
    { const c = cashCalc(); $("hHero").insertAdjacentHTML("beforeend", wdSugHtml(c) + (c.target > 0 ? wdBar(c) : "")); }
    $("hHero").insertAdjacentHTML("beforeend", `<button class="hlink" id="hAcct">돈 관리 · 출금 내역 <i>›</i></button>`);
    $("hAcct").onclick = () => showView("vAcct");
    if ($("hSet")) $("hSet").onclick = () => showView("vSet");
    $("curSym").textContent = sym;
  }
  function pickCoin(c) { setChart(c); }
  function renderTicks() {
    $("hTick").innerHTML = Market.COINS.map((c) => {
      const t = st.tick[c] || {}, p = price(c), k = kimp(c);
      return `<button class="tick" data-c="${c}"><span class="t1">${c}<span class="chg ${sgn(t.chg || 0)}">${t.chg != null ? pctS(t.chg) : "—"}</span></span><b>${p ? Chart.fmtP(p) : "—"}</b><small>김프 <span class="${sgn(k || 0)}">${k == null ? "—" : pctS(k)}</span></small></button>`;
    }).join("");
    $("hTick").querySelectorAll(".tick").forEach((b) => b.onclick = () => { pickCoin(b.dataset.c); lastTab = "vChart"; showView("vChart"); });
  }
  // 진행 중 포지션에 그때그때 생각 적기 (포지션 기록의 notes에 시간순으로 쌓임)
  async function addNote(id, text) {
    const t = st.trades.find((x) => x.id === id); if (!t || !text) return;
    t.notes = [...(t.notes || []), { at: Date.now(), d: today(), tm: nowHM(), text }];
    await Store.put("trades", t); await loadData(); toast("생각을 남겼어요");
  }
  async function delNote(id, at) {
    const t = st.trades.find((x) => x.id === id); if (!t) return false;
    const n = (t.notes || []).find((x) => String(x.at) === String(at)); if (!n) return false;
    if (!confirm(`이 생각을 지울까요?\n\n"${n.text}"`)) return false;
    t.notes = t.notes.filter((x) => x !== n);
    await Store.put("trades", t); await loadData(); toast("생각을 지웠어요"); return true;
  }
  // full: 날짜 항상 표시 (상세 화면)
  const noteLine = (n, id, full) => `<div class="pn"><span class="pnT"><span class="mut">${!full && n.d === today() ? "" : esc(n.d.slice(5)) + " "}${esc(n.tm)}</span> ${esc(n.text)}</span>${id ? `<button class="pnDel" data-nd="${id}" data-at="${n.at}" aria-label="이 생각 지우기">✕</button>` : ""}</div>`;
  function renderOpen() {
    // 생각을 쓰는 중이면 다시 그리지 않음 (쓰던 글이 지워지지 않게)
    const typing = [...$("hOpen").querySelectorAll(".pnIn")].some((x) => x.value.trim() || document.activeElement === x);
    if (typing) return;
    const open = st.trades.filter((t) => t.status === "open");
    const td = new Date(today()).getTime();
    $("hOpen").innerHTML = open.length ? open.map((t) => {
      const days = Math.max(1, Math.round((td - new Date(t.date).getTime()) / 864e5) + 1);
      const has = (t.basis && t.basis.length) || t.why;
      const line = has
        ? `<div class="bline"><span>${esc([...(t.basis || []), t.why].filter(Boolean).join(" · "))}</span><button class="sm ghost" data-b="${t.id}">수정</button></div>`
        : `<div class="bline need"><span>근거 미입력</span><button class="sm primary" data-b="${t.id}">근거 적기</button></div>`;
      const notes = (t.notes || []).slice(-2);
      const pn = `<div class="pnote">${notes.map((n) => noteLine(n, t.id)).join("")}<div class="pnRow"><textarea class="pnIn" rows="1" data-n="${t.id}" placeholder="지금 이 포지션에 대한 생각" enterkeyhint="done" autocomplete="off" spellcheck="false"></textarea><button class="sm primary" data-ns="${t.id}">남기기</button></div></div>`;
      return tradeRow(t).replace(`<b>${esc(t.coin)}</b>`, `<i class="live"></i><b>${esc(t.coin)}</b>`).replace(/(<div class="l2"><span>)/, `$1보유 ${days}일 · `).replace(/<\/div>\s*$/, line + pn + "</div>");
    }).join("") : `<div class="empty">진행 중인 포지션이 없어요.</div>`;
    $("hOpen").querySelectorAll(".item").forEach((el) => el.onclick = () => tradeDetail(el.dataset.id));
    $("hOpen").querySelectorAll("[data-b]").forEach((b) => b.onclick = (e) => { e.stopPropagation(); basisForm(b.dataset.b); });
    $("hOpen").querySelectorAll(".pnote").forEach((x) => x.onclick = (e) => e.stopPropagation());
    const send = async (id) => { const inp = $("hOpen").querySelector(`.pnIn[data-n="${id}"]`), v = inp.value.trim(); if (!v) return; inp.value = ""; inp.blur(); await addNote(id, v); renderOpen(); };
    $("hOpen").querySelectorAll("[data-ns]").forEach((b) => b.onclick = () => send(b.dataset.ns));
    $("hOpen").querySelectorAll("[data-nd]").forEach((b) => b.onclick = async () => { if (await delNote(b.dataset.nd, b.dataset.at)) renderOpen(); });
    $("hOpen").querySelectorAll(".pnIn").forEach((inp) => {
      inp.onkeydown = (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); send(inp.dataset.n); } };
      inp.oninput = () => { inp.style.height = "auto"; inp.style.height = inp.scrollHeight + 2 + "px"; };
    });
  }
  function renderHome() {
    $("topDate").textContent = new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
    renderHero(); renderNews(); renderTicks(); renderOpen();
  }
  let hT = 0;
  function homeSoon() { if (hT || !$("vHome").classList.contains("on") || document.hidden) return; hT = setTimeout(() => { hT = 0; renderHero(); renderTicks(); }, 1000); }
  function renderSet() {
    const a = bybitEquity();
    $("asBybit").value = a ? a.v.toFixed(2) : Store.pref.get("asBybit", "") || "";
    $("asBybit").disabled = !!a;
    const u = upbitEquity();
    $("asUpbit").value = u != null ? u : Store.pref.get("asUpbit", "") || "";
    $("asUpbit").disabled = u != null;
    renderFontPick();
  }
  // 숫자 글꼴 고르기
  const FONTS = [
    { k: "plex", short: "IBM Plex", name: "IBM Plex Sans KR", note: "시크릿 노트와 같은 글꼴", css: "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=swap", fam: '"IBM Plex Sans KR"' },
    { k: "noto", short: "Noto", name: "Noto Sans KR", note: "구글 기본 고딕", css: "https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700&display=swap", fam: '"Noto Sans KR"' },
    { k: "nanum", short: "나눔고딕", name: "나눔고딕", note: "둥글고 넓은 숫자", css: "https://fonts.googleapis.com/css2?family=Nanum+Gothic:wght@400;700;800&display=swap", fam: '"Nanum Gothic"' },
    { k: "roboto", short: "Roboto", name: "Roboto", note: "안드로이드 기본 숫자", css: "https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap", fam: "Roboto" },
    { k: "pretendard", short: "Pretendard", name: "Pretendard", note: "지금 앱 글자", css: null, fam: '"Pretendard"' },
  ];
  const loaded = new Set();
  function loadFont(f) {
    if (!f.css || loaded.has(f.k)) return;
    loaded.add(f.k);
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = f.css; document.head.appendChild(l);
  }
  function applyFont(k) {
    const f = FONTS.find((x) => x.k === k) || FONTS[0];
    loadFont(f);
    document.documentElement.style.setProperty("--mono", `${f.fam},"Pretendard",system-ui,sans-serif`);
    if (document.fonts) document.fonts.ready.then(() => Chart.retheme());
    return f.k;
  }
  let numFont = applyFont(Store.pref.get("numFont", "plex"));
  function renderFontPick() {
    FONTS.forEach(loadFont);
    const ff = (f) => f.fam.replace(/"/g, "&quot;") + ",sans-serif";
    const curF = FONTS.find((x) => x.k === numFont) || FONTS[0];
    $("fontPick").innerHTML = `<div class="chips">${FONTS.map((f) => `<button class="${f.k === numFont ? "on" : ""}" data-k="${f.k}" style="font-family:${ff(f)}">${f.short}</button>`).join("")}</div>
      <div class="fpv" style="font-family:${ff(curF)}">$2,246.58 · +1.54%</div>`;
    $("fontPick").querySelectorAll("[data-k]").forEach((b) => b.onclick = () => { numFont = applyFont(b.dataset.k); Store.pref.set("numFont", numFont); renderFontPick(); });
  }

  $("asBybit").oninput =() => Store.pref.set("asBybit", $("asBybit").value);
  $("asUpbit").oninput = () => Store.pref.set("asUpbit", $("asUpbit").value);

  // ---------- 출금 (회계팀) ----------
  // 출금·입금 기록: { kind: "out"|"in", venue, amount, cur, rate(그때 환율), type: "profit"|"principal"|"auto", date, memo }
  // 계산은 시크릿 노트와 같은 방식: 날짜순으로 손익·출금을 쌓으면서, "이익+원금(자동)" 출금은 그때까지 출금 가능한 이익만큼을 이익, 나머지를 원금으로 나눔
  const toKRWr = (v, c, r) => (c === "KRW" ? v : st.fx || r ? v * (r || st.fx.rate) : null);
  const WD_TYPE = { profit: "이익 출금", principal: "원금 출금", auto: "이익+원금 출금" };
  function cashCalc() {
    const ym = ymNow(), ev = [];
    let ok = true;
    for (const t of st.trades.filter((x) => x.status === "closed")) {
      const p = realPnl(t); if (p == null) continue;
      const k = toKRWr(p, curOf(t), t.rate); if (k == null) { ok = false; continue; }
      ev.push({ d: t.closeDate || t.date || "", t: "pl", v: k });
    }
    for (const c of st.cash) {
      const k = toKRWr(c.amount, c.cur, c.rate); if (k == null) { ok = false; continue; }
      ev.push({ d: c.date, t: c.kind, k: c.type, v: k, id: c.id });
    }
    ev.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : (a.t === "pl" ? 0 : 1) - (b.t === "pl" ? 0 : 1)));
    let pl = 0, out = 0, outP = 0, inn = 0, mPl = 0, mOut = 0, mOutAll = 0, mOutP = 0, mIn = 0;
    const split = {};
    for (const x of ev) {
      const m = x.d.slice(0, 7) === ym;
      if (x.t === "pl") { pl += x.v; if (m) mPl += x.v; }
      else if (x.t === "out") {
        const pp = x.k === "principal" ? x.v : x.k === "auto" ? Math.max(0, x.v - Math.max(0, pl - (out - outP))) : 0;
        out += x.v; outP += pp; split[x.id] = { profit: x.v - pp, principal: pp };
        if (m) { mOut += x.v - pp; mOutP += pp; mOutAll += x.v; }
      } else { inn += x.v; if (m) mIn += x.v; }
    }
    const pct = +Store.pref.get("wdPct", 50) || 50, target = +Store.pref.get("wdTarget", 0) || 0;
    const wdb = Math.max(0, pl - (out - outP));
    const sug = mPl > 0 ? Math.max(0, Math.min(wdb, mPl * pct / 100 - mOut)) : 0;
    return { ok, pl, mPl, mOut, mOutP, mOutAll, mIn, wdb, sug, pct, target, split };
  }
  const fromKRW = (v) => conv(v, "KRW");
  const FK = (v) => { const x = fromKRW(v); return x == null ? "—" : fmtC(x); };
  function wdBar(c) {
    if (!(c.target > 0)) return `<div class="wprog"><span>이번 달 이익 출금 ${FK(c.mOut)}</span></div>`;
    const r = c.mOut / c.target, p = Math.round(r * 100), done = r >= 1;
    return `<div class="wprog${done ? " ok" : ""}"><div class="wbar"><i style="width:${Math.min(100, p)}%"></i></div><span>${done ? `✓ 이번 달 출금 목표 달성 · ${FK(c.mOut)} / ${FK(c.target)}` : `이번 달 이익 출금 ${FK(c.mOut)} / 목표 ${FK(c.target)} (${p}%)`}</span></div>`;
  }
  function wdSugHtml(c) {
    if (!c.ok && !st.fx) return "";
    if (c.sug > 0) return `<div class="wsug">이번 달 출금 추천 <b>${FK(c.sug)}</b> <small>이번 달 이익의 ${c.pct}%</small></div>`;
    if (c.mPl <= 0) return `<div class="wsug mutd">이번 달은 아직 이익이 없어서 출금 추천이 없어요</div>`;
    return `<div class="wsug mutd">이번 달 추천만큼 이미 출금했어요 · 이번 달 이익 출금 ${FK(c.mOut)}</div>`;
  }
  const money2 = (x) => (x.cur === "KRW" ? krw(x.amount) : usd(x.amount));
  function renderCash() {
    const c = cashCalc();
    $("wdBody").innerHTML = wdSugHtml(c) + wdBar(c)
      + `<div class="kv" style="margin-top:12px">
        <span>이번 달 실현 손익</span><b class="${sgn(c.mPl)}">${FK(c.mPl)}</b>
        <span>이번 달 출금</span><b>${FK(c.mOutAll)}</b>
        <span class="ind">└ 이익</span><b>${FK(c.mOut)}</b>
        <span class="ind">└ 원금</span><b>${FK(c.mOutP)}</b>
        <span>이번 달 입금</span><b>${FK(c.mIn)}</b>
        <span>출금 가능 이익 <small class="mut">(누적 이익 − 이익 출금)</small></span><b>${FK(c.wdb)}</b></div>`;
    $("wdTarget").value = c.target || ""; $("wdPct").value = Store.pref.get("wdPct", "") || "";
    // 내역: 달마다 묶어서 전부
    const list = st.cash.slice().sort((a, b) => (b.date + b.id).localeCompare(a.date + a.id));
    const months = [...new Set(list.map((x) => x.date.slice(0, 7)))];
    $("wdList").innerHTML = list.length ? months.map((m) => {
      const xs = list.filter((x) => x.date.startsWith(m));
      let o = 0, i = 0; for (const x of xs) { const k = toKRWr(x.amount, x.cur, x.rate) || 0; if (x.kind === "out") o += k; else i += k; }
      return `<div class="wdm"><b>${m.replace("-", "년 ")}월</b><span>출금 ${FK(o)}${i ? ` · 입금 ${FK(i)}` : ""}</span></div>` + xs.map((x) => {
        const sp = c.split[x.id], tag = x.kind === "out" ? WD_TYPE[x.type] || "출금" : "입금";
        const detail = x.kind === "out" && x.type === "auto" && sp ? `<small class="mut">이익 ${FK(sp.profit)} · 원금 ${FK(sp.principal)}</small>` : "";
        return `<div class="kvrow wdr"><span><span class="badge ${x.kind === "out" ? "spot" : "open"}">${tag}</span>${esc(x.date.slice(5))} · ${venueName[x.venue]}${x.src === "note" ? " · 노트" : ""}${x.memo ? " · " + esc(x.memo) : ""}${detail ? "<br>" + detail : ""}</span><span><b class="${x.kind === "in" ? "up" : ""}">${x.kind === "in" ? "+" : "−"}${money2(x)}</b> <button class="sm ghost danger" data-wdel="${x.id}">삭제</button></span></div>`;
      }).join("");
    }).join("") : `<div class="empty">아직 출금·입금 기록이 없어요.<br>노트 기록은 설정 → 데이터 → 노트 백업을 다시 불러오면 들어와요.</div>`;
    $("wdList").querySelectorAll("[data-wdel]").forEach((b) => b.onclick = async () => {
      if (b.dataset.s !== "1") { b.dataset.s = "1"; b.textContent = "한 번 더"; return; }
      await Store.del("cash", b.dataset.wdel); await loadData(); renderCash(); renderHome();
    });
  }
  $("wdTarget").oninput = () => { Store.pref.set("wdTarget", $("wdTarget").value); renderCash(); };
  $("wdPct").oninput = () => { Store.pref.set("wdPct", $("wdPct").value); renderCash(); };
  $("wdAdd").onclick = () => {
    sheet(`<div class="sh"><h2>출금 · 입금 기록</h2><button class="ghost" id="shX">닫기</button></div>
      <div class="card">
        <label>종류</label><div class="chips" id="cKind"></div>
        <label>거래소</label><div class="chips" id="cVen"></div>
        <div id="cTypeW"><label>무슨 돈인가요?</label><div class="chips" id="cType"></div><p class="mut sm" style="margin:6px 0 0">잘 모르겠으면 "이익+원금"을 고르세요. 출금 가능한 이익만큼은 이익, 넘는 부분은 원금으로 자동으로 나눠요.</p></div>
        <div class="row"><div><label for="cAmt" id="cAmtL">금액</label><input id="cAmt" type="number" inputmode="decimal" step="any"></div><div><label for="cDate">날짜</label><input id="cDate" type="date" value="${today()}"></div></div>
        <div id="cRateW"><label for="cRate">그날 환율 (원/달러)</label><input id="cRate" type="number" inputmode="decimal" step="any" value="${st.fx ? st.fx.rate.toFixed(1) : ""}"></div>
        <label for="cMemo">메모</label><input id="cMemo" placeholder="예: 생활비">
      </div><div class="err" id="cErr"></div>
      <button class="primary" id="cSave" style="width:100%;min-height:50px">저장</button>`);
    $("shX").onclick = closeSheet;
    let kind = "out", venue = "bybit", type = "auto";
    const lab = () => { $("cAmtL").textContent = venue === "upbit" ? "금액 (₩)" : "금액 ($)"; $("cRateW").hidden = venue === "upbit"; };
    chips($("cKind"), [["출금", "out"], ["입금", "in"]], [kind], false);
    $("cKind").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { kind = b.dataset.v; $("cTypeW").hidden = kind !== "out"; }));
    chips($("cVen"), [["바이비트", "bybit"], ["업비트", "upbit"]], [venue], false);
    $("cVen").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { venue = b.dataset.v; lab(); }));
    chips($("cType"), [["이익+원금 (자동)", "auto"], ["이익만", "profit"], ["원금만", "principal"]], [type], false);
    $("cType").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => (type = b.dataset.v)));
    lab();
    $("cSave").onclick = async () => {
      const amount = +$("cAmt").value;
      if (!(amount > 0)) { $("cErr").textContent = "금액을 넣어 주세요."; return; }
      await Store.put("cash", { id: Store.uid("c"), kind, venue, amount, cur: venue === "upbit" ? "KRW" : "USD", rate: +$("cRate").value || (st.fx ? st.fx.rate : 0), type: kind === "out" ? type : "", date: $("cDate").value || today(), memo: $("cMemo").value.trim() });
      await loadData(); closeSheet(); renderCash(); renderHome(); toast(kind === "out" ? "출금을 기록했어요" : "입금을 기록했어요");
    };
  };

  // ---------- 팀 ----------
  const usdOf = (v, c) => (c === "USD" ? v : st.fx ? v / st.fx.rate : null);
  const pnlOf = (t) => realPnl(t);
  const closedSorted = () => st.trades.filter((t) => t.status === "closed").sort((a, b) => ((b.closeDate || b.date) + (b.time || "")).localeCompare((a.closeDate || a.date) + (a.time || "")));
  const daysAgo = (n) => { const d = new Date(Date.now() - n * 864e5); return new Date(d - d.getTimezoneOffset() * 60e3).toISOString().slice(0, 10); };

  // ---------- 심리 코치 (경고만, 막지 않음) ----------
  const MIND = { cool: 30, streak: 2, perDay: 4 };
  const tsOf = (d, tm) => (d ? new Date(d + "T" + (tm || "00:00").slice(0, 5) + ":00").getTime() : null);
  const entryTs = (t) => (t.date && t.time ? tsOf(t.date, t.time) : null);
  // 청산 시각: 바이비트 기록의 closeTime, 없으면 같은 날 기록의 시각(대략)
  const closeTs = (t) => (t.closeTime ? tsOf(t.closeDate || t.date, t.closeTime) : t.src === "bybit" && t.time && (!t.closeDate || t.closeDate === t.date) ? tsOf(t.date, t.time) : null);
  // 진입 단위로 묶기 (바이비트 분할 청산 여러 건 = 진입 1번)
  const entryKey = (t) => `${t.coin}|${t.side}|${t.date}|${t.time || t.id}`;
  function entries(from) {
    const m = new Map();
    for (const t of st.trades) {
      if (shadowed(t) || !t.date || (from && t.date < from && (t.closeDate || t.date) < from)) continue;
      const k = entryKey(t); if (!m.has(k)) m.set(k, { k, t, list: [] }); m.get(k).list.push(t);
    }
    for (const e of m.values()) {
      e.b = e.list.find((x) => (x.basis || []).length || x.tf || (x.mood || []).length) || e.t;
      e.closed = e.list.every((x) => x.status === "closed");
      let pl = 0, ok = e.closed; for (const x of e.list) { const p = realPnl(x); if (p == null) continue; const u = usdOf(p, curOf(x)); if (u == null) ok = false; else pl += u; }
      e.pl = ok ? pl : null;
      const cts = e.list.map(closeTs).filter(Boolean); e.cts = cts.length ? Math.max(...cts) : null;
      e.cd = e.list.map((x) => x.closeDate || x.date).sort().pop();
    }
    return [...m.values()];
  }
  const lossCloses = () => st.trades.filter((t) => t.status === "closed" && !shadowed(t) && realPnl(t) < 0).map((t) => ({ t, ts: closeTs(t) })).filter((x) => x.ts);
  // 손절 직후(MIND.cool분 안) 들어간 진입
  function revenge(es) {
    const ls = lossCloses(), out = [];
    for (const e of es) {
      const a = entryTs(e.t); if (!a) continue;
      const l = ls.find((x) => !e.list.includes(x.t) && x.ts < a && a - x.ts <= MIND.cool * 60e3);
      if (l) out.push({ e, l, gap: Math.round((a - l.ts) / 60e3) });
    }
    return out;
  }
  function lossStreak() {
    const es = entries(daysAgo(60)).filter((e) => e.closed && e.pl != null).sort((a, b) => (b.cd + (b.cts || 0)).localeCompare(a.cd + (a.cts || 0)));
    let n = 0; for (const e of es) { if (e.pl < 0) n++; else break; }
    return { n, last: es[0] && es[0].cd };
  }
  function mindChecks() {
    const out = [], now = Date.now();
    const last = lossCloses().sort((a, b) => b.ts - a.ts)[0];
    if (last && now >= last.ts && now - last.ts < MIND.cool * 60e3) out.push({ lv: "warn", text: `손절 ${Math.max(1, Math.round((now - last.ts) / 60e3))}분 전 · ${MIND.cool}분은 쉬어 가요 (복수 매매 주의)` });
    const s = lossStreak();
    if (s.n >= MIND.streak) out.push(s.last === today() ? { lv: "warn", text: `${s.n}연속 손절 · 오늘은 여기까지가 좋아요` } : { lv: "info", text: `최근 ${s.n}연속 손절 · 다음 진입은 한 번 더 확인해요` });
    const tl = tiltScore();
    if (tl.v >= 60) out.unshift({ lv: "warn", text: `틸트 ${tl.v}점 · 감정이 많이 흔들려요, 오늘은 쉬어 가요` });
    const n = entries(today()).filter((e) => e.t.date === today()).length;
    if (n >= MIND.perDay) out.push({ lv: "warn", text: `오늘 진입 ${n}번 · 과매매 주의` });
    const noBasis = st.trades.filter((t) => t.status === "open" && !(t.basis && t.basis.length) && !t.why);
    if (noBasis.length) out.push({ lv: "warn", text: `근거 없이 들고 있는 포지션 ${noBasis.length}건`, go: "home" });
    if (!st.journal.some((j) => j.date === today() && j.kind === "diary")) out.push({ lv: "info", text: "오늘 일지를 아직 안 썼어요", go: "journal" });
    return out;
  }

  // 틸트 점수 (0~100): 선물 계좌를 망가뜨리는 감정 신호를 묶어서 셈
  const HOT_MOODS = ["복수심", "조급함", "욕심", "불안", "두려움"];
  function tiltScore() {
    const parts = [], now = Date.now(), add = (v, why) => { if (v > 0) parts.push({ v: Math.round(v), why }); };
    const s = lossStreak(); if (s.n >= 1 && s.last >= daysAgo(1)) add(Math.min(30, s.n * 10), `연속 손절 ${s.n}번`);
    const last = lossCloses().sort((a, b) => b.ts - a.ts)[0];
    if (last && now >= last.ts) { const m = (now - last.ts) / 60e3; if (m < MIND.cool) add(20, `손절한 지 ${Math.max(1, Math.round(m))}분`); else if (m < 120) add(10, `손절한 지 ${Math.round(m)}분`); }
    const td = entries(today()).filter((e) => e.t.date === today());
    if (td.length >= 3) add(Math.min(24, (td.length - 2) * 8), `오늘 진입 ${td.length}번`);
    if (td.some((e) => e.t.time && +e.t.time.slice(0, 2) < 6)) add(10, "새벽 매매");
    // 손실 뒤 크기·레버리지를 키웠는지 (가장 최근 진입 vs 그 전 손실 진입)
    const rec = entries(daysAgo(2)).filter((e) => entryTs(e.t)).sort((a, b) => entryTs(b.t) - entryTs(a.t)), cur = rec[0];
    if (cur && now - entryTs(cur.t) < 24 * 36e5) {
      const pl = rec.slice(1).find((e) => e.closed && e.pl != null && e.pl < 0);
      if (pl) {
        const nv = (e) => e.list.reduce((a, x) => a + (x.en || 0) * (x.qty || 0), 0), r = nv(pl) ? nv(cur) / nv(pl) : 0;
        if (r >= 1.3) add(20, `손실 뒤 크기를 ${r.toFixed(1)}배로 키움`);
        if (pl.t.lev && cur.t.lev > pl.t.lev) add(10, `손실 뒤 레버리지 ${pl.t.lev}→${cur.t.lev}배`);
      }
    }
    const eq = futEq(), c = riskCfg(); if (eq) { const dl = -todayFutPnl() / eq * 100; if (dl > 0) add(Math.min(20, dl / c.day * 20), `오늘 손실 −${dl.toFixed(1)}%`); }
    const op = st.trades.filter((t) => t.status === "open"), fs = op.map((t) => t.feel || {});
    if (fs.some((f) => f.chase === "강함")) add(15, "되찾고 싶은 마음 강함"); else if (fs.some((f) => f.chase === "조금")) add(7, "되찾고 싶은 마음 조금");
    if (fs.some((f) => f.sleep === "부족")) add(5, "잠 부족");
    if (fs.some((f) => +f.lv >= 4)) add(5, "감정이 셈");
    const hm = [...new Set(op.flatMap((t) => t.mood || []).filter((m) => HOT_MOODS.includes(m)))];
    if (hm.length) add(10, `진입 심리: ${hm.join(", ")}`);
    const v = Math.min(100, parts.reduce((a, p) => a + p.v, 0));
    return { v, parts: parts.sort((a, b) => b.v - a.v), lv: v >= 60 ? "hot" : v >= 30 ? "warm" : "calm" };
  }
  const CALM = ["차트를 끄고 5분 걷기", "물 한 잔 마시고 숨을 천천히 10번 쉬기", "방금 손절한 이유를 한 줄로 적기", "다음 진입 조건을 미리 적어 두고 그때까지 기다리기", "오늘 손실 한도까지 남은 금액 확인하기", "상담사에게 지금 마음 털어놓기"];

  // ---------- 리스크 매니저 (거부권) ----------
  const RISK_DEF = { per: 3, day: 8, lev: 20 };
  const riskCfg = () => Object.assign({}, RISK_DEF, Store.pref.get("risk", {}));
  const futEq = () => { const a = bybitEquity(); if (a && a.v) return a.v; const m = +Store.pref.get("asBybit", 0); return m > 0 ? m : null; };
  const isFut = (t) => t.venue !== "upbit" && t.side !== "buy";
  function todayFutPnl() {
    let v = 0; const td = today();
    for (const t of st.trades) if (t.status === "closed" && isFut(t) && !shadowed(t) && (t.closeDate || t.date) === td) { const p = realPnl(t); if (p != null) v += p; }
    return v;
  }
  const liqEst = (side, en, lev) => (lev > 0 && en ? (side === "long" ? en * (1 - 1 / lev + 0.005) : en * (1 + 1 / lev - 0.005)) : null);
  function judge({ side, en, sl, qty, lev, liq, open }) {
    const c = riskCfg(), eq = futEq(), no = [];
    let riskPct = null, locked = false;
    if (!sl) no.push("손절가가 없어요");
    else if ((side === "long" && sl >= en) || (side === "short" && sl <= en)) { if (open) { locked = true; riskPct = 0; } else no.push("손절가가 진입가 반대쪽이에요"); }
    if (lev > c.lev) no.push(`레버리지 ${lev}배 · 기준 ${c.lev}배 넘음`);
    if (sl && qty && eq && !locked) { riskPct = Math.abs(en - sl) * qty / eq * 100; if (riskPct > c.per + 1e-9) no.push(`손절 시 계좌 −${riskPct.toFixed(1)}% · 기준 ${c.per}% 넘음`); }
    const lq = liq || liqEst(side, en, lev);
    if (sl && lq && ((side === "long" && sl <= lq) || (side === "short" && sl >= lq))) no.push("청산가가 손절가보다 먼저 와요");
    const dl = eq ? -todayFutPnl() / eq * 100 : null;
    if (!open && dl != null && dl >= c.day) no.push(`오늘 손실 −${dl.toFixed(1)}% · 하루 한도 ${c.day}% 도달`);
    return { ok: !no.length, no, riskPct, liq: lq, locked };
  }
  function riskChecks() {
    const out = [], c = riskCfg(), eq = futEq();
    for (const t of st.trades.filter((t) => t.status === "open" && isFut(t))) {
      const j = judge({ side: t.side, en: t.en, sl: t.sl, qty: t.qty, lev: t.lev, liq: t.liq, open: true });
      if (!j.ok) out.push({ lv: "warn", text: `${t.coin} ${sideName[t.side]} 거부 · ${j.no[0]}` });
    }
    if (eq) { const dl = -todayFutPnl() / eq * 100; if (dl >= c.day) out.push({ lv: "warn", text: `오늘 손실 −${dl.toFixed(1)}% · 하루 한도 도달, 오늘은 진입 거부` }); }
    return out;
  }
  function weekStats(n = 7) {
    const from = daysAgo(n - 1), cl = st.trades.filter((t) => t.status === "closed" && (t.closeDate || t.date) >= from);
    let pl = 0, wins = 0, ok = true;
    for (const t of cl) { const p = pnlOf(t); if (p == null) continue; if (p > 0) wins++; const u = usdOf(p, curOf(t)); if (u == null) ok = false; else pl += u; }
    const opened = st.trades.filter((t) => t.date >= from);
    const withBasis = opened.filter((t) => (t.basis && t.basis.length) || t.why).length;
    const moods = {}; for (const t of opened) for (const m of t.mood || []) moods[m] = (moods[m] || 0) + 1;
    for (const j of st.journal.filter((j) => j.date >= from)) for (const m of j.mood || []) moods[m] = (moods[m] || 0) + 1;
    const top = Object.entries(moods).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m, c]) => `${m} ${c}`);
    return { n: cl.length, wins, pl: ok ? pl : null, opened: opened.length, withBasis, top };
  }
  // 차트분석팀: 근거 칩별 성과
  function basisStats() {
    const m = {};
    for (const t of st.trades.filter((t) => t.status === "closed")) {
      const p = pnlOf(t); if (p == null) continue; const u = usdOf(p, curOf(t)); if (u == null) continue;
      for (const b of t.basis || []) { const o = (m[b] = m[b] || { n: 0, w: 0, pl: 0 }); o.n++; if (p > 0) o.w++; o.pl += u; }
    }
    return Object.entries(m).map(([b, o]) => ({ b, ...o, rate: o.w / o.n })).sort((a, b) => b.n - a.n || b.rate - a.rate);
  }
  // 트렌드팀: 시장 온도
  let lsr = {}, lsrAt = 0;
  async function loadLsr() {
    if (Date.now() - lsrAt < 5 * 60e3) return;
    lsrAt = Date.now();
    for (const c of Market.COINS) { const r = await Market.longShort(c); if (r) lsr[c] = r; }
  }
  const frS = (v) => (v == null ? "—" : (v * 100 >= 0 ? "+" : "") + (v * 100).toFixed(4) + "%");
  const bigUsd = (v) => (v >= 1e9 ? "$" + (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? "$" + (v / 1e6).toFixed(0) + "M" : usd(v, 0));
  const FR = { hot: 0.0003, cold: -0.0001 };
  function trendNews() {
    const out = [];
    for (const c of Market.COINS) {
      const fr = st.tick[c] && st.tick[c].fr;
      if (fr == null) continue;
      if (fr >= FR.hot) out.push({ lv: "warn", text: `${c} 펀딩비 ${frS(fr)} · 롱 과열` });
      else if (fr <= FR.cold) out.push({ lv: "warn", text: `${c} 펀딩비 ${frS(fr)} · 숏 과열` });
    }
    return out;
  }

  const TEAMS = [
    { id: "vTRisk", name: "🛡 리스크 매니저", role: "손절 · 수량 · 레버리지 · 하루 손실 한도 · 거부권", sum: () => { const r = riskChecks(); if (r.length) return r[0].text + (r.length > 1 ? ` 외 ${r.length - 1}건` : ""); const eq = futEq(), c = riskCfg(); return eq ? `이상 없음 · 오늘 손실 여유 ${Math.max(0, c.day + todayFutPnl() / eq * 100).toFixed(1)}%` : "바이비트 자산을 알면 % 기준으로 심사해요"; }, warn: () => riskChecks().length > 0 },
    { id: "vTMind", name: "🧠 심리 코치", role: "복수 매매 · 연속 손절 · 과매매 · 근거 없는 진입", sum: () => { const w = mindChecks().filter((x) => x.lv === "warn"); return w.length ? w[0].text + (w.length > 1 ? ` 외 ${w.length - 1}건` : "") : "지금은 차분해요"; }, warn: () => mindChecks().some((x) => x.lv === "warn") },
    { id: "vTTalk", name: "🛋 상담사", role: "내 이야기를 들어주는 대화 상대", sum: () => { const t = tiltScore(); return Counsel.hasKey() ? (t.v >= 30 ? `틸트 ${t.v}점 · 이야기 나눠 볼까요?` : "언제든 털어놓으세요") : "Claude API 열쇠를 넣으면 대화할 수 있어요"; } },
    { id: "vTData", name: "📊 데이터 분석가", role: "근거 · 시간봉 · 요일 · 시간대 · 심리별 성과", sum: () => { const es = entries(daysAgo(89)).filter((e) => e.closed && e.pl != null && e.cd >= daysAgo(89)); const w = es.filter((e) => e.pl > 0).length; return es.length ? `최근 90일 ${es.length}건 · 승률 ${Math.round(w / es.length * 100)}%` : "종료한 매매가 쌓이면 성과를 나눠 보여줘요"; } },
  ];
  function renderTeamList() {
    $("teamList").innerHTML = TEAMS.map((t, i) => `<div class="item team" data-i="${i}">
      <div class="l1"><b>${t.name}</b>${t.warn && t.warn() ? '<span class="badge warn">확인</span>' : '<span class="mut">›</span>'}</div>
      <div class="l2"><span>${esc(t.role)}</span></div>
      <div class="tsum">${esc(t.sum())}</div></div>`).join("");
    $("teamList").querySelectorAll(".item").forEach((el) => el.onclick = () => showView(TEAMS[el.dataset.i].id));
  }
  document.querySelectorAll("[data-back]").forEach((b) => b.onclick = () => goBack(b.dataset.back));

  // ---------- 데이터 분석가 ----------
  let dsDays = 90;
  seg($("dsRange"), [["30일", 30], ["90일", 90], ["전체", 0]], dsDays, (v) => { dsDays = v; renderData(); });
  const SES = (h) => (h >= 9 && h < 16 ? "아시아 9~16시" : h >= 16 && h < 22 ? "유럽 16~22시" : h >= 22 || h < 6 ? "미국 22~6시" : "새벽 6~9시");
  function holdOf(e) {
    const a = entryTs(e.t);
    if (a && e.cts && e.cts >= a) { const h = (e.cts - a) / 36e5; return h < 4 ? "4시간 미만" : h < 24 ? "하루 안" : h < 72 ? "1~3일" : "3일 이상"; }
    const d = Math.round((new Date(e.cd + "T00:00:00") - new Date(e.t.date + "T00:00:00")) / 864e5);
    return d <= 0 ? "하루 안" : d <= 3 ? "1~3일" : "3일 이상";
  }
  const DIMS = [
    ["근거", (e) => ((e.b.basis || []).length ? e.b.basis : ["근거 없음"])],
    ["기준 시간봉", (e) => [Market.TF[e.b.tf] ? Market.TF[e.b.tf].name : "모름"]],
    ["코인 · 방향", (e) => [`${e.t.coin} ${sideName[e.t.side]}`]],
    ["레버리지", (e) => { const l = e.t.lev; return [!l ? "모름" : l <= 5 ? "5배 이하" : l <= 10 ? "6~10배" : l <= 20 ? "11~20배" : "20배 초과"]; }],
    ["요일", (e) => [WD[new Date(e.t.date + "T00:00:00").getDay()] + "요일"]],
    ["진입 시간대", (e) => (e.t.time ? [SES(+e.t.time.slice(0, 2))] : ["모름"])],
    ["보유 기간", (e) => [holdOf(e)]],
    ["진입 심리", (e) => e.b.mood || []],
  ];
  const usdS = (v) => (v > 0 ? "+" : "") + usd(v);
  function renderData() {
    const from = dsDays ? daysAgo(dsDays - 1) : "";
    const es = entries(from).filter((e) => e.closed && e.pl != null && e.cd >= from);
    if (!es.length) { $("dsFind").innerHTML = `<div class="empty">이 기간에 종료한 매매가 없어요.</div>`; $("dsBody").innerHTML = ""; return; }
    const wins = es.filter((e) => e.pl > 0), losses = es.filter((e) => e.pl < 0);
    const sum = es.reduce((a, e) => a + e.pl, 0);
    const aw = wins.length ? wins.reduce((a, e) => a + e.pl, 0) / wins.length : 0, al = losses.length ? losses.reduce((a, e) => a + e.pl, 0) / losses.length : 0;
    const groups = [];
    const body = DIMS.map(([name, fn]) => {
      const m = new Map();
      for (const e of es) for (const k of fn(e)) { const o = m.get(k) || { n: 0, w: 0, pl: 0 }; o.n++; if (e.pl > 0) o.w++; o.pl += e.pl; m.set(k, o); }
      const rows = [...m.entries()].sort((a, b) => b[1].n - a[1].n || b[1].pl - a[1].pl);
      for (const [k, o] of rows) if (o.n >= 5 && k !== "모름") groups.push({ name, k, ...o, rate: o.w / o.n });
      if (!rows.length) return "";
      return `<div class="card"><h3>${name}</h3><table class="dst"><tr><th></th><th>건수</th><th>승률</th><th>손익($)</th></tr>${rows.map(([k, o]) => `<tr class="${o.n < 5 ? "few" : ""}"><td>${esc(k)}</td><td>${o.n}</td><td>${Math.round(o.w / o.n * 100)}%</td><td class="${sgn(o.pl)}">${usdS(o.pl)}</td></tr>`).join("")}</table></div>`;
    }).join("");
    const good = groups.filter((g) => g.pl > 0 && g.rate >= 0.5).sort((a, b) => b.pl - a.pl).slice(0, 3);
    const bad = groups.filter((g) => g.pl < 0).sort((a, b) => a.pl - b.pl).slice(0, 3);
    const line = (g, ok) => `<div class="chk ${ok ? "ok" : "warn"}"><i>${ok ? "✓" : "!"}</i><span>${esc(g.name)} <b>${esc(g.k)}</b> · ${g.n}건 승률 ${Math.round(g.rate * 100)}% · <b class="${sgn(g.pl)}">${usdS(g.pl)}</b></span></div>`;
    const rv = revenge(es);
    let rvLine = "";
    if (rv.length) { const p = rv.reduce((a, x) => a + x.e.pl, 0), w = rv.filter((x) => x.e.pl > 0).length; rvLine = `<div class="chk ${p < 0 ? "warn" : "info"}"><i>${p < 0 ? "!" : "i"}</i><span>손절 ${MIND.cool}분 안에 다시 들어간 매매 ${rv.length}건 · 승률 ${Math.round(w / rv.length * 100)}% · <b class="${sgn(p)}">${usdS(p)}</b></span></div>`; }
    $("dsFind").innerHTML = `<div class="kv"><span>종료한 매매 <small class="mut">(진입 단위)</small></span><b>${es.length}건 · 승률 ${Math.round(wins.length / es.length * 100)}%</b>
        <span>손익 (달러 환산)</span><b class="${sgn(sum)}">${usdS(sum)}</b>
        <span>평균 수익 / 평균 손실</span><b><span class="up">${usdS(aw)}</span> / <span class="dn">${usdS(al)}</span></b>
        <span>손익비</span><b>${al ? (aw / -al).toFixed(2) : "—"}</b></div>`
      + (good.length || bad.length || rvLine ? `<div style="margin-top:10px">${good.map((g) => line(g, true)).join("")}${bad.map((g) => line(g, false)).join("")}${rvLine}</div>`
        : `<p class="mut sm" style="margin-bottom:0">같은 조건의 매매가 5건 이상 쌓이면 잘 되는 것 · 안 되는 것을 골라 줘요.</p>`);
    $("dsBody").innerHTML = body;
  }
  $("tcGo").onclick = () => { lastTab = "vChart"; showView("vChart"); setTimeout(() => $("anaBtn").click(), 200); };

  async function renderTTrend() {
    const draw = () => {
      $("ttBody").innerHTML = `<table><tr><th>종목</th><th>24시간</th><th>펀딩비</th><th>미결제약정</th><th>롱 : 숏</th></tr>${Market.COINS.map((c) => {
        const t = st.tick[c] || {}, l = lsr[c];
        return `<tr><td><b>${c}</b></td><td class="${sgn(t.chg || 0)}">${t.chg != null ? pctS(t.chg) : "—"}</td><td class="${t.fr >= FR.hot ? "up" : t.fr <= FR.cold ? "dn" : ""}">${frS(t.fr)}</td><td>${t.oi ? bigUsd(t.oi) : "—"}</td><td>${l ? `${(l.buy * 100).toFixed(0)} : ${(l.sell * 100).toFixed(0)}` : "—"}</td></tr>`;
      }).join("")}</table>`;
      const n = trendNews();
      $("ttNote").textContent = n.length ? n.map((x) => x.text).join(" · ") : `펀딩비 ${frS(FR.hot)} 이상이면 롱 과열, ${frS(FR.cold)} 이하면 숏 과열로 표시해요.`;
    };
    draw(); await loadLsr(); draw();
  }
  async function trendText() {
    await loadLsr();
    const lines = [`트렌드팀 자료 · 기준 ${new Date().toLocaleString("ko-KR")}`,
      "부탁: 매수/매도 지시 말고, 큰 흐름(주봉·일봉)과 시장 분위기(과열/공포 신호)를 정리해 주세요. 제 방식은 4시간봉 이상 스윙, 큰 추세 매매예요.", ""];
    for (const c of Market.COINS) {
      const t = st.tick[c] || {}, l = lsr[c], k = kimp(c);
      lines.push(`[${c}USDT] 현재 ${price(c) ? Chart.fmtP(price(c)) : "—"} · 24시간 ${t.chg != null ? pctS(t.chg) : "—"} · 펀딩비 ${frS(t.fr)} · 미결제약정 ${t.oi ? bigUsd(t.oi) : "—"} · 롱:숏(계정 비율) ${l ? `${(l.buy * 100).toFixed(1)}:${(l.sell * 100).toFixed(1)}` : "—"} · 김프 ${k == null ? "—" : pctS(k)}`);
      for (const [tf, n] of [["1w", 12], ["1d", 30]]) {
        try {
          const b = await Market.klines(c, tf, n);
          lines.push(`- ${Market.TF[tf].name} 최근 ${b.length}봉 종가: ` + b.map((x) => Chart.fmtP(x.c)).join(", "));
        } catch {}
      }
      lines.push("");
    }
    return lines.join("\n");
  }
  async function copyText(text, msg) { try { await navigator.clipboard.writeText(text); toast(msg); } catch { sheet(`<div class="sh"><h2>복사할 내용</h2><button class="ghost" id="shX">닫기</button></div><textarea class="anaText" readonly>${esc(text)}</textarea>`); $("shX").onclick = closeSheet; } }
  $("ttCopy").onclick = async () => { $("ttCopy").disabled = true; copyText(await trendText(), "트렌드 자료를 복사했어요"); $("ttCopy").disabled = false; };
  $("ttClaude").onclick = $("taClaude").onclick = () => window.open("https://claude.ai/new", "_blank", "noopener");

  let taDays = 7;
  seg($("taRange"), [["7일", 7], ["30일", 30], ["90일", 90]], taDays, (v) => (taDays = v));
  // 심리 코치 화면
  const chkHtml = (list, okText) => list.length ? list.map((x) => `<div class="chk ${x.lv}"><i>${x.lv === "warn" ? "!" : "i"}</i><span>${esc(x.text)}</span>${x.go ? `<button class="sm ghost" data-go="${x.go}">보기</button>` : ""}</div>`).join("") : `<div class="chk ok"><i>✓</i><span>${okText}</span></div>`;
  function renderMindNow() {
    $("mcNow").innerHTML = chkHtml(mindChecks(), "지금은 차분해요 · 계획대로 가요");
    $("mcNow").querySelectorAll("[data-go]").forEach((b) => b.onclick = () => { const v = b.dataset.go === "home" ? "vHome" : "vJournal"; lastTab = v; showView(v); if (v === "vJournal") renderJournal(); });
  }
  function renderTilt() {
    const t = tiltScore(), word = { calm: "차분해요", warm: "조금 흔들려요", hot: "많이 흔들려요 (틸트)" }[t.lv];
    const tips = t.lv === "calm" ? [] : CALM.slice(t.lv === "hot" ? 0 : 1, t.lv === "hot" ? 6 : 4);
    $("mcTilt").innerHTML = `<div class="tilt ${t.lv}"><b>${t.v}</b><span>${word}</span></div>
      <div class="wprog ${t.lv === "hot" ? "bad" : ""}"><div class="wbar"><i style="width:${t.v}%"></i></div></div>
      ${t.parts.length ? `<div class="kv" style="margin-top:10px">${t.parts.map((p) => `<span>${esc(p.why)}</span><b>+${p.v}</b>`).join("")}</div>` : `<p class="mut sm" style="margin-bottom:0">흔들리는 신호가 없어요. 이 마음 그대로 계획대로 가요.</p>`}
      ${tips.length ? `<div class="calm"><b>지금 해 볼 것</b>${tips.map((x) => `<span>· ${esc(x)}</span>`).join("")}</div>` : ""}
      <button class="${t.lv === "calm" ? "" : "primary"}" id="mcTalk" style="width:100%;margin-top:12px">🛋 상담사와 이야기하기</button>
      <p class="mut sm" style="margin-bottom:0">30점 이상이면 주의, 60점 이상이면 틸트예요. 진입 근거를 적을 때 감정 세기·잠·되찾고 싶은 마음을 고르면 더 정확해져요.</p>`;
    $("mcTalk").onclick = () => showView("vTTalk");
  }
  function statRows(es, fn) {
    const m = new Map();
    for (const e of es) for (const k of fn(e)) { const o = m.get(k) || { n: 0, w: 0, pl: 0 }; o.n++; if (e.pl > 0) o.w++; o.pl += e.pl; m.set(k, o); }
    return [...m.entries()].sort((a, b) => b[1].n - a[1].n);
  }
  function renderFeel() {
    const from = daysAgo(89), es = entries(from).filter((e) => e.closed && e.pl != null && e.cd >= from);
    const sets = [
      ["진입 때 심리", (e) => e.b.mood || []],
      ["감정 세기", (e) => (e.b.feel && e.b.feel.lv ? [`세기 ${e.b.feel.lv}`] : [])],
      ["잠", (e) => (e.b.feel && e.b.feel.sleep ? [e.b.feel.sleep === "부족" ? "잠 부족" : "잘 잠"] : [])],
      ["되찾고 싶은 마음", (e) => (e.b.feel && e.b.feel.chase ? [e.b.feel.chase] : [])],
    ];
    const html = sets.map(([name, fn]) => {
      const rows = statRows(es, fn); if (!rows.length) return "";
      return `<div class="fsub">${name}</div><table class="dst"><tr><th></th><th>건수</th><th>승률</th><th>손익($)</th></tr>${rows.map(([k, o]) => `<tr class="${o.n < 5 ? "few" : ""}"><td>${esc(k)}</td><td>${o.n}</td><td>${Math.round(o.w / o.n * 100)}%</td><td class="${sgn(o.pl)}">${usdS(o.pl)}</td></tr>`).join("")}</table>`;
    }).join("");
    $("mcFeel").innerHTML = html || `<div class="empty">진입 근거를 적을 때 심리·감정을 골라 두면,<br>어떤 마음일 때 결과가 좋았는지 여기서 보여줘요.</div>`;
  }
  function renderMind() {
    renderTilt(); renderMindNow(); renderFeel();
    const from = daysAgo(29), es = entries(from).filter((e) => e.t.date >= from);
    const done = es.filter((e) => e.closed && e.pl != null);
    const st2 = (arr) => { const n = arr.length, w = arr.filter((e) => e.pl > 0).length, pl = arr.reduce((a, e) => a + e.pl, 0); return n ? `${n}건 · 승률 ${Math.round(w / n * 100)}% · <b class="${sgn(pl)}">${usdS(pl)}</b>` : "없음"; };
    const rv = revenge(done).map((x) => x.e), rest = done.filter((e) => !rv.includes(e));
    const perDay = {}; for (const e of es) perDay[e.t.date] = (perDay[e.t.date] || 0) + 1;
    const busyDays = Object.keys(perDay).filter((d) => perDay[d] >= MIND.perDay);
    const busy = done.filter((e) => busyDays.includes(e.t.date)), calm = done.filter((e) => !busyDays.includes(e.t.date));
    const noB = done.filter((e) => !(e.b.basis || []).length && !e.b.why), withB = done.filter((e) => (e.b.basis || []).length || e.b.why);
    $("mcPat").innerHTML = `<div class="kv">
      <span>손절 ${MIND.cool}분 안 재진입</span><b style="font-family:var(--font)">${st2(rv)}</b>
      <span class="ind">└ 나머지 진입</span><b style="font-family:var(--font)">${st2(rest)}</b>
      <span>하루 ${MIND.perDay}번 이상 진입한 날</span><b style="font-family:var(--font)">${busyDays.length}일 · ${st2(busy)}</b>
      <span class="ind">└ 그 밖의 날</span><b style="font-family:var(--font)">${st2(calm)}</b>
      <span>근거 없이 진입</span><b style="font-family:var(--font)">${st2(noB)}</b>
      <span class="ind">└ 근거 적은 진입</span><b style="font-family:var(--font)">${st2(withB)}</b></div>
      <p class="mut sm" style="margin-bottom:0">경고 기준: 손절 후 ${MIND.cool}분 · 연속 손절 ${MIND.streak}번 · 하루 진입 ${MIND.perDay}번. 막지는 않고 알려만 줘요.</p>`;
    const w = weekStats(7);
    $("taWeek").innerHTML = `<div class="kv"><span>종료한 매매</span><b>${w.n}건 · 수익 ${w.wins}건${w.n ? ` (${Math.round(w.wins / w.n * 100)}%)` : ""}</b>
      <span>손익 (달러 환산)</span><b class="${sgn(w.pl || 0)}">${w.pl == null ? "—" : usd(w.pl)}</b>
      <span>근거 기록</span><b>${w.opened ? `${w.withBasis} / ${w.opened}건` : "—"}</b>
      <span>자주 나온 심리</span><b style="font-family:var(--font)">${esc(w.top.join(" · ") || "—")}</b></div>`;
  }

  // 리스크 매니저 화면
  const rk = { coin: st.coin, side: "long" };
  seg($("rkCoin"), Market.COINS.map((c) => [c, c]), rk.coin, (v) => { rk.coin = v; const p = price(v); if (p) $("rkEn").value = +p.toFixed(v === "BTC" ? 1 : 2); rkCalc(); });
  seg($("rkSide"), [["롱", "long"], ["숏", "short"]], rk.side, (v) => { rk.side = v; rkCalc(); });
  ["rkEn", "rkSl", "rkLev", "rkRisk"].forEach((id) => $(id).addEventListener("input", rkCalc));
  [["rkCPer", "per"], ["rkCDay", "day"], ["rkCLev", "lev"]].forEach(([id, k]) => $(id).addEventListener("change", () => {
    const c = Store.pref.get("risk", {}), v = +$(id).value; if (v > 0) c[k] = v; else delete c[k]; Store.pref.set("risk", c);
    renderRiskLive(); rkCalc(); toast("거부 기준을 바꿨어요");
  }));
  const pxS = (v) => (v ? Chart.fmtP(v) : "—");
  function rkCalc() {
    const c = riskCfg(), eq = futEq(), en = +$("rkEn").value, sl = +$("rkSl").value, lev = +$("rkLev").value || 1, rp = +$("rkRisk").value || c.per;
    $("rkRisk").placeholder = c.per;
    if (!en || !sl) { $("rkOut").innerHTML = `<p class="mut sm" style="margin:10px 0 0">진입가와 손절가를 넣으면 수량 · 증거금 · 청산가를 계산해요.</p>`; return; }
    const d = Math.abs(en - sl), qty = eq && d ? eq * rp / 100 / d : null, notional = qty ? qty * en : null, margin = notional ? notional / lev : null;
    const j = judge({ side: rk.side, en, sl, qty, lev });
    if (margin && eq && margin > eq) { j.no.push(`필요 증거금 ${usd(margin)} · 계좌보다 커요 (레버리지를 올리거나 위험을 줄이세요)`); j.ok = false; }
    $("rkOut").innerHTML = `<div class="verdict ${j.ok ? "ok" : "no"}"><b>${j.ok ? "✓ 통과" : "✕ 진입 거부"}</b>${j.no.map((x) => `<span>${esc(x)}</span>`).join("")}</div>
      <div class="kv" style="margin-top:10px">
        <span>손절폭</span><b>${(d / en * 100).toFixed(2)}%</b>
        <span>수량 <small class="mut">(계좌 ${rp}% 위험)</small></span><b>${qty ? qty.toFixed(rk.coin === "BTC" ? 3 : 2) + " " + rk.coin : "—"}</b>
        <span>포지션 금액</span><b>${notional ? usd(notional) : "—"}</b>
        <span>필요 증거금 <small class="mut">(${lev}배)</small></span><b>${margin ? usd(margin) : "—"}</b>
        <span>실제 레버리지 <small class="mut">(금액 ÷ 계좌)</small></span><b>${notional && eq ? (notional / eq).toFixed(1) + "배" : "—"}</b>
        <span>손절 시 손실</span><b class="dn">${qty ? "−" + usd(qty * d) : "—"}</b>
        <span>예상 청산가 <small class="mut">(격리, 대략)</small></span><b>${pxS(j.liq)}</b></div>
      ${eq ? "" : `<p class="mut sm" style="margin-bottom:0">바이비트 자산을 몰라서 수량을 못 정해요. 설정에서 바이비트를 연결하거나 자산을 넣어 주세요.</p>`}`;
  }
  function renderRiskLive() {
    const c = riskCfg(), eq = futEq(), tp = todayFutPnl();
    const dl = eq ? Math.max(0, -tp / eq * 100) : null, hit = dl != null && dl >= c.day;
    $("rkToday").innerHTML = eq ? `<div class="wprog${hit ? " bad" : ""}"><div class="wbar"><i style="width:${Math.min(100, dl / c.day * 100)}%"></i></div>
        <span>${hit ? `🚫 오늘 한도 도달 · 오늘은 새 진입 거부` : `오늘 손실 −${dl.toFixed(1)}% / 한도 ${c.day}% · 여유 ${(c.day - dl).toFixed(1)}%`}</span></div>
        <div class="kv" style="margin-top:10px"><span>오늘 실현 손익 (선물)</span><b class="${sgn(tp)}">${usdS(tp)}</b><span>계좌 (바이비트)</span><b>${usd(eq)}</b><span>한 매매 최대 손실</span><b>${usd(eq * c.per / 100)} <small class="mut">(${c.per}%)</small></b></div>`
      : `<div class="empty">바이비트 자산을 몰라서 % 기준을 못 써요.<br>설정에서 바이비트를 연결하거나 자산을 넣어 주세요.</div>`;
    const open = st.trades.filter((t) => t.status === "open" && isFut(t));
    $("rkPos").innerHTML = open.length ? open.map((t) => {
      const j = judge({ side: t.side, en: t.en, sl: t.sl, qty: t.qty, lev: t.lev, liq: t.liq, open: true }), lp = price(t.coin);
      const ld = j.liq && lp ? Math.abs(lp - j.liq) / lp * 100 : null;
      return `<div class="rkrow"><div class="l1"><span><span class="badge ${t.side}">${sideName[t.side]}</span><b>${esc(t.coin)}</b> <small class="mut">${t.lev ? t.lev + "배" : ""}</small></span><span class="badge ${j.ok ? "open" : "warn"}">${j.ok ? "✓ 통과" : "✕ 거부"}</span></div>
        <div class="kv"><span>진입 / 손절</span><b>${pxS(t.en)} / ${t.sl ? pxS(t.sl) : '<span class="dn">없음</span>'}</b>
          <span>손절 시 계좌</span><b class="${j.locked ? "up" : j.riskPct > c.per ? "dn" : ""}">${j.locked ? "본절 이상 · 손실 없음" : j.riskPct == null ? "—" : "−" + j.riskPct.toFixed(1) + "%"}</b>
          <span>청산가${t.liq ? "" : " (대략)"}</span><b>${pxS(j.liq)}${ld != null ? ` <small class="mut">지금가에서 ${ld.toFixed(1)}%</small>` : ""}</b></div>
        ${j.no.map((x) => `<div class="chk warn"><i>!</i><span>${esc(x)}</span></div>`).join("")}</div>`;
    }).join("") : `<div class="empty">진행 중인 선물 포지션이 없어요.</div>`;
  }
  function renderRisk() {
    const c = riskCfg();
    $("rkCPer").value = c.per; $("rkCDay").value = c.day; $("rkCLev").value = c.lev;
    if (!$("rkEn").value) { const p = price(rk.coin); if (p) $("rkEn").value = +p.toFixed(rk.coin === "BTC" ? 1 : 2); }
    renderRiskLive(); rkCalc(); renderTTrend();
  }
  function auditText(n) {
    const from = daysAgo(n - 1);
    const tr = st.trades.filter((t) => (t.closeDate || t.date) >= from || t.date >= from).sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
    const jr = st.journal.filter((j) => j.date >= from).sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
    const cur = (t) => (curOf(t) === "KRW" ? "원" : "$");
    const lines = [`복기 자료 · 최근 ${n}일 (${from} ~ ${today()})`,
      "부탁: 매수/매도 지시 말고 점검만 해 주세요. ① 진입 근거가 실제로 맞았는지 ② 손절·익절 계획을 지켰는지 ③ 심리 패턴(연속 손실 뒤 무리한 진입, 복수매매, 과매매 등) ④ 다음에 지킬 것 1~3가지.",
      "제 방식: 4시간봉 이상 스윙, 큰 추세 매매. 일목·볼린저·RSI·거래량, 직접 그은 평행채널·피보, 변곡 자리 캔들패턴, 파동을 봅니다.", "", `[매매 ${tr.length}건]`];
    for (const t of tr) {
      const p = t.status === "closed" ? pnlOf(t) : null;
      lines.push(`- ${t.date} ${t.time || ""} ${venueName[t.venue]} ${t.coin} ${sideName[t.side]} · 진입 ${Chart.fmtP(t.en)}${t.qty ? ` × ${t.qty}` : ""}${t.lev ? ` · ${t.lev}배` : ""} · 손절 ${t.sl ? Chart.fmtP(t.sl) : "없음"} · 익절 ${t.tp ? Chart.fmtP(t.tp) : "없음"}`
        + (t.status === "closed" ? ` → 청산 ${t.exit ? Chart.fmtP(t.exit) : "—"} (${t.closeDate || ""}) 손익 ${p == null ? "—" : (p >= 0 ? "+" : "") + p.toFixed(2) + cur(t)}${t.hit ? ` · 결과 ${t.hit}` : ""}` : " → 진행 중")
        + `\n  근거: ${(t.basis || []).join(", ") || "없음"}${t.tf ? ` / 기준 ${Market.TF[t.tf] ? Market.TF[t.tf].name : t.tf}` : ""}${t.why ? ` / 메모: ${t.why}` : ""}`
        + `${(t.mood || []).length || t.moodText ? `\n  진입 때 심리: ${(t.mood || []).join(", ")}${t.moodText ? " — " + t.moodText : ""}` : ""}`
        + `${(t.closeMood || []).length ? `\n  청산 때 심리: ${t.closeMood.join(", ")}` : ""}${t.lesson ? `\n  청산 후 생각: ${t.lesson}` : ""}`
        + (t.notes || []).map((n) => `\n  포지션 중 생각 (${n.d} ${n.tm}): ${n.text}`).join(""));
    }
    lines.push("", `[일지·메모 ${jr.length}개]`);
    for (const j of jr) lines.push(`- ${j.date} ${j.time || ""} ${j.kind === "memo" ? "메모" : j.kind === "shot" ? "차트" : j.kind === "talk" ? "상담" : "일지"}${(j.mood || []).length ? ` (심리: ${j.mood.join(", ")})` : ""}: ${(j.text || "").replace(/\n+/g, " ")}`);
    return lines.join("\n");
  }
  $("taCopy").onclick = () => copyText(auditText(taDays), `최근 ${taDays}일 복기 자료를 복사했어요`);

  // ---------- 상담사 ----------
  let talk = null, talking = false;
  function talkContext() {
    const t = tiltScore(), w = weekStats(7), td = today(), L = [];
    L.push(`오늘 ${td} ${nowHM()} · 틸트 점수 ${t.v}/100${t.parts.length ? ` (${t.parts.map((p) => p.why).join(", ")})` : ""}`);
    L.push(`최근 7일: 종료 ${w.n}건, 수익 ${w.wins}건, 손익 ${w.pl == null ? "모름" : (w.pl >= 0 ? "+" : "") + w.pl.toFixed(0) + "달러"}, 자주 나온 심리 ${w.top.join(", ") || "없음"}`);
    const s = lossStreak(); if (s.n) L.push(`최근 연속 손절 ${s.n}번 (마지막 ${s.last})`);
    const op = st.trades.filter((x) => x.status === "open");
    for (const x of op) L.push(`진행 중: ${x.coin} ${sideName[x.side]} ${x.lev ? x.lev + "배 " : ""}진입 ${x.date}${x.why ? ` · 근거 "${x.why}"` : ""}${(x.mood || []).length ? ` · 심리 ${x.mood.join(", ")}` : ""}${x.feel && x.feel.chase ? ` · 되찾고 싶은 마음 ${x.feel.chase}` : ""}${(x.notes || []).length ? ` · 생각 "${x.notes[x.notes.length - 1].text}"` : ""}`);
    const recent = closedSorted().slice(0, 6);
    for (const x of recent) { const p = realPnl(x); L.push(`최근 청산: ${x.closeDate || x.date} ${x.coin} ${sideName[x.side]} ${p == null ? "" : (p >= 0 ? "+" : "") + p.toFixed(0) + (curOf(x) === "KRW" ? "원" : "달러")}${x.lesson ? ` · 남긴 생각 "${x.lesson}"` : ""}`); }
    const js = st.journal.filter((j) => j.kind !== "shot" && j.kind !== "talk" && j.date >= daysAgo(6)).slice(0, 8);
    for (const j of js) L.push(`일지 ${j.date}${(j.mood || []).length ? ` (${j.mood.join(", ")})` : ""}: ${(j.text || "").replace(/\s+/g, " ").slice(0, 200)}`);
    const past = st.journal.filter((j) => j.kind === "talk" && (!talk || j.id !== talk.id)).slice(0, 2);
    for (const j of past) L.push(`지난 상담 ${j.date} 일부: ${(j.text || "").replace(/\s+/g, " ").slice(-400)}`);
    return L.join("\n");
  }
  const talkText = (msgs) => msgs.map((m) => `${m.role === "user" ? "나" : "상담사"}: ${m.content}`).join("\n");
  async function saveTalk() {
    if (!talk || !talk.msgs.length) return;
    const old = st.journal.find((j) => j.id === talk.id);
    await Store.put("journal", Object.assign(old || { id: talk.id, kind: "talk", date: talk.date, time: talk.time, mood: [] }, { text: talkText(talk.msgs), msgs: talk.msgs, ctx: talk.ctx }));
    await loadData();
  }
  function startTalk(resume) {
    const td = today(), prev = resume ? st.journal.find((j) => j.kind === "talk" && j.date === td && Array.isArray(j.msgs)) : null;
    talk = prev ? { id: prev.id, date: prev.date, time: prev.time, msgs: prev.msgs.slice(), ctx: prev.ctx || talkContext() }
      : { id: "talk_" + Date.now().toString(36), date: td, time: nowHM(), msgs: [], ctx: null };
    if (!talk.ctx) talk.ctx = talkContext();
  }
  function talkHello() {
    const t = tiltScore();
    if (t.lv === "hot") return "오늘 많이 힘드셨던 것 같아요. 지금 마음이 어떤지, 생각나는 대로 편하게 말해 주세요. 천천히 들을게요.";
    if (t.lv === "warm") return "조금 마음이 흔들리는 날 같아요. 지금 어떤 기분인지 들려줄래요?";
    return "안녕하세요. 오늘 하루, 그리고 매매하면서 어떤 마음이었는지 편하게 이야기해 주세요.";
  }
  function drawTalk(streamText) {
    const msgs = talk ? talk.msgs : [];
    const bub = (role, text, cls = "") => `<div class="bub ${role}${cls}">${esc(text).replace(/\n/g, "<br>")}</div>`;
    $("tkLog").innerHTML = bub("as", talkHello()) + msgs.map((m) => bub(m.role === "user" ? "me" : "as", m.content)).join("")
      + (streamText != null ? bub("as", streamText || "…", " typing") : "");
    $("tkLog").lastElementChild.scrollIntoView({ block: "end" });
  }
  function talkSetup(show) {
    $("tkSetup").hidden = !show;
    if (show) { $("tkKey").value = ""; setTimeout(() => $("tkKey").focus(), 50); }
  }
  function renderTalk() {
    if (!talk) startTalk(true);
    talkSetup(!Counsel.hasKey());
    drawTalk();
  }
  $("tkKeySave").onclick = () => {
    const k = $("tkKey").value.trim();
    if (!/^sk-ant-/.test(k)) { toast("sk-ant- 로 시작하는 열쇠를 넣어 주세요"); return; }
    Counsel.setKey(k); $("tkKey").value = ""; talkSetup(false); toast("상담사를 연결했어요");
  };
  $("tkKeyCancel").onclick = () => talkSetup(false);
  $("tkKeyEdit").onclick = () => talkSetup(true);
  $("tkNew").onclick = () => { if (talking) return; startTalk(false); drawTalk(); $("tkIn").focus(); };
  async function sendTalk() {
    const text = $("tkIn").value.trim();
    if (!text || talking) return;
    if (!Counsel.hasKey()) { talkSetup(true); return; }
    if (!talk) startTalk(true);
    talk.msgs.push({ role: "user", content: text }); $("tkIn").value = "";
    talking = true; $("tkSend").disabled = true;
    let acc = ""; drawTalk("");
    try {
      const r = await Counsel.reply(talk.ctx, talk.msgs, (d) => { acc += d; drawTalk(acc); });
      const out = r.refusal && !r.text ? "이 이야기에는 제가 답하기 어려워요. 다른 방식으로 말해 주시겠어요? 많이 힘드시면 109나 1577-0199에 연락해 주세요." : r.text;
      talk.msgs.push({ role: "assistant", content: out });
      await saveTalk();
    } catch (e) {
      talk.msgs.pop(); $("tkIn").value = text;
      if (e.code === "nokey") talkSetup(true);
      toast(e.message);
    } finally { talking = false; $("tkSend").disabled = false; drawTalk(); }
  }
  $("tkSend").onclick = sendTalk;
  $("tkIn").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendTalk(); } });

  // 홈: 팀 소식 (확인할 것이 있을 때만)
  function renderNews() {
    const items = [
      ...riskChecks().map((x) => ({ team: "리스크 매니저", v: "vTRisk", ...x })),
      ...trendNews().map((x) => ({ team: "리스크 매니저", v: "vTRisk", ...x })),
      ...mindChecks().filter((x) => x.lv === "warn").map((x) => ({ team: "심리 코치", v: "vTMind", ...x })),
    ];
    for (const c of Market.COINS) { const k = kimp(c); if (k != null && (k >= 3 || k <= -1)) items.push({ team: "돈 관리", v: "vAcct", text: `${c} 김프 ${pctS(k)}` }); }
    const box = $("hNews");
    box.hidden = !items.length;
    box.innerHTML = items.map((x) => `<button class="nrow" data-v="${x.v}"><b>${x.team}</b><span>${esc(x.text)}</span><i>›</i></button>`).join("");
    box.querySelectorAll(".nrow").forEach((b) => b.onclick = () => { if (b.dataset.v !== "vAcct") lastTab = "vTeam"; showView(b.dataset.v); });
  }

  // ---------- 노트 가져오기 · 백업 ----------
  async function importNote(json) {
    let data; try { data = typeof json === "string" ? JSON.parse(json) : json; } catch { throw new Error("형식이 맞지 않아요"); }
    if (data && data.app === "trade-agent") return restore(data);
    const entries = (data && data.entries) || (Array.isArray(data) ? data : null);
    if (!entries) throw new Error("노트 백업이 아니에요");
    const trades = [], journal = [], legacy = [], cash = [];
    for (const e of entries) {
      legacy.push({ id: "note_" + e.id, raw: e });
      if (e.del) continue;
      if (e.wd) {
        const amt = parseFloat(e.amt);
        if (amt > 0) cash.push({ id: "note_" + e.id, src: "note", kind: e.type === "in" ? "in" : "out", venue: e.venue === "업비트" ? "upbit" : "bybit", amount: amt, cur: e.cur || "KRW", rate: +e.rate || 0,
          type: e.type === "in" ? "" : e.kind === "p" ? "principal" : e.kind === "a" ? "auto" : "profit", date: String(e.date), memo: "" });
        continue;
      }
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
        hit: e.hit || "", lesson: e.lesson || "", closeDate: e.cd || e.date, img: e.imgPred || null, imgRes: e.imgRes || null, rate: +e.rate || 0,
      });
    }
    const had = new Map((await Store.all("trades")).map((t) => [t.id, t]));
    const merged = trades.map((t) => (had.has(t.id) ? Object.assign({}, t, had.get(t.id), { rate: t.rate }) : t));
    await Store.putMany("trades", merged); await Store.putMany("journal", journal); await Store.putMany("legacy", legacy); await Store.putMany("cash", cash);
    if (data.seed || data.seedU) Store.pref.set("noteSeed", { bybit: data.seed, upbit: data.seedU });
    await loadData();
    return `노트에서 매매 ${trades.length}건, 일지 ${journal.length}개, 출금·입금 ${cash.length}건을 가져왔어요.`;
  }
  async function backup() {
    return { app: "trade-agent", v: 1, at: new Date().toISOString(), trades: await Store.all("trades"), journal: await Store.all("journal"), drawings: await Store.all("drawings"), legacy: await Store.all("legacy"), cash: await Store.all("cash") };
  }
  async function restore(d) {
    for (const k of ["trades", "journal", "drawings", "legacy", "cash"]) if (d[k]) await Store.putMany(k, d[k]);
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
          <label for="bbSec">API Secret</label><input id="bbSec" type="text" class="secret" autocomplete="off" data-lpignore="true" spellcheck="false">
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

  // ---------- 업비트 연결 (집 PC) ----------
  function ubView(s, x) {
    const box = $("ubBody");
    if (!x.local) {
      const snap = st.upSnap;
      box.innerHTML = `<p class="mut sm" style="margin:0">업비트는 등록한 IP(집 PC)에서만 연결돼요. 집 PC에서 <b>앱실행.bat</b>로 앱을 켜 두면, 매매·입출금·잔고가 자동으로 들어와 여기에도 보여요.</p>
        <p style="margin:10px 0 0"><b class="${snap && Date.now() - snap.at < 3600e3 ? "up" : ""}">● ${snap ? "마지막으로 받은 시각 " + new Date(snap.at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "아직 PC에서 받은 기록이 없어요"}</b></p>`;
      $("ubMsg").textContent = ""; $("ubErr").textContent = ""; return;
    }
    if (!x.server) {
      box.innerHTML = `<p class="mut sm" style="margin:0">업비트를 연결하려면 앱을 <b>앱실행.bat</b>로 다시 켜 주세요. (새 PC 서버가 필요해요)</p>`;
    } else if (!x.configured) {
      if (!$("ubKey")) {
        box.innerHTML = `<p class="mut sm" style="margin-top:0">업비트 Open API의 <b>조회 전용</b> 열쇠를 넣어 주세요. 열쇠는 이 PC 파일에만 저장되고 폰·인터넷으로 올라가지 않아요.</p>
          <label for="ubKey">Access Key</label><input id="ubKey" autocomplete="off" spellcheck="false">
          <label for="ubSec">Secret Key</label><input id="ubSec" type="text" class="secret" autocomplete="off" data-lpignore="true" spellcheck="false">
          <div class="row"><button class="primary" id="ubGo">연결</button></div>`;
        $("ubGo").onclick = async () => {
          $("ubGo").disabled = true; $("ubErr").textContent = "";
          try { const n = await Upbit.connect($("ubKey").value, $("ubSec").value); toast(`업비트 연결됨 · ${n}건 반영`); await refreshViews(); }
          catch (e) { $("ubErr").textContent = e.message; }
          finally { if ($("ubGo")) $("ubGo").disabled = false; }
        };
      }
    } else {
      box.innerHTML = `<p style="margin-top:0"><b class="up">● 연결됨</b> <span class="mut sm">5분마다 자동으로 읽어요 (최근 1년)</span></p>
        <div class="row wrap"><button id="ubNow">지금 새로 읽기</button><button class="danger" id="ubOff">연결 끊기</button></div>`;
      $("ubNow").onclick = () => Upbit.sync().then((n) => toast(n ? `${n}건 반영했어요` : "새 기록이 없어요")).catch(() => {});
      $("ubOff").onclick = (e) => {
        if (e.target.dataset.s !== "1") { e.target.dataset.s = "1"; e.target.textContent = "한 번 더 누르면 끊기 (기록은 남아요)"; return; }
        Upbit.disconnect();
      };
    }
    $("ubMsg").textContent = s.msg || (s.at ? "마지막 확인 " + new Date(s.at).toTimeString().slice(0, 5) : "");
    $("ubErr").textContent = s.err || "";
  }
  Upbit.init(ubView, refreshViews);

  // ---------- 시작 ----------
  (async () => {
    document.body.dataset.v = "vHome";
    await loadData();
    renderHome();
    loadFx(); setInterval(loadFx, 6 * 3600e3);
    pollUpbit(); setInterval(pollUpbit, 4000);
    await loadChart();
    setInterval(() => { if (document.hidden) return; if ($("vTrade").classList.contains("on")) renderTrades(); if ($("vAcct").classList.contains("on")) renderAcct(); if ($("vHome").classList.contains("on")) { renderOpen(); renderNews(); } if ($("vTeam").classList.contains("on")) renderTeamList(); if ($("vTRisk").classList.contains("on")) renderRiskLive(); if ($("vTMind").classList.contains("on")) { renderMindNow(); renderTilt(); } }, 3000);
  })();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => Chart.retheme());
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    // 새 버전이 올라오면 자동으로 받아서 한 번 새로 고침
    const had = !!navigator.serviceWorker.controller;
    let reloaded = false;
    const busy = () => (window.Markup && Markup.isOpen()) || !$("sheet").hidden
      || [...document.querySelectorAll("textarea, input:not([type=checkbox]):not([type=file]):not([type=date])")].some((x) => x.value && x.value.trim() && !x.disabled && !x.readOnly && x.offsetParent);
    let pending = false;
    const doReload = () => { if (!reloaded) { reloaded = true; location.reload(); } };
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (!had) return; if (busy()) { pending = true; toast("새 버전이 있어요 · 앱을 다시 열면 적용돼요"); } else doReload(); });
    document.addEventListener("visibilitychange", () => { if (pending && document.hidden) doReload(); });
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((reg) => {
      document.addEventListener("visibilitychange", () => { if (!document.hidden) reg.update().catch(() => {}); });
      setInterval(() => reg.update().catch(() => {}), 10 * 60e3);
    }).catch(() => {});
  }
})();
