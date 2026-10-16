import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    // DB tests share one Postgres database (secrets.test clears the whole table), so files run one at a time.
    fileParallelism: false,
    environment: "node",
    include: ["src/**/*.test.ts", "fixtures/**/*.test.ts"],
  },
});
