/** @type {import('tailwindcss').Config} */
export default {
  content: ["./renderer/**/*.html", "./renderer/**/*.js"],
  theme: {
    extend: {
      colors: {
        text: "#e7edf7",
        muted: "#9aa6b2",
      },
      fontFamily: {
        sans: ["ui-sans-serif", "system-ui", "Arial"],
      },
      keyframes: {
        floatIn: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        floatIn: "floatIn 420ms ease both",
      },
    },
  },
  plugins: [],
};
