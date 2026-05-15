import { Heart } from 'lucide-react';
import { Link } from 'react-router-dom';

export function Footer() {
  return (
    <footer className="w-full border-t border-rc-border bg-rc-bg/50 mt-auto">
      <div className="max-w-5xl mx-auto px-4 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-rc-muted text-sm">
          <span>&copy; {new Date().getFullYear()} RandomChat.</span>
          <span className="flex items-center gap-1">Made with <Heart size={14} className="text-red-500 fill-red-500" /></span>
        </div>
        
        <div className="flex items-center gap-6">
          <Link to="/terms" className="text-rc-muted hover:text-rc-text transition-colors text-sm">Terms</Link>
          <Link to="/privacy" className="text-rc-muted hover:text-rc-text transition-colors text-sm">Privacy</Link>
          <div className="w-px h-4 bg-rc-border"></div>
          <a href="#" className="flex items-center gap-1.5 text-rc-muted hover:text-rc-text transition-colors text-sm font-medium">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
              <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
              <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
            </svg>
            Instagram
          </a>
          <a href="#" className="flex items-center gap-1.5 text-rc-muted hover:text-rc-text transition-colors text-sm font-medium">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 3a10.9 10.9 0 0 1-3.14 1.53 4.48 4.48 0 0 0-7.86 3v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z"></path>
            </svg>
            Twitter
          </a>
        </div>
      </div>
    </footer>
  );
}
