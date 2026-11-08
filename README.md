# zpi-zread

> 用 AI 把本地代码变成 Wiki 文档，一条命令搞定。

`zpi-zread` 是 [open-zread](https://github.com/1316151417/open-zread) 的 Node.js 重构版：Agent 运行时不再自己实现，而是完全构建在 [`@zpi-dev/agent-sdk`](https://www.npmjs.com/package/@zpi-dev/agent-sdk) 之上——ReAct 循环、工具调用、上下文压缩都由 SDK 提供。所有数据完全本地存储，代码不会离开你的机器。

## 功能特性

- **npx 直接运行** — 无需 clone 仓库、无需配置，一条命令分析代码库
- **单模型 + 思考强度** — 不再区分 lite/pro/max 三级模型，一个默认模型（`deepseek-flash`）+ 一个思考强度（`max`）
- **两阶段流水线** — 先生成目录（TOC），再并行生成每个主题的详细文档
- **浏览器预览** — 内置 `preview` 命令，本地起服务渲染生成的 Wiki（侧边栏导航、Markdown、Mermaid 图表、搜索）
- **依赖极简** — 运行时仅 4 个依赖：`@zpi-dev/agent-sdk`、`typebox`、`pinyin-pro`、`marked`

## 快速开始

```bash
# 安装（Node.js >= 24）
npx zpi-zread /path/to/your/project

# 或本地运行
npm i -g zpi-zread
zpi-zread /path/to/your/project
```

环境变量只需一个 API Key（支持项目目录或当前目录下的 `.env` 文件）：

```bash
export DEEPSEEK_API_KEY="your-api-key"
```

生成完成后预览报告：

```bash
npx zpi-zread preview /path/to/your/project   # 打开浏览器
npx zpi-zread preview --port 9000             # 指定端口
npx zpi-zread preview --no-open               # 不自动打开浏览器
```

也可以生成完直接进入预览：

```bash
npx zpi-zread /path/to/your/project --preview
```

## 命令与配置

```
zpi-zread [路径] [选项]       分析代码库，生成 Wiki 文档
zpi-zread preview [路径]      浏览器预览已生成的文档
```

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--model <id>` | 模型 | `deepseek-flash` |
| `--effort <级别>` | 思考强度 `off`/`low`/`medium`/`high`/`xhigh`/`max` | `max` |
| `--threads <n>` | 内容生成并行数 | `10` |
| `--preview` | 生成完成后自动启动浏览器预览 | 关 |
| `--port <n>` | 预览端口 | `8765` |
| `--no-open` | 预览时不自动打开浏览器 | - |

环境变量（均可被同名命令行选项覆盖）：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DEEPSEEK_API_KEY` | DeepSeek API 密钥（必填） | - |
| `ZREAD_MODEL` | 等价于 `--model` | `deepseek-flash` |
| `ZREAD_EFFORT` | 等价于 `--effort` | `max` |
| `ZREAD_THREADS` | 等价于 `--threads` | `10` |
| `ZREAD_MAX_STEPS` | 单主题 Agent 最大轮数 | `50` |
| `ZREAD_DOC_LANGUAGE` | 文档语言 | `中文` |
| `ZREAD_TARGET_AUDIENCE` | 目标受众 | `初级开发者` |

## 输出结构

生成的文档保存在目标项目的 `.zread/wiki/` 下（与 Zread CLI 格式对齐）：

```
.zread/
└── wiki/
    ├── current          # 指向最新版本的指针
    └── versions/
        └── 2026-11-08-180000/
            ├── wiki.json   # 文档目录索引
            ├── 1-xiang-mu-gai-shu.md
            ├── 2-kuai-su-qi-dong.md
            └── ...
```

## 架构

```
bin/cli.mjs → src/cli.ts (main)
  └─ src/pipeline.ts (runPipeline)
       ├─ 阶段 1: explorer — Agent 探索项目 → XML TOC → parseTocXml → Topic[]
       └─ 阶段 2: researcher — 每个主题一个 Agent → <blog> Markdown → .md 文件
```

```
├── bin/cli.mjs       # npx 入口
├── src/
│   ├── cli.ts        # 参数解析与命令分发
│   ├── config.ts     # 环境变量配置（模型/思考强度/并行数）
│   ├── agent.ts      # query() 封装：给提示词、返回最终文本
│   ├── tools.ts      # 3 个 defineTool 自定义工具：目录树 / 读文件 / 只读 Shell
│   ├── prompts.ts    # 两阶段提示词（TOC 拆分 + 内容生成）
│   ├── toc.ts        # TOC 解析、拼音 slug、导航上下文、内容提取
│   ├── pipeline.ts   # 两阶段编排 + wiki.json + 并行内容生成
│   ├── preview.ts    # 本地 HTTP 服务 + 内嵌单页预览应用
│   └── log.ts        # 控制台日志
└── scripts/build.mjs # esbuild 打包
```

Agent 能力（ReAct 循环、上下文压缩、工具调度）全部来自 `@zpi-dev/agent-sdk` 的 `query()`；相比原版 open-zread，删除了自研的 provider 抽象层（OpenAI/Anthropic 双协议）、ReAct 循环实现、三级模型配置和 Langfuse 观测。

## 开发

```bash
npm install
npm run check     # 类型检查
npm run build     # 构建 dist/cli.js
npm run dev -- /path/to/project   # tsx 直跑源码
npm test          # （可选）单元测试
```

## 与 open-zread 的关系

| 特性 | open-zread | zpi-zread |
|------|-----------|-----------|
| 语言 | Python | TypeScript (Node.js >= 24) |
| Agent 运行时 | 自研 ReAct 循环 + provider 抽象 | `@zpi-dev/agent-sdk` |
| 模型配置 | lite/pro/max 三级 + settings.json | 单模型 + 思考强度（环境变量） |
| 观测 | Langfuse（可选） | 无 |
| 预览 | 依赖闭源 Zread CLI | 内置 `preview` 命令 |
| 安装 | `uv sync` + 源码运行 | `npx zpi-zread` |

## License

MIT
