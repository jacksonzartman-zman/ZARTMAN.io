// Minimal ESM ESLint config to avoid importing internal eslint subpaths
// The repository also contains a `.eslintrc.json` which will be used
// by eslint for rules; keep this file minimal to avoid resolver errors.
export default {
  ignores: [".next/**", "out/**", "build/**", "node_modules/**"],
};
