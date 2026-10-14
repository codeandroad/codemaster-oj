import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      // Code editors deliberately use document navigation so unsaved work triggers beforeunload.
      "@next/next/no-html-link-for-pages": "off",
      // Request-key changes synchronously reset loading/error before the new external request.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  globalIgnores([".next/**", "next-env.d.ts", "node_modules/**"]),
]);
