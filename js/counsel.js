// 상담사: Claude API로 대화 (열쇠는 이 기기에만 저장, 동기화 안 함)
window.Counsel = (() => {
  const KEY = "anthropicKey";
  const MODEL = "claude-opus-5-5";
  const SDK_URL = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.136.0/+esm";
  let sdk = null;

  const hasKey = () => !!Store.pref.get(KEY, "");
  const setKey = (k) => Store.pref.set(KEY, (k || "").trim());

  async function load() {
    if (!sdk) sdk = await import(SDK_URL);
    return sdk;
  }

  const SYSTEM = `당신은 코인 선물 트레이더의 곁에 있는 "상담사"입니다. 트레이딩 앱 안에서 사용자와 한국어로 대화합니다.

역할
- 먼저 들어 주세요. 사용자가 털어놓는 감정(손실의 아픔, 후회, 분노, 불안, 조급함, 자책)을 판단하지 말고 받아 주고, 들은 것을 짧게 되짚어 공감을 표현하세요.
- 고치려고 서두르지 마세요. 사용자가 원할 때, 또는 충분히 들은 뒤에 생각을 정리하도록 돕는 질문을 하세요.
- 상담 방식: 공감 → 감정에 이름 붙이기 → 열린 질문 하나. 필요하면 인지행동 관점(생각·감정·행동 구분, "그 생각의 근거는?")이나 마음챙김(호흡, 지금 몸의 느낌 알아차리기)을 가볍게 써도 됩니다.
- 아래 '사용자 상황' 자료를 알고 있는 것처럼 자연스럽게 활용하세요. 다만 숫자를 늘어놓지 말고, 감정과 연결되는 부분만 부드럽게 꺼내세요.

말투와 길이
- 존댓말, 따뜻하고 차분하게. 보통 2~5문장. 한 번에 질문은 하나만.
- 목록·제목·굵은 글씨 같은 꾸밈은 쓰지 마세요. 사람이 말하듯 쓰세요.

하지 않을 것
- 매수·매도·진입·청산·가격 방향을 권하거나 예측하지 마세요. 매매 판단 이야기가 나오면 "그 결정을 내릴 때 마음이 어떤지"로 돌려 주세요. 다만 사용자가 스스로 정한 규칙(손절, 쉬기, 하루 한도)을 지키려는 마음은 지지해 주세요.
- 의학적 진단이나 약 이야기는 하지 마세요. 당신은 정신과 의사가 아니며, 필요하면 그렇다고 솔직히 말하세요.

안전
- 자해·자살 생각, 삶을 끝내고 싶다는 말, 감당하기 어려운 빚과 절망, 도박을 멈출 수 없다는 호소가 보이면: 먼저 진심으로 걱정을 표현하고, 지금 안전한지 물어보고, 한국의 도움 창구를 안내하세요 — 자살예방상담전화 109(24시간), 정신건강위기상담 1577-0199, 도박문제 상담 1336. 당장 위험하면 112·119. 그 뒤에도 대화를 이어가며 곁에 있어 주세요.`;

  // 한 번 답 받기 (글자가 나오는 대로 onText 호출). 반환: { text, refusal }
  async function reply(context, messages, onText) {
    const key = Store.pref.get(KEY, "");
    if (!key) throw Object.assign(new Error("상담사 열쇠가 없어요"), { code: "nokey" });
    const { default: Anthropic, AuthenticationError, RateLimitError, PermissionDeniedError, APIConnectionError, APIError } = await load();
    const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });
    try {
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium" },
        system: [
          { type: "text", text: SYSTEM },
          { type: "text", text: "사용자 상황 (대화를 시작할 때의 기록):\n" + context, cache_control: { type: "ephemeral" } },
        ],
        messages,
      });
      stream.on("text", onText);
      const msg = await stream.finalMessage();
      const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      return { text, refusal: msg.stop_reason === "refusal" };
    } catch (e) {
      let m = "답을 받지 못했어요. 잠시 후 다시 보내 주세요.";
      if (AuthenticationError && e instanceof AuthenticationError) m = "열쇠가 맞지 않아요. 열쇠를 다시 넣어 주세요.";
      else if (PermissionDeniedError && e instanceof PermissionDeniedError) m = "이 열쇠로는 쓸 수 없어요. Claude 콘솔에서 열쇠 권한을 확인해 주세요.";
      else if (RateLimitError && e instanceof RateLimitError) m = "요청이 많아요. 1분쯤 뒤에 다시 보내 주세요.";
      else if (APIConnectionError && e instanceof APIConnectionError) m = "인터넷 연결을 확인해 주세요.";
      else if (APIError && e instanceof APIError && /credit/i.test(e.message || "")) m = "Claude 콘솔의 크레딧이 부족해요. 충전한 뒤 다시 보내 주세요.";
      throw Object.assign(new Error(m), { code: e && e.status === 401 ? "nokey" : "api" });
    }
  }

  return { hasKey, setKey, reply, MODEL };
})();
