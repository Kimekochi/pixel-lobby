/* Пиксель-лобби: хранилище поверх Firebase (или демо-режим в памяти, пока Firebase не настроен).
   Даёт странице тот же интерфейс, что был в Claude: claude.use("db") и claude.use("user"). */
(function(){
  const cfg = window.FIREBASE_CONFIG || {};
  const configured = !!(cfg.apiKey && !/ВСТАВЬ|PASTE/i.test(cfg.apiKey) && window.firebase);

  /* ---------- общие помощники ---------- */
  const isPlain = v => v && typeof v === "object" && !Array.isArray(v);
  // {a:{b:{c:1}}} -> {"a.b.c":1}: вложенные объекты сливаются, как раньше
  function flatten(obj, prefix, out){
    out = out || {};
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? prefix + "." + k : k;
      if (isPlain(v) && Object.keys(v).length) flatten(v, key, out); else out[key] = v;
    }
    return out;
  }
  function deepMerge(target, patch){
    const out = isPlain(target) ? { ...target } : {};
    for (const [k, v] of Object.entries(patch)) out[k] = isPlain(v) && Object.keys(v).length ? deepMerge(out[k], v) : v;
    return out;
  }
  const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
  const newId = () => Math.random().toString(36).slice(2, 12);

  /* ---------- Firebase ---------- */
  function firebaseBackend(){
    firebase.initializeApp(cfg);
    const fs = firebase.firestore(), auth = firebase.auth();
    const worker = String(window.AUTH_WORKER_URL || "").replace(/\/+$/, "");
    const needLogin = err => {
      window.PL_NEEDS_LOGIN = { error: err || "" };
      window.dispatchEvent(new CustomEvent("pl-need-login", { detail: window.PL_NEEDS_LOGIN }));
    };
    // ?ft=… — пропуск, который выдал сервер входа после Discord
    const params = new URLSearchParams(location.search);
    const ft = params.get("ft");
    if (ft) { params.delete("ft"); const q = params.toString(); history.replaceState(null, "", location.pathname + (q ? "?" + q : "") + location.hash); }
    const ready = new Promise(resolve => {
      let first = true;
      auth.onAuthStateChanged(u => {
        if (u) { window.PL_NEEDS_LOGIN = null; window.dispatchEvent(new Event("pl-signed-in")); resolve(u.uid); }
        else if (first && !ft) needLogin();
        first = false;
      });
      if (ft) auth.signInWithCustomToken(ft).catch(e => { console.error(e); needLogin("Не получилось войти через Discord. Попробуй ещё раз."); });
    });
    window.PL_AUTH = {
      hasDiscord: !!worker,
      discord(){ if (worker) location.href = worker + "/login?return=" + encodeURIComponent(location.href); },
      anon(){ return auth.signInAnonymously().catch(e => { console.error(e); needLogin("Гостевой вход выключен в Firebase."); }); },
      signOut(){ return auth.signOut().then(() => location.reload()); },
      async info(){
        await ready; const u = auth.currentUser;
        if (!u || !u.uid.startsWith("discord_")) return { kind: "guest", name: "" };
        const c = (await u.getIdTokenResult()).claims || {};
        const avatar = c.davatar && c.did ? `https://cdn.discordapp.com/avatars/${c.did}/${c.davatar}.png?size=64` : "";
        return { kind: "discord", name: c.dname || "", avatar };
      }
    };
    const wrapDoc = s => ({ id: s.id, exists: s.exists, data: () => s.data() });
    const wrapQuery = q => ({ docs: q.docs.map(wrapDoc), size: q.size, empty: q.empty });
    function docRef(path){
      const r = fs.doc(path);
      return {
        id: r.id, path,
        async get(){ await ready; return wrapDoc(await r.get()); },
        async set(data){ await ready; await r.set(data); },
        async update(data){ await ready; await r.update(flatten(data)); },
        async delete(){ await ready; await r.delete(); },
        onSnapshot(next, err){ let off = null, dead = false;
          ready.then(() => { if (!dead) off = r.onSnapshot(s => next(wrapDoc(s)), e => err && err({ code: "unavailable", message: String(e) })); });
          return () => { dead = true; off && off(); }; },
        // короткая «бронь» документа, чтобы двое не заняли последнее место одновременно
        async acquire({ holder, ttlMs = 4000 }){ await ready;
          return fs.runTransaction(async t => {
            const s = await t.get(r); if (!s.exists) return { acquired: false };
            const l = s.data()._lease, now = Date.now();
            if (l && l.exp > now && l.holder !== holder) return { acquired: false, expiresAt: new Date(l.exp).toISOString() };
            t.update(r, { _lease: { holder, exp: now + ttlMs } }); return { acquired: true, holder };
          }); }
      };
    }
    function colRef(path){
      const c = fs.collection(path);
      return {
        path, doc: id => docRef(path + "/" + (id || newId())),
        async add(data){ await ready; const r = await c.add(data); return docRef(path + "/" + r.id); },
        async get(){ await ready; return wrapQuery(await c.get()); },
        onSnapshot(next, err){ let off = null, dead = false;
          ready.then(() => { if (!dead) off = c.onSnapshot(q => next(wrapQuery(q)), e => err && err({ code: "unavailable", message: String(e) })); });
          return () => { dead = true; off && off(); }; }
      };
    }
    const db = { doc: docRef, collection: colRef };
    const user = { id: () => ready, can: async () => true, isOwner: () => false, canEdit: () => true };
    return { db, user, mode: "firebase" };
  }

  /* ---------- Демо-режим: данные в памяти этой вкладки ---------- */
  function memoryBackend(){
    const docs = new Map(), subs = new Set();
    let uid = null; try { uid = localStorage.getItem("pl-demo-uid"); } catch {}
    if (!uid) { uid = "demo-" + newId(); try { localStorage.setItem("pl-demo-uid", uid); } catch {} }
    const parentOf = p => p.split("/").slice(0, -1).join("/");
    const snap = p => { const d = docs.get(p); return { id: p.split("/").pop(), exists: d !== undefined, data: () => clone(d) }; };
    const notify = () => queueMicrotask(() => subs.forEach(f => f()));
    function docRef(path){
      return {
        id: path.split("/").pop(), path,
        async get(){ return snap(path); },
        async set(data){ docs.set(path, clone(data)); notify(); },
        async update(data){ if (!docs.has(path)) throw { code: "invalid_argument", message: "Документа нет" }; docs.set(path, deepMerge(docs.get(path), clone(data))); notify(); },
        async delete(){ docs.delete(path); notify(); },
        onSnapshot(next){ const f = () => next(snap(path)); subs.add(f); queueMicrotask(f); return () => subs.delete(f); },
        async acquire(){ return { acquired: true }; }
      };
    }
    function colRef(path){
      const list = () => { const ds = [...docs.keys()].filter(p => parentOf(p) === path).sort().map(snap); return { docs: ds, size: ds.length, empty: !ds.length }; };
      return {
        path, doc: id => docRef(path + "/" + (id || newId())),
        async add(data){ const r = docRef(path + "/" + newId()); await r.set(data); return r; },
        async get(){ return list(); },
        onSnapshot(next){ const f = () => next(list()); subs.add(f); queueMicrotask(f); return () => subs.delete(f); }
      };
    }
    const db = { doc: docRef, collection: colRef };
    const user = { id: async () => uid, can: async () => true, isOwner: () => true, canEdit: () => true };
    window.PL_AUTH = null;
    return { db, user, mode: "demo" };
  }

  let backend;
  try { backend = configured ? firebaseBackend() : memoryBackend(); }
  catch (e) { console.error("Firebase не запустился, включаю демо-режим", e); backend = memoryBackend(); }
  window.PL_MODE = backend.mode;
  window.claude = { use: async name => name === "db" ? backend.db : name === "user" ? backend.user : null };
})();
