import { build } from "esbuild";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
await rm("dist", { recursive: true, force: true });

await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
  platform: "node",
  target: "node24",
  format: "esm",
  bundle: true,
  // 运行时依赖（agent-sdk、typebox、marked、pinyin-pro）保持 external，随 package.json 安装
  packages: "external",
  banner: {
    js: "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);",
  },
});
console.log("dist/cli.js built");
