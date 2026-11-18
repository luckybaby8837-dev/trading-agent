// 스크린샷 그리기 편집기
// - 원본 사진(base)은 그대로 두고, 그린 것(marks)은 따로 저장 → 저장한 뒤에도 다시 열어 고칠 수 있음
// - 좌표는 사진 크기 기준 0~1 비율로 저장 (어느 화면에서 열어도 같은 자리)
// - 도구: 펜 · 형광펜 · 화살표 · 네모(영역) · 수평선(가격 자리) · 글씨 · 옮기기 · 지우개
const Markup = (() => {
  const COLORS = ["#e0424a", "#0f9f5a", "#3d63e8", "#f5b700", "#ffffff", "#14171f"];
  const SIZES = [["가늘게", 0.004], ["보통", 0.007], ["굵게", 0.012]];
  const TOOLS = [
    ["pen", "펜", '<path d="M4 20l4-1 11-11-3-3L5 16z"/>'],
    ["hl", "형광펜", '<path d="M5 19h6M7 15l8-8 3 3-8 8H7z"/>'],
    ["arrow", "화살표", '<path d="M5 19L19 5M10 5h9v9"/>'],
    ["rect", "네모", '<rect x="4" y="6" width="16" height="12" rx="1"/>'],
    ["hline", "수평선", '<path d="M3 12h18M3 8h2M3 16h2"/>'],
    ["text", "글씨", '<path d="M5 6h14M12 6v13"/>'],
    ["move", "옮기기", '<path d="M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4"/>'],
    ["erase", "지우개", '<path d="M7 20h10M5 15l8-8 5 5-6 6H8z"/>'],
  ];
  let root, cv, ctx, img, marks = [], hist = [], fut = [], tool = "pen", color = COLORS[0], size = SIZES[1][1];
  let drawing = null, moving = null, resolveFn = null, dirty = false, box = null;

  const el = (h) => { const d = document.createElement("div"); d.innerHTML = h.trim(); return d.firstChild; };
  function build() {
    root = el(`<div class="mk" hidden>
      <div class="mkTop"><button class="ghost" data-a="close">닫기</button>
        <div class="mkUndo"><button class="ghost" data-a="undo" aria-label="되돌리기"><svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg></button><button class="ghost" data-a="redo" aria-label="다시하기"><svg viewBox="0 0 24 24"><path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/></svg></button></div>
        <button class="primary" data-a="save">저장</button></div>
      <div class="mkStage"><canvas></canvas></div>
      <div class="mkBar">
        <div class="mkTools"></div>
        <div class="mkOpt"><div class="mkColors"></div><div class="mkSizes"></div><button class="ghost sm danger" data-a="clear">모두 지우기</button></div>
      </div></div>`);
    document.body.appendChild(root);
    cv = root.querySelector("canvas"); ctx = cv.getContext("2d");
    root.querySelector(".mkTools").innerHTML = TOOLS.map(([k, n, p]) => `<button data-t="${k}"><svg viewBox="0 0 24 24">${p}</svg><span>${n}</span></button>`).join("");
    root.querySelector(".mkColors").innerHTML = COLORS.map((c) => `<button data-c="${c}" style="background:${c}" aria-label="색"></button>`).join("");
    root.querySelector(".mkSizes").innerHTML = SIZES.map(([n, v]) => `<button data-s="${v}">${n}</button>`).join("");
    root.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.t) { tool = b.dataset.t; closeBox(); ui(); }
      if (b.dataset.c) { color = b.dataset.c; ui(); }
      if (b.dataset.s) { size = +b.dataset.s; ui(); }
      const a = b.dataset.a;
      if (a === "undo" && hist.length) { fut.push(JSON.stringify(marks)); marks = JSON.parse(hist.pop()); dirty = true; draw(); }
      if (a === "redo" && fut.length) { hist.push(JSON.stringify(marks)); marks = JSON.parse(fut.pop()); dirty = true; draw(); }
      if (a === "clear" && marks.length) { if (b.dataset.s !== "1") { b.dataset.s = "1"; b.textContent = "한 번 더 누르면 모두 지움"; return; } snap(); marks = []; draw(); b.dataset.s = ""; b.textContent = "모두 지우기"; }
      if (a === "save") finish(true);
      if (a === "close") { if (dirty && b.dataset.s !== "1") { b.dataset.s = "1"; b.textContent = "저장 안 하고 닫기"; return; } finish(false); }
    });
    cv.addEventListener("pointerdown", down);
    cv.addEventListener("pointermove", move);
    addEventListener("pointerup", up);
    addEventListener("resize", () => { if (!root.hidden) fit(); });
  }
  function ui() {
    root.querySelectorAll("[data-t]").forEach((b) => b.classList.toggle("on", b.dataset.t === tool));
    root.querySelectorAll("[data-c]").forEach((b) => b.classList.toggle("on", b.dataset.c === color));
    root.querySelectorAll("[data-s]").forEach((b) => b.classList.toggle("on", +b.dataset.s === size));
    cv.style.cursor = tool === "move" ? "move" : tool === "erase" ? "pointer" : tool === "text" ? "text" : "crosshair";
  }
  const snap = () => { hist.push(JSON.stringify(marks)); if (hist.length > 80) hist.shift(); fut = []; dirty = true; };

  // 화면 크기에 맞춰 사진 표시
  let W = 0, H = 0;
  function fit() {
    const st = root.querySelector(".mkStage"), mw = st.clientWidth - 8, mh = st.clientHeight - 8;
    const k = Math.min(mw / img.width, mh / img.height, 1.5);
    W = Math.max(50, Math.floor(img.width * k)); H = Math.max(50, Math.floor(img.height * k));
    const dpr = devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + "px"; cv.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);
    render(ctx, marks, W, H);
    if (drawing) render(ctx, [drawing], W, H);
  }

  // 그린 것 그리기 (편집기·저장 그림 공용)
  function render(c, list, w, h) {
    for (const m of list) {
      const lw = Math.max(1, m.w * w);
      c.save(); c.strokeStyle = m.c; c.fillStyle = m.c; c.lineWidth = lw; c.lineCap = "round"; c.lineJoin = "round";
      if (m.t === "pen" || m.t === "hl") {
        if (m.t === "hl") { c.globalAlpha = 0.35; c.lineWidth = lw * 3.5; c.lineCap = "square"; }
        c.beginPath(); m.pts.forEach(([x, y], i) => (i ? c.lineTo(x * w, y * h) : c.moveTo(x * w, y * h)));
        if (m.pts.length === 1) c.lineTo(m.pts[0][0] * w + 0.1, m.pts[0][1] * h);
        c.stroke();
      } else if (m.t === "arrow") {
        const [ax, ay] = [m.a[0] * w, m.a[1] * h], [bx, by] = [m.b[0] * w, m.b[1] * h];
        const ang = Math.atan2(by - ay, bx - ax), hd = Math.max(10, lw * 4);
        c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx - Math.cos(ang) * hd * 0.6, by - Math.sin(ang) * hd * 0.6); c.stroke();
        c.beginPath(); c.moveTo(bx, by);
        c.lineTo(bx - hd * Math.cos(ang - 0.45), by - hd * Math.sin(ang - 0.45));
        c.lineTo(bx - hd * Math.cos(ang + 0.45), by - hd * Math.sin(ang + 0.45)); c.closePath(); c.fill();
      } else if (m.t === "rect") {
        const x = Math.min(m.a[0], m.b[0]) * w, y = Math.min(m.a[1], m.b[1]) * h, rw = Math.abs(m.b[0] - m.a[0]) * w, rh = Math.abs(m.b[1] - m.a[1]) * h;
        c.globalAlpha = 0.14; c.fillRect(x, y, rw, rh); c.globalAlpha = 1; c.strokeRect(x, y, rw, rh);
      } else if (m.t === "hline") {
        c.setLineDash([lw * 3, lw * 2]); c.beginPath(); c.moveTo(0, m.y * h); c.lineTo(w, m.y * h); c.stroke();
      } else if (m.t === "text") {
        const fs = Math.max(11, m.s * w);
        c.font = `700 ${fs}px ${getComputedStyle(document.body).fontFamily}`; c.textBaseline = "top";
        const lines = String(m.text).split("\n");
        c.lineWidth = Math.max(2, fs / 5); c.strokeStyle = m.c === "#14171f" || m.c === "#3d63e8" ? "rgba(255,255,255,.85)" : "rgba(0,0,0,.65)";
        lines.forEach((ln, i) => { c.strokeText(ln, m.x * w, m.y * h + i * fs * 1.25); c.fillText(ln, m.x * w, m.y * h + i * fs * 1.25); });
      }
      c.restore();
    }
  }

  // 손가락·마우스 입력
  const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / W, (e.clientY - r.top) / H]; };
  function down(e) {
    if (root.hidden) return;
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    const p = pos(e);
    if (tool === "text") { const m = hit(p, ["text"]); openBox(m, p); return; }
    if (tool === "erase") { const m = hit(p); if (m) { snap(); marks = marks.filter((x) => x !== m); draw(); } drawing = { erasing: true }; return; }
    if (tool === "move") { const m = hit(p); if (m) { snap(); moving = { m, last: p }; } return; }
    const base = { c: color, w: size };
    if (tool === "pen" || tool === "hl") drawing = { t: tool, ...base, pts: [p] };
    else if (tool === "arrow" || tool === "rect") drawing = { t: tool, ...base, a: p, b: p };
    else if (tool === "hline") drawing = { t: "hline", ...base, y: p[1] };
    draw();
  }
  function move(e) {
    if (root.hidden) return;
    const p = pos(e);
    if (moving) { const dx = p[0] - moving.last[0], dy = p[1] - moving.last[1]; shift(moving.m, dx, dy); moving.last = p; draw(); return; }
    if (!drawing) return;
    if (drawing.erasing) { const m = hit(p); if (m) { snap(); marks = marks.filter((x) => x !== m); draw(); } return; }
    if (drawing.pts) drawing.pts.push(p);
    else if (drawing.t === "hline") drawing.y = p[1];
    else drawing.b = p;
    draw();
  }
  function up() {
    if (moving) { moving = null; return; }
    if (!drawing) return;
    if (!drawing.erasing) {
      const d = drawing, tiny = d.a && Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) < 0.01;
      if (!tiny) { snap(); marks.push(roundMark(d)); }
    }
    drawing = null; draw();
  }
  const r4 = (v) => Math.round(v * 10000) / 10000;
  function roundMark(m) {
    const o = { ...m };
    if (o.pts) o.pts = o.pts.filter((p, i) => i % 1 === 0).map(([x, y]) => [r4(x), r4(y)]);
    for (const k of ["a", "b"]) if (o[k]) o[k] = o[k].map(r4);
    if (o.y != null) o.y = r4(o.y);
    return o;
  }
  function shift(m, dx, dy) {
    if (m.pts) m.pts = m.pts.map(([x, y]) => [x + dx, y + dy]);
    if (m.a) { m.a = [m.a[0] + dx, m.a[1] + dy]; m.b = [m.b[0] + dx, m.b[1] + dy]; }
    if (m.t === "hline") m.y += dy;
    if (m.t === "text") { m.x += dx; m.y += dy; }
  }
  // 누른 자리 가까이 있는 그린 것 찾기
  function hit(p, only) {
    const px = p[0] * W, py = p[1] * H, R = 16;
    let best = null, bd = R;
    const seg = (x1, y1, x2, y2) => { const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy; let t = L ? ((px - x1) * dx + (py - y1) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - x1 - t * dx, py - y1 - t * dy); };
    for (let i = marks.length - 1; i >= 0; i--) {
      const m = marks[i]; if (only && !only.includes(m.t)) continue;
      let d = Infinity;
      if (m.pts) for (let j = 0; j < m.pts.length; j++) { const a = m.pts[Math.max(0, j - 1)], b = m.pts[j]; d = Math.min(d, seg(a[0] * W, a[1] * H, b[0] * W, b[1] * H)); }
      else if (m.t === "arrow") d = seg(m.a[0] * W, m.a[1] * H, m.b[0] * W, m.b[1] * H);
      else if (m.t === "rect") { const [x1, y1, x2, y2] = [m.a[0] * W, m.a[1] * H, m.b[0] * W, m.b[1] * H]; d = Math.min(seg(x1, y1, x2, y1), seg(x2, y1, x2, y2), seg(x2, y2, x1, y2), seg(x1, y2, x1, y1)); }
      else if (m.t === "hline") d = Math.abs(py - m.y * H);
      else if (m.t === "text") {
        const fs = Math.max(11, m.s * W), lines = String(m.text).split("\n");
        ctx.font = `700 ${fs}px ${getComputedStyle(document.body).fontFamily}`;
        const tw = Math.max(...lines.map((l) => ctx.measureText(l).width)), th = lines.length * fs * 1.25;
        const x = m.x * W, y = m.y * H;
        if (px >= x - 6 && px <= x + tw + 6 && py >= y - 6 && py <= y + th + 6) d = 0;
      }
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  // 글씨 입력 상자 (새로 쓰기 / 이미 쓴 글씨 고치기)
  function openBox(m, p) {
    closeBox();
    const r = cv.getBoundingClientRect(), sr = root.getBoundingClientRect();
    box = el(`<div class="mkBox"><textarea rows="2" placeholder="글씨를 쓰세요"></textarea><div class="row"><button class="ghost sm danger" data-x="del">${m ? "글씨 지우기" : "취소"}</button><button class="primary sm" data-x="ok">완료</button></div></div>`);
    const at = m ? [m.x, m.y] : p;
    box.style.left = Math.min(sr.width - 250, Math.max(8, r.left - sr.left + at[0] * W)) + "px";
    box.style.top = Math.min(sr.height - 160, Math.max(56, r.top - sr.top + at[1] * H)) + "px";
    root.appendChild(box);
    const ta = box.querySelector("textarea");
    ta.value = m ? m.text : ""; ta.style.color = (m ? m.c : color) === "#ffffff" ? "" : (m ? m.c : color);
    setTimeout(() => ta.focus(), 30); setTimeout(() => ta.focus(), 250);
    box.querySelector('[data-x="ok"]').onclick = () => {
      const v = ta.value.trim();
      snap();
      if (m) { if (v) { m.text = v; m.c = color; } else marks = marks.filter((x) => x !== m); }
      else if (v) marks.push({ t: "text", c: color, s: size * 4.2 + 0.012, x: r4(p[0]), y: r4(p[1]), text: v });
      else hist.pop();
      closeBox(); draw();
    };
    box.querySelector('[data-x="del"]').onclick = () => { if (m) { snap(); marks = marks.filter((x) => x !== m); draw(); } closeBox(); };
  }
  function closeBox() { if (box) { box.remove(); box = null; } }

  // 저장: 원본 크기(최대 1600px)로 합친 그림 + 다시 고칠 수 있는 원본·그린 것
  function finish(save) {
    closeBox();
    let out = null;
    if (save) {
      const k = Math.min(1, 1600 / Math.max(img.width, img.height)), w = Math.round(img.width * k), h = Math.round(img.height * k);
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const x = c.getContext("2d"); x.drawImage(img, 0, 0, w, h); render(x, marks, w, h);
      out = { img: c.toDataURL("image/jpeg", 0.85), edit: marks.length ? { base: img.src, marks } : null };
    }
    root.hidden = true; document.body.classList.remove("mkOpen");
    root.querySelector('[data-a="close"]').textContent = "닫기"; root.querySelector('[data-a="close"]').dataset.s = "";
    const f = resolveFn; resolveFn = null; if (f) f(out);
  }

  // 열기: base = 원본 사진(dataURL), marks = 예전에 그린 것
  function open(base, oldMarks) {
    if (!root) build();
    return new Promise((res) => {
      resolveFn = res;
      img = new Image();
      img.onload = () => {
        marks = JSON.parse(JSON.stringify(oldMarks || [])); hist = []; fut = []; dirty = false; drawing = null; moving = null;
        root.hidden = false; document.body.classList.add("mkOpen"); ui(); fit();
      };
      img.onerror = () => { resolveFn = null; res(null); };
      img.src = base;
    });
  }
  const isOpen = () => root && !root.hidden;
  const cancel = () => { if (isOpen()) finish(false); };
  return { open, isOpen, cancel, render };
})();
