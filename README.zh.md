# dsh-shell-selector

选择 DeepSeek Harness 执行 Shell 命令时使用的解析器——**Bash**（Windows 上
包含 Git Bash）、**PowerShell 7 (pwsh)** 或 **Windows PowerShell**，可在
设置页中完成。

| | |
|---|---|
| Host | Windows / macOS / Linux |
| Client | Web（设置 → **Shell 解析器** 标签页） |
| 安装 | `dsh plugin add dsh-shell-selector-0.1.0.tgz` |
| License | MIT |

> **重启要求** — 更改 Shell 解析器 **不会** 热替换当前进程。选择会立即保存，
> 并在下次启动 DeepSeek Harness 时生效。设置页始终同时展示 **当前生效**
> （本次进程）与 **重启后**（下次启动），并提示是否需要重启。

---

## 产品契约

> **Preset determines WHETHER. Selector determines WHICH.**
>
> Agent Preset 决定有没有 Shell；Shell Selector 决定 Shell 是谁。

- Shell Selector 不会设置 `agent-presets.default`，不会提供专属 Agent
  Preset，也不会按 preset 名称判断。
- 未挂载 `tool-bash` / `tool-pwsh` 的 preset **不会**因为本插件获得 Shell
  能力。这是权限边界，不是便利默认值。
- 挂载了标准 Shell 工具的 preset 只会得到与当前 Shell 匹配的工具。在
  Windows 上，原本只暴露 `pwsh` 的 preset 在选择 Bash 后，最终 `bash` 可见、
  `pwsh` 隐藏——目标工具先**添加**、不匹配的工具后**移除**，因此有 Shell
  权限的 agent 绝不会变成零 Shell。
- 工具与提示词严格同步：Bash 工具不会配 PowerShell 指引，反之亦然。
- PowerShell 7 与 Windows PowerShell 共用同一个面向模型的 `pwsh` 工具，
  区别只在宿主执行器实际调用哪个可执行文件。

### 单个 Agent 的适配流程

对每个 agent，按此顺序：

1. **能力检测** — 在任何修改**之前**读取工具视图。既无 `bash` 也无 `pwsh`
   即无 Shell 能力，直接返回。
2. **确保目标** — 若当前 Shell 对应的工具缺失，在 agent 自己的作用域挂载官方
   `@deepseek-ai/dsh-tool-bash` / `@deepseek-ai/dsh-tool-pwsh` 插件。
3. **验证目标** — 确认其确实可见。
4. **隐藏对侧** — 只有此时才限制另一种方言的工具。
5. **遮蔽对侧提示词** — 按 section 身份将其 `tool:*` 段置空。
6. **验证最终状态** — 目标可见、对侧隐藏。

任何失败都会回滚整个事务，并以 `ShellSelectorAgentAdaptationError` 明确报错。
插件绝不会只打一条 warning 就让 agent 带着错误或空的 Shell 继续运行。

## 为什么需要重启？

DeepSeek Harness 在**启动时**决定哪个 Shell 执行器（`ctx.shell`）被组合进
进程。运行时替换意味着在会话中途卸载/重载平台服务与工具——本插件刻意不
这样做。实际流程：

1. **保存** 将选择写入 `$DSH_HOME/settings.yaml`（标准设置服务，带冲突
   检测写入）。
2. **当前进程继续使用原有的 Shell**——不替换、不重启。
3. 在**下次启动**时，组合层在激活执行器行时读取已保存的选择，从第一秒起
   就组合出匹配的 Shell。

完整设计见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

---

## 模式

### Windows

| 模式 | 行为 |
|---|---|
| **DSH 默认** | 保持内置平台规则（PowerShell）。 |
| **自动降级**（推荐） | 按严格顺序使用第一个可用 Shell：**Bash → PowerShell 7 → Windows PowerShell**，启动时解析一次。 |
| **指定 Shell** | 精确使用 **Bash**、**PowerShell 7 (pwsh)** 或 **Windows PowerShell**。若指定的 Shell 无法检测，下次启动回退到 DSH 默认。 |

### macOS / Linux

| 模式 | 行为 |
|---|---|
| **DSH 默认** | 保持内置平台规则（Bash）。 |
| **指定 Shell** | **Bash**（v1 中 POSIX 上唯一的显式选项）。 |

Windows 上 **不会** 把 WSL 启动器（`System32\bash.exe`）当作 Bash。即使
Git Bash 不在 PATH 中，也会被发现。

---

## 生效方式

Shell 替换发生在**进程启动时的组合层**：

1. **Bundle patch**（`cordis.patch.yml`）— `bash-sandbox` /
   `pwsh-sandbox` 执行器行在启动时读取已保存配置，只启用其中一个。显式
   选择 Windows PowerShell 时固定其可执行文件路径。
2. **宿主插件**（`src/index.ts`）— 捕获启动快照；在需要时为 Git Bash
   目录加入进程级 `PATH`；安装上文所述的单 Agent Shell 工具适配。
3. **设置命名空间**（`shell-selector`，`mode: default|fallback|explicit`，
   `shell: bash|pwsh|powershell`）— 通过设置服务持久化。

**不** 在运行时替换 `ctx.shell`，**不** 热切换宿主执行器，**不** 强制重启，
**不** 修改默认 Agent Preset。Bundle patch 只管**宿主**层；Agent 工具面按
agent 作用域处理，因此没有 Shell 权限的 preset 不会被全局 patch 提权。

### Windows 上的 Git Bash

- 检测顺序：`PATH` 上的 `bash.exe` → 由 `PATH` 上 `git.exe` 推导 Git Bash →
  `%ProgramFiles%\Git` → `%ProgramFiles(x86)%\Git` →
  `%LOCALAPPDATA%\Programs\Git`。
- 每个候选都会经过真实探针验证：`bash --version` 与
  `bash -c 'printf "$BASH_VERSION"'`；`System32\bash.exe`（WSL）会被拒绝。
- 因为官方 Bash 执行器总是直接 spawn `bash`，无法指定绝对路径，所以当
  当前生效 Shell 是 Windows 上的 Bash 时，宿主插件会把解析出的 Git Bash
  bin 目录前置到**进程级** `PATH`。不会修改注册表或用户环境变量。

---

## 设置页

设置 → **Shell 解析器**：

- **当前生效** — 本次进程执行命令时使用的 Shell（进程内不可变）。
- **重启后** — 下次启动将组合的 Shell，在有待生效更改时显示。
- **重新检测** — 不修改任何设置，仅重新扫描本机。
- **保存** — 持久化选择；成功提示会说明重启后生效。
- 当配置的 Shell 无法检测、当前生效 Shell 缺失、或没有任何可用 Shell 时
  显示警告。

UI 使用 DSH 原生组件（`Menu`、`Button`、图标），不使用原生 `<select>`，
因此与 Settings 其余部分在明/暗色、键盘导航、浮层行为上保持一致。

## 开发

```sh
pnpm install
pnpm lint && pnpm typecheck && pnpm test && pnpm build
npm pack --dry-run
```

- `scripts/render-patch.mjs` 从 `src/boot/expressions.ts`（单一事实来源）
  生成 `cordis.patch.yml`；`scripts/lint.mjs` 校验已提交文件同步。
- `scripts/build-client.mjs` 将浏览器客户端打包为 `lib/client.js`（DSH Web
  模块加载器格式）。
- `tests/expressions.test.ts` 在构造的环境中执行启动表达式，并断言它们与
  `src/resolver.ts` 一致。
- `tests/detector.test.ts` 覆盖 Git Bash 发现、WSL 拒绝、探针校验与去重。
- `tests/client/*` 覆盖 DSH 原生 Select 与设置页布局。

## 安全说明

- 配置只接受白名单 id——没有自由格式命令或路径输入，**任何用户输入都不会
  被 eval 或 spawn**。
- 启动表达式直接读取 `$DSH_HOME/settings.yaml`（先尝试 JSON 解析，再解析
  扁平 YAML 段），只探测固定的白名单候选可执行文件。
- Web 端点同源、仅 GET/POST，带严格 CSP 头与请求体大小限制；设置命名空间
  本身不通过设置 RPC 暴露。
