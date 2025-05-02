/** @type {import("prettier").Config} */
export default {
  plugins: [
    "prettier-plugin-astro",
    "prettier-plugin-multiline-arrays",
  ],
  printWidth: 80,
  proseWrap: "always",
  trailingComma: "all",
  semi: true,
  multilineArraysWrapThreshold: 1,
  
};
