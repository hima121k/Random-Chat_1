import { useState } from 'react';
import { Timestamp, doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { Check, CheckCheck } from 'lucide-react';

export interface Message {
  id: string;
  text: string;
  senderId: string;
  createdAt: Timestamp | null;
  reactions?: string[];
  isRead?: boolean;
}

interface MessageBubbleProps {
  message: Message;
  isOwnMessage: boolean;
  chatId: string;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, isOwnMessage, chatId }) => {
  const [showReactions, setShowReactions] = useState(false);

  const timeString = message.createdAt?.toDate
    ? message.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  const handleReact = async (emoji: string) => {
    setShowReactions(false);
    if (!chatId || !message.id) return;
    try {
      const msgRef = doc(db, 'chats', chatId, 'messages', message.id);
      await updateDoc(msgRef, { reactions: arrayUnion(emoji) });
    } catch (e) {
      console.error('Failed to react:', e);
    }
  };

  return (
    <div 
      className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'} group relative mb-2`}
      onMouseEnter={() => setShowReactions(true)}
      onMouseLeave={() => setShowReactions(false)}
      onClick={() => setShowReactions(prev => !prev)}
    >
      <div
        className={`px-4 py-2.5 rounded-2xl max-w-[78%] shadow-md text-sm leading-relaxed relative ${
          isOwnMessage
            ? 'bg-gradient-to-br from-rc-accent to-rose-600 text-white rounded-br-sm'
            : 'bg-rc-panel border border-rc-border text-rc-text rounded-bl-sm'
        }`}
      >
        <div className="break-words">{message.text}</div>
        
        <div className={`flex items-center justify-end gap-1 text-[10px] mt-1 ${isOwnMessage ? 'text-white/50' : 'text-rc-muted'}`}>
          <span>{timeString}</span>
          {isOwnMessage && (
            message.isRead ? (
              <CheckCheck size={12} className="text-blue-400" />
            ) : (
              <Check size={12} />
            )
          )}
        </div>

        {/* Existing Reactions */}
        {message.reactions && message.reactions.length > 0 && (
          <div className={`absolute -bottom-3 ${isOwnMessage ? 'right-2' : 'left-2'} bg-rc-panel border border-rc-border rounded-full px-1.5 py-0.5 text-xs shadow-md flex gap-0.5`}>
            {message.reactions.map((emoji, i) => (
              <span key={i}>{emoji}</span>
            ))}
          </div>
        )}
      </div>

      {/* Hover Reaction Menu */}
      {!isOwnMessage && showReactions && (
        <div className="absolute top-1/2 -translate-y-1/2 -right-[110px] bg-rc-panel border border-rc-border rounded-full px-2 py-1 flex gap-1 shadow-lg z-10 animate-fade-in">
          {['👍', '😂', '❤️', '😲'].map(emoji => (
            <button key={emoji} onClick={(e) => { e.stopPropagation(); handleReact(emoji); }} className="hover:scale-125 transition-transform text-base">
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
