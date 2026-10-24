# Пиксель-лобби

Сайт для сбора пати с друзьями: пиксельные персонажи, лобби под любую игру, эмоции и общая галерея образов.
Сайт лежит на GitHub Pages, а лобби хранятся в Firebase. Оба сервиса бесплатные.

Пока Firebase не настроен, сайт работает в **демо-режиме**: всё работает, но лобби видны только в одной вкладке.

---

## 1. Создай проект Firebase (≈5 минут)

1. Зайди на https://console.firebase.google.com и войди через Google.
2. Нажми **Create a project** (Создать проект), назови, например, `pixel-lobby`. Google Analytics можно выключить.
3. Когда проект создастся, нажми на значок **</>** (Web), назови приложение `pixel-lobby` и нажми **Register app**.
4. Firebase покажет блок кода с `const firebaseConfig = { ... }`. Оставь эту вкладку открытой, это понадобится в шаге 3.

## 2. Включи вход и базу данных

1. В меню слева: **Build → Authentication → Get started**.
   Во вкладке **Sign-in method** выбери **Anonymous** и включи его (**Enable → Save**).
   Это вход без пароля: друзья просто открывают ссылку.
2. В меню слева: **Build → Firestore Database → Create database**.
   Регион можно выбрать `eur3 (europe-west)`. Режим: **Start in production mode**.
3. В Firestore открой вкладку **Rules**, замени всё содержимым файла `firestore.rules` из этой папки и нажми **Publish**.

## 3. Вставь настройки в сайт

Открой `firebase-config.js` и замени заглушку значениями из шага 1.4:

```js
window.FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "pixel-lobby-xxxx.firebaseapp.com",
  projectId: "pixel-lobby-xxxx",
  storageBucket: "pixel-lobby-xxxx.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef"
};
```

Эти ключи не секретные, их можно хранить в открытом репозитории: доступ к данным ограничивают правила из шага 2.3.

## 4. Выложи на GitHub Pages

1. Создай на https://github.com новый **публичный** репозиторий, например `pixel-lobby`.
2. Загрузи в него все файлы из этой папки: **Add file → Upload files**, перетащи файлы, **Commit changes**.
3. Открой **Settings → Pages**. В **Source** выбери **Deploy from a branch**, ветку `main`, папку `/ (root)` и нажми **Save**.
4. Через минуту-две сайт будет доступен по адресу `https://ТВОЙ-НИК.github.io/pixel-lobby/`.

## 5. Разреши этот адрес в Firebase

В Firebase: **Authentication → Settings → Authorized domains → Add domain** и добавь `ТВОЙ-НИК.github.io`.
Без этого анонимный вход на сайте не заработает.

Готово: открой ссылку, собери персонажа, создай лобби и скинь ссылку друзьям.

---

## Как это устроено

| Файл | Что внутри |
|---|---|
| `index.html` | Весь сайт: редактор персонажа, лобби, эмоции |
| `adapter.js` | Связь с Firebase (и демо-режим, если Firebase не настроен) |
| `firebase-config.js` | Настройки твоего проекта Firebase |
| `firestore.rules` | Правила доступа к базе |
| `manifest.json`, `icon-*.png` | Чтобы сайт можно было поставить на телефон как приложение |

**Поставить на телефон:** открой сайт в браузере и выбери «Добавить на главный экран».

**Если что-то не работает:** открой сайт, нажми F12 → вкладка Console. Чаще всего причина в том, что не включён Anonymous-вход (шаг 2.1), не опубликованы правила (шаг 2.3) или не добавлен домен (шаг 5).

**Лимиты бесплатного Firebase:** 50 000 чтений и 20 000 записей в день. Для компании друзей этого хватит с огромным запасом.

---

## Вход через Discord (по желанию)

Без этого шага работает гостевой вход. С Discord персонаж привязан к аккаунту и сохраняется на любом устройстве, а имя подставляется само.

Схема: сайт → сервер входа (Cloudflare Worker из папки `auth-worker/`) → Discord → сервер входа выдаёт пропуск Firebase → сайт.

1. **Firebase:** Authentication → Sign-in method → Anonymous должен остаться включённым (это гостевой вход).
   Project settings → Service accounts → **Generate new private key**. Скачается JSON. **Никому его не отправляй и не загружай на GitHub.**
2. **Cloudflare:** https://dash.cloudflare.com → Workers & Pages → Create → Worker → назови `pixel-lobby-auth` → Deploy → Edit code, вставь `auth-worker/worker.js`, Deploy.
   Запомни адрес вида `https://pixel-lobby-auth.<ник>.workers.dev`.
3. **Discord:** https://discord.com/developers/applications → New Application → OAuth2.
   Скопируй **Client ID**, нажми Reset Secret и скопируй **Client Secret**.
   В Redirects добавь `https://pixel-lobby-auth.<ник>.workers.dev/callback` и сохрани.
4. **Cloudflare → Worker → Settings → Variables and Secrets:**
   - `DISCORD_CLIENT_ID`: Text, Client ID
   - `DISCORD_CLIENT_SECRET`: Secret, Client Secret
   - `FIREBASE_CLIENT_EMAIL`: Text, поле `client_email` из JSON
   - `FIREBASE_PRIVATE_KEY`: Secret, поле `private_key` из JSON целиком, от `-----BEGIN` до `END PRIVATE KEY-----\n`
   - `ALLOWED_ORIGIN`: Text, `https://kimekochi.github.io`
5. В `firebase-config.js` впиши адрес воркера: `window.AUTH_WORKER_URL = "https://pixel-lobby-auth.<ник>.workers.dev";`
