// 분석 자료 만들기: 차트 상태 + 내가 그린 선 → Claude에 붙여 넣을 글과 차트 그림 (무료 방식)
const Analysis = (() => {
  const f = (p) => Chart.fmtP(p);
  const pct = (a, b) => ((a / b - 1) * 100).toFixed(2) + "%";
  const dt = (t) => new Date(t).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

  function tfState(bars, name) {
    const n = bars.length - 1, b = bars[n];
    const ichi = Ind.ichimoku(bars), bb = Ind.bollinger(bars), r = Ind.rsi(bars), vma = Ind.sma(bars.map((x) => x.v), 20);
    const sh = ichi.shift - 1;
    const ca = ichi.spanA[n - sh], cb = ichi.spanB[n - sh];
    const top = Math.max(ca, cb), bot = Math.min(ca, cb);
    const pos = b.c > top ? "구름 위" : b.c < bot ? "구름 아래" : "구름 안";
    const fa = ichi.spanA[n], fb = ichi.spanB[n];
    const w = (bb.up[n] - bb.lo[n]) / bb.mid[n] * 100;
    const ws = []; for (let i = n - 119; i <= n; i++) if (bb.mid[i]) ws.push((bb.up[i] - bb.lo[i]) / bb.mid[i] * 100);
    const rank = ws.filter((x) => x <= w).length / ws.length;
    const bbPos = (b.c - bb.lo[n]) / (bb.up[n] - bb.lo[n]);
    const lines = [
      `[${name}] 현재 ${f(b.c)} (마지막 봉은 ${dt(b.t)}에 시작해 아직 진행 중)`,
      `- 일목: ${pos} (구름 ${f(bot)}~${f(top)}, ${ca >= cb ? "양운" : "음운"}), 26봉 앞 구름 ${fa >= fb ? "양운" : "음운"}, 전환선 ${f(ichi.tenkan[n])}, 기준선 ${f(ichi.kijun[n])} (기준선 대비 ${pct(b.c, ichi.kijun[n])})`,
      `- 볼밴: 상단 ${f(bb.up[n])} / 중심 ${f(bb.mid[n])} / 하단 ${f(bb.lo[n])}, 밴드 안 위치 ${(bbPos * 100).toFixed(0)}%, 폭 ${w.toFixed(1)}% (최근 120봉 중 하위 ${(rank * 100).toFixed(0)}%)`,
      `- RSI ${r[n].toFixed(1)} (5봉 전 ${r[n - 5].toFixed(1)}, 20봉 최저 ${Math.min(...r.slice(n - 19)).toFixed(1)} / 최고 ${Math.max(...r.slice(n - 19)).toFixed(1)})`,
      `- 거래량: 20봉 평균의 ${(b.v / vma[n] * 100).toFixed(0)}%`,
      `- 최근 8봉 (시가/고가/저가/종가): ` + bars.slice(-8).map((x) => `${f(x.o)}/${f(x.h)}/${f(x.l)}/${f(x.c)}`).join(" · "),
    ];
    return lines.join("\n");
  }

  function drawingText(drawings, price) {
    if (!drawings.length) return "내가 그린 선: 없음";
    const out = ["내가 그린 선 (현재 봉 기준 값):"];
    drawings.forEach((d, i) => {
      const v = Chart.valueNow(d);
      if (!v) return;
      const pt = (q) => `${dt(q.t)} ${f(q.p)}`;
      if (v.kind === "수평선") out.push(`${i + 1}. 수평선 ${f(v.price)} (현재가 대비 ${pct(v.price, price)})`);
      if (v.kind === "추세선") out.push(`${i + 1}. 추세선 ${pt(v.from)} → ${pt(v.to)}, 지금 위치 ${f(v.now)} (현재가 대비 ${pct(v.now, price)})`);
      if (v.kind === "평행채널") {
        const hi = Math.max(v.line1, v.line2), lo = Math.min(v.line1, v.line2);
        out.push(`${i + 1}. 평행채널 기준선 ${pt(v.from)} → ${pt(v.to)}, 지금 상단 ${f(hi)} / 중앙 ${f(v.mid)} / 하단 ${f(lo)}, 채널 안 위치 ${(((price - lo) / (hi - lo)) * 100).toFixed(0)}%`);
      }
      if (v.kind === "피보나치") out.push(`${i + 1}. 피보나치 ${pt(v.from)} → ${pt(v.to)}: ` + v.levels.map(([r, p]) => `${r}=${f(p)}`).join(", "));
    });
    return out.join("\n");
  }

  async function build(coin, tf, drawings, price) {
    const order = ["15m", "1h", "4h", "1d", "1w"];
    const parts = [];
    for (const k of order) {
      try {
        const bars = k === tf ? Chart.bars : await Market.klines(coin, k, 300);
        if (bars.length > 130) parts.push(tfState(bars, Market.TF[k].name));
      } catch {}
    }
    const text = [
      `${coin}USDT (바이비트 선물) 차트를 읽어 주세요. 지금 보고 있는 시간봉: ${Market.TF[tf].name}. 현재가 ${f(price)}. 기준 시각 ${new Date().toLocaleString("ko-KR")}.`,
      "",
      "제 방식: 4시간봉 이상 스윙, 큰 추세 매매. 일목균형표·볼린저밴드·RSI·거래량을 보고, 로그 차트에 직접 그은 평행채널·피보나치로 추세를 보고, 변곡 자리의 캔들패턴(필요하면 역추세)도 봅니다. 파동(임펄스·ABC), 삼각수렴, 쌍봉, 다이버전스도 봅니다.",
      "부탁: 매수/매도 지시 말고, 차트에서 보이는 것을 읽어 주세요. 특히 제가 그린 선이 지금 가격과 어떤 관계인지, 시간봉끼리 맞는 점과 엇갈리는 점, 제가 놓치기 쉬운 것을 짚어 주세요. 첨부한 차트 그림도 같이 봐 주세요.",
      "",
      drawingText(drawings, price),
      "",
      ...parts.map((p) => p + "\n"),
    ].join("\n");
    return text;
  }

  async function copyImage(canvas) {
    const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      return "copied";
    } catch {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "chart-" + Date.now() + ".png";
      a.click();
      return "saved";
    }
  }
  return { build, copyImage };
})();
