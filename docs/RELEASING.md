# GitHub 官网与 Mac 安装包发布

## 准备

1. 将此仓库推送至 `JackZhong1998/personal-memory` 的 `main` 分支。检查 Actions 已启用。
2. Repository Settings → Pages → Source 选择 **GitHub Actions**。工作流也尝试通过 configure-pages 启用；若组织策略不允许，仓库管理员需手动开启。私有仓库的 Pages 可用性取决于 GitHub 套餐。
3. 查看 `Validate` 完成。`Deploy website` 成功后，Pages 会返回实际网址；标准项目站点一般为 `https://jackzhong1998.github.io/personal-memory/`。以 Actions 的部署结果为准。

## 自动构建并发布

在 Actions 中手动运行 **Release macOS**，或创建与 package.json 一致的版本 tag：

```sh
git tag v0.1.0
git push origin v0.1.0
```

工作流先测试，再使用 `macos-15`（arm64）和 `macos-15-intel`（x64）runner 构建对应架构。runner 标签可用性受 GitHub 和账户限制；若某架构 runner 不可用，不会发布缺少架构的正式版本。

产物：

```text
Tracelet-mac-arm64.dmg
Tracelet-mac-arm64.zip
Tracelet-mac-x64.dmg
Tracelet-mac-x64.zip
SHA256SUMS.txt
```

两套安装包都成功后才发布 Release。相同版本已存在时拒绝覆盖，需递增 package.json 版本并更新 npm lockfile 的根版本。

若构建成功而最后上传失败，可在 Actions 手动运行 `Publish built release`，填写之前 `Release macOS` 的 run ID。它核对来源、原始 commit 与 tag，只提取各架构对应的包并校验 ZIP，再从保留的构建产物发布，避免重新构建。该恢复流程拒绝覆盖现有 Release。

Release 完成触发 Pages 工作流，查询 GitHub 最新 Release 的实际文件，生成 `site/release.json`。官网只在清单中存在真实文件时启用下载。没有发布文件时显示“尚未发布”，不伪造下载地址。页面会准确区分签名/公证状态。

## Apple 签名和公证

无证书时可自动生成测试 DMG/ZIP，但这些并非面向大众的可信正式安装包。要消除普通用户安装时的 Gatekeeper 阻碍，需要有效的 Apple Developer ID Application 证书和 Apple 公证权限。请在 GitHub Actions Secrets 安全配置，不在聊天或源码中填写：

| Secret | 用途 |
| --- | --- |
| `MAC_CSC_LINK` | electron-builder 支持的 p12 证书来源 / Base64 |
| `MAC_CSC_KEY_PASSWORD` | p12 密码 |
| `APPLE_ID` | Apple 账号 |
| `APPLE_APP_SPECIFIC_PASSWORD` | 公证专用密码 |
| `APPLE_TEAM_ID` | Apple Developer Team |

工作流在证书与公证身份齐全时强制公证，并进行 codesign 和 Gatekeeper 检查；失败不会发布。未配齐时显式生成未签名测试包，发布说明不冒充已认证。OpenRouter Key 不用于构建，**不要**放在这些 secrets 或安装包中。

## 验证下载

从 Release 下载对应 DMG 与 `SHA256SUMS.txt`。运行 `shasum -a 256 Tracelet-mac-arm64.dmg`（Intel 替换文件名），与清单逐字比较。安装后拖入 Applications，打开设置连接来源；确认同步自己的实际 Codex/Claude Code 文件，再配置新 OpenRouter Key，先检查一小批提问后发送分析。

自动测试覆盖结构化合成数据、真实 Electron 文件监听 / preload / SQLite / React 启动；不等于对所有平台版本及真实个人日志都完成验证。发布前请至少在一台实际 Mac 上完成钥匙串、菜单栏、退出重启和一次付费分析的人工验收。

## 常见问题

- `gh auth status` 失败不代表 Git proxy 无法推送。环境的 Git 代理和 GitHub API 权限不同，应分别验证；不要提取代理凭据。
- 无 `workflows` 权限时无法推送工作流；需要由仓库拥有者授权或上传代码，不能靠重试解决。
- Pages 403 / 404：检查 Pages Source、仓库可见性、套餐与组织政策。
- Actions 排队或 Mac runner 超额：检查账户 macOS runner 配额；Linux 不能替代 DMG 打包与 Mac 原生检查。
- 不使用 `xattr -cr` 或全局关闭 Gatekeeper 作为默认安装流程。测试包请先审查 Release 说明及校验值，按 Apple 官方隐私与安全性流程操作。
