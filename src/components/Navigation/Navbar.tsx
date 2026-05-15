import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Zap, LogOut } from 'lucide-react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { auth as _auth } from '../../lib/firebase';
import type { Auth } from 'firebase/auth';
import { getUserRole, type Role, subscribeToUserSubscription, type UserSubscription } from '../../services/admin';
import { Shield, Star } from 'lucide-react';

const auth = _auth as Auth;

export function Navbar() {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role>('user');
  const [subscription, setSubscription] = useState<UserSubscription>({ isPro: false });
  const [avatarUrl, setAvatarUrl] = useState(() => localStorage.getItem('chat_avatar') || '');
  const navigate = useNavigate();

  useEffect(() => {
    let unsubSub = () => {};
    const unsub = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        const userRole = await getUserRole(currentUser.email);
        setRole(userRole);
        
        // Staff get Pro status immediately
        if (userRole === 'owner' || userRole === 'admin') {
          setSubscription({ isPro: true, status: 'Permanent (Staff)' });
        }

        unsubSub = subscribeToUserSubscription(currentUser.uid, (sub) => {
          // Only update if not staff (to prevent staff from losing pro if doc data is wrong)
          if (userRole !== 'owner' && userRole !== 'admin') {
            setSubscription(sub);
          }
        });
      } else {
        setRole('user');
        setSubscription({ isPro: false });
        unsubSub();
      }
    });

    const handleStorageChange = () => {
      setAvatarUrl(localStorage.getItem('chat_avatar') || '');
    };
    window.addEventListener('storage', handleStorageChange);
    
    const handleAvatarUpdate = () => {
      setAvatarUrl(localStorage.getItem('chat_avatar') || '');
    };
    window.addEventListener('avatar_updated', handleAvatarUpdate);

    return () => {
      unsub();
      unsubSub();
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('avatar_updated', handleAvatarUpdate);
    };
  }, []);

  const handleSignOut = async () => {
    if (auth) {
      await signOut(auth);
      navigate('/');
    }
  };

  return (
    <nav className="sticky top-0 z-50 bg-rc-bg/80 backdrop-blur-md border-b border-rc-border">
      <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 group">
          <div className="bg-gradient-to-br from-rc-accent to-indigo-600 p-1.5 rounded-lg shadow-glowSm group-hover:shadow-glow transition-all">
            <Zap size={20} className="text-white" strokeWidth={2.5} />
          </div>
          <span className="text-xl font-bold bg-gradient-to-r from-rc-text to-rc-muted bg-clip-text text-transparent group-hover:to-rc-text transition-all">
            RandomChat
          </span>
        </Link>

        {user && (
          <div className="flex items-center gap-4">
            {!subscription.isPro && (
              <Link to="/pricing" className="hidden md:flex items-center gap-1.5 px-3 py-1.5 bg-rc-accent/10 hover:bg-rc-accent/20 border border-rc-accent/30 rounded-lg text-xs font-bold text-rc-accentGlow transition-all">
                <Star size={14} className="fill-rc-accentGlow" />
                Upgrade
              </Link>
            )}

            <div className="flex items-center gap-2">
              <div className="relative">
                {avatarUrl ? (
                  <img src={avatarUrl} alt="avatar" className="w-8 h-8 rounded-full ring-2 ring-rc-accent object-cover" />
                ) : user.photoURL ? (
                  <img src={user.photoURL} alt="avatar" className="w-8 h-8 rounded-full ring-2 ring-rc-accent/40 object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-rc-accent to-indigo-600 flex items-center justify-center text-white font-bold text-xs">
                    {(user.displayName || user.email || 'U')[0].toUpperCase()}
                  </div>
                )}
                {subscription.isPro && (
                  <div className="absolute -top-1 -right-1 w-4 h-4 bg-gradient-to-br from-amber-300 to-amber-500 rounded-full border-2 border-rc-bg flex items-center justify-center shadow-glowSm">
                    <Star size={10} className="text-rc-bg fill-rc-bg" />
                  </div>
                )}
              </div>
              <div className="hidden sm:flex flex-col">
                <span className="text-sm text-rc-text font-medium max-w-[120px] truncate leading-tight">
                  {user.displayName || user.email?.split('@')[0] || 'User'}
                </span>
                {subscription.isPro && (
                  <div className="flex items-center gap-1">
                    <Star size={10} className="text-amber-400 fill-amber-400" />
                    <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider leading-none">Pro Member</span>
                  </div>
                )}
              </div>
            </div>
            
            {(role === 'admin' || role === 'owner') && (
              <>
                <div className="w-px h-6 bg-rc-border"></div>
                <Link to="/admin" className="flex items-center gap-1.5 text-sm text-amber-400 hover:text-amber-300 transition-colors">
                  <Shield size={16} />
                  <span className="hidden sm:block">Admin</span>
                </Link>
              </>
            )}

            <div className="w-px h-6 bg-rc-border"></div>
            <button 
              onClick={handleSignOut}
              className="flex items-center gap-1.5 text-sm text-rc-muted hover:text-red-400 transition-colors"
            >
              <LogOut size={16} />
              <span className="hidden sm:block">Sign Out</span>
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
