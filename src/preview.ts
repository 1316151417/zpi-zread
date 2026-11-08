/** 浏览器预览：本地 HTTP 服务渲染 .zread/wiki 生成的文档。 */
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

export interface PreviewOptions {
  projectPath: string;
  port: number;
  open: boolean;
}

export interface PreviewHandle {
  server: Server;
  url: string;
  versionDir: string;
}

interface LoadedWiki {
  versionDir: string;
  wiki: { id: string; language: string; pages: WikiPageJson[] };
}

interface WikiPageJson {
  slug: string;
  title: string;
  file: string;
  section: string;
  level?: string;
  group?: string;
}

/** 读取 .zread/wiki/current 指向的最新版本。 */
export function loadWiki(projectPath: string): LoadedWiki {
  const wikiDir = join(projectPath, ".zread", "wiki");
  let pointer: string;
  try {
    pointer = readFileSync(join(wikiDir, "current"), "utf8").trim();
  } catch {
    throw new Error(`未找到 ${join(wikiDir, "current")}，请先运行 zpi-zread 生成文档`);
  }
  const versionDir = join(wikiDir, pointer);
  let wikiJson: LoadedWiki["wiki"];
  try {
    wikiJson = JSON.parse(readFileSync(join(versionDir, "wiki.json"), "utf8"));
  } catch {
    throw new Error(`未找到或无法解析 ${join(versionDir, "wiki.json")}`);
  }
  return { versionDir, wiki: wikiJson };
}

export async function startPreview(opts: PreviewOptions): Promise<PreviewHandle> {
  const { versionDir, wiki } = loadWiki(opts.projectPath);
  const url = `http://127.0.0.1:${opts.port}/`;

  const server = createServer((req, res) => {
    handle(req, res, { versionDir, wiki }).catch((error: unknown) => {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(error instanceof Error ? error.message : String(error));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, "127.0.0.1", resolve);
  });

  if (opts.open) openBrowser(url);
  return { server, url, versionDir };
}

type Router = LoadedWiki;

async function handle(req: IncomingMessage, res: ServerResponse, state: Router): Promise<void> {
  const path = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
  if (path === "/" || path === "/index.html") {
    send(res, 200, "text/html; charset=utf-8", pageHtml(state));
  } else if (path === "/api/wiki") {
    send(res, 200, "application/json; charset=utf-8", JSON.stringify(state.wiki));
  } else if (path.startsWith("/api/page/")) {
    const slug = path.slice("/api/page/".length).replace(/\.md$/, "");
    const page = state.wiki.pages.find((p) => p.slug === slug);
    if (!page) {
      send(res, 404, "application/json; charset=utf-8", JSON.stringify({ error: "页面不存在" }));
      return;
    }
    let markdown: string;
    try {
      markdown = readFileSync(join(state.versionDir, page.file), "utf8");
    } catch {
      send(res, 404, "application/json; charset=utf-8", JSON.stringify({ error: "文档尚未生成" }));
      return;
    }
    const html = sanitize(await marked.parse(markdown));
    send(res, 200, "application/json; charset=utf-8", JSON.stringify({ title: page.title, html }));
  } else {
    send(res, 404, "text/plain; charset=utf-8", "not found");
  }
}

function send(res: ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

/** 模型输出的 Markdown 可能携带原始 HTML，做基础净化。 */
function sanitize(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/javascript:/gi, "");
}

function openBrowser(url: string): void {
  const commands: Record<string, string[]> = {
    darwin: ["open", url],
    linux: ["xdg-open", url],
    win32: ["cmd", "/c", "start", "", url],
  };
  const command = commands[process.platform];
  if (!command) return;
  try {
    spawn(command[0]!, command.slice(1), { detached: true, stdio: "ignore" }).unref();
  } catch {
    // 打开失败不影响服务
  }
}

// ---------------------------------------------------------------------------
// 单页应用（内嵌 HTML/CSS/JS，无静态资源文件）
// ---------------------------------------------------------------------------

const LEVEL_LABELS: Record<string, { text: string; cls: string }> = {
  beginner: { text: "入门", cls: "b-beginner" },
  intermediate: { text: "进阶", cls: "b-intermediate" },
  advanced: { text: "高级", cls: "b-advanced" },
};

function levelBadge(level?: string): string {
  if (!level) return "";
  const meta = LEVEL_LABELS[level.toLowerCase()];
  if (!meta) return "";
  return `<span class="badge ${meta.cls}" title="${escapeHtml(level)}">${meta.text}</span>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function pageHtml(state: Router): string {
  const sections = new Map<string, { name?: string; pages: WikiPageJson[] }[]>();
  for (const page of state.wiki.pages) {
    const groups = sections.get(page.section) ?? [];
    const groupName = page.group ?? "";
    let group = groups.find((g) => g.name === groupName);
    if (!group) {
      group = { name: groupName || undefined, pages: [] };
      groups.push(group);
    }
    group.pages.push(page);
    sections.set(page.section, groups);
  }

  const nav = [...sections.entries()]
    .map(([section, groups]) => {
      const items = groups
        .map((group) => {
          const links = group.pages
            .map(
              (p) =>
                `<a class="page-link" href="#${p.slug}" data-slug="${p.slug}" data-title="${escapeHtml(p.title)}">${levelBadge(p.level)}<span>${escapeHtml(p.title)}</span></a>`,
            )
            .join("");
          return group.name ? `<div class="group">${escapeHtml(group.name)}</div>${links}` : links;
        })
        .join("");
      return `<div class="section">${escapeHtml(section)}</div>${items}`;
    })
    .join("");

  return `<!doctype html>
<html lang="${state.wiki.language === "en" ? "en" : "zh-CN"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zread 文档预览</title>
<style>
:root {
  --bg: #f7f8fa; --panel: #ffffff; --text: #1f2328; --muted: #6b7280;
  --border: #e5e7eb; --accent: #2563eb; --accent-soft: #eff6ff;
  --code-bg: #f3f4f6; --pre-bg: #0f172a; --pre-text: #e2e8f0;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111418; --panel: #181c22; --text: #e6e8ea; --muted: #9aa3af;
    --border: #2a3038; --accent: #60a5fa; --accent-soft: #1e293b;
    --code-bg: #232932; --pre-bg: #0b1017; --pre-text: #dbe4ee;
  }
}
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif; background: var(--bg); color: var(--text); }
.layout { display: flex; min-height: 100vh; }
aside { width: 300px; flex-shrink: 0; background: var(--panel); border-right: 1px solid var(--border); padding: 16px 0 32px; position: sticky; top: 0; height: 100vh; overflow-y: auto; }
aside header { padding: 4px 20px 12px; border-bottom: 1px solid var(--border); margin-bottom: 12px; }
aside header h1 { font-size: 16px; margin: 0 0 8px; }
aside header input { width: 100%; padding: 7px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); color: var(--text); font-size: 13px; outline: none; }
aside header input:focus { border-color: var(--accent); }
.section { padding: 10px 20px 4px; font-size: 12px; font-weight: 600; color: var(--muted); letter-spacing: .05em; }
.group { padding: 8px 20px 2px; font-size: 12px; color: var(--muted); font-style: italic; }
.page-link { display: flex; align-items: center; gap: 8px; padding: 6px 20px; color: var(--text); text-decoration: none; font-size: 13.5px; line-height: 1.4; border-left: 2px solid transparent; }
.page-link:hover { background: var(--accent-soft); }
.page-link.active { border-left-color: var(--accent); color: var(--accent); background: var(--accent-soft); font-weight: 500; }
.page-link span { overflow: hidden; text-overflow: ellipsis; }
.badge { flex-shrink: 0; font-size: 10.5px; padding: 1px 6px; border-radius: 99px; border: 1px solid transparent; }
.b-beginner { color: #15803d; background: #dcfce7; }
.b-intermediate { color: #b45309; background: #fef3c7; }
.b-advanced { color: #b91c1c; background: #fee2e2; }
@media (prefers-color-scheme: dark) {
  .b-beginner { color: #4ade80; background: rgba(34,197,94,.12); }
  .b-intermediate { color: #fbbf24; background: rgba(245,158,11,.12); }
  .b-advanced { color: #f87171; background: rgba(239,68,68,.12); }
}
main { flex: 1; min-width: 0; }
article { max-width: 860px; margin: 0 auto; padding: 40px 48px 96px; }
article h1 { font-size: 28px; border-bottom: 1px solid var(--border); padding-bottom: 12px; }
article h2 { font-size: 22px; margin-top: 40px; }
article h3 { font-size: 18px; }
article img { max-width: 100%; }
article code { background: var(--code-bg); padding: 2px 5px; border-radius: 5px; font-size: .9em; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
article pre { background: var(--pre-bg); color: var(--pre-text); padding: 16px; border-radius: 10px; overflow-x: auto; }
article pre code { background: transparent; color: inherit; padding: 0; }
article table { border-collapse: collapse; width: 100%; margin: 16px 0; }
article th, article td { border: 1px solid var(--border); padding: 8px 12px; text-align: left; }
article th { background: var(--code-bg); }
article blockquote { border-left: 3px solid var(--accent); margin: 16px 0; padding: 4px 16px; color: var(--muted); background: var(--accent-soft); border-radius: 0 8px 8px 0; }
article a { color: var(--accent); }
.nav-footer { display: flex; justify-content: space-between; gap: 16px; margin-top: 56px; padding-top: 20px; border-top: 1px solid var(--border); }
.nav-footer a { color: var(--accent); text-decoration: none; font-size: 14px; max-width: 46%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav-footer a:hover { text-decoration: underline; }
.loading { color: var(--muted); padding: 80px 0; text-align: center; }
@media (max-width: 860px) {
  aside { position: fixed; z-index: 10; transform: translateX(-100%); transition: transform .2s; box-shadow: 0 0 24px rgba(0,0,0,.18); }
  aside.open { transform: none; }
  article { padding: 24px 20px 80px; }
  .menu-btn { display: block !important; }
}
.menu-btn { display: none; position: fixed; left: 14px; bottom: 14px; z-index: 20; width: 42px; height: 42px; border-radius: 50%; border: none; background: var(--accent); color: #fff; font-size: 18px; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.25); }
</style>
</head>
<body>
<div class="layout">
  <aside id="sidebar">
    <header>
      <h1>文档目录</h1>
      <input id="search" type="search" placeholder="搜索页面标题…" autocomplete="off">
    </header>
    <nav id="nav">${nav}</nav>
  </aside>
  <main>
    <article id="content"><div class="loading">加载中…</div></article>
  </main>
</div>
<button class="menu-btn" id="menuBtn" title="目录">☰</button>
<script type="module">
var mermaidLib = null;
try {
  mermaidLib = (await import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs")).default;
  mermaidLib.initialize({ startOnLoad: false, theme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default" });
} catch (e) { /* 离线时保留代码块展示 */ }

var wiki = null;
var currentSlug = null;

async function fetchJson(url) {
  var res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(function () { return {}; })).error || ("HTTP " + res.status));
  return res.json();
}

async function show(slug) {
  var page = wiki.pages.find(function (p) { return p.slug === slug; });
  if (!page) page = wiki.pages[0];
  if (!page) throw new Error("没有可展示的页面");
  currentSlug = page.slug;
  var content = document.getElementById("content");
  content.innerHTML = '<div class="loading">加载中…</div>';
  var data;
  try {
    data = await fetchJson("/api/page/" + encodeURIComponent(page.slug));
  } catch (err) {
    content.innerHTML = '<h1>' + page.title + '</h1><div class="loading">' + err.message + "</div>";
    return;
  }
  document.title = page.title + " · Zread";
  content.innerHTML = data.html;
  document.querySelectorAll(".page-link").forEach(function (a) {
    a.classList.toggle("active", a.getAttribute("data-slug") === page.slug);
  });
  renderMermaid(content);
  renderFooter(page);
  window.scrollTo(0, 0);
  document.getElementById("sidebar").classList.remove("open");
}

function renderMermaid(root) {
  if (!mermaidLib) return;
  var blocks = root.querySelectorAll("pre code.language-mermaid, pre code.lang-mermaid");
  if (!blocks.length) return;
  blocks.forEach(function (block) {
    var div = document.createElement("div");
    div.className = "mermaid";
    div.textContent = block.textContent;
    block.parentNode.replaceWith(div);
  });
  mermaidLib.run({ querySelector: ".mermaid" }).catch(function () {});
}

function renderFooter(page) {
  var index = wiki.pages.findIndex(function (p) { return p.slug === page.slug; });
  var prev = wiki.pages[index - 1];
  var next = wiki.pages[index + 1];
  var footer = document.createElement("div");
  footer.className = "nav-footer";
  footer.innerHTML =
    (prev ? '<a href="#' + prev.slug + '">← ' + escapeText(prev.title) + "</a>" : "<span></span>") +
    (next ? '<a href="#' + next.slug + '">' + escapeText(next.title) + " →</a>" : "<span></span>");
  document.getElementById("content").appendChild(footer);
}

function escapeText(text) {
  var div = document.createElement("span");
  div.textContent = text;
  return div.innerHTML;
}

document.getElementById("search").addEventListener("input", function (event) {
  var keyword = event.target.value.trim().toLowerCase();
  document.querySelectorAll(".page-link").forEach(function (a) {
    var title = (a.getAttribute("data-title") || "").toLowerCase();
    a.style.display = !keyword || title.indexOf(keyword) >= 0 ? "" : "none";
  });
});

document.getElementById("menuBtn").addEventListener("click", function () {
  document.getElementById("sidebar").classList.toggle("open");
});

window.addEventListener("hashchange", function () {
  var slug = location.hash.slice(1);
  if (slug && slug !== currentSlug) show(slug);
});

try {
  wiki = await fetchJson("/api/wiki");
} catch (err) {
  document.getElementById("content").innerHTML = '<div class="loading">' + err.message + "</div>";
  throw err;
}
await show(location.hash.slice(1));
</script>
</body>
</html>`;
}
