/** CLI 入口：参数解析、命令分发（generate / preview）。 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readConfig } from "./config.ts";
import { runPipeline } from "./pipeline.ts";
import { startPreview } from "./preview.ts";
import { Log } from "./log.ts";

interface CliArgs {
  command: "generate" | "preview";
  projectPath: string;
  flags: Record<string, string | boolean>;
}

const USAGE = `用法:
  zpi-zread [路径] [选项]       分析代码库，生成 Wiki 文档
  zpi-zread preview [路径]      浏览器预览已生成的文档

选项:
  --model <id>     模型，默认 deepseek-flash
  --effort <级别>  思考强度 off|low|medium|high|xhigh|max，默认 max
  --threads <n>    内容生成并行数，默认 10
  --preview        生成完成后自动启动浏览器预览
  --port <n>       预览端口，默认 8765
  --no-open        预览时不自动打开浏览器
  -h, --help       显示帮助`;

function parseArgs(argv: string[]): CliArgs {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let command: CliArgs["command"] = "generate";
  const valueFlags = new Set(["--model", "--effort", "--threads", "--port"]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "preview" && i === 0 && positional.length === 0) {
      command = "preview";
      continue;
    }
    if (arg.startsWith("--")) {
      const name = arg.split("=", 2)[0] ?? arg;
      if (valueFlags.has(name)) {
        const inline = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[++i];
        if (inline === undefined) fail(`${name} 需要一个值\n\n${USAGE}`);
        flags[name.slice(2)] = inline;
      } else {
        flags[arg.slice(2)] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  const projectPath = positional[0] ? resolve(positional[0]) : process.cwd();
  return { command, projectPath, flags };
}

/** 极简 .env 加载：KEY=VALUE，支持引号与 # 注释。 */
function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function fail(message: string): never {
  console.error(`zpi-zread: ${message}`);
  process.exit(1);
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return 0;
  }
  const args = parseArgs(argv);
  if (!existsSync(args.projectPath)) fail(`${args.projectPath} 不是有效目录`);
  loadDotEnv(resolve(args.projectPath, ".env"));
  loadDotEnv(resolve(process.cwd(), ".env"));

  if (args.command === "preview") {
    const port = Number(args.flags.port ?? 8765);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) fail("--port 需要是有效端口号");
    try {
      const handle = await startPreview({
        projectPath: args.projectPath,
        port,
        open: !args.flags["no-open"],
      });
      const log = new Log();
      log.info(`文档预览: ${handle.url}`);
      log.info(`版本目录: ${handle.versionDir}`);
      log.info("按 Ctrl+C 退出");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fail(message.includes("EADDRINUSE") ? `端口 ${port} 已被占用，请用 --port 指定其他端口` : message);
    }
    return 0; // server 保持事件循环存活
  }

  // generate
  const flagEnv: Record<string, string> = {};
  if (typeof args.flags.model === "string") flagEnv.ZREAD_MODEL = args.flags.model;
  if (typeof args.flags.effort === "string") flagEnv.ZREAD_EFFORT = args.flags.effort;
  if (typeof args.flags.threads === "string") flagEnv.ZREAD_THREADS = args.flags.threads;
  const config = (() => {
    try {
      return readConfig({ ...process.env, ...flagEnv });
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    }
  })();

  const log = new Log();
  log.info(`模型: ${config.model}  思考强度: ${config.effort}  并行: ${config.threads}`);
  let result;
  try {
    result = await runPipeline(config, args.projectPath, log);
  } catch (error) {
    log.fail(`流水线失败: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  if (args.flags.preview) {
    const port = Number(args.flags.port ?? 8765);
    const handle = await startPreview({ projectPath: args.projectPath, port, open: true });
    log.info(`\n文档预览: ${handle.url}（按 Ctrl+C 退出）`);
    return 0;
  }
  log.info("\n预览报告: npx zpi-zread preview");
  return 0;
}
