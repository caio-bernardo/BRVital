import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "jsdom", include: ["*.test.ts", "*.test.tsx"] },
  resolve: { alias: { "react-native": "react-native-web" } },
  esbuild: { jsx: "automatic" },
});
