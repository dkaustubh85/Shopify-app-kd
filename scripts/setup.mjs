import { spawnSync } from "node:child_process";
const schema =
  process.env.DATABASE_PROVIDER === "postgresql"
    ? "prisma/postgresql/schema.prisma"
    : "prisma/schema.prisma";
for (const args of process.argv.includes("--skip-generate")
  ? [["migrate", "deploy"]]
  : [["generate"], ["migrate", "deploy"]]) {
  const result = spawnSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", ...args, "--schema", schema],
    { stdio: "inherit", env: process.env },
  );
  if (result.status !== 0) process.exit(result.status || 1);
}
