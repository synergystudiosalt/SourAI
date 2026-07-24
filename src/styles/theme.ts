/**
 * Comprehensive theme configuration for sour.ai
 * Defines consistent colors, typography, spacing, and animations
 */

export const theme = {
  // Color Palette - Light Mode
  colors: {
    light: {
      // Primary backgrounds
      bg: {
        primary: '#faf9f6',
        secondary: '#f4f2eb',
        tertiary: '#eeebe3',
        overlay: '#fcfbf9',
      },
      // Primary text
      text: {
        primary: '#1c1b1a',
        secondary: '#524f47',
        tertiary: '#8c887d',
        disabled: '#a39d8f',
      },
      // Borders
      border: {
        light: '#e8e7e1',
        medium: '#e2dfd5',
        dark: '#d8d5c9',
      },
      // Semantic colors
      accent: '#d96b43', // Burnt orange/coral
      success: '#10b981',
      error: '#ef4444',
      warning: '#f59e0b',
      info: '#3b82f6',
    },
    dark: {
      // Primary backgrounds
      bg: {
        primary: '#181817',
        secondary: '#1e1e1d',
        tertiary: '#252524',
        overlay: '#121212',
      },
      // Primary text
      text: {
        primary: '#f0efe6',
        secondary: '#b0adab',
        tertiary: '#a09c94',
        disabled: '#767671',
      },
      // Borders
      border: {
        light: '#2d2d2c',
        medium: '#333231',
        dark: '#383836',
      },
      // Semantic colors
      accent: '#ff8a65', // Lighter orange for dark mode
      success: '#6ee7b7',
      error: '#f87171',
      warning: '#fbbf24',
      info: '#60a5fa',
    },
  },

  // Typography
  typography: {
    fontFamily: {
      instrument: '"Instrument Serif", serif',
      jakarta: '"Plus Jakarta Sans", sans-serif',
      newsreader: '"Newsreader", serif',
      pixel: '"Press Start 2P", cursive',
    },
    fontSize: {
      xs: '0.75rem',    // 12px
      sm: '0.875rem',   // 14px
      base: '1rem',     // 16px
      lg: '1.125rem',   // 18px
      xl: '1.25rem',    // 20px
      '2xl': '1.5rem',  // 24px
      '3xl': '1.875rem', // 30px
    },
    fontWeight: {
      light: 300,
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
    lineHeight: {
      tight: 1.2,
      normal: 1.5,
      relaxed: 1.75,
      loose: 2,
    },
  },

  // Spacing
  spacing: {
    xs: '0.25rem',    // 4px
    sm: '0.5rem',     // 8px
    md: '1rem',       // 16px
    lg: '1.5rem',     // 24px
    xl: '2rem',       // 32px
    '2xl': '3rem',    // 48px
    '3xl': '4rem',    // 64px
  },

  // Border Radius
  borderRadius: {
    none: '0',
    sm: '0.25rem',
    md: '0.5rem',
    lg: '0.75rem',
    xl: '1rem',
    '2xl': '1.5rem',
    full: '9999px',
  },

  // Shadows - Enhanced with subtle gradients
  shadows: {
    none: 'none',
    xs: '0 1px 2px rgba(0, 0, 0, 0.05)',
    sm: '0 1px 3px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.06)',
    md: '0 4px 6px rgba(0, 0, 0, 0.1), 0 2px 4px rgba(0, 0, 0, 0.06)',
    lg: '0 10px 15px rgba(0, 0, 0, 0.1), 0 4px 6px rgba(0, 0, 0, 0.05)',
    xl: '0 20px 25px rgba(0, 0, 0, 0.1), 0 10px 10px rgba(0, 0, 0, 0.04)',
    '2xl': '0 25px 50px rgba(0, 0, 0, 0.25)',
  },

  // Transitions & Animations
  transitions: {
    fast: '150ms ease-out',
    base: '200ms ease-out',
    slow: '300ms ease-out',
    verySlow: '500ms ease-out',
  },

  animations: {
    // Smooth fade and scale
    fadeIn: 'opacity-in ease-out',
    fadeOut: 'opacity-out ease-out',
    scaleIn: 'scale-in ease-out',
    scaleOut: 'scale-out ease-out',

    // Smooth height transitions (for collapsible content)
    slideDown: 'slide-down ease-out',
    slideUp: 'slide-up ease-out',

    // Pulse and loading states
    pulse: 'pulse ease-in-out 2s infinite',
    spin: 'spin linear infinite',
  },

  // Component-specific styles
  components: {
    // Button styles
    button: {
      base: 'inline-flex items-center justify-center font-medium rounded-lg transition-all duration-150 cursor-pointer',
      primary: 'bg-[#d96b43] text-white hover:bg-[#c85a35] active:bg-[#b84a27] disabled:opacity-50 disabled:cursor-not-allowed',
      secondary: 'bg-[#eeebe3] dark:bg-[#2d2d2c] text-[#1c1b1a] dark:text-[#f0efe6] hover:bg-[#e4e0d5] dark:hover:bg-[#383836] active:bg-[#ddd9cf] dark:active:bg-[#424240]',
      ghost: 'text-[#615e56] dark:text-[#a3a099] hover:bg-[#efece5] dark:hover:bg-[#252524] hover:text-[#1c1b1a] dark:hover:text-[#f0efe6]',
      danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 disabled:opacity-50',
    },

    // Input styles
    input: {
      base: 'w-full px-3 py-2 rounded-lg bg-white dark:bg-[#1a1a19] border border-[#e6e4dc] dark:border-[#2d2d2c] text-[#1c1b1a] dark:text-[#f0efe6] placeholder-[#8c887d] dark:placeholder-[#767671] outline-none transition-colors',
      focus: 'focus:border-[#c5c2b6] dark:focus:border-[#444] focus:ring-2 focus:ring-[#d96b43]/20',
    },

    // Card styles with subtle shadows and borders
    card: {
      base: 'rounded-lg border border-[#e8e7e1] dark:border-[#2d2d2c] bg-white dark:bg-[#1e1e1d] shadow-sm',
      hover: 'hover:shadow-md transition-shadow',
    },

    // Badge styles
    badge: {
      base: 'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium',
      primary: 'bg-[#d96b43] text-white',
      secondary: 'bg-[#e8e6df] dark:bg-[#2d2d2c] text-[#524f47] dark:text-[#b0adab]',
      success: 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200',
      error: 'bg-red-100 dark:bg-red-950/30 text-red-800 dark:text-red-200',
    },
  },

  // Breakpoints for responsive design
  breakpoints: {
    xs: '0px',
    sm: '640px',
    md: '768px',
    lg: '1024px',
    xl: '1280px',
    '2xl': '1536px',
  },
};

// Export individual sections for convenience
export const lightColors = theme.colors.light;
export const darkColors = theme.colors.dark;
export const typography = theme.typography;
export const spacing = theme.spacing;
export const transitions = theme.transitions;

// Helper function to get current theme colors
export const getThemeColors = (isDarkMode: boolean) => {
  return isDarkMode ? darkColors : lightColors;
};

// Export common animation keyframes for use in CSS
export const animationKeyframes = `
  @keyframes opacity-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes opacity-out {
    from { opacity: 1; }
    to { opacity: 0; }
  }

  @keyframes scale-in {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @keyframes scale-out {
    from {
      opacity: 1;
      transform: scale(1);
    }
    to {
      opacity: 0;
      transform: scale(0.95);
    }
  }

  @keyframes slide-down {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes slide-up {
    from {
      opacity: 1;
      transform: translateY(0);
    }
    to {
      opacity: 0;
      transform: translateY(-4px);
    }
  }

  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }
`;
