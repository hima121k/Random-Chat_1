import React, { useEffect, useRef, useState } from 'react';
import { db } from '../../lib/firebase';
import { doc, collection, addDoc, onSnapshot, updateDoc } from 'firebase/firestore';
import { Mic, MicOff, Video, VideoOff, PhoneOff } from 'lucide-react';

const servers = {
  iceServers: [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
    // Fix #11: TURN server — credentials loaded from env vars
    ...(import.meta.env.VITE_TURN_URL ? [{
      urls: import.meta.env.VITE_TURN_URL as string,
      username: import.meta.env.VITE_TURN_USERNAME as string,
      credential: import.meta.env.VITE_TURN_CREDENTIAL as string,
    }] : []),
  ],
  iceCandidatePoolSize: 10,
};

interface VideoCallProps {
  chatId: string;
  isCaller: boolean;
  onHangup: () => void;
}

export const VideoCall: React.FC<VideoCallProps> = ({ chatId, isCaller, onHangup }) => {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null); // Fix #4: ref for cleanup

  useEffect(() => {
    let mounted = true;
    const unsubscribers: (() => void)[] = []; // Track all onSnapshot listeners for cleanup

    const setupWebRTC = async () => {
      pc.current = new RTCPeerConnection(servers);

      pc.current.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          setRemoteStream(event.streams[0]);
          // Direct assignment helps ensure video element catches track additions immediately
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = event.streams[0];
          }
        } else {
          const track = event.track;
          setRemoteStream((prev) => {
            const stream = prev || new MediaStream();
            stream.addTrack(track);
            if (remoteVideoRef.current && remoteVideoRef.current.srcObject !== stream) {
              remoteVideoRef.current.srcObject = stream;
            }
            return stream;
          });
        }
      };

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (!mounted) {
          stream.getTracks().forEach(track => track.stop());
          return;
        }
        localStreamRef.current = stream;  // Fix #4: store in ref
        setLocalStream(stream);

        stream.getTracks().forEach((track) => {
          pc.current?.addTrack(track, stream);
        });
      } catch (err) {
        console.error("Error accessing media devices.", err);
        return;
      }

      const chatDoc = doc(db, 'chats', chatId);
      const callerCandidatesCollection = collection(chatDoc, 'callerCandidates');
      const calleeCandidatesCollection = collection(chatDoc, 'calleeCandidates');

      if (isCaller) {
        pc.current.onicecandidate = (event) => {
          if (event.candidate) {
            addDoc(callerCandidatesCollection, event.candidate.toJSON());
          }
        };

        const offerDescription = await pc.current?.createOffer();
        if (offerDescription) {
          await pc.current?.setLocalDescription(offerDescription);

          const offer = {
            sdp: offerDescription.sdp,
            type: offerDescription.type,
          };

          await updateDoc(chatDoc, { offer });
        }

        const unsubChatDoc = onSnapshot(chatDoc, async (snapshot) => {
          const data = snapshot.data();
          if (!pc.current?.currentRemoteDescription && data?.answer) {
            const answerDescription = new RTCSessionDescription(data.answer);
            await pc.current?.setRemoteDescription(answerDescription);

            // Listen to candidates ONLY AFTER remote description is set
            const unsubCalleeCandidates = onSnapshot(calleeCandidatesCollection, (candidateSnapshot) => {
              candidateSnapshot.docChanges().forEach((change) => {
                if (change.type === 'added') {
                  const candidate = new RTCIceCandidate(change.doc.data());
                  pc.current?.addIceCandidate(candidate);
                }
              });
            });
            unsubscribers.push(unsubCalleeCandidates);
          }
        });
        unsubscribers.push(unsubChatDoc);

      } else {
        pc.current.onicecandidate = (event) => {
          if (event.candidate) {
            addDoc(calleeCandidatesCollection, event.candidate.toJSON());
          }
        };

        const chatData = await new Promise<Record<string, unknown>>((resolve) => {
          const unsub = onSnapshot(chatDoc, (snapshot) => {
            const data = snapshot.data();
            if (data?.offer) {
              resolve(data as Record<string, unknown>);
              unsub();
            }
          });
          unsubscribers.push(unsub);
        });

        const offerDescription = new RTCSessionDescription(chatData.offer as RTCSessionDescriptionInit);
        await pc.current?.setRemoteDescription(offerDescription);

        // Subscribe to caller candidates AFTER setRemoteDescription
        const unsubCallerCandidates = onSnapshot(callerCandidatesCollection, (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
              const candidate = new RTCIceCandidate(change.doc.data());
              pc.current?.addIceCandidate(candidate);
            }
          });
        });
        unsubscribers.push(unsubCallerCandidates);

        const answerDescription = await pc.current?.createAnswer();
        if (answerDescription) {
          await pc.current?.setLocalDescription(answerDescription);

          const answer = {
            type: answerDescription.type,
            sdp: answerDescription.sdp,
          };

          await updateDoc(chatDoc, { answer });
        }
      }
    };

    setupWebRTC();

    return () => {
      mounted = false;
      // Clean up all Firestore snapshot listeners
      unsubscribers.forEach(unsub => unsub());
      localStreamRef.current?.getTracks().forEach(track => track.stop());
      if (pc.current) {
        pc.current.close();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, isCaller]);

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play().catch((err) => {
        console.warn("Autoplay prevented for remote video", err);
      });
    }
  }, [remoteStream]);

  const toggleAudio = () => {
    if (localStream) {
      localStream.getAudioTracks()[0].enabled = isAudioMuted;
      setIsAudioMuted(!isAudioMuted);
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      localStream.getVideoTracks()[0].enabled = isVideoMuted;
      setIsVideoMuted(!isVideoMuted);
    }
  };

  const handleHangup = () => {
    localStreamRef.current?.getTracks().forEach(track => track.stop()); // Fix #4: use ref
    pc.current?.close();
    onHangup();
  };

  return (
    <div className="absolute inset-0 bg-black z-50 flex flex-col">
      <div className="relative flex-1 bg-gray-900">
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover"
        />
        <div className="absolute top-4 right-4 w-32 h-48 bg-gray-800 rounded-lg overflow-hidden border-2 border-gray-700 shadow-xl">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        </div>
      </div>

      <div className="bg-gray-900 p-6 flex justify-center items-center gap-6 pb-10">
        <button
          onClick={toggleAudio}
          className={`p-4 rounded-full ${isAudioMuted ? 'bg-red-500 text-white' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
        >
          {isAudioMuted ? <MicOff size={24} /> : <Mic size={24} />}
        </button>
        <button
          onClick={handleHangup}
          className="p-5 rounded-full bg-red-600 text-white hover:bg-red-700 shadow-lg shadow-red-500/30 transform hover:scale-105 transition-all"
        >
          <PhoneOff size={28} />
        </button>
        <button
          onClick={toggleVideo}
          className={`p-4 rounded-full ${isVideoMuted ? 'bg-red-500 text-white' : 'bg-gray-700 text-white hover:bg-gray-600'}`}
        >
          {isVideoMuted ? <VideoOff size={24} /> : <Video size={24} />}
        </button>
      </div>
    </div>
  );
};
