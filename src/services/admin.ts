import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, updateDoc, onSnapshot, query, orderBy, where, addDoc, serverTimestamp, Timestamp, limit } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import type { User } from 'firebase/auth';

export type Role = 'owner' | 'admin' | 'user';
export type ReportStatus = 'pending' | 'actioned' | 'dismissed';

export interface Report {
  id: string;
  reportedId: string;
  reportedName: string;
  reportedEmail?: string;
  reporterId: string;
  chatId: string;
  reason: string;
  description?: string;
  timestamp: Timestamp | null;
  status: ReportStatus;
  actionedBy?: string;
}

export interface BannedUser {
  userId: string;
  email?: string;
  name?: string;
  bannedAt: Timestamp | null;
  bannedBy: string;
  bannedByRole?: Role; // Added to track if an owner performed the ban
  reason: string;
  reportCount: number;
  permanent: boolean;
  expiresAt?: Timestamp | null;
}

export interface BanAppeal {
  id: string;
  userId: string;
  email: string;
  name: string;
  banReason: string;
  appealMessage: string;
  status: 'pending' | 'approved' | 'denied';
  timestamp: Timestamp | null;
  actionedBy?: string;
  actionedAt?: Timestamp | null;
}

export interface UserSubscription {
  isPro: boolean;
  planId?: string;
  status?: string;
  currentPeriodEnd?: Timestamp | null;
}

export interface Coupon {
  id: string;
  code: string;
  discountPercent: number;
  expiresAt: Timestamp | null;
  active: boolean;
  usageCount: number;
}


// Thresholds
const TEMP_BAN_THRESHOLD = 3;   // 3 unique reports → 7-day temp ban
const PERM_BAN_THRESHOLD = 5;   // 5 unique reports → permanent ban
const TEMP_BAN_DAYS = 7;

// Get the comma-separated list of owner emails from env
const getOwnerEmails = (): string[] => {
  const emails = import.meta.env.VITE_OWNER_EMAILS || '';
  return emails.split(',').map((e: string) => e.trim().toLowerCase()).filter((e: string) => e.length > 0);
};

export const getUserRole = async (email: string | null | undefined): Promise<Role> => {
  if (!email) return 'user';

  const normalizedEmail = email.toLowerCase();

  // 1. Check if they are a hardcoded owner
  const owners = getOwnerEmails();
  if (owners.includes(normalizedEmail)) {
    return 'owner';
  }

  // 2. Check Firestore for their role
  if (!db) return 'user';

  try {
    const roleDoc = await getDoc(doc(db, 'roles', normalizedEmail));
    if (roleDoc.exists()) {
      const data = roleDoc.data();
      if (data.role === 'admin' || data.role === 'owner') {
        return data.role as Role;
      }
    }
  } catch (error) {
    console.error("Error fetching user role:", error);
  }

  return 'user';
};

export const grantAdmin = async (email: string) => {
  if (!db) return;
  const currentEmail = auth?.currentUser?.email;
  const currentRole = await getUserRole(currentEmail);

  if (currentRole !== 'owner') {
    throw new Error("Only owners can grant admin privileges.");
  }

  await setDoc(doc(db, 'roles', email.toLowerCase()), { role: 'admin' });
};

export const revokeAdmin = async (email: string) => {
  if (!db) return;
  const currentEmail = auth?.currentUser?.email;
  const currentRole = await getUserRole(currentEmail);

  if (currentRole !== 'owner') {
    throw new Error("Only owners can revoke admin privileges.");
  }

  await deleteDoc(doc(db, 'roles', email.toLowerCase()));
};

export const getAllAdmins = async (): Promise<string[]> => {
  if (!db) return [];
  const snapshot = await getDocs(collection(db, 'roles'));
  return snapshot.docs.map(doc => doc.id);
};

// --- Announcements ---
export const publishAnnouncement = async (message: string) => {
  if (!db) return;
  const currentEmail = auth?.currentUser?.email;
  const role = await getUserRole(currentEmail);

  if (role === 'user') {
    throw new Error("Unauthorized to publish announcements.");
  }

  await setDoc(doc(db, 'system', 'announcement'), {
    message,
    timestamp: Date.now(),
    publisher: currentEmail
  });
};

export const clearAnnouncement = async () => {
  if (!db) return;
  const currentEmail = auth?.currentUser?.email;
  const role = await getUserRole(currentEmail);

  if (role === 'user') {
    throw new Error("Unauthorized to clear announcements.");
  }

  await deleteDoc(doc(db, 'system', 'announcement'));
};

export const subscribeToAnnouncement = (callback: (message: string | null) => void) => {
  if (!db) return () => { };

  try {
    return onSnapshot(doc(db, 'system', 'announcement'), (doc) => {
      if (doc.exists() && doc.data().message) {
        callback(doc.data().message);
      } else {
        callback(null);
      }
    }, (error) => {
      console.warn("Announcement subscription failed (likely missing Firestore rules):", error.message);
      callback(null);
    });
  } catch (err) {
    console.warn("Announcement subscription init failed:", err);
    return () => { };
  }
};

export const subscribeToPlatformMetrics = (callback: (metrics: { activeChats: number, waitingUsers: number }) => void) => {
  if (!db) return () => { };
  let activeChats = 0;
  let waitingUsers = 0;

  const notify = () => callback({ activeChats, waitingUsers });

  try {
    const unsubChats = onSnapshot(collection(db, 'chats'), (snap) => {
      activeChats = snap.docs.filter(doc => doc.data().status === 'active').length;
      notify();
    }, (err) => {
      console.warn('Failed to subscribe to chats metric:', err);
    });

    const unsubWaiting = onSnapshot(collection(db, 'waiting_room'), (snap) => {
      waitingUsers = snap.docs.filter(doc => doc.data().status === 'waiting').length;
      notify();
    }, (err) => {
      console.warn('Failed to subscribe to waiting metric:', err);
    });

    return () => {
      unsubChats();
      unsubWaiting();
    };
  } catch (err) {
    console.warn("Platform metrics subscription failed:", err);
    return () => { };
  }
};

// ── USER LOOKUP ───────────────────────────────────────────────────────────────

// Look up a user's UID by searching reported email in the reports collection
export const lookupUidByEmail = async (email: string): Promise<{ uid: string; name: string } | null> => {
  if (!db || !email.trim()) return null;
  const normalizedEmail = email.trim().toLowerCase();
  try {
    // 2. Search in 'users' collection (Primary source)
    const usersRef = collection(db, 'users');
    const qUsers = query(usersRef, where('email', '==', normalizedEmail));
    const snapUsers = await getDocs(qUsers);
    if (!snapUsers.empty) {
      const data = snapUsers.docs[0].data();
      return { uid: snapUsers.docs[0].id, name: data.displayName || 'Unknown' };
    }

    // 3. Fallback: Search in 'reports' collection (Historical data)
    const reportsRef = collection(db, 'reports');
    const q = query(reportsRef, where('reportedEmail', '==', normalizedEmail));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const d = snap.docs[0].data();
      return { uid: d.reportedId, name: d.reportedName };
    }
  } catch (err) {
    console.warn('UID lookup failed:', err);
  }
  return null;
};

/**
 * Ensures a user's basic profile (email, etc.) exists in Firestore.
 * This allows administrators to find users by email to grant Pro status.
 */
export const syncUserProfile = async (user: User, role: Role = 'user', isPro: boolean = false) => {
  if (!db || !user) return;
  try {
    const userRef = doc(db, 'users', user.uid);
    await setDoc(userRef, {
      email: user.email?.toLowerCase(),
      displayName: user.displayName,
      lastLogin: serverTimestamp(),
      role: role,
      isPro: isPro
    }, { merge: true });
  } catch (error) {
    console.error("Error syncing user profile:", error);
  }
};

// ── REPORTING ─────────────────────────────────────────────────────────────────

export const clearAllReports = async () => {
  if (!db) return;
  const adminEmail = auth?.currentUser?.email;
  const role = await getUserRole(adminEmail);
  if (role !== 'owner') throw new Error('Only the Owner can clear all reports.');

  // Delete in batches of 400
  let deleted = 0;
  let hasMore = true;
  while (hasMore) {
    const snap = await getDocs(query(collection(db, 'reports'), orderBy('timestamp', 'desc'), limit(400)));
    if (snap.empty) { hasMore = false; break; }
    const batch = (await import('firebase/firestore')).writeBatch(db);
    snap.docs.slice(0, 400).forEach(d => batch.delete(d.ref));
    await batch.commit();
    deleted += snap.docs.slice(0, 400).length;
    if (snap.docs.length < 400) hasMore = false;
  }
  return deleted;
};

export const deleteReport = async (reportId: string) => {
  if (!db) return;
  const adminEmail = auth?.currentUser?.email;
  const role = await getUserRole(adminEmail);
  if (role !== 'owner') throw new Error('Only the Owner can delete reports.');
  await deleteDoc(doc(db, 'reports', reportId));
};

export const deleteAllReportsForUser = async (reportedId: string) => {
  if (!db) return 0;
  const adminEmail = auth?.currentUser?.email;
  const role = await getUserRole(adminEmail);
  if (role !== 'owner') throw new Error('Only the Owner can delete reports.');

  const snap = await getDocs(
    query(collection(db, 'reports'), where('reportedId', '==', reportedId))
  );
  if (snap.empty) return 0;
  const { writeBatch } = await import('firebase/firestore');
  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
  return snap.size;
};

export const submitReport = async (
  reportedId: string,
  reportedName: string,
  reportedEmail: string | null,
  chatId: string,
  reason: string,
  description?: string
) => {
  if (!db || !auth?.currentUser) return;
  const reporterId = auth.currentUser.uid;

  // Prevent self-reporting
  if (reportedId === reporterId) {
    throw new Error('You cannot report yourself.');
  }

  // DUPLICATE CHECK: one report per reporter per chat session
  const alreadyReported = await getDocs(
    query(
      collection(db, 'reports'),
      where('reportedId', '==', reportedId),
      where('reporterId', '==', reporterId),
      where('chatId', '==', chatId)
    )
  );
  if (!alreadyReported.empty) {
    throw new Error('ALREADY_REPORTED: You have already reported this user in this session.');
  }

  // Write the report
  await addDoc(collection(db, 'reports'), {
    reportedId,
    reportedName,
    reportedEmail: reportedEmail || '',
    reporterId,
    chatId,
    reason,
    description: description || '',
    status: 'pending',
    timestamp: serverTimestamp(),
  });

  // Count only ACTIVE (non-dismissed) reports against this user.
  // Each unique reporter only counts once to prevent spam-reporting abuse.
  const activeReports = await getDocs(
    query(
      collection(db, 'reports'),
      where('reportedId', '==', reportedId),
      where('status', 'in', ['pending', 'actioned'])
    )
  );

  // Deduplicate: count unique reporters
  const uniqueReporters = new Set(activeReports.docs.map(d => d.data().reporterId));
  const reportCount = uniqueReporters.size;

  const banRef = doc(db, 'banned_users', reportedId);
  const existing = await getDoc(banRef);

  // NEVER auto-ban an owner or admin
  const reportedRole = await getUserRole(reportedEmail);
  if (reportedRole === 'owner' || reportedRole === 'admin') return;

  // Don't overwrite a permanent ban
  if (existing.exists() && existing.data()?.permanent === true) return;

  if (reportCount >= PERM_BAN_THRESHOLD) {
    // Permanent ban
    await setDoc(banRef, {
      userId: reportedId,
      email: reportedEmail || '',
      name: reportedName,
      bannedAt: serverTimestamp(),
      bannedBy: 'auto-system',
      bannedByRole: 'admin', // Auto-bans are treatable by admins
      reason: `Auto-permanently-banned after ${reportCount} reports`,
      reportCount,
      permanent: true,
      expiresAt: null,
    });
  } else if (reportCount >= TEMP_BAN_THRESHOLD) {
    // 7-day temp ban
    const expiresAt = Timestamp.fromDate(
      new Date(Date.now() + TEMP_BAN_DAYS * 24 * 60 * 60 * 1000)
    );
    await setDoc(banRef, {
      userId: reportedId,
      email: reportedEmail || '',
      name: reportedName,
      bannedAt: serverTimestamp(),
      bannedBy: 'auto-system',
      bannedByRole: 'admin', // Auto-bans are treatable by admins
      reason: `Auto-temp-banned for 7 days after ${reportCount} reports`,
      reportCount,
      permanent: false,
      expiresAt,
    });
  }
};

// ── ADMIN REVIEW QUEUE ────────────────────────────────────────────────────────

export const subscribeToPendingReports = (callback: (reports: Report[]) => void) => {
  if (!db) return () => { };
  try {
    const q = query(
      collection(db, 'reports'),
      where('status', '==', 'pending'),
      orderBy('timestamp', 'desc')
    );
    return onSnapshot(q, (snap) => {
      callback(snap.docs.map(d => ({ id: d.id, ...d.data() } as Report)));
    }, (err) => {
      console.warn('Failed to subscribe to reports:', err.message);
      callback([]);
    });
  } catch (err) {
    return () => { };
  }
};

export const subscribeToAllReports = (callback: (reports: Report[]) => void) => {
  if (!db) return () => { };
  try {
    const q = query(collection(db, 'reports'), orderBy('timestamp', 'desc'));
    return onSnapshot(q, (snap) => {
      callback(snap.docs.map(d => ({ id: d.id, ...d.data() } as Report)));
    }, (err) => {
      console.warn('Failed to subscribe to all reports:', err.message);
      callback([]);
    });
  } catch (err) {
    return () => { };
  }
};

export const dismissReport = async (reportId: string) => {
  if (!db) return;
  await updateDoc(doc(db, 'reports', reportId), {
    status: 'dismissed',
    actionedBy: auth?.currentUser?.email || 'unknown',
  });
};

export const actionReportBan = async (
  reportId: string,
  reportedId: string,
  reportedName: string,
  reportedEmail: string,
  permanent: boolean
) => {
  if (!db) return;
  const adminEmail = auth?.currentUser?.email;
  const role = await getUserRole(adminEmail);
  if (role === 'user') throw new Error('Unauthorized');

  // Protect owners and admins from being banned via report review
  const targetRole = await getUserRole(reportedEmail);
  if (targetRole === 'owner' || targetRole === 'admin') {
    throw new Error('Cannot ban an owner or admin account.');
  }

  const expiresAt = permanent
    ? null
    : Timestamp.fromDate(new Date(Date.now() + TEMP_BAN_DAYS * 24 * 60 * 60 * 1000));

  await setDoc(doc(db, 'banned_users', reportedId), {
    userId: reportedId,
    email: reportedEmail,
    name: reportedName,
    bannedAt: serverTimestamp(),
    bannedBy: adminEmail || 'admin',
    bannedByRole: role,
    reason: `Banned by admin via report review`,
    reportCount: 0,
    permanent,
    expiresAt,
  });
  await updateDoc(doc(db, 'reports', reportId), {
    status: 'actioned',
    actionedBy: adminEmail || 'unknown',
  });
};

// ── BAN MANAGEMENT ────────────────────────────────────────────────────────────

export const subscribeToBannedUsers = (callback: (users: BannedUser[]) => void) => {
  if (!db) return () => { };
  try {
    return onSnapshot(collection(db, 'banned_users'), (snap) => {
      callback(snap.docs.map(d => ({ userId: d.id, ...d.data() } as BannedUser)));
    }, (err) => {
      console.warn('Failed to subscribe to banned users:', err.message);
      callback([]);
    });
  } catch (err) {
    return () => { };
  }
};

export const manualBanUser = async (
  userId: string,
  email: string,
  name: string,
  reason: string,
  permanent: boolean
) => {
  if (!db) return;
  const adminEmail = auth?.currentUser?.email;
  const role = await getUserRole(adminEmail);
  if (role === 'user') throw new Error('Unauthorized');

  // Protect owners and admins from manual bans
  const targetRole = await getUserRole(email);
  if (targetRole === 'owner' || targetRole === 'admin') {
    throw new Error('Cannot ban an owner or admin account.');
  }

  const expiresAt = permanent
    ? null
    : Timestamp.fromDate(new Date(Date.now() + TEMP_BAN_DAYS * 24 * 60 * 60 * 1000));

  await setDoc(doc(db, 'banned_users', userId), {
    userId, email, name,
    bannedAt: serverTimestamp(),
    bannedBy: adminEmail || 'admin',
    bannedByRole: role,
    reason,
    reportCount: 0,
    permanent,
    expiresAt,
  });
};

export const unbanUser = async (userId: string) => {
  if (!db) return;
  const adminEmail = auth?.currentUser?.email;
  const role = await getUserRole(adminEmail);
  if (role === 'user') throw new Error('Unauthorized');

  // PROTECTION: If banned by owner, only owner can unban
  const banRef = doc(db, 'banned_users', userId);
  const banDoc = await getDoc(banRef);
  if (banDoc.exists()) {
    const data = banDoc.data() as BannedUser;
    if (data.bannedByRole === 'owner' && role !== 'owner') {
      throw new Error('This user was banned by an Owner and can only be unbanned by an Owner.');
    }
  }

  await deleteDoc(banRef);
};

// ── BAN APPEALS ──────────────────────────────────────────────────────────────

export const submitBanAppeal = async (
  userId: string,
  email: string,
  name: string,
  banReason: string,
  appealMessage: string
) => {
  if (!db) return;

  // One appeal per user — check first
  const existing = await getDocs(
    query(collection(db, 'ban_appeals'), where('userId', '==', userId), where('status', '==', 'pending'))
  );
  if (!existing.empty) throw new Error('APPEAL_EXISTS: You already have a pending appeal.');

  await addDoc(collection(db, 'ban_appeals'), {
    userId,
    email,
    name,
    banReason,
    appealMessage,
    status: 'pending',
    timestamp: serverTimestamp(),
  });
};

export const subscribeToAppeals = (callback: (appeals: BanAppeal[]) => void) => {
  if (!db) return () => { };
  try {
    const q = query(collection(db, 'ban_appeals'), orderBy('timestamp', 'desc'));
    return onSnapshot(q, (snap) => {
      callback(snap.docs.map(d => ({ id: d.id, ...d.data() } as BanAppeal)));
    }, (err) => {
      console.warn('Failed to subscribe to appeals:', err.message);
      callback([]);
    });
  } catch { return () => { }; }
};

export const approveAppeal = async (appealId: string, userId: string) => {
  if (!db) return;
  const adminEmail = auth?.currentUser?.email;
  const role = await getUserRole(adminEmail);
  if (role === 'user') throw new Error('Unauthorized');

  // PROTECTION: If banned by owner, only owner can approve appeal (unban)
  const banRef = doc(db, 'banned_users', userId);
  const banDoc = await getDoc(banRef);
  if (banDoc.exists()) {
    const data = banDoc.data() as BannedUser;
    if (data.bannedByRole === 'owner' && role !== 'owner') {
      throw new Error('This user was banned by an Owner. Appeal can only be approved by an Owner.');
    }
  }

  await updateDoc(doc(db, 'ban_appeals', appealId), {
    status: 'approved',
    actionedBy: adminEmail || 'admin',
    actionedAt: serverTimestamp(),
  });
  await deleteDoc(banRef);
};

export const denyAppeal = async (appealId: string) => {
  if (!db) return;
  const adminEmail = auth?.currentUser?.email;
  const role = await getUserRole(adminEmail);
  if (role === 'user') throw new Error('Unauthorized');

  await updateDoc(doc(db, 'ban_appeals', appealId), {
    status: 'denied',
    actionedBy: adminEmail || 'admin',
    actionedAt: serverTimestamp(),
  });
};

// ── SUBSCRIPTIONS ────────────────────────────────────────────────────────────

export const getUserSubscription = async (userId: string): Promise<UserSubscription> => {
  if (!db) return { isPro: false };
  try {
    // Check if user is owner/admin first
    const currentUser = auth?.currentUser;
    if (currentUser) {
      const role = await getUserRole(currentUser.email);
      if (role === 'owner' || role === 'admin') {
        return { isPro: true, status: 'Permanent (Staff)' };
      }
    }

    const subDoc = await getDoc(doc(db, 'users', userId));
    if (subDoc.exists()) {
      const data = subDoc.data();
      return {
        isPro: data.isPro || false,
        planId: data.planId,
        status: data.status,
        currentPeriodEnd: data.currentPeriodEnd
      };
    }
  } catch (error) {
    console.error("Error fetching user subscription:", error);
  }
  return { isPro: false };
};

export const subscribeToUserSubscription = (userId: string, callback: (sub: UserSubscription) => void) => {
  if (!db) return () => { };
  try {
    // Check role immediately for current user
    const currentUser = auth?.currentUser;
    if (currentUser && currentUser.uid === userId) {
      getUserRole(currentUser.email).then(role => {
        if (role === 'owner' || role === 'admin') {
          callback({ isPro: true, status: 'Permanent (Staff)' });
        }
      });
    }

    return onSnapshot(doc(db, 'users', userId), (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        // Use live auth reference to avoid stale closure
        getUserRole(auth?.currentUser?.email).then(role => {
          if (role === 'owner' || role === 'admin') {
            callback({ isPro: true, status: 'Permanent (Staff)' });
          } else {
            callback({
              isPro: data.isPro || false,
              planId: data.planId,
              status: data.status,
              currentPeriodEnd: data.currentPeriodEnd
            });
          }
        });
      } else {
        // Even if no doc, staff get pro — use live auth reference
        getUserRole(auth?.currentUser?.email).then(role => {
          if (role === 'owner' || role === 'admin') {
            callback({ isPro: true, status: 'Permanent (Staff)' });
          } else {
            callback({ isPro: false });
          }
        });
      }
    }, (error) => {
      console.warn("User subscription listener failed (likely missing rules):", error.message);
      callback({ isPro: false });
    });
  } catch (error) {
    console.error("Error subscribing to user subscription:", error);
    return () => { };
  }
};

export const subscribeToProUsers = (callback: (users: { uid: string; email?: string; name?: string; isPro: boolean; status?: string }[]) => void) => {
  if (!db) return () => { };
  try {
    const q = query(collection(db, 'users'), where('isPro', '==', true));
    return onSnapshot(q, (snap) => {
      callback(snap.docs.map(d => ({ uid: d.id, ...d.data() } as any)));
    }, (err) => {
      console.warn('Failed to subscribe to pro users:', err.message);
      callback([]);
    });
  } catch (err) {
    return () => { };
  }
};

export const updateUserSubscription = async (userId: string, isPro: boolean) => {
  if (!db) return;
  const adminEmail = auth?.currentUser?.email;
  const role = await getUserRole(adminEmail);
  if (role !== 'owner') throw new Error('Only the Owner can manually update subscriptions.');

  await setDoc(doc(db, 'users', userId), {
    isPro,
    updatedBy: adminEmail,
    updatedAt: serverTimestamp(),
  }, { merge: true });
};

export const updateUserSubscriptionByEmail = async (email: string, isPro: boolean) => {
  if (!db) return;
  const adminEmail = auth?.currentUser?.email;
  const role = await getUserRole(adminEmail);
  if (role !== 'owner') throw new Error('Only the Owner can manually update subscriptions.');

  // We need to find the UID first. 
  // We can look in 'reports' collection as a fallback, 
  // but better to have a 'users_index' or just try to find them in 'users' if we indexed email.
  // For now, let's look in 'reports' as we did before for lookupUidByEmail.
  const user = await lookupUidByEmail(email);
  if (!user) throw new Error('User with this email not found in records. They must have been reported or have a history to be found this way.');

  await setDoc(doc(db, 'users', user.uid), {
    isPro,
    email: email.toLowerCase(), // Ensure email is stored
    updatedBy: adminEmail,
    updatedAt: serverTimestamp(),
  }, { merge: true });
};

export const subscribeToCoupons = (callback: (coupons: Coupon[]) => void) => {
  if (!db) return () => { };
  try {
    const q = query(collection(db, 'coupons'), orderBy('code', 'asc'));
    return onSnapshot(q, (snap) => {
      callback(snap.docs.map(d => ({ id: d.id, ...d.data() } as Coupon)));
    }, (err) => {
      console.warn('Failed to subscribe to coupons:', err.message);
      callback([]);
    });
  } catch (err) {
    return () => { };
  }
};

export const createCoupon = async (coupon: Omit<Coupon, 'id' | 'usageCount'>) => {
  if (!db) return;
  const adminEmail = auth?.currentUser?.email;
  const role = await getUserRole(adminEmail);
  if (role !== 'owner') throw new Error('Only the Owner can create coupons.');

  const existing = await getDocs(query(collection(db, 'coupons'), where('code', '==', coupon.code.toUpperCase())));
  if (!existing.empty) throw new Error('A coupon with this code already exists.');

  await addDoc(collection(db, 'coupons'), {
    ...coupon,
    code: coupon.code.toUpperCase(),
    usageCount: 0,
    createdAt: serverTimestamp(),
  });
};

export const deleteCoupon = async (couponId: string) => {
  if (!db) return;
  const adminEmail = auth?.currentUser?.email;
  const role = await getUserRole(adminEmail);
  if (role !== 'owner') throw new Error('Only the Owner can delete coupons.');

  await deleteDoc(doc(db, 'coupons', couponId));
};

export const validateCoupon = async (code: string): Promise<Coupon | null> => {
  if (!db) return null;
  const normalized = code.trim().toUpperCase();
  const snap = await getDocs(query(collection(db, 'coupons'), where('code', '==', normalized), where('active', '==', true)));
  
  if (snap.empty) return null;
  
  const coupon = { id: snap.docs[0].id, ...snap.docs[0].data() } as Coupon;
  
  // Check expiry
  if (coupon.expiresAt && coupon.expiresAt.toDate() < new Date()) {
    return null;
  }
  
  return coupon;
};
