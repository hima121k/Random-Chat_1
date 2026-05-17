import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Zap, Phone, Sparkles, Shield, Lock, Star } from 'lucide-react'
import { loginWithGoogle, signInWithEmail, createEmailAccount, sendPhoneOTP, auth as _auth } from '../lib/firebase'
import type { Auth } from 'firebase/auth'
const auth = _auth as Auth
import { MatchingService } from '../components/Matching/MatchingService'
import { LocalAvatarCreator } from '../components/Avatar/LocalAvatarCreator'
import { onAuthStateChanged, type User, signOut, type ConfirmationResult, linkWithCredential, PhoneAuthProvider } from 'firebase/auth'
import { getUserRole, submitBanAppeal, subscribeToUserSubscription, type UserSubscription, syncUserProfile } from '../services/admin'

type AuthMode = 'login' | 'signup-email' | 'signup-phone' | 'signup-otp'

export default function Home() {
  const [isMatching, setIsMatching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState(() => localStorage.getItem('chat_name') || '')
  const [gender, setGender] = useState(() => localStorage.getItem('chat_gender') || 'male')
  const [age, setAge] = useState(() => localStorage.getItem('chat_age') || '18')
  const [avatarUrl, setAvatarUrl] = useState(() => localStorage.getItem('chat_avatar') || '')
  const [showAvatarCreator, setShowAvatarCreator] = useState(false)
  const [currentUser, setCurrentUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [requiresPhoneVerification, setRequiresPhoneVerification] = useState(false)
  const [isBanned, setIsBanned] = useState<string | null>(null)
  const [appealMsg, setAppealMsg] = useState('')
  const [appealSent, setAppealSent] = useState(false)
  const [appealError, setAppealError] = useState('')
  const [isAppealing, setIsAppealing] = useState(false)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [countryCode, setCountryCode] = useState('+91')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null)
  const [subscription, setSubscription] = useState<UserSubscription>({ isPro: false })
  const [matchGender, setMatchGender] = useState(() => localStorage.getItem('chat_match_gender') || 'any')

  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    let activeSubUnsub: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      
      // Clean up previous subscription listener if it exists
      if (activeSubUnsub) {
        activeSubUnsub();
        activeSubUnsub = null;
      }

      if (user) {
        // Step 1: Check providers for phone verification requirement
        const providers = user.providerData.map(p => p.providerId);
        const hasEmailAuth = providers.includes('password');
        const hasPhoneAuth = providers.includes('phone');
        
        if (hasEmailAuth && !hasPhoneAuth) {
          setRequiresPhoneVerification(true);
          setAuthMode('signup-phone');
        } else {
          setRequiresPhoneVerification(false);
        }

        // Step 2: Handle roles and subscriptions
        try {
          const role = await getUserRole(user.email);
          const isPro = role === 'owner' || role === 'admin';
          
          // Sync profile to Firestore so admins can find them by email
          // and so strangers can see their badges
          syncUserProfile(user, role, isPro);

          // Staff get Pro status immediately without waiting for Firestore
          if (role === 'owner' || role === 'admin') {
            setSubscription({ isPro: true, status: 'Permanent (Staff)' });
          }

          // Start Firestore subscription listener
          activeSubUnsub = subscribeToUserSubscription(user.uid, (sub) => {
            // Only update via Firestore if the user is NOT staff
            // (Staff status is managed locally to ensure it stays permanent)
            if (role !== 'owner' && role !== 'admin') {
              setSubscription(sub);
            }
          });
        } catch (err) {
          console.error("Role check failed:", err);
          // Fallback to normal subscription listener if role check fails
          activeSubUnsub = subscribeToUserSubscription(user.uid, setSubscription);
        }
      } else {
        setRequiresPhoneVerification(false);
        setSubscription({ isPro: false });
      }
    });

    return () => {
      unsubAuth();
      if (activeSubUnsub) activeSubUnsub();
    };
  }, []);

  const clearErrors = () => setError(null)

  const handleGoogleSignIn = async () => {
    setIsLoading(true); clearErrors()
    try { await loginWithGoogle() }
    catch { setError('Google sign-in failed. Please try again.') }
    finally { setIsLoading(false) }
  }

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password.trim()) { setError('Please fill in all fields.'); return }
    setIsLoading(true); clearErrors()
    try {
      await signInWithEmail(email.trim(), password)
    } catch (err: unknown) {
      const code = (err as { code?: string }).code
      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
        setError('Incorrect email or password.')
      } else {
        setError('Sign-in failed. Please try again.')
      }
    } finally { setIsLoading(false) }
  }

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) { setError('Please enter your email.'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    setIsLoading(true); clearErrors()
    setRequiresPhoneVerification(true)
    try {
      await createEmailAccount(email.trim(), password)
      setAuthMode('signup-phone')
    } catch (err: unknown) {
      setRequiresPhoneVerification(false)
      const code = (err as { code?: string }).code
      if (code === 'auth/email-already-in-use') setError('This email is already registered. Please sign in.')
      else setError('Failed to create account. Try again.')
    } finally { setIsLoading(false) }
  }

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault()
    const digits = phone.replace(/\s/g, '').replace(/^0+/, '')
    if (!digits) { setError('Please enter your phone number.'); return }
    const fullPhone = countryCode + digits
    setIsLoading(true); clearErrors()
    try {
      const result = await sendPhoneOTP(fullPhone)
      setConfirmationResult(result)
      setAuthMode('signup-otp')
    } catch (err: unknown) {
      const code = (err as { code?: string }).code
      if (code === 'auth/invalid-phone-number') setError('Invalid phone number. Check and try again.')
      else if (code === 'auth/too-many-requests') setError('Too many attempts. Wait a few minutes.')
      else if (code === 'auth/operation-not-allowed') setError('Phone auth not enabled in Firebase Console.')
      else setError('Failed to send OTP. Please try again.')
    } finally { setIsLoading(false) }
  }

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!otp || otp.length < 4) { setError('Please enter the OTP.'); return }
    if (!confirmationResult || !auth.currentUser) return
    setIsLoading(true); clearErrors()
    try {
      const credential = PhoneAuthProvider.credential(confirmationResult.verificationId, otp.trim())
      await linkWithCredential(auth.currentUser, credential)
      setRequiresPhoneVerification(false)
      setAuthMode('login')
    } catch (err: unknown) {
      const code = (err as { code?: string }).code
      if (code === 'auth/invalid-verification-code') setError('Incorrect OTP. Check and try again.')
      else if (code === 'auth/provider-already-linked') {
        setRequiresPhoneVerification(false)
        setAuthMode('login')
      } else {
        setError('Verification failed. Please try again.')
      }
    } finally { setIsLoading(false) }
  }

  const handleSignOut = async () => {
    await signOut(auth)
    setAuthMode('login')
    setRequiresPhoneVerification(false)
    setIsBanned(null)
    setEmail(''); setPassword(''); setPhone(''); setOtp('')
    clearErrors()
  }

  // Fix 1: track whether we successfully matched so leaveQueue is never called
  // after a successful navigation to a chat room.
  const matchedRef = useRef(false)

  const handleStart = useCallback(async () => {
    if (!name.trim()) { setError('Please enter a nickname.'); return }
    const ageNum = parseInt(age, 10)
    if (isNaN(ageNum) || ageNum < 13 || ageNum > 99) { setError('Please enter a valid age (13–99).'); return }
    if (!currentUser) { setError('Please sign in first.'); return }

    matchedRef.current = false  // Fix 1: reset on every new start attempt
    localStorage.setItem('chat_name', name.trim())
    localStorage.setItem('chat_gender', gender)
    localStorage.setItem('chat_age', age)
    if (avatarUrl) localStorage.setItem('chat_avatar', avatarUrl)
    setError(null); setIsMatching(true)

    try {
      const userRole = await getUserRole(currentUser.email)
      localStorage.setItem('chat_match_gender', matchGender)
      await MatchingService.findMatch(currentUser.uid, { 
        name: name.trim(), 
        gender, 
        age: ageNum, 
        avatarUrl, 
        role: userRole,
        matchGender,
        isPro: subscription.isPro 
      }, (chatId) => {
        matchedRef.current = true  // Fix 1: mark as matched before navigating
        setIsMatching(false)
        sessionStorage.setItem('active_chat_id', chatId)
        navigate(`/chat/${chatId}`)
      })
    } catch (err) {
      const msg = (err as Error).message || ''
      if (msg.startsWith('BANNED:')) {
        // Double-check: owners and admins can never be locked out
        const role = await getUserRole(currentUser.email)
        if (role === 'owner' || role === 'admin') {
          setError('Warning: Your UID is in the ban list but your role protects you. Visit /admin → Banned Users to remove it.'); setIsMatching(false)
        } else {
          setIsBanned(msg.replace('BANNED: ', '')); setIsMatching(false)
        }
      } else {
        setError(msg || 'Failed to connect.'); setIsMatching(false)
      }
    }
  }, [name, gender, age, avatarUrl, navigate, currentUser, matchGender, subscription.isPro])

  useEffect(() => {
    // Fix 1: only leave the queue on unmount if we never found a match
    return () => {
      if (isMatching && currentUser && !matchedRef.current) {
        MatchingService.leaveQueue(currentUser.uid)
      }
    }
  }, [isMatching, currentUser])

  useEffect(() => {
    if (location.state?.autoStart && name.trim()) {
      navigate('/', { replace: true, state: {} })
      handleStart()
    }
  }, [location.state, navigate, handleStart, name])

  const handleCancel = async () => {
    setIsMatching(false)
    if (currentUser) await MatchingService.leaveQueue(currentUser.uid)
  }


  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 relative overflow-hidden">

      {/* Decorative orbs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-rc-accent/20 rounded-full blur-3xl animate-pulse-slow" />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-indigo-700/15 rounded-full blur-3xl animate-pulse-slow" style={{ animationDelay: '1.5s' }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-violet-900/10 rounded-full blur-2xl" />
      </div>

      {/* Header */}
      <div className="text-center mb-10 z-10">
        <div className="flex justify-center mb-5">
          <div className="relative">
            <div className="absolute inset-0 bg-rc-accent rounded-2xl blur-lg opacity-60 animate-pulse-slow" />
            <div className="relative bg-gradient-to-br from-rc-accent to-indigo-600 p-4 rounded-2xl shadow-glow">
              <Zap size={44} className="text-white" strokeWidth={2.5} />
            </div>
          </div>
        </div>
        <h1 className="text-5xl font-extrabold mb-2 bg-gradient-to-r from-rc-accentGlow via-violet-300 to-indigo-300 bg-clip-text text-transparent tracking-tight">
          RandomChat
        </h1>
        <p className="text-rc-muted text-base max-w-sm mx-auto leading-relaxed">
          Connect instantly with strangers. Private, encrypted &amp; lightning fast.
        </p>
        <div className="flex items-center justify-center gap-4 mt-4 text-xs text-rc-dimmed">
          <span className="flex items-center gap-1"><Lock size={10} className="text-rc-accentGlow" /> End-to-end encrypted</span>
          <span className="w-px h-3 bg-rc-border" />
          <span className="flex items-center gap-1"><Shield size={10} className="text-rc-accentGlow" /> Anonymous</span>
          <span className="w-px h-3 bg-rc-border" />
          <span className="flex items-center gap-1"><Sparkles size={10} className="text-rc-accentGlow" /> Instant match</span>
        </div>
      </div>

      {/* ── BANNED SCREEN ── */}
      {isBanned ? (
        <div className="card p-8 w-full max-w-md text-center space-y-4 z-10 border-red-500/30">
          <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto">
            <span className="text-5xl">🚫</span>
          </div>
          <h2 className="text-red-400 font-bold text-2xl">Account Suspended</h2>
          <p className="text-red-300/80 text-sm leading-relaxed px-4">
            {isBanned}
          </p>

          {appealSent ? (
            <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4">
              <p className="text-green-400 font-semibold text-sm">✅ Appeal submitted!</p>
              <p className="text-green-400/70 text-xs mt-1">Our team will review your request shortly.</p>
            </div>
          ) : (
            <div className="text-left space-y-3">
              <p className="text-rc-muted text-xs text-center">Believe this is a mistake? Submit an appeal below.</p>
              <textarea
                value={appealMsg}
                onChange={e => { setAppealMsg(e.target.value); setAppealError('') }}
                placeholder="Explain why your account should be reinstated..."
                maxLength={500}
                className="w-full bg-rc-bg border border-rc-border rounded-xl p-3 text-sm text-white outline-none focus:border-red-500/50 resize-none min-h-[80px]"
              />
              {appealError && <p className="text-red-400 text-xs">{appealError}</p>}
              <button
                onClick={async () => {
                  if (!appealMsg.trim() || !currentUser) return
                  setIsAppealing(true); setAppealError('')
                  try {
                    await submitBanAppeal(
                      currentUser.uid,
                      currentUser.email || '',
                      currentUser.displayName || 'Unknown',
                      'Account Suspended',
                      appealMsg.trim()
                    )
                    setAppealSent(true)
                  } catch (e: any) {
                    const msg = e?.message || ''
                    if (msg.startsWith('APPEAL_EXISTS:')) setAppealError('You already have a pending appeal.')
                    else setAppealError('Failed to submit. Please try again.')
                  } finally { setIsAppealing(false) }
                }}
                disabled={!appealMsg.trim() || isAppealing}
                className="w-full py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/40 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {isAppealing ? 'Submitting...' : 'Submit Appeal'}
              </button>
            </div>
          )}

          <button onClick={handleSignOut}
            className="mt-2 px-6 py-2 bg-rc-surface hover:bg-rc-bg text-rc-muted border border-rc-border rounded-xl text-sm transition-colors">
            Sign Out
          </button>
        </div>

      ) : (!currentUser || requiresPhoneVerification) ? (
        /* ── AUTH CARD ── */
        <div className="card p-7 w-full max-w-md space-y-5 z-10">

          {/* LOGIN */}
          {authMode === 'login' && (
            <>
              <div className="text-center">
                <p className="text-rc-text font-bold text-xl">Welcome back</p>
                <p className="text-rc-muted text-sm mt-1">Sign in to start chatting</p>
              </div>

              <button onClick={handleGoogleSignIn} disabled={isLoading}
                className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-50 text-gray-800 font-semibold py-3 rounded-xl shadow-lg transition-all disabled:opacity-60 text-sm">
                <svg width="18" height="18" viewBox="0 0 48 48">
                  <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 33.7 29.2 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l5.7-5.7C34.4 5.1 29.5 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21c10.5 0 20-7.6 20-21 0-1.3-.2-2.7-.4-4z"/>
                  <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.1 18.9 12 24 12c3.1 0 5.9 1.1 8.1 2.9l5.7-5.7C34.4 5.1 29.5 3 24 3c-7.6 0-14.2 4.1-17.7 10.2z"/>
                  <path fill="#4CAF50" d="M24 45c5.3 0 10.1-1.9 13.8-5.1l-6.4-5.4C29.5 36.3 26.9 37 24 37c-5.2 0-9.6-3.4-11.3-8H6l-1 .4C8.5 40.5 15.7 45 24 45z"/>
                  <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.8 2.4-2.3 4.4-4.3 5.8l6.4 5.4C41.3 35.7 44 30.3 44 24c0-1.3-.2-2.7-.4-4z"/>
                </svg>
                Continue with Google
              </button>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-rc-border" />
                <span className="text-rc-muted text-xs">or sign in with email</span>
                <div className="flex-1 h-px bg-rc-border" />
              </div>

              <form onSubmit={handleEmailLogin} className="space-y-3">
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="Email address" required className="input-field" />
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="Password" required className="input-field" />
                <button type="submit" disabled={isLoading} className="btn-primary w-full py-3 text-sm">
                  {isLoading ? 'Signing in…' : 'Sign In →'}
                </button>
              </form>

              <p className="text-center text-sm text-rc-muted">
                New here?{' '}
                <button onClick={() => { setAuthMode('signup-email'); clearErrors() }}
                  className="text-rc-accentGlow hover:underline font-medium">
                  Create account
                </button>
              </p>
            </>
          )}

          {/* SIGN UP STEP 1 */}
          {authMode === 'signup-email' && (
            <>
              <div className="flex items-center gap-2">
                <StepDot n={1} active done={false} />
                <StepBar filled={false} />
                <StepDot n={2} active={false} done={false} />
                <StepBar filled={false} />
                <StepDot n={3} active={false} done={false} />
              </div>
              <div>
                <p className="text-rc-text font-bold text-lg">Create Account</p>
                <p className="text-rc-muted text-sm">Step 1 — Set your email &amp; password</p>
              </div>
              <form onSubmit={handleCreateAccount} className="space-y-3">
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="Your email address" required className="input-field" />
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="Password (min 6 chars)" required className="input-field" />
                <button type="submit" disabled={isLoading} className="btn-primary w-full py-3 text-sm">
                  {isLoading ? 'Creating…' : 'Next: Verify Phone →'}
                </button>
              </form>
              <button onClick={() => { setAuthMode('login'); clearErrors() }}
                className="w-full text-center text-sm text-rc-muted hover:text-rc-text underline">
                ← Back to Sign In
              </button>
            </>
          )}

          {/* SIGN UP STEP 2 */}
          {authMode === 'signup-phone' && (
            <>
              <div className="flex items-center gap-2">
                <StepDot n="✓" active={false} done />
                <StepBar filled />
                <StepDot n={2} active done={false} />
                <StepBar filled={false} />
                <StepDot n={3} active={false} done={false} />
              </div>
              <div>
                <p className="text-rc-text font-bold text-lg">Verify Phone</p>
                <p className="text-rc-muted text-sm">Step 2 — One-time phone verification</p>
              </div>
              <form onSubmit={handleSendOTP} className="space-y-3">
                <div className="flex gap-2">
                  <select value={countryCode} onChange={e => setCountryCode(e.target.value)}
                    className="bg-rc-bg/80 border border-rc-border text-rc-text rounded-xl px-3 py-3 outline-none focus:border-rc-accent focus:ring-1 focus:ring-rc-accent/40 text-sm">
                    {['+91 🇮🇳','+1 🇺🇸','+44 🇬🇧','+971 🇦🇪','+92 🇵🇰','+880 🇧🇩','+977 🇳🇵','+65 🇸🇬','+61 🇦🇺','+49 🇩🇪','+33 🇫🇷','+86 🇨🇳'].map(opt => {
                      const [code] = opt.split(' ')
                      return <option key={code} value={code}>{opt}</option>
                    })}
                  </select>
                  <div className="flex-1 flex items-center bg-rc-bg/80 border border-rc-border rounded-xl px-4 py-3 gap-2 focus-within:border-rc-accent transition-colors">
                    <Phone size={15} className="text-rc-muted shrink-0" />
                    <input type="tel" value={phone} onChange={e => setPhone(e.target.value.replace(/[^0-9\s]/g, ''))}
                      placeholder="98765 43210" required
                      className="flex-1 bg-transparent text-rc-text outline-none placeholder-rc-muted text-sm" />
                  </div>
                </div>
                <button type="submit" disabled={isLoading} className="btn-primary w-full py-3 text-sm">
                  {isLoading ? 'Sending OTP…' : 'Send OTP →'}
                </button>
              </form>
            </>
          )}

          {/* SIGN UP STEP 3 */}
          {authMode === 'signup-otp' && (
            <>
              <div className="flex items-center gap-2">
                <StepDot n="✓" active={false} done />
                <StepBar filled />
                <StepDot n="✓" active={false} done />
                <StepBar filled={false} />
                <StepDot n={3} active done={false} />
              </div>
              <div>
                <p className="text-rc-text font-bold text-lg">Enter OTP</p>
                <p className="text-rc-muted text-sm">
                  Code sent to <span className="text-rc-text font-medium">{countryCode}{phone}</span>
                </p>
              </div>
              <form onSubmit={handleVerifyOTP} className="space-y-3">
                <input type="number" value={otp} onChange={e => setOtp(e.target.value)}
                  placeholder="• • • • • •" maxLength={6} required
                  className="input-field text-center text-3xl tracking-[0.5em] font-bold border-rc-accent/50 focus:border-rc-accent" />
                <button type="submit" disabled={isLoading} className="btn-primary w-full py-3 text-sm">
                  {isLoading ? 'Verifying…' : '✓ Verify & Finish'}
                </button>
              </form>
              <button onClick={() => { setAuthMode('signup-phone'); setOtp(''); clearErrors() }}
                className="w-full text-center text-sm text-rc-muted hover:text-rc-text underline">
                ← Change phone number
              </button>
            </>
          )}

          {error && (
            <div className="text-red-400 bg-red-400/10 border border-red-400/20 px-4 py-2.5 rounded-xl text-sm text-center">
              {error}
            </div>
          )}
        </div>

      ) : !isMatching ? (
        /* ── CHAT SETUP ── */
        <div className="card p-7 w-full max-w-md space-y-6 z-10">


          {/* Avatar Creation CTA */}
          <div className="bg-gradient-to-r from-rc-accent/10 to-indigo-500/10 border border-rc-accent/20 rounded-xl p-4 flex items-center justify-between shadow-glowSm">
            <div className="flex items-center gap-4">
              {avatarUrl ? (
                <img src={avatarUrl.replace('.glb', '.png')} alt="avatar" className="w-12 h-12 rounded-full ring-2 ring-rc-accent shadow-glowSm object-cover" />
              ) : (
                <div className="w-12 h-12 rounded-full bg-rc-surface border border-rc-border flex items-center justify-center">
                  <Sparkles size={20} className="text-rc-accentGlow" />
                </div>
              )}
              <div>
                <p className="text-sm font-semibold text-rc-text">
                  Custom Avatar
                </p>
                <p className="text-xs text-rc-muted mt-0.5">Stand out with a unique identity</p>
              </div>
            </div>
            <button 
              onClick={() => setShowAvatarCreator(true)}
              className="text-xs px-4 py-2 bg-rc-surface border border-rc-border rounded-lg text-rc-text hover:border-rc-accent/50 hover:bg-rc-accent/10 transition-all font-medium shrink-0"
            >
              {avatarUrl ? 'Edit Avatar' : 'Create Now'}
            </button>
          </div>

          {/* Nickname + Age */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-rc-muted mb-2 uppercase tracking-wider">Nickname</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="Your nickname" maxLength={20} className="input-field" />
            </div>
            <div className="w-24">
              <label className="block text-xs font-semibold text-rc-muted mb-2 uppercase tracking-wider">Age</label>
              <input type="number" value={age} onChange={e => setAge(e.target.value)}
                placeholder="18" min={13} max={99} className="input-field" />
            </div>
          </div>

          {/* Gender */}
          <div>
            <label className="block text-xs font-semibold text-rc-muted mb-2 uppercase tracking-wider">I am a</label>
            <div className="flex gap-3">
              {[
                { val: 'male',   label: '♂ Male',   active: 'bg-blue-500/20 border-blue-500/60 text-blue-400' },
                { val: 'female', label: '♀ Female', active: 'bg-pink-500/20 border-pink-500/60 text-pink-400' },
                { val: 'other',  label: '⚡ Other',  active: 'bg-rc-accent/20 border-rc-accent/60 text-rc-accentGlow' },
              ].map(({ val, label, active }) => (
                <label key={val} className={`flex-1 text-center py-3 rounded-xl cursor-pointer border text-sm font-medium transition-all ${
                  gender === val ? active : 'bg-rc-bg/60 border-rc-border text-rc-muted hover:border-rc-border/80'
                }`}>
                  <input type="radio" name="gender" value={val} checked={gender === val}
                    onChange={e => setGender(e.target.value)} className="hidden" />
                  {label}
                </label>
              ))}
            </div>
          </div>
          
          {/* Match Gender (Pro Feature) */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-semibold text-rc-muted uppercase tracking-wider">Match with</label>
              {!subscription.isPro && (
                <div onClick={() => navigate('/pricing')} className="flex items-center gap-1 text-[10px] font-bold text-amber-400 cursor-pointer hover:text-amber-300 transition-colors uppercase tracking-widest bg-amber-400/10 px-2 py-0.5 rounded-full">
                  <Star size={10} className="fill-amber-400" />
                  Pro Feature
                </div>
              )}
            </div>
            <div className={`flex gap-3 ${!subscription.isPro ? 'opacity-60 grayscale' : ''}`}>
              {[
                { val: 'any',    label: '∞ Any',    active: 'bg-rc-accent/20 border-rc-accent/60 text-rc-accentGlow' },
                { val: 'male',   label: '♂ Male',   active: 'bg-blue-500/20 border-blue-500/60 text-blue-400' },
                { val: 'female', label: '♀ Female', active: 'bg-pink-500/20 border-pink-500/60 text-pink-400' },
              ].map(({ val, label, active }) => (
                <label key={val} className={`flex-1 text-center py-3 rounded-xl cursor-pointer border text-sm font-medium transition-all ${
                  matchGender === val ? active : 'bg-rc-bg/60 border-rc-border text-rc-muted hover:border-rc-border/80'
                } ${!subscription.isPro && val !== 'any' ? 'cursor-not-allowed pointer-events-none' : ''}`}>
                  <input type="radio" name="matchGender" value={val} checked={matchGender === val}
                    onChange={e => {
                      if (!subscription.isPro && e.target.value !== 'any') return;
                      setMatchGender(e.target.value)
                    }} className="hidden" />
                  {label}
                </label>
              ))}
            </div>
            {!subscription.isPro && (
              <p className="text-[10px] text-rc-muted mt-2 italic text-center">Upgrade to Pro to filter matches by gender</p>
            )}
          </div>

          <button onClick={handleStart} disabled={!name.trim()}
            className="btn-primary w-full py-4 text-base font-bold tracking-wide flex items-center justify-center gap-2">
            <Zap size={18} strokeWidth={2.5} />
            Start Chatting
          </button>

          {error && (
            <div className="text-red-400 bg-red-400/10 border border-red-400/20 px-4 py-2.5 rounded-xl text-sm text-center">
              {error}
            </div>
          )}
        </div>

      ) : (
        /* ── MATCHING SPINNER ── */
        <div className="flex flex-col items-center space-y-5 z-10">
          <div className="relative">
            <div className="absolute inset-0 bg-rc-accent/30 rounded-full animate-ping" />
            <div className="absolute inset-2 bg-rc-accent/20 rounded-full animate-ping" style={{ animationDelay: '0.2s' }} />
            <div className="relative bg-gradient-to-br from-rc-accent to-indigo-600 p-5 rounded-full shadow-glow">
              <Zap size={32} className="text-white animate-pulse" strokeWidth={2.5} />
              {subscription.isPro && (
                <div className="absolute -top-1 -right-1 bg-gradient-to-br from-amber-300 to-amber-500 p-1.5 rounded-full border-2 border-rc-bg shadow-glow">
                  <Star size={14} className="text-rc-bg fill-rc-bg" />
                </div>
              )}
            </div>
          </div>
          <div className="text-center">
            <p className="text-rc-text font-semibold text-lg">Finding your match…</p>
            <p className="text-rc-muted text-sm mt-1">This usually takes just a few seconds</p>
          </div>
          <button onClick={handleCancel} className="text-rc-muted hover:text-rc-text underline text-sm transition-colors">
            Cancel
          </button>
        </div>
      )}

      {/* Avatar Creator Modal */}
      {showAvatarCreator && (
        <LocalAvatarCreator 
          onClose={() => setShowAvatarCreator(false)} 
          onAvatarExported={(url) => {
            setAvatarUrl(url);
            localStorage.setItem('chat_avatar', url);
            setShowAvatarCreator(false);
          }} 
        />
      )}
    </div>
  )
}

// ── Step progress indicator ──────────────────────────────────────
const StepDot = ({ n, active, done }: { n: number | string; active: boolean; done: boolean }) => (
  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm transition-all ${
    done    ? 'bg-rc-accent text-white shadow-glowSm' :
    active  ? 'bg-rc-accent/30 text-rc-accentGlow border border-rc-accent' :
              'bg-rc-surface text-rc-muted border border-rc-border'
  }`}>{n}</div>
)
const StepBar = ({ filled }: { filled: boolean }) => (
  <div className="flex-1 h-0.5 bg-rc-border rounded overflow-hidden">
    <div className={`h-full bg-rc-accent rounded transition-all duration-500 ${filled ? 'w-full' : 'w-0'}`} />
  </div>
)
