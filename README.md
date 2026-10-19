# Tracelet · 个人 AI 记忆层

运行在 Mac 上，将分散在 AI 平台中的**用户提问**整理成对话 trace，再通过 OpenRouter 提炼有原文证据、由用户确认的个人记忆。

首版产品和官网已包含在此仓库。网站下载按钮读取发布清单，只有真实 Release 同时具有两个架构的 DMG 和校验文件时才启用。

## 0.3.2 来源分类与浏览器采集

应用默认打开左右对照工作台：左侧查看对话原文，右侧按层级与状态查看记忆，支持定位证据、审核更新和查看历史。新版提炼区分长期个人、项目和会话情节，附逐字引文、范围与新增/更新/冲突/重复建议。相关旧记忆也会列入发送预览；替换必须手动确认。旧记录保留并显示未分层，旧提问可经用户选择后重新分析。

界面使用白底圆角卡片，来源按平台分类；跨平台记忆展示所有证据来源。提示词、论文设计映射、已实现边界及真实模型评测方式见 [Memory Curator v2](docs/MEMORY_AGENT.md)。

## 采集能力

| 来源 | 接入方式 | 范围 |
| --- | --- | --- |
| Codex | 监听 `~/.codex/sessions/**/*.jsonl`，支持 `CODEX_HOME` | 用户文本；排除助手、工具和已识别的启动上下文 |
| Claude Code | 监听 `~/.claude/projects/**/*.jsonl` | user 消息中的 text 块；排除 tool_result、meta 消息 |
| ChatGPT | 导入 `conversations.json` | mapping 中的 user 消息，保留分支中的用户消息 |
| Claude 网页版 | 导入 JSON | conversations 数组中的 `chat_messages`，sender 为 human/user |
| Grok | 导入 JSON | `messages` 数组，role 为 user，content 为文本；导出格式不同需适配 |

| 浏览器 AI 网站 / 自定义 HTTPS 站点 | Chrome / Edge 扩展 + Native Messaging / JSON 导出 | 当前页面已加载的用户文本；规则须预览验证 |

采集默认关闭。新增 Chrome / Edge 扩展，支持逐站授权、用户消息预览、本地队列与 Mac 原生同步，详见 [浏览器采集说明](docs/BROWSER_CAPTURE.md)。内置 Claude、Grok、Manus、Genspark、ChatGPT 规则为待验证模板，自定义来源按域名独立分类。应用不监听键盘或屏幕，不提供 MCP 或自动将记忆注入第三方平台。文件布局可能随平台版本变化；解析异常会显示在应用中。JSONL 最后一条未写完时等待后续更新，不把半条内容当成新消息。

## 本地开发

- Node.js 24；macOS 13+ 可运行与打包 Mac 应用。
- Linux 可测试解析、SQLite、分析协议、官网及 Electron；**不能在 Linux 上声称完成 DMG 打包或 macOS 原生验证**。

```sh
npm ci
npm test
npm run build
npm run site:check
npm run dev
```

若处于代理环境，Electron 下载支持官方 `ELECTRON_GET_USE_PROXY=1` 与 `GLOBAL_AGENT_HTTP_PROXY` 配置。不要关闭 TLS 或校验。

Linux 图形冒烟测试：`xvfb-run -a npm run smoke:electron`。Mac：`npm run smoke:electron`。测试使用临时数据库和合成 Codex 文件，不读取真实个人对话或调用 AI。

静态官网：在仓库运行 `python3 -m http.server 8080 --directory site`，访问该服务。站点不需要 npm 构建或后端。

## 配置 OpenRouter

在应用的「连接与设置」中保存**你自己的新 API Key**。不要将 Key 写进源码、GitHub Actions 或 Issues。曾在聊天中公开的 Key 应先撤销。Key 使用 Electron safeStorage，在 Mac 上由 Keychain 保护，不进入 renderer 或 JSON 导出。

默认模型：`deepseek/deepseek-v4-flash`。已在 OpenRouter 的公开 `/api/v1/models` 列表确认该 ID；账户授权、余额及请求成功仍需实际验证。应用可查询实时 DeepSeek 列表，也允许手工输入 ID，不做隐式模型回退。

选对话 → 预览实际发送的提问和 ID → 确认发送 → 查看候选记忆及证据 → 确认/忽略。分析费用由 OpenRouter 收取。每批新提问最多 100 条、40,000 字符，另含预览中最多 24 条 / 12,000 字符的参考记忆；成功后只分析新增或变化的提问，剩余内容可继续分批分析。单条超过本批限制的提问不会发送。

## Mac 安装包与官网发布

详见 [发布指南](docs/RELEASING.md)。仓库带有三个 GitHub Actions：

- `Validate`：类型检查、单元测试、构建、官网检查和 Electron 冒烟测试。
- `Release macOS`：在 Apple Silicon / Intel Mac runner 构建 DMG、ZIP 与 SHA-256 校验文件，发布 GitHub Release，附浏览器扩展 ZIP；也可手动运行。
- `Deploy website`：部署 GitHub Pages，并从最新真实 Release 生成下载清单。

本机 Mac 打包：`npm run dist:mac`。输出到 `release/`。未配置 Apple 证书时是未签名/未公证的测试包。正式分发应配置 Developer ID 签名与 Apple 公证。不要关闭 Gatekeeper。

## 数据与架构

数据目录：`~/Library/Application Support/Tracelet/`（开发模式可能使用小写 `tracelet`）。包含 `tracelet.sqlite`、非秘密设置和 API Key 密文。数据库没有额外加密，依赖文件权限，建议开启 FileVault。导出 JSON 含私人提问，应谨慎保管。

架构与 Agent 设计见 [ARCHITECTURE.md](docs/ARCHITECTURE.md)。完整隐私说明见 [官网隐私页](site/privacy.html)。

## License

MIT。用户数据、第三方平台服务和模型使用仍受各自政策约束。
