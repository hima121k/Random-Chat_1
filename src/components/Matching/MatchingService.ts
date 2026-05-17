import { collection, addDoc, query, where, getDocs, doc, deleteDoc, onSnapshot, serverTimestamp, runTransaction, Timestamp, getDoc } from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import { getUserRole } from '../../services/admin';

export interface UserData {
  name: string;
  gender: string;
  age: number;
  avatarUrl?: string;
  role?: string;
  matchGender?: string;
  isPro?: boolean;
  mood?: string;
  location?: string;
  interests?: string;
}

export interface ChatRoom {
  id: string;
  participants: string[];
  users: Record<string, UserData>;
  status: 'waiting' | 'active' | 'ended';
  createdAt: Timestamp | null;
  lastMessageAt?: Timestamp | null;
}

export const MatchingService = {
  activeWaitingDocId: null as string | null,
  idToken: null as string | null,

  findMatch: async (userId: string, userData: UserData, onMatchFound: (chatId: string) => void): Promise<() => void> => {
    if (!db) throw new Error('Firestore not initialised.');

    try {
      // 0. Check if the current user is banned.
      // Owners and admins are NEVER subject to bans — check role first.
      const currentEmail = auth?.currentUser?.email;
      const myRole = await getUserRole(currentEmail);
      if (myRole !== 'owner' && myRole !== 'admin') {
        const myBanRef = doc(db, 'banned_users', userId);
        const myBanDoc = await getDoc(myBanRef);
        if (myBanDoc.exists()) {
          // Check if the temp ban has expired
          const banData = myBanDoc.data();
          if (banData.permanent) {
            throw new Error('BANNED: Your account has been suspended due to multiple violations.');
          } else if (banData.expiresAt) {
            const expiresAt = banData.expiresAt.toDate ? banData.expiresAt.toDate() : new Date(banData.expiresAt);
            if (new Date() < expiresAt) {
              const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              throw new Error(`BANNED: Your account is temporarily suspended for ${daysLeft} more day(s).`);
            }
            // Ban expired — auto-remove it
            await deleteDoc(myBanRef);
          }
        }
      }

      // 1. Fetch active users in the waiting room
      const waitingRef = collection(db, 'waiting_room');
      // Fix: only query by status to avoid Firestore requiring a composite index on status + createdAt
      const q = query(
        waitingRef,
        where('status', '==', 'waiting')
      );

      let matched = false;
      let unsubscribe = () => { };

      const querySnapshot = await getDocs(q);
      const blockedUsers = JSON.parse(localStorage.getItem('blockedUsers') || '[]');

      // Fix: Filter out stale documents (older than 2 minutes) in JavaScript
      const staleThreshold = Date.now() - 2 * 60 * 1000;
      const validDocs = querySnapshot.docs.filter(docSnap => {
        const wu = docSnap.data();
        const createdAt = wu.createdAt?.toDate ? wu.createdAt.toDate().getTime() : wu.createdAt;
        // If server timestamp is not resolved yet locally, treat it as fresh
        return !createdAt || createdAt >= staleThreshold;
      });

      // Filter and sort waiting users using a highly sophisticated multi-dimensional scoring algorithm
      const sortedDocs = validDocs.filter(docSnap => {
        const wu = docSnap.data();
        if (wu.userId === userId) return false;
        if (blockedUsers.includes(wu.userId)) return false; // Don't match with blocked users

        // Compatibility Check (Pro Feature)
        const myMatchGender = userData.matchGender || 'any';
        const theirMatchGender = wu.userData?.matchGender || 'any';
        const myGender = userData.gender;
        const theirGender = wu.userData?.gender;

        const iMatchThem = myMatchGender === 'any' || myMatchGender === theirGender;
        const theyMatchMe = theirMatchGender === 'any' || theirMatchGender === myGender;

        return iMatchThem && theyMatchMe;
      }).sort((a, b) => {
        const wuA = a.data();
        const wuB = b.data();

        const getMatchScore = (otherUser: UserData) => {
          let score = 0;

          // 1. Pro Status Boost (Premium Priority Matchmaking)
          if (otherUser.isPro) score += 500;

          // 2. Shared Interests Matching (100 points per overlapping interest)
          if (userData.interests && otherUser.interests) {
            const myInterests = userData.interests.toLowerCase().split(/[,\s]+/).map(i => i.trim()).filter(Boolean);
            const theirInterests = otherUser.interests.toLowerCase().split(/[,\s]+/).map(i => i.trim()).filter(Boolean);
            const shared = myInterests.filter(i => theirInterests.includes(i));
            score += shared.length * 100;
          }

          // 3. Mood Matching (50 points for same emotional vibe)
          if (userData.mood && otherUser.mood && userData.mood.toLowerCase() === otherUser.mood.toLowerCase()) {
            score += 50;
          }

          // 4. Location Proximity (30 points for matching country/city)
          if (userData.location && otherUser.location && userData.location.toLowerCase() === otherUser.location.toLowerCase()) {
            score += 30;
          }

          // 5. Age Proximity (Deduct 10 points per year of age difference)
          const ageDiff = Math.abs((userData.age || 0) - (otherUser.age || 0));
          score -= ageDiff * 10;

          return score;
        };

        const scoreA = getMatchScore(wuA.userData || {});
        const scoreB = getMatchScore(wuB.userData || {});

        return scoreB - scoreA; // Sort highest match score first!
      });

      for (const docSnapshot of sortedDocs) {
        const waitingUser = docSnapshot.data();

        // Check if different user, not blocked, and not banned
        if (waitingUser.userId !== userId) {
          // Check if this waiting user is banned
          // Fix #3: use banned_users (snake_case)
          const theirBanRef = doc(db, 'banned_users', waitingUser.userId);
          const theirBanDoc = await getDoc(theirBanRef);
          if (theirBanDoc.exists()) continue; 

          let targetChatId: string | null = null;
          try {
            await runTransaction(db, async (transaction) => {
              // Read the specific waiting document in the transaction
              const waitingDoc = await transaction.get(docSnapshot.ref);
              if (!waitingDoc.exists() || waitingDoc.data()?.status !== 'waiting') {
                throw new Error("User already matched by someone else");
              }

              // Found a match! Create a new chat room
              const chatRef = doc(collection(db, 'chats'));
              targetChatId = chatRef.id;
              
              transaction.set(chatRef, {
                participants: [waitingUser.userId, userId],
                users: {
                  [waitingUser.userId]: waitingUser.userData,
                  [userId]: userData
                },
                status: 'active',
                createdAt: serverTimestamp(),
                lastMessageAt: serverTimestamp(),
              });

              // Fix 2: delete the waiting doc atomically instead of updating it.
              transaction.delete(docSnapshot.ref);
              matched = true;
            });

            // If the transaction succeeded, execute callback and break loop
            if (matched && targetChatId) {
              onMatchFound(targetChatId);
              break;
            }
          } catch {
            // Transaction failed (e.g., someone else claimed this user first)
            // Continue the loop to try the next available user
            continue;
          }
        }
      }

      if (!matched) {
        // 2. No match found — add ourselves to the waiting room, then
        //    listen on the chats collection for a doc where we are a participant.
        const waitingDocRef = await addDoc(collection(db, 'waiting_room'), {
          userId,
          userData,
          status: 'waiting',
          createdAt: serverTimestamp()
        });
        
        // Cache the waiting room document ID for tab-close beacon support!
        MatchingService.activeWaitingDocId = waitingDocRef.id;

        // Maintain the list of current active chats where we are a participant
        interface ActiveChatInfo {
          id: string;
          createdAt: number;
        }
        let latestActiveChats: ActiveChatInfo[] = [];

        // Fix: primary match signal — listen for active chats where we are a participant
        const chatsRef = collection(db, 'chats');
        const chatsQ = query(chatsRef, where('participants', 'array-contains', userId));
        
        const unsubChats = onSnapshot(chatsQ, (chatsSnap) => {
          latestActiveChats = chatsSnap.docs
            .map(d => {
              const data = d.data();
              if (data.status !== 'active') return null;
              
              const createdAt = data.createdAt
                ? (data.createdAt.toDate ? data.createdAt.toDate().getTime() : data.createdAt)
                : Infinity;
              return { id: d.id, createdAt };
            })
            .filter((c): c is ActiveChatInfo => c !== null)
            .sort((a, b) => b.createdAt - a.createdAt);
        });

        // Watch our own waiting doc — when it gets deleted by the matcher, we are officially matched!
        let chatFound = false;
        const unsubWaiting = onSnapshot(waitingDocRef, (snapshot) => {
          if (!snapshot.exists()) {
            unsubWaiting();
            
            // The document was deleted, meaning we matched!
            // Retrieve the newest active chat and transition
            const handleMatchTransition = (chatId: string) => {
              if (chatFound) return;
              chatFound = true;
              unsubChats();
              MatchingService.activeWaitingDocId = null;
              deleteDoc(waitingDocRef).catch(() => {});
              onMatchFound(chatId);
            };

            const newestChat = latestActiveChats[0];
            if (newestChat) {
              handleMatchTransition(newestChat.id);
            } else {
              // Fallback: if the chats snapshot hasn't arrived/updated yet, poll briefly
              const interval = setInterval(() => {
                const retryChat = latestActiveChats[0];
                if (retryChat) {
                  clearInterval(interval);
                  handleMatchTransition(retryChat.id);
                }
              }, 100);
              // Safety timeout: stop polling after 5 seconds to prevent memory leaks
              setTimeout(() => clearInterval(interval), 5000);
            }
          }
        });

        // Return a cleanup that cancels both listeners
        unsubscribe = () => { unsubChats(); unsubWaiting(); };
      }

      return unsubscribe;

    } catch (error) {
      console.error("Error finding match:", error);
      throw error;
    }
  },

  leaveQueue: async (userId: string) => {
    MatchingService.activeWaitingDocId = null;
    if (!db) return;
    try {
      const q = query(collection(db, 'waiting_room'), where('userId', '==', userId), where('status', '==', 'waiting'));
      const querySnapshot = await getDocs(q);
      // Fix #7: replace async forEach with Promise.all to avoid fire-and-forget deletes
      await Promise.all(querySnapshot.docs.map(d => deleteDoc(d.ref)));
    } catch (error) {
      console.error("Error leaving queue:", error);
    }
  },

  leaveQueueBeacon: (userId: string) => {
    MatchingService.leaveQueue(userId).catch(() => {});
    const docId = MatchingService.activeWaitingDocId;
    const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
    const token = MatchingService.idToken;
    if (docId && projectId && token) {
      const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/waiting_room/${docId}`;
      fetch(url, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        keepalive: true
      }).catch(() => {});
      MatchingService.activeWaitingDocId = null;
    }
  }
};
