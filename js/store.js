// 저장소: 기기 안(IndexedDB)에 모든 기록 보관. 바뀐 내용은 동기화 모듈(sync.js)에 알려 줌.
const Store = (() => {
  const DBN = "trade-agent";
  // 기록 종류(동기화 이름). 출금·입금(cash)은 처음부터 있던 칸(memos)에 담아서, 저장소 구조를 바꿀 일이 없게 함
  const STORES = ["trades", "journal", "drawings", "legacy", "cash"];
  const PHYS = { cash: "memos" };
  const NEED = ["trades", "journal", "memos", "drawings", "legacy"];
  const phys = (s) => PHYS[s] || s;
  let dbp = null;
  const subs = [];
  const emit = (store, op, v) => { for (const f of subs) try { f(store, op, v); } catch {} };

  function openAt(ver) {
    return new Promise((res, rej) => {
      const q = ver ? indexedDB.open(DBN, ver) : indexedDB.open(DBN);
      q.onupgradeneeded = () => { for (const s of NEED) if (!q.result.objectStoreNames.contains(s)) q.result.createObjectStore(s, { keyPath: "id" }); };
      q.onsuccess = () => {
        const db = q.result;
        db.onversionchange = () => { db.close(); dbp = null; };
        res(db);
      };
      q.onerror = () => rej(q.error);
    });
  }
  function open() {
    if (dbp) return dbp;
    // 지금 있는 버전 그대로 열고, 빠진 칸이 있을 때만 한 단계 올림
    dbp = openAt(0).then((db) => {
      if (NEED.every((s) => db.objectStoreNames.contains(s))) return db;
      const v = db.version; db.close();
      return openAt(v + 1);
    });
    dbp.catch(() => (dbp = null));
    return dbp;
  }
  async function tx(store, mode, fn) {
    const db = await open();
    store = phys(store);
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
