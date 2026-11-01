/** @type {import('tailwindcss').Config} */
module.exports = {
  mode: "jit",
  darkMode: "class",
  content: [
    "./sidepanel.tsx",
    "./content.ts",
    "./background/**/*.tsx",
    "./contents/**/*.tsx",
    "./tabs/**/*.tsx",
    "./components/**/*.{ts,tsx}",
    "./screens/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        // Pentone Wispr Flow-inspired design tokens
        pentone: {
          ivory: '#FFFEEF',
          butter: '#F3F1DF',
          charcoal: '#191919',
          muted: '#77776E',
          forest: '#005447',
          deepgreen: '#003F36',
          lavender: '#E9D2FF',
          lavendersoft: '#F5EBFF',
          border: '#DDDCCB',
          // Dark mode counterparts
          darkbg: '#171816',
          darksurface: '#22231F',
          darktext: '#F5F1E7',
          darkmuted: '#A6A49B',
          darkforest: '#07584B',
          darkdeepgreen: '#064238',
          darklavender: '#CDB0F3',
          darkborder: '#373832'
        }
      },
      fontFamily: {
        display: ['Newsreader', 'Fraunces', 'Playfair Display', 'Georgia', 'Cambria', 'serif'],
        sans: ['Plus Jakarta Sans', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace']
      }
    }
  },
  plugins: []
}
