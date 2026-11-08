/** 两阶段流水线：阶段 1 章节拆分（TOC）→ 阶段 2 并行内容生成。 */
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Config } from "./config.ts";
import { runAgent } from "./agent.ts";
import { step1Prompts, step2Prompts } from "./prompts.ts";
import { buildTocNavigation, extractBlogContent, parseTocXml, type Topic } from "./toc.ts";
import { dirStructureText } from "./tools.ts";
import { Log, dim, green, red, yellow } from "./log.ts";

export interface WikiPage {
  slug: string;
  title: string;
  file: string;
  section: string;
  level: string;
  group?: string;
}

export interface WikiIndex {
  id: string;
  generated_at: string;
  language: string;
  pages: WikiPage[];
}

export interface PipelineResult {
  projectPath: string;
  projectName: string;
  versionDir: string;
  topics: Topic[];
  wiki: WikiIndex;
  failed: string[];
}

function timestamp(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

export function buildWiki(versionId: string, topics: Topic[], language: string): WikiIndex {
  const pages: WikiPage[] = topics.map((t) => ({
    slug: t.slug,
    title: t.name,
    file: `${t.slug}.md`,
    section: t.sectionName,
    level: t.level,
    ...(t.groupName ? { group: t.groupName } : {}),
  }));
  return {
    id: versionId,
    generated_at: new Date().toISOString(),
    language,
    pages,
  };
}

/** 运行完整分析流水线，输出到目标项目的 .zread/ 下。 */
export async function runPipeline(config: Config, projectPath: string, log: Log): Promise<PipelineResult> {
  const projectName = basename(projectPath);
  const wikiDir = join(projectPath, ".zread", "wiki");
  const versionsDir = join(wikiDir, "versions");
  const versionId = timestamp();
  const versionDir = join(versionsDir, versionId);
  mkdirSync(versionDir, { recursive: true });
  writeFileSync(join(wikiDir, "current"), `versions/${versionId}`);
  log.info(`报告输出目录: ${versionDir}`);

  const promptVars = {
    workingDir: projectPath,
    osName: process.platform,
    docLanguage: config.docLanguage,
    targetAudience: config.targetAudience,
    repoStructure: dirStructureText(projectPath, ".", 2),
  };

  // ====== 阶段 1: 章节拆分 ======
  log.rule(`阶段 1/2: 章节拆分 [${projectName}]`);
  const step1 = step1Prompts(promptVars);
  const tocRun = await runAgent(config, projectPath, {
    system: step1.system,
    user: step1.user,
    label: "  ",
    onToolCall: (name, input) => log.tool(name, summarizeInput(input)),
  });
  const topics = parseTocXml(tocRun.text);
  if (!topics.length) throw new Error("章节拆分失败：未能解析出任何主题");

  log.info(`  识别到 ${topics.length} 个主题:`);
  for (const topic of topics) {
    const group = topic.groupName ? ` (${topic.groupName})` : "";
    log.info(`    [${topic.sectionName}] ${topic.name} [${topic.level}]${group}`);
  }

  const wiki = buildWiki(
    versionId,
    topics,
    config.docLanguage === "中文" ? "zh" : "en",
  );
  writeFileSync(join(versionDir, "wiki.json"), JSON.stringify(wiki, null, 2));

  // ====== 阶段 2: 内容生成 ======
  log.rule("阶段 2/2: 内容生成");
  log.info(`  并行模式: ${config.threads} 线程, ${topics.length} 个主题`);

  const failed: string[] = [];
  let cursor = 0;
  let done = 0;
  const workerCount = Math.min(config.threads, topics.length);
  const logPrefix = "  ";
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= topics.length) break;
      const topic = topics[i]!;
      const short = `[${topic.sectionName}] ${topic.name}`;
      try {
        const step2 = step2Prompts({
          ...promptVars,
          currentSection: topic.sectionName,
          currentTopic: topic.name,
          fullToc: buildTocNavigation(topics, topic),
        });
        const run = await runAgent(config, projectPath, { system: step2.system, user: step2.user });
        const content = extractBlogContent(run.text);
        writeFileSync(join(versionDir, `${topic.slug}.md`), content);
        done += 1;
        log.ok(`✓ ${short} ${dim(`(${done}/${topics.length}, ${run.turns} 轮)`)}`);
      } catch (error) {
        failed.push(topic.name);
        log.fail(`✗ ${short} - ${errorMessage(error)}`);
      }
    }
  });
  await Promise.all(workers);

  log.rule("分析完成");
  const successCount = topics.length - failed.length;
  log.info(`  共 ${topics.length} 个主题，成功 ${green(String(successCount))}` + (failed.length ? `，失败 ${red(String(failed.length))}` : ""));
  if (failed.length) log.info(`  失败主题: ${yellow(failed.join("、"))}`);
  log.info(`  报告目录: ${versionDir}`);

  return { projectPath, projectName, versionDir, topics, wiki, failed };
}

function summarizeInput(input: Record<string, unknown>): string {
  const json = JSON.stringify(input);
  return json.length > 120 ? `${json.slice(0, 120)}...` : json;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
