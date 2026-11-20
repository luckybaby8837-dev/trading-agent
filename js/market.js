// 시세: 바이비트(선물) 캔들·실시간, 업비트(현물) 원화 가격, 달러 환율 — 모두 무료 공개 데이터
const Market = (() => {
  const BYBIT = "https://api.bybit.com";
  const TF = {
    "15m": { iv: "15", ms: 15 * 60e3, name: "15분" },
    "1h": { iv: "60", ms: 60 * 60e3, name: "1시간" },
    "4h": { iv: "240", ms: 240 * 60e3, name: "4시간" },
    "1d": { iv: "D", ms: 1440 * 60e3, name: "일봉" },
    "1w": { iv: "W", ms: 7 * 1440 * 60e3, name: "주봉" },
  };
  const COINS = ["BTC", "ETH"];

  // before: 이 시각 이전 캔들만 (예전 차트 더 불러올 때)
  async function klines(coin, tf, count = 1000, before) {
    const iv = TF[tf].iv, out = new Map();
    let end = before || Date.now();
    while (out.size < count) {
      const need = Math.min(1000, count - out.size);
      const r = await fetch(`${BYBIT}/v5/market/kline?category=linear&symbol=${coin}USDT&interval=${iv}&limit=${need}&end=${end}`);
      const j = await r.json();
      const rows = (j.result && j.result.list) || [];
      if (!rows.length) break;
      for (const k of rows) out.set(+k[0], { t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] });
      end = +rows[rows.length - 1][0] - 1;
      if (rows.length < need) break;
    }
    return [...out.values()].sort((a, b) => a.t - b.t);
  }

  // 바이비트 실시간 (캔들 + 시세)
  let ws = null, wsSubs = new Set(), handlers = { kline: [], ticker: [] }, ping = null, retry = 0;
  function connect() {
    ws = new WebSocket("wss://stream.bybit.com/v5/public/linear");
    ws.onopen = () => {
      retry = 0;
      if (wsSubs.size) ws.send(JSON.stringify({ op: "subscribe", args: [...wsSubs] }));
      clearInterval(ping);
      ping = setInterval(() => ws.readyState === 1 && ws.send('{"op":"ping"}'), 20000);
    };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (!m.topic) return;
      if (m.topic.startsWith("kline.")) {
        const [, iv, sym] = m.topic.split(".");
        for (const k of m.data) handlers.kline.forEach((f) => f(sym.replace("USDT", ""), iv,
          { t: +k.start, o: +k.open, h: +k.high, l: +k.low, c: +k.close, v: +k.volume }, k.confirm));
      } else if (m.topic.startsWith("tickers.")) {
        const sym = m.topic.split(".")[1].replace("USDT", "");
        handlers.ticker.forEach((f) => f(sym, m.data));
      }
    };
    ws.onclose = () => { clearInterval(ping); setTimeout(connect, Math.min(15000, 1000 * 2 ** retry++)); };
  }
  function sub(topics) {
    const add = topics.filter((t) => !wsSubs.has(t));
    add.forEach((t) => wsSubs.add(t));
    if (!ws) connect();
    else if (ws.readyState === 1 && add.length) ws.send(JSON.stringify({ op: "subscribe", args: add }));
  }
  function unsub(topics) {
    const rm = topics.filter((t) => wsSubs.has(t));
    rm.forEach((t) => wsSubs.delete(t));
    if (ws && ws.readyState === 1 && rm.length) ws.send(JSON.stringify({ op: "unsubscribe", args: rm }));
  }
  const on = (kind, f) => handlers[kind].push(f);

  // 업비트 원화 시세 (현물)
  async function upbit() {
    const r = await fetch("https://api.upbit.com/v1/ticker?markets=" + COINS.map((c) => "KRW-" + c).concat("KRW-USDT").join(","));
    const j = await r.json(), o = {};
    for (const x of j) o[x.market.replace("KRW-", "")] = { price: x.trade_price, chg: x.signed_change_rate * 100 };
    return o;
  }
  // 달러 환율 (하루 단위 갱신되는 무료 환율)
  async function usdkrw() {
    try {
      const r = await fetch("https://open.er-api.com/v6/latest/USD");
      const j = await r.json();
      if (j && j.rates && j.rates.KRW) return { rate: j.rates.KRW, at: j.time_last_update_unix * 1000 };
    } catch {}
    return null;
  }
  // 롱:숏 계정 비율 (바이비트 공개 데이터, 1시간 단위)
  async function longShort(coin) {
    try {
      const r = await fetch(`${BYBIT}/v5/market/account-ratio?category=linear&symbol=${coin}USDT&period=1h&limit=1`);
      const x = ((await r.json()).result || {}).list || [];
      if (x[0]) return { buy: +x[0].buyRatio, sell: +x[0].sellRatio, at: +x[0].timestamp };
    } catch {}
    return null;
  }
  return { TF, COINS, klines, sub, unsub, on, upbit, usdkrw, longShort };
})();
