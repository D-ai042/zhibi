/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        locked: "#d4a017",
        "plot-bright": "#93c5fd",
        "plot-dark": "#7c3aed",
        convergence: "#f97316",
        "ai-pending": "#e9d5ff",
        review: "#fb923c",
      },
    },
  },
  plugins: [],
};
