import type { Config } from 'tailwindcss'

export default {
  content: [],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"IBM Plex Mono"', 'monospace'],
        sans: ['"IBM Plex Sans"', 'sans-serif'],
      },
      colors: {
        ink: {
          DEFAULT: '#1a1a2e',
          light: '#3d3d5c',
          faint: '#9999b3',
          ghost: '#ccccda',
        },
        surface: {
          DEFAULT: '#fafaf8',
          warm: '#f4f3f0',
          ruled: '#eeeee8',
        },
        accent: {
          DEFAULT: '#e63946',
          dim: '#e6394620',
        },
      },
    },
  },
} satisfies Config
