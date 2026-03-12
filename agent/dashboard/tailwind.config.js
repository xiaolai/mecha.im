/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        success: { DEFAULT: "hsl(var(--success))", foreground: "hsl(var(--success-foreground))" },
        warning: { DEFAULT: "hsl(var(--warning))", foreground: "hsl(var(--warning-foreground))" },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        sidebar: {
          DEFAULT: "hsl(var(--sidebar))",
          foreground: "hsl(var(--sidebar-foreground))",
          border: "hsl(var(--sidebar-border))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          muted: "hsl(var(--sidebar-muted))",
        },
        msg: {
          user: { DEFAULT: "hsl(var(--msg-user))", foreground: "hsl(var(--msg-user-foreground))" },
          assistant: { DEFAULT: "hsl(var(--msg-assistant))", foreground: "hsl(var(--msg-assistant-foreground))" },
          tool: { DEFAULT: "hsl(var(--msg-tool))", border: "hsl(var(--msg-tool-border))" },
        },
        code: { bg: "hsl(var(--code-bg))", border: "hsl(var(--code-border))", text: "hsl(var(--code-text))" },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: [
          "ui-sans-serif", "-apple-system", "BlinkMacSystemFont", "Segoe UI",
          "Helvetica", "Arial", "sans-serif", "Apple Color Emoji", "Segoe UI Emoji",
        ],
        mono: [
          "ui-monospace", "SFMono-Regular", "SF Mono", "Menlo", "Consolas",
          "Liberation Mono", "monospace",
        ],
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
