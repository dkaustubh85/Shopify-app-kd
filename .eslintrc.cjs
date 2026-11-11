module.exports = {
  root: true,
  env: { browser: true, node: true, es2022: true },
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  extends: ["eslint:recommended", "prettier"],
  rules: { "no-constant-condition": ["error", { checkLoops: false }] },
  ignorePatterns: [
    "build",
    ".react-router",
    "node_modules",
    "node_modules.remix-backup",
    ".cache",
  ],
  overrides: [
    {
      files: ["**/*.ts", "**/*.tsx"],
      parser: "@typescript-eslint/parser",
      plugins: ["@typescript-eslint"],
      extends: ["plugin:@typescript-eslint/recommended"],
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-unused-vars": [
          "error",
          { argsIgnorePattern: "^_" },
        ],
      },
    },
    {
      files: ["app/**/*.tsx"],
      plugins: ["react", "react-hooks", "jsx-a11y"],
      extends: [
        "plugin:react/recommended",
        "plugin:react/jsx-runtime",
        "plugin:react-hooks/recommended",
      ],
      settings: { react: { version: "detect" } },
      rules: { "react/prop-types": "off" },
    },
  ],
};
