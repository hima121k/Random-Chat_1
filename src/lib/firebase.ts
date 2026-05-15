import { initializeApp } from 'firebase/app';
import {
  getAuth, signInWithPopup, GoogleAuthProvider,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signInWithPhoneNumber, RecaptchaVerifier, linkWithCredential,
  EmailAuthProvider,
  type Auth, type ConfirmationResult
} from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

const app = firebaseConfig.apiKey ? initializeApp(firebaseConfig) : null;
export const auth: Auth | null = app ? getAuth(app) : null;
export const db: Firestore | null = app ? getFirestore(app) : null;
const googleProvider = new GoogleAuthProvider();

// ── Google Sign-In ──────────────────────────────────────────────
export const loginWithGoogle = async () => {
  if (!auth) throw new Error('Firebase Auth is not initialized.');
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
};

// ── Email/Password Sign-In (returning users) ────────────────────
export const signInWithEmail = async (email: string, password: string) => {
  if (!auth) throw new Error('Firebase Auth is not initialized.');
  const result = await signInWithEmailAndPassword(auth, email, password);
  return result.user;
};

// ── Phone OTP (first-time registration step 1) ──────────────────
let recaptchaVerifier: RecaptchaVerifier | null = null;

export const sendPhoneOTP = async (phoneNumber: string): Promise<ConfirmationResult> => {
  if (!auth) throw new Error('Firebase Auth is not initialized.');

  if (recaptchaVerifier) {
    recaptchaVerifier.clear();
    recaptchaVerifier = null;
  }

  let container = document.getElementById('recaptcha-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'recaptcha-container';
    document.body.appendChild(container);
  }

  recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
    size: 'invisible',
    callback: () => {},
  });

  return await signInWithPhoneNumber(auth, phoneNumber, recaptchaVerifier);
};

export const verifyPhoneOTP = async (confirmationResult: ConfirmationResult, otp: string) => {
  const result = await confirmationResult.confirm(otp);
  return result.user;
};

// ── Link email+password to phone-verified account (registration step 2) ──
export const linkEmailPassword = async (email: string, password: string) => {
  if (!auth?.currentUser) throw new Error('No authenticated user.');
  const credential = EmailAuthProvider.credential(email, password);
  const result = await linkWithCredential(auth.currentUser, credential);
  return result.user;
};

// ── Create account directly with email+password (no phone) ───────
export const createEmailAccount = async (email: string, password: string) => {
  if (!auth) throw new Error('Firebase Auth is not initialized.');
  const result = await createUserWithEmailAndPassword(auth, email, password);
  return result.user;
};
