import { useState } from 'react';
import { Timestamp, doc, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { Check, CheckCheck, Reply } from 'lucide-react';

export interface Message {
  id: string;
  text: string;
  senderId: string;
  createdAt: Timestamp | null;
  reactions?: Record<string, string>;
  isRead?: boolean;
  replyTo?: { text: string; senderId: string } | null;
}

interface MessageBubbleProps {
  message: Message;
  isOwnMessage: boolean;
  chatId: string;
  strangerName: string;
  onReply: (message: Message) => void;
  currentUserId: string;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, isOwnMessage, chatId, strangerName, onReply, currentUserId }) => {
  const [showReactions, setShowReactions] = useState(false);

  const timeString = message.createdAt?.toDate
    ? message.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  const handleReact = async (emoji: string) => {
    setShowReactions(false);
    if (!chatId || !message.id || !currentUserId) return;
    try {
      const msgRef = doc(db, 'chats', chatId, 'messages', message.id);
      if (message.reactions?.[currentUserId] === emoji) {
        // Toggle off (remove reaction)
        await updateDoc(msgRef, {
          [`reactions.${currentUserId}`]: deleteField()
        });
      } else {
        // Set / Replace reaction (WhatsApp one select option system)
        await updateDoc(msgRef, {
          [`reactions.${currentUserId}`]: emoji
        });
      }
    } catch (e) {
      console.error('Failed to react:', e);
    }
  };

  return (
    <div 
      className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'} group relative ${
        message.reactions && Object.keys(message.reactions).length > 0 ? 'mb-4' : 'mb-2'
      }`}
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
        {/* Reply Action Button (positioned relative to the message bubble itself!) */}
        <button 
          onClick={(e) => { e.stopPropagation(); onReply(message); setShowReactions(false); }}
          className={`absolute top-1/2 -translate-y-1/2 transition-opacity p-2 bg-rc-panel border border-rc-border hover:border-rc-accent/50 rounded-full text-rc-muted hover:text-rc-accentGlow shadow-md z-10 cursor-pointer ${
            isOwnMessage ? '-left-12' : '-right-12'
          } ${showReactions ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
          title="Reply"
        >
          <Reply size={14} className={isOwnMessage ? 'scale-x-[-1]' : ''} />
        </button>
        {/* Reply Preview inside Bubble */}
        {message.replyTo && (
          <div className={`mb-1.5 p-2 rounded-lg border-l-2 text-xs bg-black/10 flex flex-col gap-0.5 ${
            isOwnMessage ? 'border-white/50 text-white/90' : 'border-rc-accent/50 text-rc-muted'
          }`}>
            <span className="font-bold text-[10px] uppercase tracking-wider">
              {message.replyTo.senderId === currentUserId ? 'You' : strangerName}
            </span>
            <span className="truncate">{message.replyTo.text}</span>
          </div>
        )}

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
        {message.reactions && Object.keys(message.reactions).length > 0 && (
          <div className={`absolute -bottom-3 ${isOwnMessage ? 'right-2' : 'left-2'} bg-rc-panel border border-rc-border rounded-full px-1.5 py-0.5 text-xs shadow-md flex gap-0.5 z-10`}>
            {Object.entries(message.reactions).map(([uid, emoji]) => (
              <span key={uid} title={uid === currentUserId ? 'You' : 'Stranger'}>{emoji}</span>
            ))}
          </div>
        )}

        {/* Hover Reaction Menu (Floating above bubble) */}
        {showReactions && (
          <div className={`absolute bottom-full pb-2 z-20 animate-fade-in ${isOwnMessage ? 'right-2' : 'left-2'}`}>
            <div className="bg-rc-panel border border-rc-border rounded-full px-2.5 py-1 flex gap-1.5 shadow-lg">
              {['👍', '😂', '❤️', '😲'].map(emoji => (
                <button key={emoji} onClick={(e) => { e.stopPropagation(); handleReact(emoji); }} className="hover:scale-125 transition-transform text-base cursor-pointer">
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
