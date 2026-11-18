// 저장소: 기기 안(IndexedDB)에 모든 기록 보관. 바뀐 내용은 동기화 모듈(sync.js)에 알려 줌.
const Store = (() => {
  const DBN = "trade-agent", VER = 2;
  const STORES = ["trades", "journal", "memos", "drawings", "legacy", "cash"];
  let dbp = null;
  const subs = [];
  const emit = (store, op, v) => { for (const f of subs) try { f(store, op, v); } catch {} };

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const q = indexedDB.open(DBN, VER);
      q.onupgradeneeded = () => {
        for (const s of STORES) if (!q.result.objectStoreNames.contains(s)) q.result.createObjectStore(s, { keyPath: "id" });
      };
      q.onsuccess = () => {
        const db = q.result;
        // 새 버전 앱이 저장소를 바꾸려 하면, 이 (예전) 화면은 연결을 놓고 새로 고침
        db.onversionchange = () => { db.close(); dbp = null; location.reload(); };
        res(db);
      };
      q.onerror = () => rej(q.error);
      q.onblocked = () => { const t = document.getElementById("toast"); if (t) { t.textContent = "다른 창에 열린 예전 앱을 닫아 주세요"; t.hidden = false; } };
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode), s = t.objectStore(store);
      const out = fn(s);
      t.oncomplete = () => res(out && "result" in out ? out.result : undefined);
      t.onerror = () => rej(t.error);
    });
  }
  const all = (store) => tx(store, "readonly", (s) => s.getAll());
  const get = (store, id) => tx(store, "readonly", (s) => s.get(id));
  // 앱에서 바꾸는 것: 시각(u)을 찍고 동기화에 알림
  const put = async (store, obj) => { obj.u = Date.now(); await tx(store, "readwrite", (s) => s.put(obj)); emit(store, "put", obj); };
  const del = async (store, id) => { await tx(store, "readwrite", (s) => s.delete(id)); emit(store, "del", id); };
  const putMany = async (store, list) => {
    const now = Date.now();
    for (const o of list) if (!o.u) o.u = now;
    await tx(store, "readwrite", (s) => { for (const o of list) s.put(o); });
    for (const o of list) emit(store, "put", o);
  };
  // 동기화가 받아온 것: 그대로 저장 (다시 알리지 않음)
  const rawPut = (store, obj) => tx(store, "readwrite", (s) => s.put(obj));
  const rawDel = (store, id) => tx(store, "readwrite", (s) => s.delete(id));
  const onChange = (f) => subs.push(f);

  // 작은 설정값
  const pref = {
    get(k, d) { try { const v = localStorage.getItem("ta_" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("ta_" + k, JSON.stringify(v)); } catch {} },
  };
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return { STORES, all, get, put, del, putMany, rawPut, rawDel, onChange, pref, uid };
})();
