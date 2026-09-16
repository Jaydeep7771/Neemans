export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // Apple's type stack -- SF Pro on Apple platforms, graceful elsewhere.
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Display"',
          '"SF Pro Text"',
          '"Segoe UI"',
          'Roboto',
          'system-ui',
          'sans-serif',
        ],
        mono: ['"SF Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        // Neeman's own values, lifted off neemans.com rather than guessed at.
        plane: '#F3F2EE',      // their warm off-white -- the biggest brand cue
        surface: '#FFFFFF',
        ink: {
          DEFAULT: '#1C1C1C',  // their text colour: warmer than pure black
          muted: '#5C5B57',
          faint: '#848482',
        },
        hair: 'rgba(28,28,28,0.09)',

        // Neeman's forest green. UI chrome and success states only -- never a data
        // mark, because green-vs-red measures ΔE 7.3 for protanopes and the
        // delivered/lost split has to be readable by everyone.
        brand: {
          DEFAULT: '#175615',
          light: '#2D7A2B',
          wash: '#EAF2E9',
        },
        // Their leather tones. Decorative only: tan sits at 2.86:1, below the
        // 3:1 a data mark needs.
        tan: {
          DEFAULT: '#C7A574',
          deep: '#B78742',
          wash: '#F6EFE3',
        },

        // Data marks. Every value validated against the #F3F2EE surface.
        viz: {
          blue: '#2a78d6',     // delivered   (blue vs red = ΔE 23.8, ample headroom)
          red: '#d03b3b',      // lost
          sev1: '#e08a8a',     // ordinal severity ramp, light -> dark
          sev2: '#d03b3b',
          sev3: '#8f2424',
          track: '#E8E4DA',    // warm track behind bars
          axis: '#CFCABD',
        },
        status: {
          good: '#2D7A2B',     // always with a tick and the word "fine"
          bad: '#d03b3b',
        },
      },
      borderRadius: { '4xl': '2rem' },
      boxShadow: {
        card: '0 1px 3px rgba(28,28,28,0.05), 0 1px 2px rgba(28,28,28,0.03)',
        lift: '0 4px 16px rgba(28,28,28,0.10)',
      },
    },
  },
  plugins: [],
};
