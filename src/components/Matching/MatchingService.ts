import { collection, addDoc, query, where, getDocs, doc, deleteDoc, onSnapshot, serverTimestamp, runTransaction, getDoc, DocumentSnapshot } from 'firebase/firestore';
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

export const MatchingService = {
  activeWaitingDocId: null as string | null,
  idToken: null as string | null,

  findMatch: async (userId: string, userData: UserData, onMatchFound: (chatId: string) => void): Promise<() => void> => {
    if (!db) throw new Error('Firestore not initialised.');

    try {
      // 0. Check if the current user is banned.
      const currentEmail = auth?.currentUser?.email;
      const myRole = await getUserRole(currentEmail);
      if (myRole !== 'owner' && myRole !== 'admin') {
        const myBanRef = doc(db, 'banned_users', userId);
        const myBanDoc = await getDoc(myBanRef);
        if (myBanDoc.exists()) {
          const banData = myBanDoc.data();
          if (banData.permanent) {
            throw new Error('BANNED: Your account has been suspended due to multiple violations.');
          } else if (banData.expiresAt) {
            const expiresAt = banData.expiresAt.toDate ? banData.expiresAt.toDate() : new Date(banData.expiresAt);
            if (new Date() < expiresAt) {
              const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              throw new Error(`BANNED: Your account is temporarily suspended for ${daysLeft} more day(s).`);
            }
            await deleteDoc(myBanRef);
          }
        }
      }

      // 1. Enter the waiting room immediately
      const waitingDocRef = await addDoc(collection(db, 'waiting_room'), {
        userId,
        userData,
        status: 'waiting',
        createdAt: serverTimestamp()
      });
      MatchingService.activeWaitingDocId = waitingDocRef.id;

      let matched = false;
      let unsubscribe = () => {};

      // 2. Sophisticated Multi-Dimensional Score Calculator
      const getMatchScore = (otherUser: UserData) => {
        let score = 0;
        if (otherUser.isPro) score += 500;

        if (userData.interests && otherUser.interests) {
          const myInterests = userData.interests.toLowerCase().split(/[,\s]+/).map(i => i.trim()).filter(Boolean);
          const theirInterests = otherUser.interests.toLowerCase().split(/[,\s]+/).map(i => i.trim()).filter(Boolean);
          const shared = myInterests.filter(i => theirInterests.includes(i));
          score += shared.length * 100;
        }

        if (userData.mood && otherUser.mood && userData.mood.toLowerCase() === otherUser.mood.toLowerCase()) {
          score += 50;
        }

        if (userData.location && otherUser.location && userData.location.toLowerCase() === otherUser.location.toLowerCase()) {
          score += 30;
        }

        const ageDiff = Math.abs((userData.age || 0) - (otherUser.age || 0));
        score -= ageDiff * 10;
        return score;
      };

      // Helper: deterministic check to see if a candidate document is older than us
      const isOlder = (otherDoc: DocumentSnapshot, myDoc: DocumentSnapshot) => {
        const otherCreated = otherDoc.get('createdAt');
        const myCreated = myDoc.get('createdAt');

        const otherTime = otherCreated?.toDate ? otherCreated.toDate().getTime() : otherCreated;
        const myTime = myCreated?.toDate ? myCreated.toDate().getTime() : myCreated;

        if (otherTime && myTime && otherTime !== myTime) {
          return otherTime < myTime;
        }
        // Tie-breaker: alphabetical order of document IDs (guarantees strict asymmetry!)
        return otherDoc.id < myDoc.id;
      };

      // 3. Listen to our own waiting document state
      const unsubWaiting = onSnapshot(waitingDocRef, (snapshot) => {
        if (!snapshot.exists()) return;
        const data = snapshot.data();
        if (data.status === 'matched' && data.chatId) {
          matched = true;
          unsubWaiting();
          unsubQueue();
          onMatchFound(data.chatId);
          deleteDoc(waitingDocRef).catch(() => {});
          MatchingService.activeWaitingDocId = null;
        }
      });

      // 4. Listen to other waiting room entries
      const waitingRef = collection(db, 'waiting_room');
      const q = query(waitingRef, where('status', '==', 'waiting'));
      const blockedUsers = JSON.parse(localStorage.getItem('blockedUsers') || '[]');

      const unsubQueue = onSnapshot(q, async (snapshot) => {
        if (matched) return;

        const mySnap = snapshot.docs.find(d => d.id === waitingDocRef.id);
        if (!mySnap) return;

        // Filter: only evaluate active, compatible waiting documents that are older than us
        const candidates = snapshot.docs.filter(docSnap => {
          if (docSnap.id === waitingDocRef.id) return false;

          const wu = docSnap.data();
          if (wu.userId === userId) return false;
          if (blockedUsers.includes(wu.userId)) return false;

          const myMatchGender = userData.matchGender || 'any';
          const theirMatchGender = wu.userData?.matchGender || 'any';
          const myGender = userData.gender;
          const theirGender = wu.userData?.gender;

          const iMatchThem = myMatchGender === 'any' || myMatchGender === theirGender;
          const theyMatchMe = theirMatchGender === 'any' || theirMatchGender === myGender;

          if (!iMatchThem || !theyMatchMe) return false;

          // Asymmetric condition: only younger documents attempt to match with older ones!
          return isOlder(docSnap, mySnap);
        });

        if (candidates.length === 0) return;

        // Sort candidates based on premium matching score
        candidates.sort((a, b) => {
          const scoreA = getMatchScore(a.data().userData || {});
          const scoreB = getMatchScore(b.data().userData || {});
          return scoreB - scoreA;
        });

        // Attempt match
        for (const candidate of candidates) {
          const otherUserId = candidate.data().userId;
          const otherUserData = candidate.data().userData;

          const theirBanRef = doc(db, 'banned_users', otherUserId);
          const theirBanDoc = await getDoc(theirBanRef);
          if (theirBanDoc.exists()) continue;

          let targetChatId: string | null = null;
          try {
            await runTransaction(db, async (transaction) => {
              const freshOther = await transaction.get(candidate.ref);
              const freshMe = await transaction.get(waitingDocRef);

              if (!freshOther.exists() || freshOther.data()?.status !== 'waiting') {
                throw new Error("Candidate already matched");
              }
              if (!freshMe.exists() || freshMe.data()?.status !== 'waiting') {
                throw new Error("We were already matched");
              }

              const chatRef = doc(collection(db, 'chats'));
              targetChatId = chatRef.id;

              transaction.set(chatRef, {
                participants: [otherUserId, userId],
                users: {
                  [otherUserId]: otherUserData,
                  [userId]: userData
                },
                status: 'active',
                createdAt: serverTimestamp(),
                lastMessageAt: serverTimestamp(),
              });

              transaction.update(candidate.ref, { status: 'matched', chatId: targetChatId });
              transaction.update(waitingDocRef, { status: 'matched', chatId: targetChatId });
              matched = true;
            });

            if (matched && targetChatId) {
              unsubWaiting();
              unsubQueue();
              onMatchFound(targetChatId);
              deleteDoc(waitingDocRef).catch(() => {});
              MatchingService.activeWaitingDocId = null;
              break;
            }
          } catch {
            continue;
          }
        }
      });

      unsubscribe = () => {
        unsubWaiting();
        unsubQueue();
      };

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
      const q = query(collection(db, 'waiting_room'), where('userId', '==', userId));
      const querySnapshot = await getDocs(q);
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
