// 바이비트 연결 (읽기 전용 API 열쇠)
// - 열쇠는 이 기기(localStorage)에만 저장. 동기화로 올리지 않음.
// - 청산된 매매(closed-pnl) → 종료 기록, 지금 포지션(position) → 진행 중 기록. 기록 자체는 동기화로 다른 기기에도 감.
// - 실시간: 개인 웹소켓(position·execution)이 바뀌었다고 알려 주면 최근 기록을 다시 읽음.
const Bybit = (() => {
  const API = "https://api.bybit.com", WS = "wss://stream.bybit.com/v5/private";
  const KEYS = "bybitKeys", LAST = "bybitLast";
  const USER_FIELDS = ["tf", "basis", "why", "mood", "moodText", "img", "imgRes", "lesson", "hit", "closeMood", "sl", "tp", "notes", "trend", "ses", "feel"];
  let keys = Store.pref.get(KEYS, null), offset = 0, ws = null, pingT = 0, retry = 0, busy = false, wsOn = false;
  let onStatus = () => {}, onData = () => {};
  let status = { msg: "", err: "", at: 0 };
  const set = (o) => { status = Object.assign(status, o); onStatus(status, !!keys, wsOn); };

  const enc = new TextEncoder();
  async function hmac(secret, text) {
    const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const s = await crypto.subtle.sign("HMAC", k, enc.encode(text));
    return [...new Uint8Array(s)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  async function syncClock() {
    try { const r = await (await fetch(API + "/v5/market/time")).json(); offset = Math.round(+r.time - Date.now()); } catch {}
  }
  const ERR = { 10003: "API 열쇠가 맞지 않아요", 10004: "Secret이 맞지 않아요", 10005: "열쇠에 권한이 없어요 (읽기 권한 확인)", 10010: "IP 제한이 걸린 열쇠예요 (IP 제한 없음으로 다시 만들어 주세요)", 33004: "열쇠가 만료됐어요 (새로 만들어 주세요)" };
  async function get(path, params, k = keys) {
    const qs = new URLSearchParams(params).toString();
    const ts = String(Date.now() + offset), rw = "10000";
    const sign = await hmac(k.secret, ts + k.key + rw + qs);
    let r;
    try { r = await fetch(`${API}${path}?${qs}`, { headers: { "X-BAPI-API-KEY": k.key, "X-BAPI-TIMESTAMP": ts, "X-BAPI-RECV-WINDOW": rw, "X-BAPI-SIGN": sign } }); }
    catch { throw new Error("바이비트에 연결하지 못했어요 (인터넷 확인)"); }
    const j = await r.json().catch(() => null);
    if (!j) throw new Error(r.status === 401 ? "API 열쇠 또는 Secret이 맞지 않아요" : "바이비트 응답 오류 (" + r.status + ")");
    if (j.retCode !== 0) throw new Error(ERR[j.retCode] || `바이비트 오류 ${j.retCode}: ${j.retMsg}`);
    return j.result;
  }

  const coinOf = (sym) => sym.replace(/(USDT|USDC|PERP)$/, "");
  const dt = (ms) => { const d = new Date(+ms); const l = new Date(d - d.getTimezoneOffset() * 60e3).toISOString(); return [l.slice(0, 10), l.slice(11, 16)]; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function closedSince(since, progress) {
    const out = [], now = Date.now() + offset, W = 7 * 864e5 - 1000;
    for (let end = now; end > since; end -= W) {
      const start = Math.max(since, end - W);
      let cursor = "";
      do {
        const p = { category: "linear", startTime: String(start), endTime: String(end), limit: "100" };
        if (cursor) p.cursor = cursor;
        const r = await get("/v5/position/closed-pnl", p);
        out.push(...(r.list || []));
        cursor = r.nextPageCursor || "";
        await sleep(80);
      } while (cursor);
      if (progress) progress(Math.min(1, (now - start) / (now - since)), out.length);
    }
    return out;
  }
  // 지금 포지션이 언제 열렸는지: 최근 체결부터 거꾸로 수량을 되감아 0이 되는 시점 (최대 90일)
  async function openTime(symbol, side, size) {
    const inc = side === "long" ? "Buy" : "Sell";
    let remain = size, end = Date.now() + offset;
    const stop = end - 90 * 864e5;
    while (end > stop) {
      const start = end - 7 * 864e5 + 1000;
      let cursor = "", list = [];
      do {
        const q = { category: "linear", symbol, startTime: String(start), endTime: String(end), limit: "100" };
        if (cursor) q.cursor = cursor;
        const r = await get("/v5/execution/list", q);
        list.push(...(r.list || []).filter((x) => x.execType === "Trade"));
        cursor = r.nextPageCursor || "";
        await sleep(80);
      } while (cursor);
      list.sort((a, b) => +b.execTime - +a.execTime);
      for (const x of list) {
        const q = +x.execQty;
        remain += x.side === inc ? -q : q;
        if (remain <= size * 1e-6) return +x.execTime;
      }
      end = start - 1;
    }
    return null;
  }
  async function positions() {
    const r = await get("/v5/position/list", { category: "linear", settleCoin: "USDT", limit: "200" });
    return (r.list || []).filter((p) => +p.size > 0);
  }

  // 지갑 잔고(USD, 미실현 포함). 통합계정 → 안 되면 선물계정
  let equity = Store.pref.get("bybitEq", null);
  async function wallet() {
    let v = null;
    for (const accountType of ["UNIFIED", "CONTRACT"]) {
      try {
        const r = await get("/v5/account/wallet-balance", { accountType });
        const a = (r.list || [])[0];
        if (!a) continue;
        v = +a.totalEquity || (a.coin || []).reduce((s, c) => s + (+c.usdValue || (c.coin === "USDT" ? +c.equity : 0) || 0), 0);
        if (v) break;
      } catch {}
    }
    if (v == null) return false;
    const changed = !equity || Math.abs(equity.v - v) > 0.005;
    equity = { v, at: Date.now() }; Store.pref.set("bybitEq", equity);
    // 다른 기기(열쇠 없는 PC)에서도 보이게 동기화 기록으로 남김 (바뀌었거나 30분마다)
    try {
      const old = await Store.get("legacy", "bybit_snapshot");
      if (!old || Math.abs((old.v || 0) - v) > 0.5 || Date.now() - (old.at || 0) > 30 * 60e3) await Store.put("legacy", { id: "bybit_snapshot", v: Math.round(v * 100) / 100, at: Date.now() });
    } catch {}
    return changed;
  }

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  async function save(rec, old) { if (old && same(Object.assign({}, old, rec), old)) return false; await Store.put("trades", Object.assign(old || {}, rec)); return true; }

  // 바이비트 내용 → 매매 기록
  async function refresh(since, progress) {
    if (!keys || busy) return 0;
    busy = true; set({ msg: "바이비트 기록 읽는 중…", err: "" });
    try {
      if (!offset) await syncClock();
      const [closed, pos] = [await closedSince(since, progress), await positions()];
      const all = await Store.all("trades"), byId = new Map(all.map((t) => [t.id, t]));
      let n = 0;
      const uniq = [...new Map(closed.map((c) => [c.orderId, c])).values()].sort((a, b) => +a.updatedTime - +b.updatedTime);
      for (const c of uniq) {
        const side = c.side === "Sell" ? "long" : "short", id = "bb_" + c.orderId;
        const old = byId.get(id), posRec = byId.get(`bbpos_${c.symbol}_${side}`);
        const [cd, ct] = dt(c.updatedTime || c.createdTime);
        const rec = {
          id, src: "bybit", venue: "bybit", coin: coinOf(c.symbol), side, status: "closed",
          en: +c.avgEntryPrice, exit: +c.avgExitPrice, qty: +c.closedSize || +c.qty, pnl: +c.closedPnl,
          fee: (+c.openFee || 0) + (+c.closeFee || 0), lev: +c.leverage || 0, closeDate: cd, closeTime: ct,
        };
        if (!old) {
          Object.assign(rec, { date: cd, time: ct, basis: [], mood: [], why: "", hit: "" });
          if (posRec) { for (const f of USER_FIELDS) if (posRec[f] != null && posRec[f] !== "") rec[f] = posRec[f]; rec.date = posRec.date; rec.time = posRec.time; }
        }
        if (await save(rec, old)) n++;
      }
      const live = new Set();
      for (const p of pos) {
        const side = p.side === "Buy" ? "long" : "short", id = `bbpos_${p.symbol}_${side}`;
        live.add(id);
        const old = byId.get(id);
        const rec = { id, src: "bybit", venue: "bybit", coin: coinOf(p.symbol), side, status: "open", en: +p.avgPrice, qty: +p.size, lev: +p.leverage || 0 };
        if (+p.stopLoss) rec.sl = +p.stopLoss;
        if (+p.takeProfit) rec.tp = +p.takeProfit;
        if (+p.liqPrice) rec.liq = +p.liqPrice;
        // 바이비트의 createdTime은 '이 종목 포지션 칸이 처음 생긴 때'라서 몇 년 전일 수 있음 → 체결 내역으로 실제 진입 시각을 찾음
        const sizeKey = `${p.size}|${p.avgPrice}`;
        if (!old || !old.openFound || old.sizeKey !== sizeKey) {
          const ot = await openTime(p.symbol, side, +p.size).catch(() => null);
          if (ot) { const [d, t] = dt(ot); Object.assign(rec, { date: d, time: t, openFound: true }); }
          else if (!old) { const [d, t] = dt(Date.now()); Object.assign(rec, { date: d, time: t }); }
          rec.sizeKey = sizeKey;
        }
        if (!old) Object.assign(rec, { basis: [], mood: [], why: "" });
        if (await save(rec, old)) n++;
      }
      for (const t of all) if (t.id.startsWith("bbpos_") && !live.has(t.id)) { await Store.del("trades", t.id); n++; }
      Store.pref.set(LAST, Date.now() + offset);
      const eqChanged = await wallet();
      set({ msg: "", err: "", at: Date.now() });
      if (n || eqChanged) onData();
      return n;
    } catch (e) { set({ err: e.message }); throw e; }
    finally { busy = false; }
  }
  let rT = 0;
  const soon = () => { clearTimeout(rT); rT = setTimeout(() => refresh(Date.now() - 3 * 864e5).catch(() => {}), 1500); };

  // 실시간 알림 (개인 웹소켓)
  function connectWs() {
    closeWs();
    if (!keys) return;
    ws = new WebSocket(WS);
    ws.onopen = async () => {
      const exp = Date.now() + offset + 10000;
      ws.send(JSON.stringify({ op: "auth", args: [keys.key, exp, await hmac(keys.secret, "GET/realtime" + exp)] }));
    };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.op === "auth") {
        if (m.success) { ws.send(JSON.stringify({ op: "subscribe", args: ["position", "execution"] })); wsOn = true; retry = 0; set({}); }
        else { set({ err: "실시간 연결 인증 실패: " + (m.ret_msg || "") }); }
      } else if (m.topic === "position" || m.topic === "execution") soon();
    };
    ws.onclose = () => {
      wsOn = false; clearInterval(pingT); set({});
      if (keys) setTimeout(connectWs, Math.min(60000, 2000 * 2 ** retry++));
    };
    pingT = setInterval(() => { if (ws && ws.readyState === 1) ws.send('{"op":"ping"}'); }, 20000);
  }
  function closeWs() { clearInterval(pingT); if (ws) { ws.onclose = null; try { ws.close(); } catch {} } ws = null; wsOn = false; }

  async function connect(key, secret) {
    key = key.trim(); secret = secret.trim();
    if (!key || !secret) throw new Error("API Key와 Secret을 모두 넣어 주세요");
    await syncClock();
    const k = { key, secret };
    const info = await get("/v5/user/query-api", {}, k);
    if (info && info.readOnly === 0) throw new Error("이 열쇠는 거래 권한이 있어요. 안전을 위해 '읽기 전용' 열쇠로 다시 만들어 주세요");
    keys = k; Store.pref.set(KEYS, k);
    connectWs();
    return refresh(Date.now() - 30 * 864e5);
  }
  function disconnect() { keys = null; Store.pref.set(KEYS, null); equity = null; Store.pref.set("bybitEq", null); closeWs(); set({ msg: "", err: "" }); }

  function init(statusCb, dataCb) {
    onStatus = statusCb; onData = dataCb;
    set({});
    if (!keys) return;
    const last = Store.pref.get(LAST, 0);
    syncClock().then(() => { connectWs(); refresh(Math.max(last - 3600e3, Date.now() - 30 * 864e5)).catch(() => {}); });
    setInterval(() => { if (!document.hidden && keys) refresh(Date.now() - 2 * 864e5).catch(() => {}); }, 5 * 60e3);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && keys) { if (!wsOn) connectWs(); soon(); } });
  }
  return { init, connect, disconnect, refresh, get on() { return !!keys; }, get equity() { return keys ? equity : null; }, get live() { return wsOn; }, get status() { return status; } };
})();
