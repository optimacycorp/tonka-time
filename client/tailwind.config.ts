import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        clay: "#d6c0a3",
        soil: "#7a4b2b",
        field: "#294534",
        sky: "#f5f1e8",
        ember: "#df6b37",
      },
      fontFamily: {
        display: ["'League Spartan'", "sans-serif"],
        body: ["'DM Sans'", "sans-serif"],
      },
      boxShadow: {
        card: "0 20px 60px rgba(35, 24, 18, 0.08)",
      },
    },
  },
  plugins: [],
} satisfies Config;
