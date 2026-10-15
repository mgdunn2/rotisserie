import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import {
  getFunctions,
  connectFunctionsEmulator,
  httpsCallable,
} from "firebase/functions";
const e = import.meta.env;
export const configured = !!(
  e.VITE_FIREBASE_API_KEY &&
  e.VITE_FIREBASE_PROJECT_ID &&
  e.VITE_FIREBASE_APP_ID
);
const app = configured
  ? initializeApp({
      apiKey: e.VITE_FIREBASE_API_KEY,
      authDomain: e.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: e.VITE_FIREBASE_PROJECT_ID,
      appId: e.VITE_FIREBASE_APP_ID,
    })
  : null;
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
const fn = app
  ? getFunctions(app, e.VITE_FIREBASE_FUNCTIONS_REGION || "us-central1")
  : null;
if (app && e.VITE_USE_EMULATORS === "true") {
  connectAuthEmulator(auth!, "http://127.0.0.1:9099");
  connectFirestoreEmulator(db!, "127.0.0.1", 8080);
  connectFunctionsEmulator(fn!, "127.0.0.1", 5001);
}
export async function command(data: Record<string, unknown>) {
  if (!fn) throw new Error("Firebase has not been configured");
  return (await httpsCallable(fn, "draftAction")(data)).data as { id: string };
}
