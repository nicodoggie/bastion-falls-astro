import { AstroBlogTailwindPaths } from "astro-blog";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,ts,tsx}", ...AstroBlogTailwindPaths],
};
