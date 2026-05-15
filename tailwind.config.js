/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        rc: {
          // Backgrounds
          bg:        '#0d0d1a',   // near-black with purple tint
          surface:   '#13132b',   // card surface
          panel:     '#1a1a35',   // elevated panels (header, input)
          border:    '#2a2a55',   // subtle border
          // Accent
          accent:    '#7c3aed',   // violet-600
          accentLt:  '#8b5cf6',   // violet-500
          accentGlow:'#a78bfa',   // violet-400
          // Bubbles
          bubbleMe:  '#4c1d95',   // own message (deep violet)
          bubbleThem:'#1e1b4b',   // their message (indigo dark)
          // Text
          text:      '#e2e8f0',   // slate-200
          muted:     '#64748b',   // slate-500
          dimmed:    '#475569',   // slate-600
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow:  '0 0 20px rgba(124,58,237,0.35)',
        glowSm:'0 0 10px rgba(124,58,237,0.25)',
      },
      animation: {
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'float': 'float 6s ease-in-out infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-8px)' },
        }
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(ellipse at center, var(--tw-gradient-stops))',
        'gradient-mesh': 'radial-gradient(at 20% 50%, #3b0764 0%, transparent 50%), radial-gradient(at 80% 20%, #1e1b4b 0%, transparent 50%), radial-gradient(at 60% 80%, #0f172a 0%, transparent 50%)',
      }
    },
  },
  plugins: [],
}
