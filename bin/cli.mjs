#!/usr/bin/env node
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args.includes("--version") || args.includes("-v")) {
  console.log(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
  process.exit(0);
}
if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}
function printHelp() {
  console.log(`zpi-zread — AI 代码库文档生成器

用法:
  zpi-zread [路径] [选项]       分析代码库，生成 Wiki 文档
  zpi-zread preview [路径]      浏览器预览已生成的文档

选项:
  --model <id>     模型，默认 deepseek-flash（可用 deepseek-v4-pro 等）
  --effort <级别>  思考强度 off|low|medium|high|xhigh|max，默认 max
  --threads <n>    内容生成并行数，默认 10
  --preview        生成完成后自动启动浏览器预览
  --port <n>       预览端口，默认 8765
  --no-open        预览时不自动打开浏览器
  -v, --version    显示版本
  -h, --help       显示帮助

环境变量:
  DEEPSEEK_API_KEY        DeepSeek API 密钥（必填）
  ZREAD_MODEL             等价于 --model
  ZREAD_EFFORT            等价于 --effort
  ZREAD_THREADS           等价于 --threads
  ZREAD_DOC_LANGUAGE      文档语言，默认 中文
  ZREAD_TARGET_AUDIENCE   目标受众，默认 初级开发者

输出写入目标项目的 .zread/wiki/versions/<时间戳>/ 目录。`);
}

const { main } = await import("../dist/cli.js");
process.exitCode = await main();
