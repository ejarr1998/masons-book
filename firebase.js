// ============================================================
// FIREBASE — initializes the single Firebase app instance and
// exports db/storage/auth. Any module needing Firestore/Storage/Auth
// imports from here rather than calling initializeApp() again, which
// would create a duplicate (and broken) app instance.
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCQEgZO95OgLJdwk04LSj-uC3eSa0Dbv0I",
  authDomain: "masons-book.firebaseapp.com",
  projectId: "masons-book",
  storageBucket: "masons-book.firebasestorage.app",
  messagingSenderId: "837372077507",
  appId: "1:837372077507:web:a1e473926d0b0701c2c976"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);
