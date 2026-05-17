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
    
    // Cache the exact moment the matching session began
    const joinTime = Date.now();
    let queueServerTime: number | null = null;

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

      // Filter and sort waiting users
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

        // 1. Prioritize Pro Users
        const prioA = wuA.userData?.isPro ? 1 : 0;
        const prioB = wuB.userData?.isPro ? 1 : 0;
        if (prioA !== prioB) return prioB - prioA;

        // 2. Age difference
        const ageA = wuA.userData?.age || 0;
        const ageB = wuB.userData?.age || 0;
        const diffA = Math.abs(ageA - userData.age);
        const diffB = Math.abs(ageB - userData.age);
        if (diffA !== diffB) return diffA - diffB;

        // 3. Tie-breaker: older first
        return ageB - ageA;
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

        // Watch our own waiting doc — if it still exists and gets deleted it means
        // we were matched; fall back to the chats listener below.
        const unsubWaiting = onSnapshot(waitingDocRef, (snapshot) => {
          if (snapshot.exists()) {
            const data = snapshot.data();
            // Cache the server's exact timestamp for this queue entry to prevent clock skew bugs!
            if (data.createdAt) {
              queueServerTime = data.createdAt.toDate ? data.createdAt.toDate().getTime() : data.createdAt;
            }
          } else {
            // doc was deleted by the matcher — the chats listener will fire shortly
            unsubWaiting();
          }
        });

        // Fix: primary match signal — listen for a new chat where we are a participant
        const chatsRef = collection(db, 'chats');
        const chatsQ = query(chatsRef, where('participants', 'array-contains', userId));
        let chatFound = false;
        
        const unsubChats = onSnapshot(chatsQ, (chatsSnap) => {
          if (chatFound) return;
          
          // Fix: Prevent auto-matching to historical active chats!
          // We only resolve matches created AFTER our queue session began (with a small 5s clock skew buffer)
          const newChat = chatsSnap.docs.find(d => {
            const data = d.data();
            if (data.status !== 'active') return false;
            
            const createdAt = data.createdAt?.toDate ? data.createdAt.toDate().getTime() : data.createdAt;
            // If the chat has no resolved timestamp yet, it is fresh and new!
            if (!createdAt) return true;

            // If we have the server-confirmed queue entry time, compare using it (perfect sync!)
            if (queueServerTime) {
              return createdAt >= (queueServerTime - 5000);
            }
            
            // Fallback: compare against local time with a generous 60-second buffer to absorb any device clock skew
            return createdAt >= (joinTime - 60000);
          });

          if (newChat) {
            chatFound = true;
            unsubChats();
            unsubWaiting();
            // Clean up our waiting room doc in case it wasn't deleted yet
            MatchingService.activeWaitingDocId = null;
            deleteDoc(waitingDocRef).catch(() => {});
            onMatchFound(newChat.id);
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
