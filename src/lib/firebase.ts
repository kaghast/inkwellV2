import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User as FirebaseUser,
  signOut,
} from "firebase/auth";
import firebaseConfig from "../../firebase-applet-config.json";

// Initialize Firebase App instance safely (singleton)
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

// Provider with Drive file and Calendar readonly access scopes
export const googleServicesProvider = new GoogleAuthProvider();
googleServicesProvider.addScope("https://www.googleapis.com/auth/drive.file");
googleServicesProvider.addScope("https://www.googleapis.com/auth/calendar.events.readonly");
googleServicesProvider.setCustomParameters({
  prompt: "consent",
  access_type: "offline",
});

// Cache the access token in memory (never in localStorage per security guidelines)
let cachedGoogleAccessToken: string | null = null;
let cachedFirebaseUser: FirebaseUser | null = null;

// Auth state listener
onAuthStateChanged(auth, async (user) => {
  cachedFirebaseUser = user;
  if (!user) {
    cachedGoogleAccessToken = null;
  }
});

/**
 * Sign in or re-authenticate with Google using popup to obtain Google Drive and Calendar OAuth access token
 */
export async function connectGoogleServices(): Promise<{ user: FirebaseUser; accessToken: string }> {
  try {
    const result = await signInWithPopup(auth, googleServicesProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error("Google erişim belirteci (access token) alınamadı.");
    }

    cachedGoogleAccessToken = credential.accessToken;
    cachedFirebaseUser = result.user;

    return {
      user: result.user,
      accessToken: cachedGoogleAccessToken,
    };
  } catch (error: any) {
    console.error("Google services connection error:", error);
    throw error;
  }
}

// Aliases for compatibility
export const connectGoogleDrive = connectGoogleServices;
export const connectGoogleCalendar = connectGoogleServices;

/**
 * Get current Google Access Token
 */
export function getGoogleAccessToken(): string | null {
  return cachedGoogleAccessToken;
}
export const getDriveAccessToken = getGoogleAccessToken;
export const getCalendarAccessToken = getGoogleAccessToken;

/**
 * Set Google Access Token in memory
 */
export function setGoogleAccessToken(token: string | null) {
  cachedGoogleAccessToken = token;
}
export const setDriveAccessToken = setGoogleAccessToken;

/**
 * Get current authenticated Firebase user
 */
export function getFirebaseUser(): FirebaseUser | null {
  return cachedFirebaseUser || auth.currentUser;
}

/**
 * Disconnect Google Services
 */
export async function disconnectGoogleServices(): Promise<void> {
  cachedGoogleAccessToken = null;
  try {
    await signOut(auth);
  } catch {
    /* ignore */
  }
}
export const disconnectGoogleDrive = disconnectGoogleServices;
export const disconnectGoogleCalendar = disconnectGoogleServices;
