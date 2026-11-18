// 저장소: 기기 안(IndexedDB)에 모든 기록 보관. 나중에 동기화 모듈만 붙이면 됨.
const Store = (() => {
  const DBN = "trade-agent", VER = 1;
  const STORES = ["trades", "journal", "memos", "drawings", "legacy"];
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const q = indexedDB.open(DBN, VER);
      q.onupgradeneeded = () => {
        for (const s of STORES) if (!q.result.objectStoreNames.contains(s)) q.result.createObjectStore(s, { keyPath: "id" });
      };
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
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
  const put = (store, obj) => { obj.u = Date.now(); return tx(store, "readwrite", (s) => s.put(obj)); };
  const del = (store, id) => tx(store, "readwrite", (s) => s.delete(id));
  const putMany = (store, list) => tx(store, "readwrite", (s) => { for (const o of list) s.put(o); });

  // 작은 설정값
  const pref = {
    get(k, d) { try { const v = localStorage.getItem("ta_" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("ta_" + k, JSON.stringify(v)); } catch {} },
  };
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return { all, get, put, del, putMany, pref, uid };
})();
