import { useState, useEffect, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { auth } from '../../lib/firebase';
import { getUserRole, type Role } from '../../services/admin';
import { onAuthStateChanged } from 'firebase/auth';

interface RoleRouteProps {
  children: ReactNode;
  allowedRoles: Role[];
}

export function RoleRoute({ children, allowedRoles }: RoleRouteProps) {
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const userRole = await getUserRole(user.email);
        setRole(userRole);
      } else {
        setRole('user');
      }
      setLoading(false);
    });

    return () => unsub();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-rc-bg flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-rc-accent"></div>
      </div>
    );
  }

  if (!role || !allowedRoles.includes(role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
