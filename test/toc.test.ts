import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTocNavigation, extractBlogContent, parseTocXml, slugify, type Topic } from "../src/toc.ts";

test("parseTocXml 解析 section/group/topic 结构", () => {
  const xml = `
<section>
快速入门
<topic level="Beginner">
项目概述
</topic>
<group>
环境搭建
<topic level="Intermediate">
快速启动指南
</topic>
</group>
</section>
<section>
深度解析
<topic level="Advanced">
架构剖析
</topic>
</section>
`;
  const topics = parseTocXml(xml);
  assert.equal(topics.length, 3);
  assert.deepEqual(
    topics.map((t) => [t.sectionName, t.name, t.level, t.groupName ?? ""]),
    [
      ["快速入门", "项目概述", "Beginner", ""],
      ["快速入门", "快速启动指南", "Intermediate", "环境搭建"],
      ["深度解析", "架构剖析", "Advanced", ""],
    ],
  );
});

test("slugify 中文转拼音、英文保留", () => {
  assert.equal(slugify("项目概述", 1), "1-xiang-mu-gai-shu");
  assert.equal(slugify("API 设计", 2), "2-api-she-ji");
  assert.equal(slugify("###", 3), "3");
});

test("extractBlogContent 提取 blog 标签，无标签时返回原文", () => {
  assert.equal(extractBlogContent("前置说明\n<blog>\n# 标题\n正文\n</blog>"), "# 标题\n正文");
  assert.equal(extractBlogContent("纯文本"), "纯文本");
});

test("buildTocNavigation 标记当前主题", () => {
  const topics: Topic[] = [
    { name: "项目概述", slug: "1-a", level: "Beginner", sectionName: "快速入门" },
    { name: "架构", slug: "2-b", level: "Advanced", sectionName: "深度解析" },
  ];
  const nav = buildTocNavigation(topics, topics[1]!);
  assert.match(nav, /- \*\*快速入门\*\*/);
  assert.match(nav, /\[架构\]\(2-b\) \[你当前在此处\]/);
  assert.doesNotMatch(nav, /1-a.*你当前在此处/);
});
