# dsh-shell-selector

选择 DeepSeek Harness 执行 Shell 命令时使用的解析器 —— **Bash**、
**PowerShell 7 (pwsh)** 或 **Windows PowerShell**，在设置页中即可完成。

| | |
|---|---|
| Host | Windows / macOS / Linux |
| Client | Web（设置 → **Shell 解析器** 标签页） |
| 安装 | `dsh plugin add dsh-shell-selector-0.1.0.tgz` |
| 许可证 | MIT |

> **重启要求** —— 更改 Shell 解析器不会热替换正在运行的进程。你的选择会
> 立即保存，并在下次启动 DeepSeek Harness 时生效。设置页始终同时显示
> **当前生效**（本进程）与 **重启后**（下次启动），并明确提示是否需要重启。

---

## 为什么需要重启？

DeepSeek Harness 在**启动时**决定由哪个 Shell 执行器（`ctx.shell`）参与进程
装配。运行中替换这组执行栈意味着在会话中途卸载、重载平台服务与工具——
本插件刻意不做这件事。取而代之：

1. **保存**将你的选择写入 `$DSH_HOME/settings.yaml`（标准设置服务，带冲突
   检测的写入）。
2. **当前进程继续使用原来的 Shell**——不做任何替换，也不重启任何东西。
3. 在**下次启动**时，装配层在激活执行器行时读取你保存的选择，从第一秒起
   就装配出匹配的 Shell。

完整设计见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

---

## 模式

### Windows

| 模式 | 行为 |
|---|---|
| **DSH 默认** | 保持内置平台规则（PowerShell）。 |
| **自动降级**（推荐） | 按严格顺序取第一个可用的 Shell：**Bash → PowerShell 7 → Windows PowerShell**，启动阶段解析一次。 |
| **指定 Shell** | 精确指定 **Bash**、**PowerShell 7 (pwsh)** 或 **Windows PowerShell**；若所选 Shell 无法检测到，下次启动回退到 DSH 默认。 |

### macOS / Linux

| 模式 | 行为 |
|---|---|
| **DSH 默认** | 保持内置平台规则（Bash）。 |
| **指定 Shell** | **Bash**（v1 在 POSIX 上唯一的显式选项）。 |

Windows 上 WSL 启动器（`System32\bash.exe`）**不算** Bash。

---

## 变更如何生效

Shell 切换发生在**进程启动时的装配层**，由本插件安装的三个机制完成：

1. **Bundle patch**（`cordis.patch.yml`）——执行器行 `bash-sandbox` /
   `pwsh-sandbox` 在启动时读取已保存的配置，恰好启用其中之一；显式选择
   *Windows PowerShell* 时，为 PowerShell 执行器固定 Windows PowerShell
   可执行文件路径。
2. **Agent preset**（`shell-selector`）——会话获得匹配的工具：选 Bash 时挂
   `tool-bash`，选 PowerShell 时挂 `tool-pwsh`。预设通过官方用户预设机制
   （`$DSH_HOME/.agent-presets/shell-selector`）提供，并成为默认 Agent
   Preset。
3. **设置命名空间**（`shell-selector`：`mode: default|fallback|explicit`、
   `shell: bash|pwsh|powershell`）——经设置服务持久化。

**没有**运行时的 `ctx.shell` 替换，**没有**动态装卸 `tool-bash`/`tool-pwsh`，
**没有**强制重启。Host 插件只负责：注册设置、快照启动决策、物化预设、提供
设置页接口。

> **关于 Agent Presets 的说明：** 安装本插件后，默认 Agent Preset 会变为
> **Shell Selector**（可在 Agent Presets 设置中看到）。选择其他预设后，
> 使用该预设的会话不再受 Shell 解析器设置影响（设置页会显示提示）。除两个
> Shell 工具行外，该预设与标准预设逐字一致，其他行为完全相同。

---

## 设置页

设置 → **Shell 解析器**：

- **当前生效** —— 本进程执行命令所用的 Shell（进程内不可变）。
- **重启后** —— 下次启动将装配的 Shell；存在待生效变更时显示。
- **重新检测** —— 只重新扫描本机，不切换运行时的任何东西。
- **保存** —— 持久化选择；成功提示会注明「重启 DeepSeek Harness 后生效」。
- 当配置的 Shell 无法检测到、当前生效的 Shell 缺失、或本机没有任何可用
  Shell 时，页面会显示相应警告。

## 开发

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build
npm pack --dry-run
```

- `scripts/render-patch.mjs` / `scripts/render-preset.mjs` 从
  `src/boot/expressions.ts`（单一来源）生成 `cordis.patch.yml` 与预设装配
  文件；`scripts/lint.mjs` 校验提交文件与渲染结果一致。
- `scripts/build-client.mjs` 将浏览器端打包为 `lib/client.js`（DSH Web 模块
  加载器格式）。
- `tests/expressions.test.ts` 在伪造环境中求值启动表达式，断言其与
  `src/resolver.ts` 镜像一致。

## 安全说明

- 配置只接受白名单内的取值——没有自由形式的命令或路径输入，**任何用户输入
  都不会被求值或 spawn**。
- 启动表达式直接读取 `$DSH_HOME/settings.yaml`（先尝试 JSON 解析，再按扁平
  YAML 节解析），从不执行 Shell 命令。
- Web 端点同源、仅 GET/POST、带严格 CSP 响应头与请求体大小限制；该设置命名
  空间不通过设置 RPC 暴露给浏览器。
