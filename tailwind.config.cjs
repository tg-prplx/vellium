module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: "#1a1a1a",
          secondary: "#222222",
          tertiary: "#2a2a2a",
          hover: "#333333",
          active: "#3a3a3a"
        },
        border: {
          DEFAULT: "#333333",
          subtle: "#2a2a2a",
          strong: "#444444"
        },
        text: {
          primary: "#f5f5f5",
          secondary: "#a0a0a0",
          tertiary: "#707070",
          inverse: "#1a1a1a"
        },
        accent: {
          DEFAULT: "#d97757",
          hover: "#c4664a",
          subtle: "rgba(217, 119, 87, 0.12)",
          border: "rgba(217, 119, 87, 0.3)"
        },
        success: {
          DEFAULT: "#4ade80",
          subtle: "rgba(74, 222, 128, 0.12)",
          border: "rgba(74, 222, 128, 0.3)"
        },
        warning: {
          DEFAULT: "#fbbf24",
          subtle: "rgba(251, 191, 36, 0.12)",
          border: "rgba(251, 191, 36, 0.3)"
        },
        danger: {
          DEFAULT: "#f87171",
          subtle: "rgba(248, 113, 113, 0.12)",
          border: "rgba(248, 113, 113, 0.3)"
        }
      },
      fontFamily: {
        sans: ["Manrope", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"]
      },
      borderRadius: {
        "2xl": "16px",
        "xl": "12px",
        "lg": "8px",
        "md": "6px"
      },
      boxShadow: {
        "soft": "0 1px 3px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.2)",
        "medium": "0 4px 12px rgba(0, 0, 0, 0.4)",
        "glow": "0 0 0 3px rgba(217, 119, 87, 0.15)"
      }
    }
  },
  plugins: []
};
