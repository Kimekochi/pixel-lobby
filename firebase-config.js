// Настройки проекта Firebase. Они не секретные: доступ к данным ограничивают правила из firestore.rules.
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyBGLjt-aOxuFr7-9RUoTnMIT_Lbv0KZ3Rg",
  authDomain: "pixel-lobby-842a9.firebaseapp.com",
  projectId: "pixel-lobby-842a9",
  storageBucket: "pixel-lobby-842a9.firebasestorage.app",
  messagingSenderId: "172799681064",
  appId: "1:172799681064:web:20abb6334189aa19f64b1d"
};

// Адрес сервера входа через Discord (Cloudflare Worker). Пока пусто, кнопки Discord не будет, только гостевой вход.
window.AUTH_WORKER_URL = "https://pixel-lobby-auth.lightblueberry219.workers.dev";
