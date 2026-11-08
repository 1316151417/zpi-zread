/** TOC 解析、slug 生成、导航上下文构建、内容提取（移植自 open-zread util/utils.py）。 */
import { pinyin } from "pinyin-pro";

export interface Topic {
  /** 中文标题，如 "项目概述" */
  name: string;
  /** URL slug，如 "1-xiang-mu-gai-shu" */
  slug: string;
  /** "Beginner" | "Intermediate" | "Advanced" */
  level: string;
  /** 所属章节，如 "快速入门" */
  sectionName: string;
  /** 可选分组名 */
  groupName?: string;
  /** 阶段 2 生成的内容 */
  content?: string;
}

/** 解析 XML TOC 输出，提取为 Topic 列表（按文档出现顺序）。 */
export function parseTocXml(xmlText: string): Topic[] {
  const found: { position: number; name: string; level: string; sectionName: string; groupName?: string }[] = [];

  const sectionPattern = /<section>\s*([\s\S]*?)\s*<\/section>/g;
  const groupPattern = /<group>\s*([\s\S]*?)\s*((?:<topic[^>]*>[\s\S]*?<\/topic>\s*)+)\s*<\/group>/g;
  const topicPattern = /<topic\s+level="([^"]*)">\s*([\s\S]*?)\s*<\/topic>/g;

  for (const sectionMatch of xmlText.matchAll(sectionPattern)) {
    const sectionBody = sectionMatch[1] ?? "";
    const sectionName = extractSectionName(sectionBody);

    // 先处理 group 块，再处理剩余的独立 topic，最终按文档顺序排序
    let groupReplaced = sectionBody;
    for (const groupMatch of sectionBody.matchAll(groupPattern)) {
      const groupName = (groupMatch[1] ?? "").trim();
      const groupBody = groupMatch[2] ?? "";
      for (const topicMatch of groupBody.matchAll(topicPattern)) {
        found.push({
          position: sectionMatch.index! + (groupMatch.index ?? 0) + (topicMatch.index ?? 0),
          name: (topicMatch[2] ?? "").trim(),
          level: (topicMatch[1] ?? "").trim(),
          sectionName,
          groupName,
        });
      }
      groupReplaced = groupReplaced.replace(groupMatch[0], "");
    }

    for (const topicMatch of groupReplaced.matchAll(topicPattern)) {
      found.push({
        position: sectionMatch.index! + (topicMatch.index ?? 0),
        name: (topicMatch[2] ?? "").trim(),
        level: (topicMatch[1] ?? "").trim(),
        sectionName,
      });
    }
  }

  found.sort((a, b) => a.position - b.position);
  return found.map((item, i) => ({
    name: item.name,
    slug: slugify(item.name, i + 1),
    level: item.level,
    sectionName: item.sectionName,
    ...(item.groupName ? { groupName: item.groupName } : {}),
  }));
}

function extractSectionName(body: string): string {
  for (const line of body.trim().split("\n")) {
    const stripped = line.trim();
    if (stripped && !stripped.startsWith("<")) return stripped;
  }
  return "未命名章节";
}

/** 将中英文标题转为 URL slug，格式：{index}-{pinyin-slug}。 */
export function slugify(name: string, index: number): string {
  const words = pinyin(name, { toneType: "none", type: "array", nonZh: "consecutive" });
  let joined = words
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return joined ? `${index}-${joined}` : String(index);
}

/** 构建阶段 2 的导航上下文，标记 [你当前在此处]。 */
export function buildTocNavigation(topics: Topic[], current: Topic): string {
  const sections = new Map<string, Topic[]>();
  for (const t of topics) {
    const list = sections.get(t.sectionName) ?? [];
    list.push(t);
    sections.set(t.sectionName, list);
  }
  const lines: string[] = [];
  for (const [sectionName, sectionTopics] of sections) {
    lines.push(`- **${sectionName}**`);
    let currentGroup: string | undefined;
    for (const t of sectionTopics) {
      if (t.groupName !== currentGroup) {
        currentGroup = t.groupName;
        if (currentGroup) lines.push(`  - *${currentGroup}*`);
      }
      const marker = t.slug === current.slug ? " [你当前在此处]" : "";
      const indent = currentGroup ? "    " : "  ";
      lines.push(`${indent}- [${t.name}](${t.slug})${marker}`);
    }
  }
  return lines.join("\n");
}

/** 从 LLM 输出中提取 <blog>...</blog> 内容。 */
export function extractBlogContent(text: string): string {
  const match = /<blog>([\s\S]*?)<\/blog>/.exec(text);
  if (match) return (match[1] ?? "").trim();
  return text.trim();
}
