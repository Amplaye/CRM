import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";

// In a real app, these values would come from environment variables.
// For TableFlow AI demo, we use placeholder config because we use the emulator.
const firebaseConfig = {
  apiKey: "demo-api-key",
  authDomain: "demo-tableflow-ai.firebaseapp.com",
  projectId: "demo-tableflow-ai",
  storageBucket: "demo-tableflow-ai.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

const auth = getAuth(app);
const db = getFirestore(app);

// Use Emulators if running locally
if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  // Prevent connecting multiple times during HMR
  if (!(auth as any)._isEmulatorLoaded) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    (auth as any)._isEmulatorLoaded = true;
  }
  if (!(db as any)._isEmulatorLoaded) {
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    (db as any)._isEmulatorLoaded = true;
  }
}

export { app, auth, db };
