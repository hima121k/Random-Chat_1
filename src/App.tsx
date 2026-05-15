import { Routes, Route, useLocation } from 'react-router-dom'
import { Suspense, lazy, useState, useEffect } from 'react'
import { Navbar } from './components/Navigation/Navbar'
import { Footer } from './components/Navigation/Footer'
import { RoleRoute } from './components/Navigation/RoleRoute'
import { subscribeToAnnouncement } from './services/admin'
import { Volume2 } from 'lucide-react'

const Home = lazy(() => import('./pages/Home'))
const Chat = lazy(() => import('./pages/Chat'))
const Pricing = lazy(() => import('./pages/Pricing'))
const Terms = lazy(() => import('./pages/Terms'))
const Privacy = lazy(() => import('./pages/Privacy'))
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'))

function App() {
  const isEnvConfigured = !!import.meta.env.VITE_FIREBASE_API_KEY;
  const location = useLocation();
  const isChatRoute = location.pathname.startsWith('/chat');
  const [announcement, setAnnouncement] = useState<string | null>(null);

  useEffect(() => {
    if (!isEnvConfigured) return;
    const unsub = subscribeToAnnouncement((msg) => {
      setAnnouncement(msg);
    });
    return () => unsub();
  }, [isEnvConfigured]);

  if (!isEnvConfigured) {
    return (
      <div className="min-h-screen bg-rc-bg text-rc-text font-sans flex items-center justify-center p-4">
        <div className="bg-rc-surface p-8 rounded-2xl max-w-md w-full shadow-2xl border border-red-500/30 text-center">
          <div className="bg-red-500/20 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-rc-text mb-2">Configuration Missing</h2>
          <p className="text-rc-muted mb-6">
            The Firebase environment variables are missing. Please configure your <code className="bg-black/30 px-2 py-1 rounded text-rc-text">.env</code> file with your Firebase project credentials to continue.
          </p>
          <div className="bg-black/20 rounded-lg p-4 text-left text-sm font-mono text-rc-muted mb-6">
            <p>VITE_FIREBASE_API_KEY=</p>
            <p>VITE_FIREBASE_AUTH_DOMAIN=</p>
            <p>VITE_FIREBASE_PROJECT_ID=</p>
            <p>VITE_FIREBASE_STORAGE_BUCKET=</p>
          </div>
          <p className="text-xs text-rc-muted">
            Once configured, restart your development server.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-rc-bg text-rc-text font-sans flex flex-col">
      <Navbar />
      {announcement && (
        <div className="bg-gradient-to-r from-amber-500/20 to-orange-500/20 border-b border-amber-500/30 px-4 py-3 flex items-center justify-center gap-3">
          <Volume2 className="text-amber-400" size={18} />
          <p className="text-sm font-medium text-amber-200">
            {announcement}
          </p>
        </div>
      )}
      <main className="flex-1 flex flex-col">
        <Suspense fallback={<div className="flex items-center justify-center flex-1"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-rc-accent"></div></div>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/chat/:chatId" element={<Chat />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/admin" element={
              <RoleRoute allowedRoles={['admin', 'owner']}>
                <AdminDashboard />
              </RoleRoute>
            } />
          </Routes>
        </Suspense>
      </main>
      {!isChatRoute && <Footer />}
    </div>
  )
}

export default App
