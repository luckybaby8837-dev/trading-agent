// 업비트 자동 가져오기 (집 PC 전용)
// 업비트 열쇠는 등록한 IP에서만 쓸 수 있어서, PC 서버(server.py)가 서명해서 대신 요청함.
// PC 앱이 가져온 기록은 동기화로 폰에도 감.
// - 체결된 주문 → 매도마다 종료 기록(평균 매수가 기준 손익), 지금 보유 코인 → 진행 중 기록
// - 원화 입금·출금 → 회계팀 출금·입금 내역
// - 원화 잔고 + 코인 수량 → 홈 현재 자산 (기록 'upbit_snapshot')
const Upbit = (() => {
  const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const DAYS = 365, WIN = 7 * 864e5;
  const FROM = "2026-10-14"; // 이 날짜 이전 업비트 매매·입출금은 앱에 넣지 않음 (사용자 요청). 평균 매수가 계산엔 그대로 씀
  let server = false, configured = false, busy = false, timer = 0;
  let status = { msg: "", err: "", at: 0 };
  let onStatus = () => {}, onData = () => {};
  const set = (o) => { status = Object.assign(status, o); onStatus(status, { local: LOCAL, server, configured }); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const USER_FIELDS = ["tf", "basis", "why", "mood", "moodText", "img", "imgRes", "lesson", "hit", "closeMood", "sl", "tp", "notes"];

  const ERR = {
    no_authorization_ip: "등록한 IP가 아니에요. PC 인터넷 주소가 바뀌었을 수 있어요 (업비트 Open API 관리에서 IP를 다시 넣어 주세요)",
    invalid_access_key: "Access Key가 맞지 않아요",
    jwt_verification: "Secret Key가 맞지 않아요",
    out_of_scope: "열쇠에 조회 권한이 없어요 (자산·주문·입금·출금 조회를 체크해 주세요)",
    expired_access_key: "열쇠가 만료됐어요. 새로 만들어 주세요",
    no_keys: "업비트 열쇠가 없어요",
  };
  const errMsg = (j, code) => { const e = j && j.error; return (e && (ERR[e.name] || e.message)) || `업비트 오류 (${code})`; };
  async function api(path, params = {}) {
    const qs = new URLSearchParams(params).toString();
    let r;
    try { r = await fetch(`/upbit/api/${path}${qs ? "?" + qs : ""}`); } catch { throw new Error("PC 서버에 연결하지 못했어요 (앱실행.bat로 켜 주세요)"); }
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(errMsg(j, r.status));
    await sleep(120);
    return j;
  }
  async function check() {
    if (!LOCAL) return set({});
    try { const r = await fetch("/upbit/status"); const j = await r.json(); server = !!j.server; configured = !!j.configured; }
    catch { server = false; configured = false; }
    set({});
  }

  const kst = (iso) => { const d = new Date(iso); const l = new Date(d - d.getTimezoneOffset() * 60e3).toISOString(); return [l.slice(0, 10), l.slice(11, 16)]; };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  async function save(store, rec, old) { if (old && same(Object.assign({}, old, rec), old)) return false; await Store.put(store, Object.assign(old || {}, rec)); return true; }

  // 체결된 주문 (최근 1년, 7일씩)
  async function doneOrders() {
    const out = [], now = Date.now(), from = now - DAYS * 864e5;
    for (let end = now; end > from; end -= WIN) {
      const start = Math.max(from, end - WIN);
      const list = await api("orders/closed", { state: "done", start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString(), limit: 1000, order_by: "asc" });
      out.push(...list.filter((o) => String(o.market).startsWith("KRW-")));
    }
    const m = new Map(out.map((o) => [o.uuid, o]));
    return [...m.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  async function fundsOf(o) {
    const v = +o.executed_volume;
    if (+o.executed_funds) return +o.executed_funds;
    if (o.ord_type === "limit") return +o.price * v;
    if (o.ord_type === "price") return +o.price;
    try { const d = await api("order", { uuid: o.uuid }); return (d.trades || []).reduce((s, t) => s + +t.funds, 0); } catch { return null; }
  }
  async function cashList(kind) {
    const out = [];
    for (let page = 1; page <= 5; page++) {
      const list = await api(kind, { currency: "KRW", state: kind === "deposits" ? "ACCEPTED" : "DONE", limit: 100, page, order_by: "desc" });
      out.push(...list);
      if (list.length < 100) break;
    }
    return out;
  }

  async function sync() {
    if (!LOCAL || !configured || busy) return 0;
    busy = true; set({ msg: "업비트 기록 읽는 중…", err: "" });
    let n = 0;
    try {
      const accounts = await api("accounts");
      const orders = await doneOrders();
      const all = await Store.all("trades"), byId = new Map(all.map((t) => [t.id, t]));
      const acc = {}; let krw = 0;
      for (const a of accounts) {
        if (a.currency === "KRW") { krw = +a.balance + +a.locked; continue; }
        acc[a.currency] = { qty: +a.balance + +a.locked, avg: +a.avg_buy_price };
      }
      // 평균 매수가로 매도 손익 계산 (기록 이전에 산 코인은 지금 업비트 평균 매수가로 대신함)
      const pos = {};
      for (const o of orders) {
        const coin = o.market.slice(4), vol = +o.executed_volume, fee = +o.paid_fee || 0;
        if (!(vol > 0)) continue;
        const funds = await fundsOf(o); if (funds == null) continue;
        const p = (pos[coin] = pos[coin] || { qty: 0, cost: 0 });
        if (o.side === "bid") { p.qty += vol; p.cost += funds + fee; continue; }
        let avg, approx = false;
        if (p.qty >= vol * 0.999 && p.qty > 0) avg = p.cost / p.qty;
        else { avg = (acc[coin] && acc[coin].avg) || (p.qty > 0 ? p.cost / p.qty : 0); approx = true; }
        const used = Math.min(p.qty, vol);
        p.cost -= p.qty > 0 ? (p.cost / p.qty) * used : 0; p.qty -= used;
        if (!avg) continue;
        if (kst(o.created_at)[0] < FROM) continue;
        const [d, tm] = kst(o.created_at), id = "ub_" + o.uuid, old = byId.get(id), posRec = byId.get("ubpos_" + coin);
        const rec = { id, src: "upbit", venue: "upbit", coin, side: "buy", status: "closed", en: Math.round(avg * 100) / 100, exit: Math.round(funds / vol * 100) / 100, qty: vol,
          pnl: Math.round(funds - fee - avg * vol), fee: Math.round(fee), closeDate: d, approx };
        if (!old) {
          Object.assign(rec, { date: d, time: tm, basis: [], mood: [], why: "", hit: "" });
          if (posRec) { for (const f of USER_FIELDS) if (posRec[f] != null && posRec[f] !== "") rec[f] = posRec[f]; rec.date = posRec.date; rec.time = posRec.time; }
        }
        if (await save("trades", rec, old)) n++;
      }
      // 지금 보유 코인 → 진행 중
      const live = new Set();
      for (const [coin, a] of Object.entries(acc)) {
        if (!(a.qty > 0 && a.avg > 0) || a.qty * a.avg < 5000) continue;
        const id = "ubpos_" + coin; live.add(id);
        const old = byId.get(id), [d, tm] = kst(new Date().toISOString());
        const rec = { id, src: "upbit", venue: "upbit", coin, side: "buy", status: "open", en: a.avg, qty: a.qty };
        if (!old) Object.assign(rec, { date: d, time: tm, basis: [], mood: [], why: "" });
        if (await save("trades", rec, old)) n++;
      }
      for (const t of all) if (t.id.startsWith("ubpos_") && !live.has(t.id)) { await Store.del("trades", t.id); n++; }
      // 원화 입금·출금
      const cash = new Map((await Store.all("cash")).map((c) => [c.id, c]));
      for (const [kind, list] of [["in", await cashList("deposits")], ["out", await cashList("withdraws")]]) {
        for (const x of list) {
          const id = `ub_${kind === "in" ? "d" : "w"}_${x.uuid}`, [d] = kst(x.done_at || x.created_at);
          if (d < FROM) continue;
          const rec = { id, src: "upbit", kind, venue: "upbit", amount: +x.amount, cur: "KRW", rate: 0, type: kind === "out" ? "auto" : "", date: d, memo: "업비트 자동" };
          const old = cash.get(id);
          if (!old) { await Store.put("cash", rec); n++; } else if (!same(Object.assign({}, old, rec), old)) { await Store.put("cash", Object.assign(old, rec)); n++; }
        }
      }
      // 기준일 이전 업비트 자동 기록은 지움 (동기화로 폰에서도 지워짐)
      for (const t of all) if (t.src === "upbit" && t.status === "closed" && (t.closeDate || t.date || "") < FROM) { await Store.del("trades", t.id); n++; }
      for (const c of await Store.all("cash")) if (c.src === "upbit" && (c.date || "") < FROM) { await Store.del("cash", c.id); n++; }
      // 홈 자산용 잔고 (폰에서도 보이게 기록으로 남김)
      const snap = { id: "upbit_snapshot", krw: Math.round(krw), coins: Object.fromEntries(Object.entries(acc).filter(([, a]) => a.qty > 0).map(([c, a]) => [c, { qty: a.qty, avg: a.avg }])), at: Date.now() };
      const oldSnap = await Store.get("legacy", "upbit_snapshot");
      if (!oldSnap || !same({ ...oldSnap, at: 0, u: 0 }, { ...snap, at: 0, u: 0 }) || Date.now() - (oldSnap.at || 0) > 30 * 60e3) { await Store.put("legacy", snap); n++; }
      set({ msg: "", err: "", at: Date.now() });
      if (n) onData();
      return n;
    } catch (e) { set({ err: e.message, msg: "" }); throw e; }
    finally { busy = false; }
  }

  async function connect(access, secret) {
    const r = await fetch("/upbit/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ access, secret }) }).catch(() => null);
    if (!r) throw new Error("PC 서버에 연결하지 못했어요 (앱실행.bat로 켜 주세요)");
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(errMsg(j, r.status));
    configured = true; set({});
    start();
    return sync();
  }
  async function disconnect() { await fetch("/upbit/keys", { method: "DELETE" }).catch(() => {}); configured = false; clearInterval(timer); set({ msg: "", err: "" }); }
  function start() { clearInterval(timer); timer = setInterval(() => sync().catch(() => {}), 5 * 60e3); }

  async function init(statusCb, dataCb) {
    onStatus = statusCb; onData = dataCb;
    await check();
    if (LOCAL && configured) { start(); sync().catch(() => {}); }
  }
  return { init, connect, disconnect, sync, get local() { return LOCAL; }, get server() { return server; }, get configured() { return configured; }, get status() { return status; } };
})();
