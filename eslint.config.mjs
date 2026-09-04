import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // The codebase uses the classic mounted-flag / localStorage-hydration
      // patterns (setState in a mount effect). They work and predate this
      // rule; rewriting them wholesale is riskier than the win. Keep the
      // signal as a warning so new code still gets flagged.
      "react-hooks/set-state-in-effect": "warn",
      // Leading underscore = intentionally unused (kept-for-signature params,
      // destructure discards in tests).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "public/sw.js",
    ".local-db/**",
    ".claude/**",
  ]),
]);

export default eslintConfig;
