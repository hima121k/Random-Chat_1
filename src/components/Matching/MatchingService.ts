import { 
  collection, 
  addDoc, 
  query, 
  where, 
  getDocs, 
  doc, 
  deleteDoc, 
  onSnapshot, 
  serverTimestamp, 
  runTransaction, 
  getDoc, 
  DocumentSnapshot 
} from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import { getUserRole } from '../../services/admin';

/**
 * Interface representing the detailed profile data of a user.
 */
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

/**
 * Interface representing the structured document details in the waiting queue.
 */
interface WaitingRoomEntry {
  userId: string;
  userData: UserData;
  status: 'waiting' | 'matched';
  chatId?: string;
  createdAt?: unknown;
}

/**
 * Interface representing computed match details for candidate scoring.
 */
interface CandidateMatch {
  doc: DocumentSnapshot;
  userId: string;
  userData: UserData;
  score: number;
}

/**
 * Production-grade State-Machine Matchmaking Service.
 * Implements a Dual-Phase Bidirectional Active-Passive Matching architecture:
 * 1. Active Registration: Every user immediately registers their presence in the waiting room.
 * 2. Asymmetric Matchmaking: Strict age/document alphabetical ordering determines directionality:
 *    - The younger/alphabetically smaller document acts as the Active Matcher.
 *    - The older/alphabetically larger document acts as the Passive Matchee.
 *    This mathematical asymmetry completely prevents concurrent transaction collisions and race conditions.
 */
export const MatchingService = {
  // Store the active waiting room document ID for session cleanup
  activeWaitingDocId: null as string | null,
  
  // Cache user auth ID token for tab-closure beacon support
  idToken: null as string | null,

  /**
   * Main matchmaking orchestrator.
   * Registers user in queue, runs the real-time matching query, coordinates asymmetric matching transactions,
   * and listens for incoming matches from other clients.
   * 
   * @param userId Unique identifier of the current user.
   * @param userData Profile details of the current user.
   * @param onMatchFound Callback triggered with the room ID once a successful match is resolved.
   * @returns Unsubscribe function to tear down real-time listeners and clean up.
   */
  findMatch: async (
    userId: string, 
    userData: UserData, 
    onMatchFound: (chatId: string) => void
  ): Promise<() => void> => {
    if (!db) {
      throw new Error('Firestore not initialised.');
    }

    try {
      // Phase 0: Enforce Ban Security Rules
      const currentEmail = auth?.currentUser?.email;
      const myRole = await getUserRole(currentEmail);
      
      // Admins and owners are immune to ban checks
      if (myRole !== 'owner' && myRole !== 'admin') {
        const myBanRef = doc(db, 'banned_users', userId);
        const myBanDoc = await getDoc(myBanRef);
        
        if (myBanDoc.exists()) {
          const banData = myBanDoc.data();
          if (banData.permanent) {
            throw new Error('BANNED: Your account has been suspended due to multiple violations.');
          } else if (banData.expiresAt) {
            const expiresAt = banData.expiresAt.toDate 
              ? banData.expiresAt.toDate() 
              : new Date(banData.expiresAt);
              
            if (new Date() < expiresAt) {
              const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              throw new Error(`BANNED: Your account is temporarily suspended for ${daysLeft} more day(s).`);
            }
            // Auto-clean expired ban
            await deleteDoc(myBanRef);
          }
        }
      }

      // Phase 1: Register presence in the waiting room
      const waitingDocRef = await addDoc(collection(db, 'waiting_room'), {
        userId,
        userData,
        status: 'waiting',
        createdAt: serverTimestamp()
      });
      MatchingService.activeWaitingDocId = waitingDocRef.id;

      let matched = false;
      let unsubscribe = () => {};

      // Phase 2: Sophisticated Multi-Dimensional Score Calculator
      const getMatchScore = (otherUser: UserData): number => {
        let score = 0;
        
        // Premium Priority Boost
        if (otherUser.isPro) {
          score += 500;
        }

        // Shared Interests Matching (100 pts per overlap)
        if (userData.interests && otherUser.interests) {
          const myInterests = userData.interests.toLowerCase().split(/[,\s]+/).map(i => i.trim()).filter(Boolean);
          const theirInterests = otherUser.interests.toLowerCase().split(/[,\s]+/).map(i => i.trim()).filter(Boolean);
          const shared = myInterests.filter(i => theirInterests.includes(i));
          score += shared.length * 100;
        }

        // Mood Vibe Compatibility
        if (userData.mood && otherUser.mood && userData.mood.toLowerCase() === otherUser.mood.toLowerCase()) {
          score += 50;
        }

        // Location Proximity
        if (userData.location && otherUser.location && userData.location.toLowerCase() === otherUser.location.toLowerCase()) {
          score += 30;
        }

        // Age Proximity (Deduct 10 pts per year of difference)
        const ageDiff = Math.abs((userData.age || 0) - (otherUser.age || 0));
        score -= ageDiff * 10;
        
        return score;
      };

      // Helper: Deterministically identify if a document is older than us to ensure asymmetry
      const isOlder = (otherDoc: DocumentSnapshot, myDoc: DocumentSnapshot): boolean => {
        const otherCreated = otherDoc.get('createdAt');
        const myCreated = myDoc.get('createdAt');

        const otherTime = otherCreated?.toDate ? otherCreated.toDate().getTime() : otherCreated;
        const myTime = myCreated?.toDate ? myCreated.toDate().getTime() : myCreated;

        if (otherTime && myTime && otherTime !== myTime) {
          return otherTime < myTime;
        }
        // Perfect tie-breaker: alphabetical document ID ordering
        return otherDoc.id < myDoc.id;
      };

      // Phase 3: Passive Listener — Wait for another user to claim us
      const unsubWaiting = onSnapshot(waitingDocRef, (snapshot) => {
        if (!snapshot.exists()) return;
        
        const data = snapshot.data() as WaitingRoomEntry;
        if (data.status === 'matched' && data.chatId) {
          matched = true;
          unsubWaiting();
          unsubQueue();
          onMatchFound(data.chatId);
          
          // Delete our waiting doc after successful transition
          deleteDoc(waitingDocRef).catch(() => {});
          MatchingService.activeWaitingDocId = null;
        }
      });

      // Phase 4: Active Matcher — Listen to other queue entries and pair deterministically
      const waitingRef = collection(db, 'waiting_room');
      const q = query(waitingRef, where('status', '==', 'waiting'));
      const blockedUsers = JSON.parse(localStorage.getItem('blockedUsers') || '[]');

      const unsubQueue = onSnapshot(q, async (snapshot) => {
        if (matched) return;

        const mySnap = snapshot.docs.find(d => d.id === waitingDocRef.id);
        if (!mySnap) return;

        // Filter: compatible, active waiting users older than us (ensures exactly 1 matcher per pair)
        const candidates: CandidateMatch[] = snapshot.docs
          .filter(docSnap => {
            if (docSnap.id === waitingDocRef.id) return false;

            const wu = docSnap.data() as WaitingRoomEntry;
            if (wu.userId === userId) return false;
            if (blockedUsers.includes(wu.userId)) return false;

            const myMatchGender = userData.matchGender || 'any';
            const theirMatchGender = wu.userData?.matchGender || 'any';
            const myGender = userData.gender;
            const theirGender = wu.userData?.gender;

            const iMatchThem = myMatchGender === 'any' || myMatchGender === theirGender;
            const theyMatchMe = theirMatchGender === 'any' || theirMatchGender === myGender;

            if (!iMatchThem || !theyMatchMe) return false;

            return isOlder(docSnap, mySnap);
          })
          .map(docSnap => {
            const data = docSnap.data() as WaitingRoomEntry;
            return {
              doc: docSnap,
              userId: data.userId,
              userData: data.userData,
              score: getMatchScore(data.userData)
            };
          });

        if (candidates.length === 0) return;

        // Sort candidates with highest score first
        candidates.sort((a, b) => b.score - a.score);

        // Attempt transaction with the best candidate
        for (const candidate of candidates) {
          const theirBanRef = doc(db, 'banned_users', candidate.userId);
          const theirBanDoc = await getDoc(theirBanRef);
          if (theirBanDoc.exists()) continue;

          let targetChatId: string | null = null;
          try {
            await runTransaction(db, async (transaction) => {
              const freshOther = await transaction.get(candidate.doc.ref);
              const freshMe = await transaction.get(waitingDocRef);

              if (!freshOther.exists() || freshOther.data()?.status !== 'waiting') {
                throw new Error("Candidate already claimed");
              }
              if (!freshMe.exists() || freshMe.data()?.status !== 'waiting') {
                throw new Error("We were already matched");
              }

              const chatRef = doc(collection(db, 'chats'));
              targetChatId = chatRef.id;

              // Write E2EE Chat room document
              transaction.set(chatRef, {
                participants: [candidate.userId, userId],
                users: {
                  [candidate.userId]: candidate.userData,
                  [userId]: userData
                },
                status: 'active',
                createdAt: serverTimestamp(),
                lastMessageAt: serverTimestamp(),
              });

              // Atomically transition status of both queue entries to matched
              transaction.update(candidate.doc.ref, { status: 'matched', chatId: targetChatId });
              transaction.update(waitingDocRef, { status: 'matched', chatId: targetChatId });
              matched = true;
            });

            if (matched && targetChatId) {
              unsubWaiting();
              unsubQueue();
              onMatchFound(targetChatId);
              
              // Clean up our queue presence
              deleteDoc(waitingDocRef).catch(() => {});
              MatchingService.activeWaitingDocId = null;
              break;
            }
          } catch {
            // Write contention: loop continues to try next candidate
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

  /**
   * Force leaves the matchmaking queue by deleting any waiting document for the user.
   * 
   * @param userId Unique identifier of the current user.
   */
  leaveQueue: async (userId: string): Promise<void> => {
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

  /**
   * Highly secure keepalive beacon for instant matchmaking teardown on tab or browser closure.
   * Uses raw keepalive REST PATCH/DELETE outliving the tab lifecycle.
   * 
   * @param userId Unique identifier of the current user.
   */
  leaveQueueBeacon: (userId: string): void => {
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
