/** 配置：环境变量 + 默认值，参考 zpi-quick-chat 的极简风格。 */

export type Effort = "off" | "low" | "medium" | "high" | "xhigh" | "max";

export interface Config {
  /** 模型 ID，默认 deepseek-flash */
  model: string;
  /** 思考强度，off 表示关闭思考 */
  effort: Effort;
  apiKey: string;
  /** 内容生成并行数 */
  threads: number;
  /** 单次 Agent 运行最大轮数 */
  maxSteps: number;
  docLanguage: string;
  targetAudience: string;
}

const EFFORTS: readonly Effort[] = ["off", "low", "medium", "high", "xhigh", "max"];

export function readConfig(env: NodeJS.ProcessEnv): Config {
  const model = env.ZREAD_MODEL?.trim() || "deepseek-flash";
  const effort = (env.ZREAD_EFFORT?.trim() || "max") as Effort;
  if (!EFFORTS.includes(effort)) {
    throw new Error(`ZREAD_EFFORT 必须是 ${EFFORTS.join(" | ")}，当前值: ${effort}`);
  }
  const apiKey = env.DEEPSEEK_API_KEY?.trim() ?? "";
  const needsDeepseekKey = model === "deepseek" || model.startsWith("deepseek-") || model.startsWith("deepseek/");
  if (needsDeepseekKey && !apiKey) throw new Error("DEEPSEEK_API_KEY is required");
  const threads = Number(env.ZREAD_THREADS ?? 10);
  if (!Number.isInteger(threads) || threads < 1) throw new Error("ZREAD_THREADS 必须是正整数");
  const maxSteps = Number(env.ZREAD_MAX_STEPS ?? 50);
  if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new Error("ZREAD_MAX_STEPS 必须是正整数");
  return {
    model,
    effort,
    apiKey,
    threads,
    maxSteps,
    docLanguage: env.ZREAD_DOC_LANGUAGE?.trim() || "中文",
    targetAudience: env.ZREAD_TARGET_AUDIENCE?.trim() || "初级开发者",
  };
}
