import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Video, PhoneOff, Phone, Flag, AlertTriangle, Lock, Zap, X } from 'lucide-react'
import {
  collection, query, orderBy, onSnapshot, addDoc, serverTimestamp,
  doc, updateDoc, setDoc, onSnapshot as onSnap, Timestamp
} from 'firebase/firestore'
import { db as _db, auth as _auth } from '../lib/firebase'
// App.tsx only renders this page when VITE_FIREBASE_API_KEY is set, so
// db and auth are always initialised here. Assert non-null once.
import type { Firestore } from 'firebase/firestore'
import type { Auth } from 'firebase/auth'
import { onAuthStateChanged, type User } from 'firebase/auth'
const db = _db as Firestore
const auth = _auth as Auth

import { MessageBubble } from '../components/Chat/MessageBubble'
import { ChatInput } from '../components/Chat/ChatInput'
import { VideoCall } from '../components/VideoCall/VideoCall'
import {
  generateECDHKeyPair,
  deriveSharedKey,
  encryptMessage,
  decryptMessage,
  saveKeyPairToSession,
  loadKeyPairFromSession,
  arrayBufferToBase64,
  type EncryptedPayload,
} from '../lib/crypto'
import { submitReport } from '../services/admin'

interface Message {
  id: string;
  text: string;
  senderId: string;
  createdAt: Timestamp | null;
  reactions?: Record<string, string>;
  isRead?: boolean;
}

interface RawMessage {
  id: string;
  ct: string;
  iv: string;
  senderId: string;
  createdAt: Timestamp | null;
}



export default function Chat() {
  const { chatId } = useParams<{ chatId: string }>()
  const navigate = useNavigate()

  const [messages, setMessages] = useState<Message[]>([])
  const [strangerData, setStrangerData] = useState<{ id: string; name: string; gender: string; avatarUrl?: string; role?: string; isPro?: boolean; mood?: string; location?: string; interests?: string } | null>(null)

  // E2EE
  const myKeyPairRef = useRef<CryptoKeyPair | null>(null)
  const sharedKeyRef = useRef<CryptoKey | null>(null)
  const [e2eeReady, setE2eeReady] = useState(false)
  const [isE2eeActive, setIsE2eeActive] = useState(false) // true only when actual E2EE key is derived
  const [keyVersion, setKeyVersion] = useState(0)
  const [peerTyping, setPeerTyping] = useState(false)

  // Video Call
  const [incomingCall, setIncomingCall] = useState(false)
  const [inCall, setInCall] = useState(false)
  const [isCaller, setIsCaller] = useState(false)

  // Report/Block
  const [showReportModal, setShowReportModal] = useState(false)
  const [reportReason, setReportReason] = useState('')
  const [reportDescription, setReportDescription] = useState('')
  const [reportSent, setReportSent] = useState(false)
  const [isReporting, setIsReporting] = useState(false)
  const [reportError, setReportError] = useState('')

  const [replyingTo, setReplyingTo] = useState<Message | null>(null)

  const isLeavingRef = useRef(false)
  const strangerUnsubRef = useRef<(() => void) | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  
  const [currentUser, setCurrentUser] = useState<User | null>(auth?.currentUser || null)
  const [isAuthLoading, setIsAuthLoading] = useState(!auth?.currentUser)
  const currentUserId = currentUser?.uid

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      setCurrentUser(user)
      setIsAuthLoading(false)
    })
  }, [])

  // ── E2EE setup (with fallback if Firestore rules block key exchange) ─────
  useEffect(() => {
    if (!currentUserId || !chatId) return
    let cancelled = false
    let unsubKeys: (() => void) | null = null

    // Timeout: if E2EE doesn't complete in 8 s, allow chat in plaintext mode
    const fallbackTimer = setTimeout(() => {
      if (!cancelled && !sharedKeyRef.current) {
        console.warn('E2EE key exchange timed out — falling back to plaintext mode')
        setE2eeReady(true) // unblock input; sharedKeyRef stays null → plaintext
      }
    }, 8000)

    const initE2EE = async () => {
      try {
        let keyPair = await loadKeyPairFromSession(chatId);
        let publicKeyB64: string;

        if (keyPair) {
          const raw = await window.crypto.subtle.exportKey('raw', keyPair.publicKey);
          publicKeyB64 = arrayBufferToBase64(raw);
        } else {
          const generated = await generateECDHKeyPair();
          keyPair = generated.keyPair;
          publicKeyB64 = generated.publicKeyB64;
          await saveKeyPairToSession(chatId, keyPair);
        }

        if (cancelled) return
        myKeyPairRef.current = keyPair

        // Publish our public key — may fail if Firestore rules aren't deployed yet
        const keyDocRef = doc(db, 'chats', chatId, 'e2eeKeys', currentUserId)
        await setDoc(keyDocRef, { publicKey: publicKeyB64, uid: currentUserId })

        const keysRef = collection(db, 'chats', chatId, 'e2eeKeys')
        unsubKeys = onSnap(keysRef, async (snap) => {
          if (cancelled) return
          const peerDoc = snap.docs.find(d => d.id !== currentUserId)
          if (!peerDoc || !myKeyPairRef.current) return
          try {
            const shared = await deriveSharedKey(myKeyPairRef.current.privateKey, peerDoc.data().publicKey)
            if (cancelled) return
            sharedKeyRef.current = shared
            setKeyVersion(v => v + 1)
            clearTimeout(fallbackTimer)
            setE2eeReady(true)
            setIsE2eeActive(true) // E2EE actually established
          } catch (err) {
            console.warn('Key derivation failed:', err)
          }
        })
      } catch (err) {
        console.warn('E2EE setup failed (likely Firestore rules not deployed):', err)
        // Fallback: unblock input immediately so users can still chat
        if (!cancelled) setE2eeReady(true)
        clearTimeout(fallbackTimer)
      }
    }

    initE2EE()
    return () => {
      cancelled = true
      clearTimeout(fallbackTimer)
      unsubKeys?.()
    }
  }, [chatId, currentUserId])

  // ── Chat room ──────────────────────────────────────────
  useEffect(() => {
    if (!chatId) { navigate('/'); return }

    // We now rely on Firestore rules to reject unauthorized access.

    if (isAuthLoading) return;
    if (!currentUserId) { navigate('/'); return }

    const chatRef = doc(db, 'chats', chatId)
    // Fix 3: includeMetadataChanges lets us inspect snapshot.metadata.fromCache
    const unsubChatSnap = onSnapshot(chatRef, { includeMetadataChanges: true }, (docSnapshot) => {
      // Fix 3: ignore locally-cached snapshots — only act on server-confirmed data
      if (docSnapshot.metadata.fromCache) return

      if (docSnapshot.exists()) {
        const data = docSnapshot.data()
        if (data.participants && data.users && currentUserId) {
          const otherId = data.participants.find((id: string) => id !== currentUserId)
          if (otherId && !strangerData) {
            // Clean up previous stranger listener if any
            strangerUnsubRef.current?.()
            // Fetch stranger's profile in real-time to ensure badges are accurate
            const unsubStranger = onSnap(doc(db, 'users', otherId), (userSnap) => {
              if (userSnap.exists()) {
                const userData = userSnap.data();
                setStrangerData({ 
                  id: otherId, 
                  name: data.users[otherId]?.name || 'Stranger',
                  gender: data.users[otherId]?.gender,
                  avatarUrl: data.users[otherId]?.avatarUrl,
                  role: userData.role || 'user',
                  isPro: userData.isPro || false,
                  mood: data.users[otherId]?.mood,
                  location: data.users[otherId]?.location,
                  interests: data.users[otherId]?.interests
                });
              } else {
                // Fallback to chat room data if user doc doesn't exist yet
                setStrangerData({ id: otherId, ...data.users[otherId] });
              }
            });
            strangerUnsubRef.current = unsubStranger;
          }
        }
        if (data.videoCall) {
          if (data.videoCall.status === 'ringing' && data.videoCall.callerId !== currentUserId) setIncomingCall(true)
          else if (data.videoCall.status === 'ended') { setInCall(false); setIncomingCall(false) }
          else if (data.videoCall.status === 'connected' && data.videoCall.callerId !== currentUserId) setIncomingCall(false)
        }

        if (data.typing) {
          const otherId = data.participants.find((id: string) => id !== currentUserId)
          if (otherId && data.typing[otherId]) {
            setPeerTyping(true)
          } else {
            setPeerTyping(false)
          }
        } else {
          setPeerTyping(false)
        }

        // Fix 3: only redirect on a server-confirmed ended status
        if (data.status === 'ended' && !isLeavingRef.current) navigate('/', { state: { autoStart: true } })
      } else {
        if (!isLeavingRef.current) navigate('/')
      }
    }, (err) => {
      console.error('Chat snapshot error:', err);
      if (!isLeavingRef.current) navigate('/', { replace: true });
    })

    return () => { 
      unsubChatSnap();
      strangerUnsubRef.current?.();
      strangerUnsubRef.current = null;
    }
  }, [chatId, currentUserId, navigate, isAuthLoading, strangerData])

  // Fix: Automatically end chat when navigating away via Navbar or Back button
  // We check window.location to avoid Strict Mode double-mount issues in dev.
  useEffect(() => {
    return () => {
      const isStillOnThisChat = window.location.pathname.includes(chatId || '');
      if (!isLeavingRef.current && chatId && !isStillOnThisChat) {
        updateDoc(doc(db, 'chats', chatId), { status: 'ended' }).catch(() => {});
      }
    }
  }, [chatId]);

  // ── Messages ──────────────────────────────────────────
  useEffect(() => {
    if (!currentUserId || !chatId) return

    const messagesRef = collection(db, 'chats', chatId, 'messages')
    const q = query(messagesRef, orderBy('createdAt', 'asc'))
    let mounted = true                                          // Fix #8: unmount guard
    const unsubMessages = onSnapshot(q, async (snapshot) => {
      const rawMsgs = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as RawMessage[]
      const decrypted = await Promise.all(
        rawMsgs.map(async (raw): Promise<Message> => {
          const anyRaw = raw as unknown as Record<string, unknown>
          const reactions = anyRaw.reactions as Record<string, string> | undefined
          const isRead = !!anyRaw.isRead

          // Mark as read if from stranger
          if (raw.senderId !== currentUserId && !isRead) {
            updateDoc(doc(db, 'chats', chatId, 'messages', raw.id), { isRead: true }).catch(() => {});
          }

          // Handle decrypting replyTo if it exists
          let replyTo: { text: string; senderId: string } | null = null
          const rawReply = anyRaw.replyTo as { text?: string; ct?: string; iv?: string; senderId: string } | undefined
          if (rawReply) {
            if (rawReply.ct && rawReply.iv && sharedKeyRef.current) {
              const decryptedReplyText = await decryptMessage({ ct: rawReply.ct, iv: rawReply.iv }, sharedKeyRef.current)
              replyTo = {
                text: decryptedReplyText ?? '🔒 Encrypted message',
                senderId: rawReply.senderId
              }
            } else if (rawReply.text) {
              replyTo = {
                text: rawReply.text,
                senderId: rawReply.senderId
              }
            }
          }

          // Support both encrypted (ct/iv) and plaintext (text) message formats
          const hasEncrypted = raw.ct && raw.iv
          if (!hasEncrypted) {
            // Plaintext fallback message
            return { id: raw.id, text: (anyRaw.text as string) ?? '', senderId: raw.senderId, createdAt: raw.createdAt, reactions, isRead, replyTo }
          }
          if (!sharedKeyRef.current)
            return { id: raw.id, text: '🔒 Decrypting…', senderId: raw.senderId, createdAt: raw.createdAt, reactions, isRead, replyTo }
          const payload: EncryptedPayload = { ct: raw.ct, iv: raw.iv }
          const plaintext = await decryptMessage(payload, sharedKeyRef.current)
          return { id: raw.id, text: plaintext ?? '🔒 Encrypted message', senderId: raw.senderId, createdAt: raw.createdAt, reactions, isRead, replyTo }
        })
      )
      if (mounted) setMessages(decrypted)                       // Fix #8: guard
    })

    return () => { mounted = false; unsubMessages() }
  }, [chatId, currentUserId, keyVersion])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Send message (encrypted if key ready, plaintext fallback) ────────────
  const handleSendMessage = useCallback(async (text: string) => {
    if (!chatId || !currentUserId || isLeavingRef.current) return

    let replyData: { text?: string; ct?: string; iv?: string; senderId: string } | null = null
    if (replyingTo) {
      if (sharedKeyRef.current) {
        // Encrypt reply text for absolute E2EE privacy!
        const payload = await encryptMessage(replyingTo.text, sharedKeyRef.current)
        replyData = {
          ct: payload.ct,
          iv: payload.iv,
          senderId: replyingTo.senderId
        }
      } else {
        // Plaintext fallback
        replyData = {
          text: replyingTo.text,
          senderId: replyingTo.senderId
        }
      }
      setReplyingTo(null)
    }

    if (sharedKeyRef.current) {
      // Full E2EE path
      const payload = await encryptMessage(text, sharedKeyRef.current)
      await addDoc(collection(db, 'chats', chatId, 'messages'), {
        ct: payload.ct, iv: payload.iv, senderId: currentUserId, createdAt: serverTimestamp(), replyTo: replyData
      })
    } else {
      // Plaintext fallback (E2EE setup failed / timed out)
      await addDoc(collection(db, 'chats', chatId, 'messages'), {
        text, senderId: currentUserId, createdAt: serverTimestamp(), replyTo: replyData
      })
    }
    await updateDoc(doc(db, 'chats', chatId), { lastMessageAt: serverTimestamp() })
  }, [chatId, currentUserId, replyingTo])

  const handleTyping = useCallback((isTyping: boolean) => {
    if (!chatId || !currentUserId || isLeavingRef.current) return;
    updateDoc(doc(db, 'chats', chatId), { [`typing.${currentUserId}`]: isTyping }).catch(() => {});
  }, [chatId, currentUserId]);

  const handleLeave = async () => {
    isLeavingRef.current = true
    if (chatId) try { await updateDoc(doc(db, 'chats', chatId), { status: 'ended' }) } catch { /* ignore */ }
    navigate('/')
  }
  const handleSwap = async () => {
    isLeavingRef.current = true
    if (chatId) try { await updateDoc(doc(db, 'chats', chatId), { status: 'ended' }) } catch { /* ignore */ }
    navigate('/', { state: { autoStart: true } })
  }

  const handleConfirmReport = async () => {
    if (!strangerData?.id || !currentUserId || !db || isReporting) return
    setIsReporting(true)
    setReportError('')
    try {
      const strangerEmail = null // email not available client-side
      await submitReport(
        strangerData.id,
        strangerData.name,
        strangerEmail,
        chatId || '',
        reportReason || 'No reason given',
        reportDescription
      )
      const blocked = JSON.parse(localStorage.getItem('blockedUsers') || '[]')
      if (!blocked.includes(strangerData.id))
        localStorage.setItem('blockedUsers', JSON.stringify([...blocked, strangerData.id]))
      setReportSent(true)
      setTimeout(() => { handleSwap() }, 1500)
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message || ''
      if (msg.startsWith('ALREADY_REPORTED:')) {
        setReportError('You have already reported this person in this session.')
      } else {
        console.error('Error reporting:', e)
        setReportError('Something went wrong. Please try again.')
      }
    } finally {
      setIsReporting(false)
    }
  }

  const handleStartCall = async () => {
    if (!chatId || !currentUserId) return
    setIsCaller(true); setInCall(true)
    await updateDoc(doc(db, 'chats', chatId), { videoCall: { status: 'ringing', callerId: currentUserId } })
  }
  const handleAcceptCall = async () => {
    if (!chatId) return
    setIsCaller(false); setInCall(true); setIncomingCall(false)
    await updateDoc(doc(db, 'chats', chatId), { 'videoCall.status': 'connected' })
  }
  const handleDeclineCall = async () => {
    if (!chatId) return; setIncomingCall(false)
    await updateDoc(doc(db, 'chats', chatId), { 'videoCall.status': 'ended' })
  }
  const handleHangupCall = async () => {
    if (!chatId) return; setInCall(false); setIsCaller(false)
    await updateDoc(doc(db, 'chats', chatId), { 'videoCall.status': 'ended' })
  }

  const getGenderColor = (gender?: string) => {
    if (gender === 'female') return 'from-pink-500 to-rose-500'
    if (gender === 'male') return 'from-blue-500 to-cyan-500'
    return 'from-rc-accent to-indigo-500'
  }
  const getGenderBadgeColor = (gender?: string) => {
    if (gender === 'female') return 'text-pink-400 bg-pink-500/10 border-pink-500/20'
    if (gender === 'male') return 'text-blue-400 bg-blue-500/10 border-blue-500/20'
    return 'text-rc-accentGlow bg-rc-accent/10 border-rc-accent/20'
  }

  if (isAuthLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-rc-bg">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-rc-accent shadow-glow"></div>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 h-full w-full max-w-3xl mx-auto border-x border-rc-border relative overflow-hidden bg-rc-bg">

      {/* Background mesh */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden z-0">
        <div className="absolute top-0 left-0 w-80 h-80 bg-rc-accent/8 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-0 w-80 h-80 bg-indigo-700/8 rounded-full blur-3xl" />
      </div>

      {/* Video Call Overlay */}
      {inCall && chatId && <VideoCall chatId={chatId} isCaller={isCaller} onHangup={handleHangupCall} />}

      {/* Incoming Call Banner */}
      {incomingCall && !inCall && (
        <div className="absolute top-20 left-4 right-4 z-40 glass rounded-2xl shadow-2xl p-4 flex items-center justify-between animate-bounce">
          <div className="flex items-center gap-3">
            {strangerData?.avatarUrl ? (
              <img src={typeof strangerData.avatarUrl === 'string' ? strangerData.avatarUrl.replace('.glb', '.png') : ''} alt="avatar" className="w-12 h-12 rounded-full ring-2 ring-rc-accent object-cover shadow-lg animate-pulse" />
            ) : (
              <div className={`w-12 h-12 bg-gradient-to-br ${getGenderColor(strangerData?.gender)} rounded-full flex items-center justify-center shadow-lg animate-pulse`}>
                <Video className="text-white" size={20} />
              </div>
            )}
            <div>
              <h3 className="text-rc-text font-bold">{strangerData?.name || 'Stranger'}</h3>
              <p className="text-rc-muted text-sm">Incoming video call…</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleDeclineCall} className="p-3 bg-red-500 hover:bg-red-600 rounded-full text-white transition-colors shadow-lg">
              <PhoneOff size={20} />
            </button>
            <button onClick={handleAcceptCall} className="p-3 bg-emerald-500 hover:bg-emerald-600 rounded-full text-white transition-colors shadow-lg">
              <Phone size={20} />
            </button>
          </div>
        </div>
      )}

      {/* Report Modal */}
      {showReportModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md">
          <div className="glass rounded-2xl p-6 w-80 shadow-2xl space-y-4">
            {reportSent ? (
              <div className="text-center space-y-3">
                <div className="w-14 h-14 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto">
                  <span className="text-3xl">✅</span>
                </div>
                <p className="text-rc-text font-semibold">Report Submitted</p>
                <p className="text-rc-muted text-sm">User blocked. Finding a new match…</p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-red-500/20 rounded-full flex items-center justify-center">
                    <AlertTriangle size={20} className="text-red-400" />
                  </div>
                  <div>
                    <p className="text-rc-text font-semibold">Report User</p>
                    <p className="text-rc-muted text-xs">This user will be reviewed by our team</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-rc-muted text-xs font-semibold uppercase tracking-wider">Reason</p>
                  {['Inappropriate content', 'Harassment', 'Spam / Bot', 'Underage user', 'Other'].map(reason => (
                    <button key={reason} onClick={() => setReportReason(reason)}
                      className={`w-full text-left text-sm px-3 py-2 rounded-xl transition-all border ${reportReason === reason
                        ? 'bg-red-500/15 text-red-400 border-red-500/40'
                        : 'bg-rc-bg/60 border-rc-border text-rc-muted hover:border-rc-border/80'
                        }`}>
                      {reason}
                    </button>
                  ))}
                </div>
                <div>
                  <p className="text-rc-muted text-xs font-semibold uppercase tracking-wider mb-1">Details <span className="text-red-400">*</span></p>
                  <textarea
                    value={reportDescription}
                    onChange={e => setReportDescription(e.target.value)}
                    placeholder="Describe what happened... (required)"
                    maxLength={300}
                    required
                    className="w-full bg-rc-bg border border-rc-border rounded-xl p-2 text-sm text-rc-text outline-none focus:border-rc-accent resize-none min-h-[60px]"
                  />
                </div>
                <div className="flex gap-3">
                  <button onClick={() => { setShowReportModal(false); setReportReason(''); setReportDescription(''); setReportError('') }}
                    className="flex-1 py-2 rounded-xl bg-rc-surface border border-rc-border text-rc-muted hover:text-rc-text transition-colors text-sm">
                    Cancel
                  </button>
                  <button onClick={handleConfirmReport} disabled={!reportReason || !reportDescription.trim() || isReporting}
                    className="flex-1 py-2 rounded-xl bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-semibold transition-colors text-sm">
                    {isReporting ? 'Submitting...' : 'Submit Report'}
                  </button>
                </div>
                {reportError && (
                  <p className="text-xs text-red-400 text-center mt-1">{reportError}</p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <header className="relative z-10 bg-rc-panel/95 backdrop-blur-xl border-b border-rc-border py-2 px-3 sm:py-3 sm:px-4 flex flex-col gap-2 sm:flex-row sm:items-center shadow-lg">
        {/* Row 1: Left avatar/name, Right actions */}
        <div className="flex items-center w-full sm:w-auto flex-1 min-w-0">
          <button onClick={handleLeave} className="mr-2 p-1.5 hover:bg-rc-surface rounded-xl transition-colors text-rc-muted hover:text-rc-text shrink-0">
            <ArrowLeft size={20} />
          </button>
          
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            {/* Avatar */}
            <div className="relative shrink-0">
              {strangerData?.avatarUrl ? (
                <img src={typeof strangerData.avatarUrl === 'string' ? strangerData.avatarUrl.replace('.glb', '.png') : ''} alt="avatar" className="w-9 h-9 sm:w-10 sm:h-10 rounded-full ring-2 ring-rc-accent object-cover shadow-lg shrink-0" />
              ) : (
                <div className={`w-9 h-9 sm:w-10 sm:h-10 bg-gradient-to-br ${getGenderColor(strangerData?.gender)} rounded-full flex items-center justify-center shadow-lg shrink-0`}>
                  <span className="text-white font-bold text-base sm:text-lg">
                    {strangerData?.name ? strangerData.name.charAt(0).toUpperCase() : 'S'}
                  </span>
                </div>
              )}
              <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-500 border-2 border-rc-panel rounded-full shadow-glowSm"></div>
            </div>

            {/* Name & Badges */}
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-rc-text flex flex-wrap items-center gap-1.5 text-sm sm:text-base">
                <span className="truncate max-w-[80px] xs:max-w-[120px] sm:max-w-none">{strangerData?.name || 'Stranger'}</span>
                {(strangerData?.isPro || strangerData?.role === 'owner' || strangerData?.role === 'admin') && (
                  <span className="text-[8px] sm:text-[9px] px-1.5 py-0.5 rounded-full border uppercase tracking-wider font-bold text-amber-400 bg-amber-500/10 border-amber-500/20 shadow-glowSm flex items-center gap-0.5 shrink-0">
                    <Zap size={7} className="fill-amber-400" /> Pro
                  </span>
                )}
                {strangerData?.gender && !strangerData?.role && (
                  <span className={`text-[8px] sm:text-[9px] px-1.5 py-0.5 rounded-full border uppercase tracking-wider font-bold shrink-0 ${getGenderBadgeColor(strangerData.gender)}`}>
                    {strangerData.gender}
                  </span>
                )}
              </h2>
              {/* E2EE / Status text for Row 1 on mobile */}
              <div className="flex sm:hidden items-center text-[10px] mt-0.5">
                {isE2eeActive ? (
                  <span className="text-emerald-400 flex items-center gap-0.5 font-medium">
                    <Lock size={8} /> Encrypted
                  </span>
                ) : e2eeReady ? (
                  <span className="text-amber-400 flex items-center gap-0.5 font-medium">
                    <Lock size={8} /> Unencrypted
                  </span>
                ) : (
                  <span className="text-yellow-400 flex items-center gap-0.5 font-medium animate-pulse">
                    <Lock size={8} /> Setting up...
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Action buttons (rendered next to name on mobile) */}
          <div className="flex items-center gap-1 ml-auto sm:hidden shrink-0">
            <button onClick={handleStartCall} disabled={inCall || incomingCall}
              className="p-1.5 hover:bg-rc-surface rounded-xl transition-colors text-rc-muted hover:text-rc-accentGlow disabled:opacity-40">
              <Video size={18} />
            </button>
            <button onClick={() => setShowReportModal(true)} title="Report User"
              className="p-1.5 hover:bg-red-500/10 rounded-xl transition-colors text-rc-muted hover:text-red-400">
              <Flag size={16} />
            </button>
            <button onClick={handleSwap}
              className="text-[10px] bg-gradient-to-r from-rc-surface to-rc-bg border border-rc-border hover:border-rc-accent/50 px-2 py-1 rounded-xl text-rc-text transition-all font-semibold shadow-glowSm">
              Skip ➔
            </button>
          </div>
        </div>

        {/* Row 2: Tags list (Location, Interests, Mood, E2EE status).
            On mobile, it spans full width. On desktop, it resides next to the name. */}
        <div className="text-[10px] flex items-center gap-2 text-rc-muted overflow-x-auto hide-scrollbar flex-nowrap whitespace-nowrap w-full sm:w-auto py-0.5 select-none sm:ml-12">
          {strangerData?.location && (
            <span className="bg-blue-500/10 border border-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full text-[9px] shrink-0 whitespace-nowrap flex items-center gap-1 shadow-glowSm transition-all duration-300 hover:bg-blue-500/20">
              📍 {strangerData.location}
            </span>
          )}
          {strangerData?.interests && strangerData.interests.split(', ').map((interest, idx) => (
            <span key={idx} className="bg-rc-accent/10 border border-rc-accent/20 text-rc-accentGlow px-2.5 py-0.5 rounded-full text-[9px] shrink-0 whitespace-nowrap flex items-center gap-1 shadow-glowSm transition-all duration-300 hover:bg-rc-accent/20">
              ✨ {interest}
            </span>
          ))}
          {strangerData?.mood && (
            <span className="bg-violet-500/10 border border-violet-500/20 text-violet-300 px-2 py-0.5 rounded-full text-[9px] shrink-0 whitespace-nowrap flex items-center gap-1 shadow-glowSm transition-all duration-300 hover:bg-violet-500/20">
              {strangerData.mood === 'Chill' && '🍃 '}{strangerData.mood === 'Curious' && '🤔 '}{strangerData.mood === 'Funny' && '😂 '}{strangerData.mood === 'Deep talk' && '🌌 '}{strangerData.mood}
            </span>
          )}
          
          {/* Only render E2EE badge on desktop tags row since it's already on Row 1 on mobile */}
          <span className="hidden sm:inline-flex">
            {isE2eeActive ? (
              <span className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-2.5 py-0.5 rounded-full text-[9px] font-semibold shrink-0 whitespace-nowrap flex items-center gap-1 shadow-glowSm transition-all duration-300 animate-pulse-slow">
                <Lock size={9} /> Encrypted
              </span>
            ) : e2eeReady ? (
              <span className="bg-amber-500/10 border border-amber-500/20 text-amber-400 px-2.5 py-0.5 rounded-full text-[9px] font-semibold shrink-0 whitespace-nowrap flex items-center gap-1 shadow-glowSm">
                <Lock size={9} /> Unencrypted
              </span>
            ) : (
              <span className="bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 px-2.5 py-0.5 rounded-full text-[9px] font-semibold shrink-0 whitespace-nowrap flex items-center gap-1 shadow-glowSm animate-pulse">
                <Lock size={9} /> Setting up...
              </span>
            )}
          </span>
        </div>

        {/* Desktop Actions Row */}
        <div className="hidden sm:flex items-center gap-1 shrink-0 ml-auto">
          <button onClick={handleStartCall} disabled={inCall || incomingCall}
            className="p-2 mr-1 hover:bg-rc-surface rounded-xl transition-colors text-rc-muted hover:text-rc-accentGlow disabled:opacity-40">
            <Video size={20} />
          </button>
          <button onClick={() => setShowReportModal(true)} title="Report User"
            className="p-2 mr-1 hover:bg-red-500/10 rounded-xl transition-colors text-rc-muted hover:text-red-400">
            <Flag size={18} />
          </button>
          <button onClick={handleSwap}
            className="text-xs bg-gradient-to-r from-rc-surface to-rc-bg border border-rc-border hover:border-rc-accent/50 px-3 py-1.5 rounded-xl text-rc-text transition-all font-semibold shadow-glowSm flex items-center gap-1">
            Skip ➔
          </button>
        </div>
      </header>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 relative z-10">
        {/* Top spacer to ensure reaction menus on the first message are never clipped at the top of scroll view */}
        <div className="h-8 shrink-0"></div>
        <div className="text-center my-4">
          <span className="text-xs text-rc-muted bg-rc-surface/60 border border-rc-border py-1 px-4 rounded-full">
            You are now chatting with a stranger
          </span>
        </div>

        {isE2eeActive && (
          <div className="text-center my-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400/80 bg-emerald-500/8 border border-emerald-500/15 px-3 py-1 rounded-full">
              <Lock size={9} /> Messages are end-to-end encrypted
            </span>
          </div>
        )}

        {e2eeReady && !isE2eeActive && (
          <div className="text-center my-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-400/80 bg-amber-500/8 border border-amber-500/15 px-3 py-1 rounded-full">
              <Lock size={9} /> Messages are not encrypted in this session
            </span>
          </div>
        )}

        {messages.map(msg => (
          <MessageBubble 
            key={msg.id} 
            message={msg} 
            isOwnMessage={msg.senderId === currentUserId} 
            chatId={chatId!} 
            strangerName={strangerData?.name || 'Stranger'}
            onReply={setReplyingTo}
            currentUserId={currentUserId || ''}
          />
        ))}
        {peerTyping && (
          <div className="flex justify-start">
            <div className="px-4 py-2 bg-rc-panel border border-rc-border rounded-2xl rounded-bl-sm flex items-center gap-1.5 shadow-sm w-fit mt-2">
              <span className="w-1.5 h-1.5 bg-rc-muted rounded-full animate-bounce"></span>
              <span className="w-1.5 h-1.5 bg-rc-muted rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
              <span className="w-1.5 h-1.5 bg-rc-muted rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply Preview Bar */}
      {replyingTo && (
        <div className="mx-4 mb-2 bg-rc-panel/85 border border-rc-accent/30 rounded-xl p-3 flex items-center justify-between shadow-glowSm animate-fade-in z-10 backdrop-blur-md">
          <div className="flex items-start gap-2.5 border-l-2 border-rc-accent pl-3 overflow-hidden">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-rc-accentGlow uppercase tracking-wider">
                Replying to {replyingTo.senderId === currentUserId ? 'yourself' : (strangerData?.name || 'stranger')}
              </p>
              <p className="text-xs text-rc-muted truncate mt-0.5">{replyingTo.text}</p>
            </div>
          </div>
          <button 
            onClick={() => setReplyingTo(null)} 
            className="p-1.5 hover:bg-rc-surface rounded-full text-rc-muted hover:text-rc-text transition-colors cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Input — always enabled; send button shows spinner while E2EE is pending */}
      <ChatInput onSendMessage={handleSendMessage} disabled={false} e2eePending={!e2eeReady} onTyping={handleTyping} hasActiveReply={!!replyingTo} />
    </div>
  )
}
