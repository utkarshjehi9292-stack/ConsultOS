import type { Config } from "tailwindcss";

// Founders will use this on phones (CLAUDE.md) — mobile-first, high legibility.
// Sober, document-like palette: this is analysis a founder screenshots and sends
// to a co-founder, not a flashy dashboard.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#14171f",
        paper: "#f7f7f4",
        line: "#e3e2dc",
        // Provenance colors: facts vs strategy readings must read differently.
        fact: "#2f6f4f", // "From platform data" — grounded
        reading: "#7a5b18", // "Strategy reading" — interpretive
        flag: "#a3341f", // sanity-check failures / low confidence
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
