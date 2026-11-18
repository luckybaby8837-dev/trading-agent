// 폰·PC 동기화: 구글 로그인 + Firebase(Firestore) 무료 저장소.
// 기록 하나 = 문서 하나 (users/{내 uid}/{종류}/{id}). 더 늦게 고친 쪽(u)이 이김. 지운 건 "지움 표시"로 남겨 다른 기기에서도 지움.
const Sync = (() => {
  // Firebase 프로젝트 연결 정보 (공개돼도 되는 값. 보안은 Firestore 규칙 + 승인된 도메인이 지킴)
  const CFG = {
    apiKey: "AIzaSyDNoXwDFgkgqqTr-7kJtfw9WhnKQ0le1qM",
    authDomain: "trading-agent-126bb.firebaseapp.com",
    projectId: "trading-agent-126bb",
    storageBucket: "trading-agent-126bb.firebasestorage.app",
    messagingSenderId: "168007604145",
    appId: "1:168007604145:web:16db967e432f4de91bcf90",
  };

  const MAX = 900000; // 문서 한 개 최대 약 1MB → 여유를 둠
  let auth = null, fs = null, user = null, unsubs = [], ready = false;
  let refreshFn = () => {}, statusFn = () => {};
  let state = { on: false, msg: "", err: "" };
  const setState = (o) => { state = Object.assign(state, o); statusFn(state, user); };

  const pend = { // 로그인 전에 지운 것 (로그인하면 지움 표시를 올림)
    get: () => Store.pref.get("syncDel", []),
    add: (store, id) => { const l = pend.get(); l.push({ store, id, u: Date.now() }); Store.pref.set("syncDel", l.slice(-2000)); },
    clear: () => Store.pref.set("syncDel", []),
  };
  const docId = (id) => String(id).replace(/\//g, "_");
  const col = (store) => fs.collection("users").doc(user.uid).collection(store);

  let rT = 0;
  const refresh = () => { clearTimeout(rT); rT = setTimeout(() => refreshFn(), 250); };

  // 사진이 커서 1MB를 넘으면 사진만 더 줄여서 올림
  function shrinkData(url, max, q) {
    return new Promise((r) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        r(c.toDataURL("image/jpeg", q));
      };
      img.onerror = () => r(url);
      img.src = url;
    });
  }
  async function fit(obj) {
    let s = JSON.stringify(obj);
    for (const [max, q] of [[1100, 0.7], [800, 0.6], [560, 0.5]]) {
      if (s.length < MAX) break;
      const o = JSON.parse(s);
      const walk = async (v) => {
        if (!v || typeof v !== "object") return;
        for (const k of Object.keys(v)) {
          if (typeof v[k] === "string" && v[k].startsWith("data:image") && v[k].length > 60000) v[k] = await shrinkData(v[k], max, q);
          else await walk(v[k]);
        }
      };
      await walk(o);
      s = JSON.stringify(o);
    }
    return s;
  }

  async function upload(store, obj) {
    if (!user) return;
    try {
      const d = await fit(obj);
      if (d.length >= MAX * 1.1) { setState({ err: "사진이 너무 커서 기록 하나를 올리지 못했어요" }); return; }
      await col(store).doc(docId(obj.id)).set({ id: obj.id, u: obj.u || 0, d });
    } catch (e) { setState({ err: "올리기 실패: " + (e.code || e.message) }); }
  }
  async function tomb(store, id, u) {
    if (!user) return;
    try { await col(store).doc(docId(id)).set({ id, u: u || Date.now(), deleted: true }); }
    catch (e) { setState({ err: "지우기 반영 실패: " + (e.code || e.message) }); }
  }

  // 클라우드 → 이 기기
  async function apply(store, data) {
    const local = await Store.get(store, data.id);
    const lu = (local && local.u) || 0;
    if (data.deleted) {
      if (local && lu <= data.u) { await Store.rawDel(store, data.id); return true; }
      return false;
    }
    if (local && lu >= (data.u || 0)) return false;
    let obj; try { obj = JSON.parse(data.d); } catch { return false; }
    obj.u = data.u || obj.u || 0;
    await Store.rawPut(store, obj);
    return true;
  }

  function watch() {
    stopWatch();
    let first = 0;
    for (const store of Store.STORES) {
      let reconciled = false;
      const un = col(store).onSnapshot({ includeMetadataChanges: true }, async (snap) => {
        let changed = false;
        for (const ch of snap.docChanges()) {
          if (ch.type === "removed") continue;
          if (await apply(store, ch.doc.data())) changed = true;
        }
        if (changed) refresh();
        // 서버 내용을 처음 받으면: 이 기기에만 있는 것·더 최근 것 올리기
        if (!reconciled && !snap.metadata.fromCache) {
          reconciled = true;
          const cloud = new Map(snap.docs.map((d) => [d.data().id, d.data()]));
          for (const o of await Store.all(store)) {
            const c = cloud.get(o.id);
            if (!c || (o.u || 0) > (c.u || 0)) await upload(store, o);
          }
          if (++first === Store.STORES.length) setState({ msg: "동기화됨 · " + new Date().toTimeString().slice(0, 5) });
        }
      }, (e) => setState({ err: "동기화 연결 오류: " + (e.code || e.message) }));
      unsubs.push(un);
    }
  }
  function stopWatch() { unsubs.forEach((u) => u()); unsubs = []; }

  // 이 기기에서 바뀐 것 → 클라우드
  Store.onChange((store, op, v) => {
    if (op === "put") { if (user) upload(store, v); }
    else if (user) tomb(store, v); else pend.add(store, v);
  });

  function init(onRefresh, onStatus) {
    refreshFn = onRefresh; statusFn = onStatus;
    if (!CFG) { setState({ msg: "아직 연결 정보가 없어요 (설정 중)" }); return; }
    if (typeof firebase === "undefined") { setState({ msg: "인터넷이 연결되면 동기화돼요" }); return; }
    firebase.initializeApp(CFG);
    auth = firebase.auth(); fs = firebase.firestore();
    try { fs.enablePersistence({ synchronizeTabs: true }).catch(() => {}); } catch {}
    ready = true;
    auth.getRedirectResult().catch((e) => setState({ err: "로그인 실패: " + (e.code || e.message) }));
    auth.onAuthStateChanged(async (u) => {
      user = u;
      if (!u) { stopWatch(); setState({ on: false, msg: "로그인하면 폰·PC 기록이 자동으로 맞춰져요", err: "" }); return; }
      setState({ on: true, msg: "맞추는 중…", err: "" });
      for (const p of pend.get()) await tomb(p.store, p.id, p.u);
      pend.clear();
      watch();
    });
  }
  async function login() {
    if (!ready) return;
    const pv = new firebase.auth.GoogleAuthProvider();
    pv.setCustomParameters({ prompt: "select_account" });
    try { await auth.signInWithPopup(pv); }
    catch (e) {
      if (/popup-blocked|operation-not-supported|web-storage/.test(e.code || "")) return auth.signInWithRedirect(pv);
      if (!/popup-closed|cancelled-popup/.test(e.code || "")) setState({ err: "로그인 실패: " + (e.code || e.message) });
    }
  }
  const logout = () => auth && auth.signOut();
  return { init, login, logout, get state() { return state; }, get user() { return user; } };
})();
