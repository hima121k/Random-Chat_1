import React, { useState, useRef, useEffect } from 'react';
import { Send, Smile } from 'lucide-react';
import EmojiPicker, { Theme, type EmojiClickData } from 'emoji-picker-react';

interface ChatInputProps {
  onSendMessage: (text: string) => Promise<void>;
  disabled?: boolean;
  e2eePending?: boolean;
  onTyping?: (isTyping: boolean) => void;
  hasActiveReply?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({ onSendMessage, disabled, e2eePending, onTyping, hasActiveReply }) => {
  const [text, setText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [typingTimeout, setTypingTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const MAX_LENGTH = 2000;           // Fix #12
  const WARN_AT   = 1800;           // Fix #12: show countdown from here

  useEffect(() => {
    inputRef.current?.focus();
  }, []);


  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || isSending || disabled || text.length > MAX_LENGTH) return; // Fix #12: block over-limit
    setIsSending(true);
    setShowEmojiPicker(false);
    try {
      await onSendMessage(trimmed);
      setText('');
      if (onTyping) onTyping(false);
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsSending(false);
      inputRef.current?.focus();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
    if (onTyping) {
      onTyping(true);
      if (typingTimeout) clearTimeout(typingTimeout);
      setTypingTimeout(setTimeout(() => onTyping(false), 1500));
    }
  };

  const onEmojiClick = (emojiData: EmojiClickData) => {
    setText((prev) => prev + emojiData.emoji);
  };

  return (
    <footer className="relative z-20 bg-rc-panel/95 backdrop-blur-xl border-t border-rc-border p-3 flex items-center gap-2 mt-auto">
      {/* Quick replies */}
      {!text && !disabled && !hasActiveReply && (
        <div className="absolute -top-12 left-0 w-full flex gap-2 px-3 overflow-x-auto hide-scrollbar z-10 pb-2">
          {['Hey! 👋', 'Where are you from? 🌍', 'What\'s your vibe? ✨', 'Got any hobbies? 🎸'].map(qr => (
            <button key={qr} type="button" 
              onClick={() => { 
                setText(qr); 
                inputRef.current?.focus(); 
                setShowEmojiPicker(false);
              }}
              className="px-3 py-1.5 bg-rc-panel/95 backdrop-blur-md border border-rc-border rounded-full text-[11px] font-medium text-rc-text hover:bg-rc-surface transition-colors whitespace-nowrap shadow-sm shrink-0">
              {qr}
            </button>
          ))}
        </div>
      )}
      {showEmojiPicker && (
        <>
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setShowEmojiPicker(false)}
            onTouchStart={() => setShowEmojiPicker(false)}
          />
          <div className="absolute bottom-[72px] left-2 z-50 shadow-2xl rounded-2xl overflow-hidden">
            <EmojiPicker
              onEmojiClick={onEmojiClick}
              theme={Theme.DARK}
              searchDisabled={false}
              skinTonesDisabled={true}
            />
          </div>
        </>
      )}

      {/* Emoji button */}
      <button
        type="button"
        onClick={() => setShowEmojiPicker(!showEmojiPicker)}
        disabled={disabled}
        className={`p-2.5 rounded-xl transition-all disabled:opacity-40 ${
          showEmojiPicker
            ? 'bg-rc-accent/20 text-rc-accentGlow'
            : 'bg-rc-surface text-rc-muted hover:bg-rc-surface/80 hover:text-rc-text'
        }`}
        title="Choose an emoji"
      >
        <Smile size={20} />
      </button>

      {/* Input form */}
      <form onSubmit={handleSend} className="flex-1 flex gap-2 items-center">
        <div className="flex-1 bg-rc-bg/80 border border-rc-border rounded-2xl px-4 py-2.5 flex items-center focus-within:border-rc-accent/60 focus-within:ring-1 focus-within:ring-rc-accent/20 transition-all">
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={handleChange}
            onFocus={() => setShowEmojiPicker(false)}
            placeholder={disabled ? 'Chat ended' : 'Say something real...'}
            className="w-full bg-transparent outline-none text-rc-text placeholder-rc-muted text-sm"
            disabled={disabled || isSending}
            autoComplete="off"
            maxLength={MAX_LENGTH}   /* Fix #12 */
          />
        </div>
        {/* Fix #12: character counter */}
        {text.length >= WARN_AT && (
          <span className={`text-[10px] shrink-0 tabular-nums ${
            text.length >= MAX_LENGTH ? 'text-red-400' : 'text-rc-muted'
          }`}>
            {MAX_LENGTH - text.length}
          </span>
        )}

        {/* Send button */}
        <button
          type="submit"
          disabled={!text.trim() || isSending || disabled}
          className="p-2.5 bg-gradient-to-br from-rc-accent to-rose-600 hover:from-rc-accentLt hover:to-rose-500
                     text-white rounded-2xl transition-all shadow-glowSm
                     disabled:opacity-40 disabled:shadow-none disabled:hover:from-rc-accent disabled:hover:to-rose-600
                     active:scale-95 shrink-0"
          title={e2eePending ? 'Setting up encryption…' : 'Send'}
        >
          {isSending ? (
            <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          ) : e2eePending ? (
            <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          ) : (
            <Send size={18} strokeWidth={2.5} />
          )}
        </button>
      </form>
    </footer>
  );
};
