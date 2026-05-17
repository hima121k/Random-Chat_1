/**
 * End-to-End Encryption module
 * ─────────────────────────────────────────────────────────────
 * Algorithm: ECDH (P-256) key exchange → AES-GCM 256-bit message cipher
 *
 * NOTE: Web Crypto API requires a Secure Context (HTTPS or localhost).
 * When accessed over plain HTTP (e.g. a local-network IP), `window.crypto.subtle`
 * is undefined. All functions here check for this and throw a clear error so
 * the caller's try/catch can fall back to plaintext mode gracefully.
 *
 * Flow:
 *  1. On match, each peer generates an ECDH key-pair.
 *  2. Each peer exports their PUBLIC key as a base64 string and writes it
 *     to Firestore under chats/{chatId}/e2eeKeys/{userId}.
 *  3. Each peer reads the other's public key from Firestore and derives a
 *     shared AES-GCM key using ECDH. The private key NEVER leaves the browser.
 *  4. Every message is encrypted with the shared key + a random IV before
 *     being stored. Only the ciphertext + IV hit Firestore.
 *  5. On receive, the client decrypts with its own derived shared key.
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

function getSubtle(): SubtleCrypto {
  const subtle = window.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      'Web Crypto API not available. E2EE requires HTTPS or localhost. ' +
      'Chat will fall back to plaintext mode.'
    );
  }
  return subtle;
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  bytes.forEach(b => (binary += String.fromCharCode(b)));
  return window.btoa(binary);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = window.atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export async function saveKeyPairToSession(chatId: string, keyPair: CryptoKeyPair) {
  const subtle = getSubtle();
  const raw = await subtle.exportKey('pkcs8', keyPair.privateKey);
  const pub = await subtle.exportKey('raw', keyPair.publicKey);
  sessionStorage.setItem(`e2ee_priv_${chatId}`, arrayBufferToBase64(raw));
  sessionStorage.setItem(`e2ee_pub_${chatId}`,  arrayBufferToBase64(pub));
}

export async function loadKeyPairFromSession(chatId: string): Promise<CryptoKeyPair | null> {
  const subtle = getSubtle();
  const privB64 = sessionStorage.getItem(`e2ee_priv_${chatId}`);
  const pubB64  = sessionStorage.getItem(`e2ee_pub_${chatId}`);
  if (!privB64 || !pubB64) return null;
  try {
    const privateKey = await subtle.importKey(
      'pkcs8', base64ToArrayBuffer(privB64),
      { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']
    );
    const publicKey = await subtle.importKey(
      'raw', base64ToArrayBuffer(pubB64),
      { name: 'ECDH', namedCurve: 'P-256' }, true, []
    );
    return { privateKey, publicKey };
  } catch { return null; }
}

// ── Key Generation ────────────────────────────────────────────────────────────

/**
 * Generate an ephemeral ECDH key pair for this session.
 * Returns { keyPair, publicKeyB64 } where publicKeyB64 is safe to store in Firestore.
 * Throws if Web Crypto is unavailable (non-HTTPS context).
 */
export async function generateECDHKeyPair(): Promise<{
  keyPair: CryptoKeyPair;
  publicKeyB64: string;
}> {
  const subtle = getSubtle();
  const keyPair = await subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );
  const rawPublic = await subtle.exportKey('raw', keyPair.publicKey);
  return { keyPair, publicKeyB64: arrayBufferToBase64(rawPublic) };
}

/**
 * Derive a shared AES-GCM-256 key from our private key and the peer's raw public key.
 */
export async function deriveSharedKey(
  myPrivateKey: CryptoKey,
  peerPublicKeyB64: string
): Promise<CryptoKey> {
  const subtle = getSubtle();
  const peerRaw = base64ToArrayBuffer(peerPublicKeyB64);
  const peerPublicKey = await subtle.importKey(
    'raw',
    peerRaw,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );
  return subtle.deriveKey(
    { name: 'ECDH', public: peerPublicKey },
    myPrivateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// ── Message Encryption / Decryption ──────────────────────────────────────────

export interface EncryptedPayload {
  /** base64-encoded ciphertext */
  ct: string;
  /** base64-encoded 12-byte IV */
  iv: string;
}

/**
 * Encrypt a plaintext string with the shared AES-GCM key.
 * Returns an EncryptedPayload that is safe to store in Firestore.
 */
export async function encryptMessage(
  plaintext: string,
  sharedKey: CryptoKey
): Promise<EncryptedPayload> {
  const subtle = getSubtle();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuf = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    sharedKey,
    encoded
  );
  return {
    ct: arrayBufferToBase64(cipherBuf),
    iv: arrayBufferToBase64(iv.buffer),
  };
}

/**
 * Decrypt an EncryptedPayload back to the original plaintext string.
 * Returns null if decryption fails (wrong key / tampered message).
 */
export async function decryptMessage(
  payload: EncryptedPayload,
  sharedKey: CryptoKey
): Promise<string | null> {
  try {
    const subtle = getSubtle();
    const ct = base64ToArrayBuffer(payload.ct);
    const iv = base64ToArrayBuffer(payload.iv);
    const plainBuf = await subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv) },
      sharedKey,
      ct
    );
    return new TextDecoder().decode(plainBuf);
  } catch {
    return null; // Decryption failure — don't crash
  }
}
