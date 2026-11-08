/** Agent 文件系统工具：get_dir_structure / view_file_in_detail / run_bash（移植自 open-zread fs_tool.py）。 */
import { spawn } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, normalize, resolve } from "node:path";
import { defineTool } from "@zpi-dev/agent-sdk";
import type { ToolDefinition } from "@zpi-dev/agent-sdk/host";
import { Type } from "typebox";

const MAX_READ_SIZE = 20 * 1024; // 单文件告警阈值（20KB × 5）
const MAX_BASH_OUTPUT = 50_000;
const BASH_TIMEOUT_MS = 30_000;

const SKIP_DIRS = new Set([
  ".git", ".svn", ".hg", "node_modules", "vendor", ".venv", "venv",
  "__pycache__", ".idea", ".vscode", ".DS_Store", "dist", "build",
  ".next", ".nuxt", ".cache", ".tox", ".mypy_cache", ".pytest_cache",
  ".eggs",
]);

const ALLOWED_COMMANDS = new Set([
  "ls", "find", "cat", "grep", "head", "tail", "wc", "file", "du", "stat",
  "which", "type", "echo", "pwd", "git", "diff", "sort", "uniq", "awk",
  "sed", "tr", "cut", "xargs", "tee", "date", "uname", "whoami",
]);

const DANGEROUS_PATTERNS = [
  "rm ", "mv ", "cp ", "chmod ", "chown ", "kill ", "sudo ",
  "curl ", "wget ", ">", ">>", "|", "&&", ";", "`", "$(",
  "python", "node", "bash", "sh ", "zsh", "npm ", "pip ",
  "uv ", "docker", "make",
];

/** 纯函数版目录树（Agent 工具与流水线预生成共用）。 */
export function dirStructureText(root: string, dirPath = ".", maxDepth = 3): string {
  const target = safeResolve(root, dirPath);
  let stat;
  try {
    stat = statSync(target);
  } catch {
    return `错误：${dirPath} 不是有效目录`;
  }
  if (!stat.isDirectory()) return `错误：${dirPath} 不是有效目录`;
  const lines: string[] = [];
  walkDir(target, lines, "", 0, maxDepth);
  return lines.length ? lines.join("\n") : `（空目录：${dirPath}）`;
}

function walkDir(path: string, lines: string[], prefix: string, depth: number, maxDepth: number): void {
  if (depth >= maxDepth) return;
  let entries: string[];
  try {
    entries = readdirSync(path).sort();
  } catch {
    lines.push(`${prefix}（无权限）`);
    return;
  }
  const filtered = entries.filter((name) => {
    if (SKIP_DIRS.has(name)) return false;
    if (name.startsWith(".") && name !== ".env" && name !== ".env.example") return false;
    return true;
  });
  for (const [i, name] of filtered.entries()) {
    const full = join(path, name);
    const isLast = i === filtered.length - 1;
    const connector = isLast ? "└── " : "├── ";
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      // 无法 stat 的条目按文件展示
    }
    if (isDir) {
      lines.push(`${prefix}${connector}${name}/`);
      walkDir(full, lines, prefix + (isLast ? "    " : "│   "), depth + 1, maxDepth);
    } else {
      lines.push(`${prefix}${connector}${name}`);
    }
  }
}

function safeResolve(root: string, relative: string): string {
  const target = normalize(isAbsolute(relative) ? relative : join(root, relative));
  return target;
}

export interface FsTools {
  tools: ToolDefinition[];
  names: string[];
}

/** 为指定项目根目录创建 3 个文件系统工具。 */
export function createFsTools(projectRoot: string): FsTools {
  const getDirStructure = defineTool({
    name: "get_dir_structure",
    description:
      "获取本地目录结构。以树形文本展示目录内容，支持指定子目录和最大递归深度。" +
      "自动过滤常见依赖目录（node_modules、vendor 等）。dir_path 使用相对于工作目录的路径，\".\" 表示根目录。",
    parameters: Type.Object({
      dir_path: Type.Optional(Type.String({ description: "相对于工作目录的路径，默认 \".\"" })),
      max_depth: Type.Optional(Type.Number({ description: "最大递归深度，默认 3" })),
    }),
    execute({ dir_path = ".", max_depth = 3 }) {
      return dirStructureText(projectRoot, dir_path, max_depth);
    },
  });

  const viewFileInDetail = defineTool({
    name: "view_file_in_detail",
    description:
      "查看本地文件内容。支持指定起始/结束行号（默认前 200 行）和是否显示行号。" +
      "file_path 使用相对于工作目录的路径。",
    parameters: Type.Object({
      file_path: Type.String({ description: "相对于工作目录的文件路径" }),
      start_line: Type.Optional(Type.Number({ description: "起始行号（从 1 开始），默认 1" })),
      end_line: Type.Optional(Type.Number({ description: "结束行号，默认 200" })),
      show_line_numbers: Type.Optional(Type.Boolean({ description: "是否显示行号，默认 true" })),
    }),
    execute({ file_path, start_line = 1, end_line = 200, show_line_numbers = true }) {
      const target = safeResolve(projectRoot, file_path);
      let stat;
      try {
        stat = statSync(target);
      } catch {
        return `错误：${file_path} 不是有效文件`;
      }
      if (!stat.isFile()) return `错误：${file_path} 不是有效文件`;
      if (stat.size > MAX_READ_SIZE * 5) {
        return `警告：文件过大（${stat.size} 字节），建议分段查看`;
      }
      let text: string;
      try {
        text = readFileSync(target, "utf8");
      } catch (error) {
        return `错误：无法读取文件 - ${errorMessage(error)}`;
      }
      const allLines = text.split("\n");
      const start = Math.max(1, start_line);
      const end = Math.min(allLines.length, end_line);
      const selected = allLines.slice(start - 1, end);
      const width = String(end).length;
      const body = show_line_numbers
        ? selected.map((line, i) => `${String(start + i).padStart(width)} | ${line}`).join("\n")
        : selected.join("\n");
      return `文件: ${file_path} (行 ${start}-${end}, 共 ${allLines.length} 行)\n${body}`;
    },
  });

  const runBash = defineTool({
    name: "run_bash",
    description:
      "在本地仓库目录中执行只读 shell 命令。仅允许信息查询类命令（ls, find, cat, grep, head, tail, wc, git log, git show 等）。" +
      "禁止写入、删除、修改文件或执行程序的命令。命令在工作目录下执行，超时 30 秒。",
    parameters: Type.Object({
      command: Type.String({ description: "要执行的 shell 命令" }),
    }),
    execute({ command }, { signal }) {
      return execReadOnly(command, signal, projectRoot);
    },
  });

  return {
    tools: [getDirStructure, viewFileInDetail, runBash],
    names: [getDirStructure.name, viewFileInDetail.name, runBash.name],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function execReadOnly(
  command: string,
  signal: AbortSignal | undefined,
  projectRoot: string,
): Promise<string> {
  const cmdLower = command.toLowerCase().trim();
  for (const pattern of DANGEROUS_PATTERNS) {
    if (cmdLower.includes(pattern)) {
      // 允许 grep/find/git 开头命令内部的管道
      if (pattern === "|" && (cmdLower.startsWith("grep") || cmdLower.startsWith("find") || cmdLower.startsWith("git"))) {
        continue;
      }
      return `错误：命令包含不允许的操作: ${pattern.trim()}`;
    }
  }
  const firstWord = basename(command.trim().split(/\s+/)[0] ?? "");
  if (!ALLOWED_COMMANDS.has(firstWord)) {
    return `错误：不允许的命令: ${firstWord}。允许的命令: ${[...ALLOWED_COMMANDS].sort().join(", ")}`;
  }

  return new Promise((resolvePromise) => {
    const child = spawn("/bin/sh", ["-c", command], { cwd: projectRoot });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (output: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(output);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish("错误：命令执行超时（30 秒）");
    }, BASH_TIMEOUT_MS);
    const onAbort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (error) => finish(`错误：命令执行失败 - ${errorMessage(error)}`));
    child.on("close", () => {
      signal?.removeEventListener("abort", onAbort);
      let output = stdout;
      if (stderr) output += `\n[stderr]: ${stderr}`;
      if (output.length > MAX_BASH_OUTPUT) {
        output = output.slice(0, MAX_BASH_OUTPUT) + `\n...（输出截断，共 ${output.length} 字符）`;
      }
      finish(output.trim() || "（无输出）");
    });
  });
}
