/*
  Пиксель-лобби: вход через Discord для Firebase.
  Работает на Cloudflare Workers (бесплатно).

  Переменные окружения (Settings → Variables and Secrets):
    DISCORD_CLIENT_ID      — Client ID приложения Discord          (Text)
    DISCORD_CLIENT_SECRET  — Client Secret приложения Discord      (Secret)
    FIREBASE_CLIENT_EMAIL  — client_email из ключа сервисного аккаунта Firebase (Text)
    FIREBASE_PRIVATE_KEY   — private_key из того же ключа          (Secret)
    ALLOWED_ORIGIN         — адрес сайта, например https://kimekochi.github.io (Text)

  Маршруты:
    /login?return=<адрес страницы>  — отправляет игрока на Discord
    /callback                       — Discord возвращает сюда; выдаём токен Firebase и возвращаем на сайт
*/

const DISCORD_AUTHORIZE = "https://discord.com/oauth2/authorize";
const DISCORD_TOKEN = "https://discord.com/api/oauth2/token";
const DISCORD_ME = "https://discord.com/api/users/@me";
const FIREBASE_AUD = "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/login") return login(url, env);
      if (url.pathname === "/callback") return await callback(request, url, env);
      return text("Пиксель-лобби: сервер входа работает.", 200);
    } catch (e) {
      return text("Не получилось войти: " + (e && e.message ? e.message : e), 500);
    }
  }
};

/* ---------- /login ---------- */
function login(url, env) {
  const ret = safeReturn(url.searchParams.get("return"), env);
  const nonce = randomHex(16);
  const state = b64urlStr(JSON.stringify({ r: ret, n: nonce }));
  const auth = new URL(DISCORD_AUTHORIZE);
  auth.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("redirect_uri", url.origin + "/callback");
  auth.searchParams.set("scope", "identify");
  auth.searchParams.set("state", state);
  return new Response(null, {
    status: 302,
    headers: {
      Location: auth.toString(),
      "Set-Cookie": `pl_state=${nonce}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`
    }
  });
}

/* ---------- /callback ---------- */
async function callback(request, url, env) {
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  if (!code || !stateRaw) return text("Discord не вернул код входа. Попробуй ещё раз.", 400);

  let state;
  try { state = JSON.parse(fromB64urlStr(stateRaw)); } catch { return text("Неверный параметр state.", 400); }
  const cookieNonce = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)pl_state=([0-9a-f]+)/);
  if (!cookieNonce || cookieNonce[1] !== state.n) return text("Сессия входа устарела. Вернись на сайт и нажми «Войти через Discord» ещё раз.", 400);
  const ret = safeReturn(state.r, env);

  // 1) меняем код на токен Discord
  const tokenRes = await fetch(DISCORD_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: url.origin + "/callback"
    })
  });
  if (!tokenRes.ok) return text("Discord отказал в обмене кода: " + (await tokenRes.text()), 400);
  const { access_token } = await tokenRes.json();

  // 2) узнаём, кто вошёл
  const meRes = await fetch(DISCORD_ME, { headers: { Authorization: "Bearer " + access_token } });
  if (!meRes.ok) return text("Не получилось узнать профиль Discord.", 400);
  const me = await meRes.json();

  // 3) выпускаем пропуск Firebase
  const uid = "discord_" + me.id;
  const claims = { dname: (me.global_name || me.username || "").slice(0, 32), davatar: me.avatar || "" , did: me.id };
  const firebaseToken = await mintCustomToken(env, uid, claims);

  // 4) возвращаем игрока на сайт
  const back = new URL(ret);
  back.searchParams.set("ft", firebaseToken);
  return new Response(null, {
    status: 302,
    headers: { Location: back.toString(), "Set-Cookie": "pl_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" }
  });
}

/* ---------- токен Firebase (JWT RS256) ---------- */
async function mintCustomToken(env, uid, claims) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: env.FIREBASE_CLIENT_EMAIL, sub: env.FIREBASE_CLIENT_EMAIL, aud: FIREBASE_AUD,
    iat: now, exp: now + 3600, uid, claims
  };
  const unsigned = b64urlStr(JSON.stringify(header)) + "." + b64urlStr(JSON.stringify(payload));
  const key = await crypto.subtle.importKey("pkcs8", pemToBuf(env.FIREBASE_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return unsigned + "." + b64urlBytes(new Uint8Array(sig));
}

/* ---------- помощники ---------- */
function safeReturn(ret, env) {
  const origin = (env.ALLOWED_ORIGIN || "").replace(/\/+$/, "");
  try {
    const u = new URL(ret);
    if (origin && u.origin === origin) { u.searchParams.delete("ft"); return u.toString(); }
  } catch {}
  return origin + "/";
}
function pemToBuf(pem) {
  const b64 = String(pem).replace(/\\n/g, "\n").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
function b64urlBytes(bytes) {
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlStr(str) { return b64urlBytes(new TextEncoder().encode(str)); }
function fromB64urlStr(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
  const bin = atob(s), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function randomHex(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return [...a].map(b => b.toString(16).padStart(2, "0")).join(""); }
function text(msg, status) { return new Response(msg, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } }); }
