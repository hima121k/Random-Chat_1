import { Timestamp } from 'firebase/firestore';

interface Message {
  id: string;
  text: string;
  senderId: string;
  createdAt: Timestamp | null;
}

interface MessageBubbleProps {
  message: Message;
  isOwnMessage: boolean;
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({ message, isOwnMessage }) => {
  const timeString = message.createdAt?.toDate
    ? message.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`px-4 py-2.5 rounded-2xl max-w-[78%] shadow-md text-sm leading-relaxed ${
          isOwnMessage
            ? 'bg-gradient-to-br from-rc-accent to-indigo-700 text-white rounded-br-sm'
            : 'bg-rc-panel border border-rc-border text-rc-text rounded-bl-sm'
        }`}
      >
        <div className="break-words">{message.text}</div>
        <div className={`text-[10px] text-right mt-1 ${isOwnMessage ? 'text-white/50' : 'text-rc-muted'}`}>
          {timeString}
        </div>
      </div>
    </div>
  );
};
