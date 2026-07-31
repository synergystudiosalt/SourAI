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
        primary: '#fbfcfd',
        secondary: '#f6f8fa',
        tertiary: '#e3e7ee',
        overlay: '#f9fafc',
      },
      // Primary text
      text: {
        primary: '#16181d',
        secondary: '#484b51',
        tertiary: '#78828e',
        disabled: '#9297a0',
      },
      // Borders
      border: {
        light: '#e3e4e6',
        medium: '#d5d9e2',
        dark: '#c3cad6',
      },
      // Semantic colors
      accent: '#4776d5', // Burnt orange/coral
      success: '#10b981',
      error: '#ef4444',
      warning: '#115bef',
      info: '#3b82f6',
    },
    dark: {
      // Primary backgrounds
      bg: {
        primary: '#17191d',
        secondary: '#1e2128',
        tertiary: '#1e2128',
        overlay: '#121316',
      },
      // Primary text
      text: {
        primary: '#dce0e5',
        secondary: '#acadaf',
        tertiary: '#a9afbc',
        disabled: '#727375',
      },
      // Borders
      border: {
        light: '#282c33',
        medium: '#313233',
        dark: '#3b414d',
      },
      // Semantic colors
      accent: '#6b9af9', // Lighter orange for dark mode
      success: '#6ee7b7',
      error: '#f87171',
      warning: '#296df6',
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
      primary: 'bg-[#4776d5] text-white hover:bg-[#3967c4] active:bg-[#2b59b4] disabled:opacity-50 disabled:cursor-not-allowed',
      secondary: 'bg-[#e3e7ee] dark:bg-[#282c33] text-[#16181d] dark:text-[#dce0e5] hover:bg-[#d5dae4] dark:hover:bg-[#3b414d] active:bg-[#cfd4dd] dark:active:bg-[#404142]',
      ghost: 'text-[#4a5259] dark:text-[#9a9da2] hover:bg-[#f2f4f7] dark:hover:bg-[#1e2128] hover:text-[#16181d] dark:hover:text-[#dce0e5]',
      danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 disabled:opacity-50',
    },

    // Input styles
    input: {
      base: 'w-full px-3 py-2 rounded-lg bg-white dark:bg-[#17191d] border border-[#dcdfe6] dark:border-[#282c33] text-[#16181d] dark:text-[#dce0e5] placeholder-[#78828e] dark:placeholder-[#727375] outline-none transition-colors',
      focus: 'focus:border-[#b9bcc2] dark:focus:border-[#444] focus:ring-2 focus:ring-[#4776d5]/20',
    },

    // Card styles with subtle shadows and borders
    card: {
      base: 'rounded-lg border border-[#e3e4e6] dark:border-[#282c33] bg-white dark:bg-[#1e2128] shadow-sm',
      hover: 'hover:shadow-md transition-shadow',
    },

    // Badge styles
    badge: {
      base: 'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium',
      primary: 'bg-[#4776d5] text-white',
      secondary: 'bg-[#dfe2e8] dark:bg-[#282c33] text-[#484b51] dark:text-[#acadaf]',
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
