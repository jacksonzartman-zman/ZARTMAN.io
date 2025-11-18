import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand maroon accent
        brand: {
          DEFAULT: "#9F1239",  // main maroon
          soft: "#7F0F30",     // darker hover
          pale: "#FDE4EC",     // very soft bg/pills
        },

        // Background system (dark, but not pure black)
        page: {
          DEFAULT: "#05070A",  // body background
          soft: "#0B0F16",     // cards / sections
          softer: "#141823",   // elevated surfaces
        },

        // Text system
        ink: {
          DEFAULT: "#F9FAFB",  // main text
          soft: "#E5E7EB",     // secondary
          muted: "#9CA3AF",    // tertiary / captions
        },

        // Borders & lines
        line: {
          subtle: "#1F2933",
          strong: "#374151",
        },

        // Utility colors
        success: {
          DEFAULT: "#16A34A",
          soft: "#052E16",
        },
        danger: {
          DEFAULT: "#DC2626",
          soft: "#450A0A",
        },
        // You can still use Tailwind's gray/emerald/etc alongside these
      },

      fontFamily: {
        // System-y but nice
        sans: [
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Text",
          "ui-sans-serif",
          "sans-serif",
        ],
      },

      borderRadius: {
        xl: "1.25rem",
        "2xl": "1.75rem",
        pill: "999px",
      },

      boxShadow: {
        // Softer, product-y shadows
        "lift-sm": "0 10px 25px rgba(0,0,0,0.35)",
        "lift-md": "0 18px 45px rgba(0,0,0,0.45)",
      },

      maxWidth: {
        page: "1120px",
        copy: "720px",
      },

      spacing: {
        18: "4.5rem",
        22: "5.5rem",
      },
    },
  },
  plugins: [],
};

export default config;