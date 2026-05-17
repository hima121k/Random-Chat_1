import { useState, useMemo } from 'react';
import { X, RefreshCw, Check, Upload } from 'lucide-react';
import { createAvatar } from '@dicebear/core';
import { adventurer, bottts, funEmoji, lorelei, micah, notionists, personas, pixelArt } from '@dicebear/collection';

interface LocalAvatarCreatorProps {
  onAvatarExported: (avatarUrl: string) => void;
  onClose: () => void;
}

const STYLES = [
  { id: 'adventurer', name: 'Adventurer', module: adventurer },
  { id: 'lorelei', name: 'Lorelei', module: lorelei },
  { id: 'micah', name: 'Micah', module: micah },
  { id: 'notionists', name: 'Notionists', module: notionists },
  { id: 'personas', name: 'Personas', module: personas },
  { id: 'bottts', name: 'Robots', module: bottts },
  { id: 'pixelArt', name: 'Pixel Art', module: pixelArt },
  { id: 'funEmoji', name: 'Emojis', module: funEmoji },
];

const COLORS = [
  { id: 'b6e3f4', hex: '#b6e3f4' },
  { id: 'c0aede', hex: '#c0aede' },
  { id: 'd1d4f9', hex: '#d1d4f9' },
  { id: 'ffd5dc', hex: '#ffd5dc' },
  { id: 'ffdfbf', hex: '#ffdfbf' },
  { id: 'transparent', hex: 'transparent' }
];

export function LocalAvatarCreator({ onAvatarExported, onClose }: LocalAvatarCreatorProps) {
  const [activeStyle, setActiveStyle] = useState(STYLES[0]);
  const [seed, setSeed] = useState(() => Math.random().toString(36).substring(7));
  const [backgroundColor, setBackgroundColor] = useState(COLORS[0].id);
  const [customAvatarUri, setCustomAvatarUri] = useState<string | null>(null);

  const generatedAvatarUri = useMemo(() => {
    const options: Record<string, string[] | string> = { seed };
    if (backgroundColor !== 'transparent') {
      options.backgroundColor = [backgroundColor];
    } else {
      options.backgroundColor = ['b6e3f400']; // Transparent hex
    }
    const avatar = createAvatar(activeStyle.module as Parameters<typeof createAvatar>[0], options);
    return avatar.toDataUri();
  }, [activeStyle, seed, backgroundColor]);

  const displayUri = customAvatarUri || generatedAvatarUri;

  const handleRandomize = () => {
    setCustomAvatarUri(null);
    setSeed(Math.random().toString(36).substring(7));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setCustomAvatarUri(event.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = () => {
    onAvatarExported(displayUri);
    window.dispatchEvent(new Event('avatar_updated'));
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-rc-bg/90 backdrop-blur-xl animate-in fade-in duration-300 p-4">
      <div className="bg-rc-panel border border-rc-border rounded-3xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col md:flex-row h-[85vh] md:h-auto md:max-h-[85vh]">
        
        {/* Left Side: Preview */}
        <div className="bg-rc-surface p-8 flex flex-col items-center justify-center relative flex-shrink-0 md:w-2/5 border-b md:border-b-0 md:border-r border-rc-border">
          <button 
            onClick={onClose}
            className="absolute top-4 right-4 p-2 bg-rc-bg/50 hover:bg-rc-bg rounded-full text-rc-muted hover:text-rc-text transition-colors md:hidden"
          >
            <X size={20} />
          </button>
          
          <div className="relative group w-48 h-48 sm:w-56 sm:h-56 mb-4">
            <div className={`absolute inset-0 rounded-full transition-colors duration-300 ${backgroundColor === 'transparent' ? 'bg-rc-bg' : ''}`} style={{ backgroundColor: backgroundColor !== 'transparent' ? COLORS.find(c => c.id === backgroundColor)?.hex : undefined }}></div>
            <img 
              src={displayUri} 
              alt="Avatar Preview" 
              className={`relative z-10 w-full h-full rounded-full transition-transform duration-300 transform group-hover:scale-105 ${customAvatarUri ? 'object-cover' : ''}`}
            />
            <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 z-20 flex gap-2 w-max">
              <label className="bg-rc-surface border border-rc-border text-rc-text px-4 py-2.5 rounded-full shadow-lg flex items-center gap-2 hover:bg-rc-bg transition-colors text-sm font-bold cursor-pointer active:scale-95">
                <Upload size={16} /> Upload
                <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
              </label>
              <button 
                onClick={handleRandomize}
                className="bg-rc-accent text-white px-4 py-2.5 rounded-full shadow-lg flex items-center gap-2 hover:bg-rc-accentLt transition-colors text-sm font-bold active:scale-95"
              >
                <RefreshCw size={16} /> Randomize
              </button>
            </div>
          </div>
          <p className="text-rc-muted text-xs text-center mt-6 hidden md:block">
            Avatars generated locally<br/>using DiceBear API.
          </p>
        </div>

        {/* Right Side: Controls */}
        <div className="flex-1 p-6 md:p-8 flex flex-col overflow-y-auto">
          <div className="flex justify-between items-center mb-8 hidden md:flex">
            <div>
              <h2 className="text-2xl font-bold text-rc-text">Design Avatar</h2>
              <p className="text-rc-muted text-sm mt-1">Create your unique identity</p>
            </div>
            <button 
              onClick={onClose}
              className="p-2 bg-rc-surface hover:bg-rc-bg border border-rc-border rounded-full text-rc-muted hover:text-rc-text transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          <div className="space-y-8 flex-1">
            {/* Style Selector */}
            <div>
              <label className="block text-xs font-semibold text-rc-muted mb-3 uppercase tracking-wider">Art Style</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-2 gap-3">
                {STYLES.map(style => (
                  <button
                    key={style.id}
                    onClick={() => { setCustomAvatarUri(null); setActiveStyle(style); }}
                    className={`p-3 rounded-xl border text-sm font-medium transition-all text-left flex items-center justify-between ${
                      activeStyle.id === style.id 
                        ? 'bg-rc-accent/10 border-rc-accent text-rc-accentGlow shadow-glowSm' 
                        : 'bg-rc-surface border-rc-border text-rc-muted hover:border-rc-border/80 hover:text-rc-text'
                    }`}
                  >
                    {style.name}
                    {activeStyle.id === style.id && <div className="w-2 h-2 rounded-full bg-rc-accent"></div>}
                  </button>
                ))}
              </div>
            </div>

            {/* Color Selector */}
            <div>
              <label className="block text-xs font-semibold text-rc-muted mb-3 uppercase tracking-wider">Background Color</label>
              <div className="flex gap-3 flex-wrap">
                {COLORS.map(color => (
                  <button
                    key={color.id}
                    onClick={() => { setCustomAvatarUri(null); setBackgroundColor(color.id); }}
                    className={`w-12 h-12 rounded-full border-2 transition-all flex items-center justify-center ${
                      backgroundColor === color.id ? 'border-rc-accent scale-110 shadow-glowSm ring-4 ring-rc-accent/20' : 'border-rc-border scale-100 hover:scale-105'
                    }`}
                    style={{ backgroundColor: color.hex === 'transparent' ? '#1a1b23' : color.hex }}
                    title={color.id}
                  >
                    {color.id === 'transparent' && <span className="w-full h-px bg-rc-border transform rotate-45"></span>}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-rc-border">
            <button
              onClick={handleSave}
              className="w-full btn-primary py-4 text-base font-bold flex items-center justify-center gap-2"
            >
              <Check size={20} />
              Save Avatar & Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
