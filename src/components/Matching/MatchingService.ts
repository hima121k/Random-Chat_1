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

      // 1. Check if there's someone in the waiting room
      const waitingRef = collection(db, 'waiting_room');
      // Fix #10: filter out stale sessions older than 2 minutes
      const staleThreshold = Timestamp.fromMillis(Date.now() - 2 * 60 * 1000);
      const q = query(
        waitingRef,
        where('status', '==', 'waiting'),
        where('createdAt', '>=', staleThreshold)
      );

      let matched = false;
      let unsubscribe = () => { };

      const querySnapshot = await getDocs(q);
      const blockedUsers = JSON.parse(localStorage.getItem('blockedUsers') || '[]');

      // Filter and sort waiting users
      const sortedDocs = querySnapshot.docs.filter(docSnap => {
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

          try {
            await runTransaction(db, async (transaction) => {
              // Read the specific waiting document in the transaction
              const waitingDoc = await transaction.get(docSnapshot.ref);
              if (!waitingDoc.exists() || waitingDoc.data()?.status !== 'waiting') {
                throw new Error("User already matched by someone else");
              }

              // Found a match! Create a new chat room
              const chatRef = doc(collection(db, 'chats'));
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
              // The matchee discovers the chatId by listening on the new chats collection.
              transaction.delete(docSnapshot.ref);

              matched = true;
              onMatchFound(chatRef.id);
            });

            // If the transaction succeeded, we are matched, break out of loop
            if (matched) break;
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
        //    Fix 2: the matcher deletes our waiting doc atomically, so we can no
        //    longer rely on a status-change on that doc to learn the chatId.
        const waitingDocRef = await addDoc(collection(db, 'waiting_room'), {
          userId,
          userData,
          status: 'waiting',
          createdAt: serverTimestamp()
        });

        // Watch our own waiting doc — if it still exists and gets deleted it means
        // we were matched; fall back to the chats listener below.
        const unsubWaiting = onSnapshot(waitingDocRef, (snapshot) => {
          // doc was deleted by the matcher — the chats listener will fire shortly
          if (!snapshot.exists()) {
            unsubWaiting();
          }
        });

        // Fix 2: primary match signal — listen for a new chat where we are a participant
        const chatsRef = collection(db, 'chats');
        const chatsQ = query(chatsRef, where('participants', 'array-contains', userId));
        let chatFound = false;
        const unsubChats = onSnapshot(chatsQ, (chatsSnap) => {
          if (chatFound) return;
          const newChat = chatsSnap.docs.find(
            d => d.data().status === 'active'
          );
          if (newChat) {
            chatFound = true;
            unsubChats();
            unsubWaiting();
            // Clean up our waiting room doc in case it wasn't deleted yet
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
    if (!db) return;
    try {
      const q = query(collection(db, 'waiting_room'), where('userId', '==', userId), where('status', '==', 'waiting'));
      const querySnapshot = await getDocs(q);
      // Fix #7: replace async forEach with Promise.all to avoid fire-and-forget deletes
      await Promise.all(querySnapshot.docs.map(d => deleteDoc(d.ref)));
    } catch (error) {
      console.error("Error leaving queue:", error);
    }
  }
};
