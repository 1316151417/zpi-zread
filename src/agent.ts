/** Agent 运行器：把 zpi-agent-sdk 的 query() 包装成"给提示词、返回最终文本"的调用。 */
import { query, type SDKMessage } from "@zpi-dev/agent-sdk";
import type { Config } from "./config.ts";
import { createFsTools } from "./tools.ts";

export interface AgentRun {
  system: string;
  user: string;
  /** 日志前缀，如 "  " 或主题名 */
  label?: string;
  /** 工具调用回调（用于进度展示） */
  onToolCall?: (name: string, input: Record<string, unknown>) => void;
}

export interface AgentResult {
  text: string;
  turns: number;
}

export async function runAgent(
  config: Config,
  projectPath: string,
  run: AgentRun,
): Promise<AgentResult> {
  const fsTools = createFsTools(projectPath);
  const response = query({
    prompt: run.user,
    options: {
      cwd: projectPath,
      model: config.model,
      env: { ...process.env, DEEPSEEK_API_KEY: config.apiKey || process.env.DEEPSEEK_API_KEY },
      systemPrompt: run.system,
      tools: fsTools.names,
      allowedTools: fsTools.names,
      zpi: { customTools: fsTools.tools },
      thinking: config.effort === "off" ? { type: "disabled" } : { type: "adaptive" },
      effort: config.effort === "off" ? undefined : config.effort,
      maxTurns: config.maxSteps,
      settingSources: [],
      persistSession: false,
    },
  });

  let text = "";
  let turns = 0;
  for await (const message of response) {
    collect(message, run.onToolCall);
    if (message.type === "result") {
      turns = message.num_turns;
      if (message.subtype === "success") {
        text = message.result;
      } else {
        const partial = (message as { result?: string }).result;
        if (partial) {
          // 达到轮数上限等情况：接受已有输出并继续
          text = partial;
        } else {
          throw new Error(message.errors?.join("\n") || `Agent 运行失败: ${message.subtype}`);
        }
      }
    }
  }
  return { text, turns };
}

function collect(message: SDKMessage, onToolCall?: (name: string, input: Record<string, unknown>) => void): void {
  if (message.type !== "assistant") return;
  for (const block of message.message.content) {
    if (block.type === "tool_use" && onToolCall) {
      onToolCall(block.name, (block.input ?? {}) as Record<string, unknown>);
    }
  }
}
