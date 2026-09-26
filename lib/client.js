window.__ModuleLoader__.load({ id: "dsh-shell-selector", factory: (require) => {
var __modules = Object.create(null); var __cache = Object.create(null);
__modules["./context.js"] = function(module, exports, require, __load_) {
"use strict";
/**
 * The client service surface this plugin uses.
 *
 * DSH 0.1.7-rc.1 retired `@deepseek-ai/dsh-client-runtime`, taking the
 * `ClientContext` type the browser halves used to import with it. The services
 * themselves are unchanged — `effect`, `slots`, `locale` — so this plugin
 * declares the smallest structural type it calls rather than importing a
 * package that no longer exists. Keeping the surface local also means a future
 * runtime reshuffle cannot break the plugin's module graph again.
 *
 * @module dsh-shell-selector/client/context
 */
Object.defineProperty(exports, "__esModule", { value: true });
};
__modules["./controller.js"] = function(module, exports, require, __load_) {
"use strict";
/**
 * Controller for the Shell Selector settings page: an external store fed by
 * the plugin's own HTTP endpoint (the settings namespace is not exposed over
 * the settings RPC, so the page never touches `ctx.settingsScope`).
 *
 * @module dsh-shell-selector/client/controller
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShellSelectorController = void 0;
const STATE_ROUTE = '/_dsh/shell-selector/state';
const ACTION_ROUTE = '/_dsh/shell-selector/action';
async function apiRequest(path, init) {
    const response = await fetch(path, { credentials: 'same-origin', ...init });
    const body = (await response.json());
    if (!response.ok || !body.ok) {
        const failure = body;
        throw new Error(failure.error?.message ?? `Shell Selector request failed with HTTP ${response.status}`);
    }
    return body.value;
}
/** Small external store shared by the settings route and pushed invalidations. */
class ShellSelectorController {
    state = { status: 'idle' };
    listeners = new Set();
    generation = 0;
    subscribe = (listener) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };
    snapshot = () => this.state;
    set(next) {
        this.state = next;
        for (const listener of this.listeners)
            listener();
    }
    async load() {
        const generation = ++this.generation;
        this.set({ ...this.state, status: 'loading', error: undefined, notice: undefined });
        try {
            const snapshot = await apiRequest(STATE_ROUTE);
            if (generation !== this.generation)
                return;
            this.set({ status: 'ready', snapshot });
        }
        catch (error) {
            if (generation !== this.generation)
                return;
            this.set({ ...this.state, status: 'error', error: error instanceof Error ? error.message : String(error) });
        }
    }
    async save(mode, shell, expectedRevision) {
        const generation = ++this.generation;
        this.set({ ...this.state, action: 'save', error: undefined, notice: undefined });
        try {
            const snapshot = await apiRequest(ACTION_ROUTE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'save', mode, shell, expectedRevision }),
            });
            if (generation !== this.generation)
                return;
            this.set({ status: 'ready', snapshot, notice: 'saved', action: undefined });
        }
        catch (error) {
            if (generation !== this.generation)
                return;
            this.set({
                ...this.state,
                status: this.state.snapshot === undefined ? 'error' : 'ready',
                error: error instanceof Error ? error.message : String(error),
                action: undefined,
            });
            if (this.state.snapshot === undefined)
                void this.load();
        }
    }
    async detect() {
        const generation = ++this.generation;
        this.set({ ...this.state, action: 'detect', error: undefined });
        try {
            const snapshot = await apiRequest(ACTION_ROUTE, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'detect' }),
            });
            if (generation !== this.generation)
                return;
            this.set({ status: 'ready', snapshot, action: undefined });
        }
        catch (error) {
            if (generation !== this.generation)
                return;
            this.set({
                ...this.state,
                status: this.state.snapshot === undefined ? 'error' : 'ready',
                error: error instanceof Error ? error.message : String(error),
                action: undefined,
            });
        }
    }
    /** Clear the transient save notice (e.g. after a few seconds or on edit). */
    dismissNotice() {
        if (this.state.notice === undefined)
            return;
        this.set({ ...this.state, notice: undefined });
    }
}
exports.ShellSelectorController = ShellSelectorController;
};
__modules["./DshSelect.js"] = function(module, exports, require, __load_) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DshSelect = DshSelect;
const jsx_runtime_1 = require("react/jsx-runtime");
/**
 * DSH-native Select.
 *
 * A lightweight wrapper around the official `Menu` and `Button` primitives. It
 * deliberately does not use a native HTML `<select>`: the trigger is a
 * DSH-styled button and the dropdown is the DSH floating menu with rounded
 * corners, soft shadow, hover tokens, selected check, outside click, Escape and
 * keyboard navigation.
 *
 * Two positioning details matter for a control that sits on the RIGHT of a
 * Settings row:
 *
 *  - `portal` renders the list into `document.body` as a fixed-position layer,
 *    so an ancestor's `overflow` cannot crop it and it is clamped to the
 *    viewport, with a small margin on every edge;
 *  - `align="end"` pins the list's RIGHT edge to the trigger's right edge, so a
 *    list wider than its trigger grows leftwards, into the dialog, instead of
 *    escaping past its right edge.
 *
 * @module dsh-shell-selector/client/dsh-select
 */
const react_1 = require("react");
const dsh_client_ui_primitives_1 = require("@deepseek-ai/dsh-client-ui-primitives");
/**
 * The dropdown chevron.
 *
 * Drawn locally on purpose: the icon family was renamed between DSH rc.6
 * (`IconChevronDownOutline14`) and rc.1 (`IconChevronDownOutlineRegular`), and a
 * settings page must not depend on which naming the running client ships. The
 * stroke uses `currentColor`, so the token-based `.sss-select-chevron` colour
 * still applies.
 */
function ChevronDown({ className }) {
    return ((0, jsx_runtime_1.jsx)("svg", { className: className, width: "14", height: "14", viewBox: "0 0 14 14", fill: "none", "aria-hidden": "true", focusable: "false", children: (0, jsx_runtime_1.jsx)("path", { d: "M3.5 5.5 7 9l3.5-3.5", stroke: "currentColor", strokeWidth: "1.2", strokeLinecap: "round", strokeLinejoin: "round" }) }));
}
function DshSelect({ value, options, onChange, disabled = false, ariaLabel, className, }) {
    const [open, setOpen] = (0, react_1.useState)(false);
    const rootRef = (0, react_1.useRef)(null);
    // Identifies THIS select's rows. `portal` renders the list into
    // `document.body`, so it is outside `rootRef` and cannot be found by walking
    // the wrapper — each row is tagged through the label node instead, which is
    // the part of the row this component owns.
    const menuId = `sss-menu-${(0, react_1.useId)().replace(/[^a-zA-Z0-9_-]/gu, '')}`;
    /** The enabled rows of this select's own menu, in DOM order. */
    const ownItems = (0, react_1.useCallback)(() => {
        const marks = Array.from(document.querySelectorAll(`[data-shell-selector-item="${menuId}"]`));
        const rows = [];
        for (const mark of marks) {
            const row = mark.closest('[role="menuitem"]');
            if (row !== null && !row.disabled)
                rows.push(row);
        }
        return rows;
    }, [menuId]);
    const focusItem = (0, react_1.useCallback)((index) => {
        const items = ownItems();
        const target = index < 0 ? items[items.length - 1] : items[index];
        if (target !== undefined)
            target.focus();
    }, [ownItems]);
    (0, react_1.useEffect)(() => {
        if (!open)
            return;
        const onKeyDown = (event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') {
                return;
            }
            const items = ownItems();
            if (items.length === 0)
                return;
            // Only steer when focus is on our trigger or inside our own menu.
            const active = document.activeElement;
            const ours = items.some((item) => item === active) ||
                (active !== null && rootRef.current?.contains(active) === true);
            if (!ours)
                return;
            event.preventDefault();
            const current = items.findIndex((item) => item === active);
            let next;
            if (event.key === 'Home')
                next = 0;
            else if (event.key === 'End')
                next = items.length - 1;
            else if (event.key === 'ArrowDown')
                next = current < 0 ? 0 : (current + 1) % items.length;
            else
                next = current <= 0 ? items.length - 1 : current - 1;
            focusItem(next);
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [open, focusItem, ownItems]);
    // Move focus into the list once it is mounted, so the first arrow key lands on
    // a row instead of being swallowed by the trigger.
    const pendingFocus = (0, react_1.useRef)(undefined);
    (0, react_1.useEffect)(() => {
        if (!open || pendingFocus.current === undefined)
            return;
        const index = pendingFocus.current;
        pendingFocus.current = undefined;
        focusItem(index);
    }, [open, focusItem]);
    const handleKeyDown = (event) => {
        if (disabled || open)
            return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            pendingFocus.current = event.key === 'ArrowUp' ? -1 : 0;
            setOpen(true);
        }
    };
    const items = options.map((option) => ({
        id: option.value,
        label: ((0, jsx_runtime_1.jsxs)("span", { className: "sss-menu-item", "data-shell-selector-item": menuId, children: [(0, jsx_runtime_1.jsx)("span", { className: "sss-menu-item-label", children: option.label }), option.description === undefined ? null : ((0, jsx_runtime_1.jsx)("span", { className: "sss-menu-item-desc", children: option.description }))] })),
        ...(option.disabled === undefined ? {} : { disabled: option.disabled }),
    }));
    const selected = options.find((option) => option.value === value);
    const anchor = ((0, jsx_runtime_1.jsxs)(dsh_client_ui_primitives_1.Button, { type: "button", variant: "outline", size: "md", className: "sss-select-trigger", disabled: disabled, "aria-haspopup": "menu", "aria-expanded": open, "aria-label": ariaLabel, onClick: () => setOpen((current) => !current), children: [(0, jsx_runtime_1.jsx)("span", { className: "sss-select-trigger-label", children: selected?.label ?? value }), (0, jsx_runtime_1.jsx)(ChevronDown, { className: "sss-select-chevron" })] }));
    return ((0, jsx_runtime_1.jsx)("div", { ref: rootRef, className: `sss-select${className === undefined ? '' : ` ${className}`}`, onKeyDown: handleKeyDown, children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Menu, { open: open, anchor: anchor, items: items, selectedId: value, 
            // Right-edge aligned so a wide list grows leftwards, and portalled so
            // the Settings dialog's overflow cannot crop it.
            align: "end", side: "bottom", portal: true, className: "sss-select-menu", onSelect: (id) => {
                onChange(id);
                setOpen(false);
            }, onClose: () => setOpen(false) }) }));
}
};
__modules["./index.js"] = function(module, exports, require, __load_) {
"use strict";
/**
 * dsh-shell-selector — browser plugin entry.
 *
 * Registers the "Shell Interpreter" settings section — a first-level tab under
 * Settings, through the official `settings.section` slot (still rendered by
 * DSH 0.1.7-rc.1) — plus its locale and styles. All configuration traffic goes
 * through the plugin's own HTTP endpoint (`/_dsh/shell-selector/...`); the host
 * side writes the `shell-selector` profile row through the settings service.
 *
 * @module dsh-shell-selector/client
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.inject = void 0;
exports.apply = apply;
const controller_js_1 = __load_("./controller.js");
const ShellSelectorPage_js_1 = __load_("./ShellSelectorPage.js");
const en_US_js_1 = __load_("./locale/en-US.js");
const zh_CN_js_1 = __load_("./locale/zh-CN.js");
const NS = 'shell-selector';
const CSS = `
.sss-section{max-width:720px;min-width:0;box-sizing:border-box;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}
.sss-title{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:500;line-height:24px}
.sss-intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:14px;line-height:22px}
.sss-rows{display:grid;gap:16px;padding:4px 0;min-width:0}
.sss-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;min-width:0;max-width:100%;box-sizing:border-box}
.sss-row-text{display:grid;gap:2px;min-width:0;flex:1 1 240px}
.sss-row-label{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.sss-row-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}
.sss-select{display:inline-flex;flex:0 0 auto;min-width:0;max-width:100%;box-sizing:border-box}
.sss-select-trigger{max-width:260px;min-width:0;box-sizing:border-box}
.sss-select-trigger-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.sss-select-chevron{margin-left:6px;flex:0 0 auto;color:var(--dsw-alias-label-tertiary)}
/* The menu is portalled and end-aligned; bound its width so a long option
   description cannot make the list wider than the Settings dialog. */
.sss-menu-item{display:grid;gap:2px;min-width:0;max-width:296px}
.sss-menu-item-label{font-size:13px;line-height:18px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sss-menu-item-desc{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.sss-restart-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.sss-capability-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.sss-status{display:grid;gap:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:10px 12px;min-width:0;max-width:100%;box-sizing:border-box}
.sss-status-row{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;min-width:0}
.sss-status-label{font-size:11px;color:var(--dsw-alias-label-caption);min-width:64px;flex:0 0 auto}
.sss-status-value{font-size:13px;color:var(--dsw-alias-label-primary);min-width:0;overflow-wrap:anywhere}
.sss-warning{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}
.sss-saved{color:var(--dsw-alias-state-success-primary);margin:0;font-size:12px;line-height:18px}
.sss-error{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:18px}
.sss-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.sss-readonly{font-size:11px;color:var(--dsw-alias-label-caption)}
.sss-detected{display:grid;gap:4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption);min-width:0;max-width:100%;box-sizing:border-box}
.sss-detected-label{color:var(--dsw-alias-label-tertiary)}
.sss-detected-row{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;min-width:0;max-width:100%;box-sizing:border-box}
.sss-detected-name{font-size:12px;color:var(--dsw-alias-label-primary);flex:0 0 auto}
/* A full Windows PowerShell path must never widen the dialog. */
.sss-detected-path{font-size:11px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1 1 auto;max-width:100%}
.sss-detected-version{font-size:11px;color:var(--dsw-alias-label-tertiary);flex:0 0 auto}
.sss-detected-none{color:var(--dsw-alias-label-tertiary)}
.sss-loading{padding:24px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);font-size:12px;color:var(--dsw-alias-label-secondary)}
`;
function installStyles() {
    const id = 'dsh-shell-selector/client';
    const existing = document.querySelector(`style[data-plugin-css="${id}"]`);
    if (existing !== null)
        return () => { };
    const style = document.createElement('style');
    style.dataset.plugin = 'dsh-shell-selector';
    style.dataset.pluginCss = id;
    style.textContent = CSS;
    document.head.appendChild(style);
    return () => {
        style.remove();
    };
}
/** Required client services. */
exports.inject = ['slots', 'locale'];
/** Register the settings section. */
function apply(ctx) {
    ctx.effect(installStyles, 'dsh-shell-selector: styles');
    ctx.effect(() => ctx.locale.register(NS, { en: en_US_js_1.en, zh: zh_CN_js_1.zh }), 'dsh-shell-selector: locale');
    const t = ctx.locale.bind(NS);
    const controller = new controller_js_1.ShellSelectorController();
    ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'shell-selector',
        order: 20,
        label: () => t('nav'),
        inject: () => ({ controller, t }),
    }, ShellSelectorPage_js_1.ShellSelectorPage));
}
};
__modules["./locale/en-US.js"] = function(module, exports, require, __load_) {
"use strict";
/**
 * English UI copy for the Shell Selector settings section.
 *
 * @module dsh-shell-selector/client/locale-en
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.en = void 0;
exports.en = {
    nav: 'Shell Selector',
    title: 'Shell Selector',
    intro: 'Choose which shell DeepSeek Harness uses for commands. Changes are saved now and take effect on the next restart.',
    loading: 'Loading…',
    activeBlock: 'Currently active',
    afterRestartBlock: 'After restart',
    mode: 'Shell mode',
    modeDescription: 'Choose how DeepSeek Harness picks the shell interpreter.',
    modeDefault: 'DSH default',
    modeDefaultHint: 'Follow the built-in platform rule: Bash on macOS/Linux, PowerShell on Windows.',
    modeFallback: 'Auto fallback (recommended)',
    modeFallbackHint: 'Use the first available shell in this order: Bash → PowerShell 7 → Windows PowerShell.',
    modeExplicit: 'Specific shell',
    modeExplicitHint: 'Always use the shell selected below after restart.',
    shell: 'Shell',
    shellDescription: 'Choose the interpreter to use after DeepSeek Harness restarts.',
    shellBash: 'Bash',
    shellPwsh: 'PowerShell 7 (pwsh)',
    shellPowershell: 'Windows PowerShell',
    restartHint: 'Changes to the Shell selector take effect after restarting DeepSeek Harness.',
    capabilityHint: 'The Shell selector applies to Agent Presets that enable Shell capability. Presets without Shell capability never gain Shell access.',
    detect: 'Re-detect',
    detecting: 'Detecting…',
    save: 'Save',
    saving: 'Saving…',
    saved: 'Settings saved. Restart DeepSeek Harness to apply the change.',
    warningMissing: 'The configured Shell can no longer be detected.',
    warningActiveMissing: 'The currently active Shell can no longer be detected.',
    warningFallbackNone: 'No supported shell detected.',
    error: 'Something went wrong: {message}',
    detectedTitle: 'Available interpreters',
    detectedNone: 'None',
    versionUnknown: 'version unknown',
    readOnly: 'Settings are read-only.',
};
};
__modules["./locale/zh-CN.js"] = function(module, exports, require, __load_) {
"use strict";
/**
 * 简体中文 UI 文案（Shell 解析器设置页）。
 *
 * @module dsh-shell-selector/client/locale-zh
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.zh = void 0;
exports.zh = {
    nav: 'Shell 解析器',
    title: 'Shell 解析器',
    intro: '选择 DeepSeek Harness 执行 Shell 命令时使用的解析器。更改会立即保存，并在下次重启后生效。',
    loading: '加载中…',
    activeBlock: '当前生效',
    afterRestartBlock: '重启后',
    mode: 'Shell 模式',
    modeDescription: '选择 DSH 使用 Shell 的解析策略。',
    modeDefault: 'DSH 默认',
    modeDefaultHint: '跟随内置平台规则：macOS/Linux 使用 Bash，Windows 使用 PowerShell。',
    modeFallback: '自动降级（推荐）',
    modeFallbackHint: '按顺序使用第一个可用的 Shell：Bash → PowerShell 7 → Windows PowerShell。',
    modeExplicit: '指定 Shell',
    modeExplicitHint: '重启后始终使用下方选择的 Shell。',
    shell: 'Shell',
    shellDescription: '选择重启后执行 Shell 命令时使用的解析器。',
    shellBash: 'Bash',
    shellPwsh: 'PowerShell 7 (pwsh)',
    shellPowershell: 'Windows PowerShell',
    restartHint: '更改 Shell 解析器后，需要重启 DeepSeek Harness 才能生效。',
    capabilityHint: 'Shell 解析器适用于启用了 Shell 能力的 Agent Preset。未启用 Shell 能力的 Agent 不会因此获得 Shell 权限。',
    detect: '重新检测',
    detecting: '检测中…',
    save: '保存',
    saving: '保存中…',
    saved: '设置已保存，重启 DeepSeek Harness 后生效。',
    warningMissing: '当前配置的 Shell 已无法检测到。',
    warningActiveMissing: '当前生效的 Shell 已无法检测到。',
    warningFallbackNone: '未检测到可用的 Shell 解析器。',
    error: '出错了：{message}',
    detectedTitle: '可用解析器',
    detectedNone: '无',
    versionUnknown: '版本未知',
    readOnly: '设置为只读，无法修改。',
};
};
__modules["./ShellSelectorPage.js"] = function(module, exports, require, __load_) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShellSelectorPage = ShellSelectorPage;
const jsx_runtime_1 = require("react/jsx-runtime");
/**
 * The Shell Interpreter settings section: choose which shell DSH runs
 * commands with. Configuration is persisted immediately, but the running
 * process keeps its boot-time shell — the change applies after restart.
 *
 * The page uses DSH-native primitives (`Menu`, `Button`) instead of browser
 * `<select>` controls, so it matches the rest of DeepSeek Harness Settings.
 *
 * @module dsh-shell-selector/client/page
 */
const react_1 = require("react");
const dsh_client_ui_primitives_1 = require("@deepseek-ai/dsh-client-ui-primitives");
const DshSelect_js_1 = __load_("./DshSelect.js");
function draftOf(snapshot) {
    const detected = snapshot.detected.map((entry) => entry.kind);
    const defaultShell = snapshot.configured.shell !== undefined && snapshot.configured.shell !== null
        ? snapshot.configured.shell
        : (detected.includes('bash') ? 'bash' : (detected[0] ?? 'bash'));
    return { mode: snapshot.configured.mode, shell: defaultShell };
}
function shellLabel(t, kind) {
    if (kind === 'bash')
        return t('shellBash');
    if (kind === 'pwsh')
        return t('shellPwsh');
    return t('shellPowershell');
}
function detectedName(snapshot, kind, t) {
    const entry = snapshot.detected.find((item) => item.kind === kind);
    return entry?.name ?? shellLabel(t, kind);
}
/** The shell this process actually runs commands with. */
function activeKindOf(snapshot) {
    return snapshot.active.kind;
}
/**
 * Which shell the NEXT boot composes, per current configuration and
 * detection. Mirrors the host's resolver for display purposes.
 */
function nextKindOf(configured, snapshot) {
    const has = (kind) => snapshot.detected.some((entry) => entry.kind === kind);
    if (configured.mode === 'explicit' && configured.shell !== undefined) {
        return has(configured.shell) ? configured.shell : activeKindOf(snapshot);
    }
    if (configured.mode === 'fallback' && snapshot.platform === 'win32') {
        if (has('bash'))
            return 'bash';
        if (has('pwsh'))
            return 'pwsh';
        if (has('powershell'))
            return 'powershell';
        return activeKindOf(snapshot);
    }
    return snapshot.platform === 'win32' ? 'pwsh' : 'bash';
}
function ShellSelectorPage({ controller, t }) {
    const state = (0, react_1.useSyncExternalStore)(controller.subscribe, controller.snapshot, controller.snapshot);
    const snapshot = state.snapshot;
    const [draft, setDraft] = (0, react_1.useState)(undefined);
    (0, react_1.useEffect)(() => {
        if (state.status === 'idle')
            void controller.load();
    }, [controller, state.status]);
    (0, react_1.useEffect)(() => {
        if (snapshot !== undefined)
            setDraft(draftOf(snapshot));
    }, [snapshot]);
    (0, react_1.useEffect)(() => {
        if (state.notice === 'saved') {
            const timer = setTimeout(() => controller.dismissNotice(), 6000);
            return () => clearTimeout(timer);
        }
        return undefined;
    }, [controller, state.notice]);
    if (snapshot === undefined) {
        return ((0, jsx_runtime_1.jsxs)("div", { className: "sss-section", children: [(0, jsx_runtime_1.jsx)("h2", { className: "sss-title", children: t('title') }), (0, jsx_runtime_1.jsx)("p", { className: "sss-intro", children: t('intro') }), state.status === 'error' ? (0, jsx_runtime_1.jsx)("p", { className: "sss-error", children: t('error', { message: state.error ?? 'unknown' }) }) : null, (0, jsx_runtime_1.jsx)("div", { className: "sss-loading", children: t('loading') })] }));
    }
    const busy = state.action !== undefined;
    const draftValue = draft ?? draftOf(snapshot);
    const detected = snapshot.detected;
    const modeOptions = [
        { value: 'default', label: t('modeDefault'), description: t('modeDefaultHint') },
        ...(snapshot.platform === 'win32'
            ? [{ value: 'fallback', label: t('modeFallback'), description: t('modeFallbackHint') }]
            : []),
        { value: 'explicit', label: t('modeExplicit'), description: t('modeExplicitHint') },
    ];
    const shellOptions = detected.map((entry) => ({
        value: entry.kind,
        label: entry.name,
        description: entry.path ?? entry.version,
    }));
    const save = () => {
        if (draft === undefined)
            return;
        void controller.save(draft.mode, draft.mode === 'explicit' ? draft.shell : undefined, snapshot.settingsRevision);
    };
    const nextKind = nextKindOf({ mode: draftValue.mode, ...(draftValue.mode === 'explicit' ? { shell: draftValue.shell } : {}) }, snapshot);
    return ((0, jsx_runtime_1.jsxs)("div", { className: "sss-section", children: [(0, jsx_runtime_1.jsx)("h2", { className: "sss-title", children: t('title') }), (0, jsx_runtime_1.jsx)("p", { className: "sss-intro", children: t('intro') }), (0, jsx_runtime_1.jsxs)("div", { className: "sss-rows", children: [(0, jsx_runtime_1.jsxs)("div", { className: "sss-row", children: [(0, jsx_runtime_1.jsxs)("div", { className: "sss-row-text", children: [(0, jsx_runtime_1.jsx)("span", { className: "sss-row-label", children: t('mode') }), (0, jsx_runtime_1.jsx)("span", { className: "sss-row-desc", children: t('modeDescription') })] }), (0, jsx_runtime_1.jsx)(DshSelect_js_1.DshSelect, { ariaLabel: t('mode'), value: draftValue.mode, options: modeOptions, disabled: busy || !snapshot.writable, onChange: (mode) => setDraft({ ...draftValue, mode }) })] }), draftValue.mode === 'explicit' ? ((0, jsx_runtime_1.jsxs)("div", { className: "sss-row", children: [(0, jsx_runtime_1.jsxs)("div", { className: "sss-row-text", children: [(0, jsx_runtime_1.jsx)("span", { className: "sss-row-label", children: t('shell') }), (0, jsx_runtime_1.jsx)("span", { className: "sss-row-desc", children: t('shellDescription') })] }), (0, jsx_runtime_1.jsx)(DshSelect_js_1.DshSelect, { ariaLabel: t('shell'), value: draftValue.shell, options: shellOptions, disabled: busy || !snapshot.writable || shellOptions.length === 0, onChange: (shell) => setDraft({ ...draftValue, shell }) })] })) : null] }), (0, jsx_runtime_1.jsx)("p", { className: "sss-restart-hint", children: t('restartHint') }), (0, jsx_runtime_1.jsx)("p", { className: "sss-capability-hint", children: t('capabilityHint') }), (0, jsx_runtime_1.jsxs)("div", { className: "sss-status", children: [(0, jsx_runtime_1.jsxs)("div", { className: "sss-status-row", children: [(0, jsx_runtime_1.jsx)("span", { className: "sss-status-label", children: t('activeBlock') }), (0, jsx_runtime_1.jsx)("span", { className: "sss-status-value", children: detectedName(snapshot, activeKindOf(snapshot), t) })] }), (0, jsx_runtime_1.jsxs)("div", { className: "sss-status-row", children: [(0, jsx_runtime_1.jsx)("span", { className: "sss-status-label", children: t('afterRestartBlock') }), (0, jsx_runtime_1.jsx)("span", { className: "sss-status-value", children: detectedName(snapshot, nextKind, t) })] })] }), snapshot.activeMissing ? (0, jsx_runtime_1.jsx)("p", { className: "sss-warning", children: t('warningActiveMissing') }) : null, snapshot.configuredMissing ? (0, jsx_runtime_1.jsx)("p", { className: "sss-warning", children: t('warningMissing') }) : null, snapshot.detected.length === 0 ? (0, jsx_runtime_1.jsx)("p", { className: "sss-warning", children: t('warningFallbackNone') }) : null, (0, jsx_runtime_1.jsxs)("div", { className: "sss-detected", children: [(0, jsx_runtime_1.jsx)("span", { className: "sss-detected-label", children: t('detectedTitle') }), detected.length === 0 ? ((0, jsx_runtime_1.jsx)("span", { className: "sss-detected-none", children: t('detectedNone') })) : (detected.map((entry) => ((0, jsx_runtime_1.jsxs)("div", { className: "sss-detected-row", children: [(0, jsx_runtime_1.jsx)("span", { className: "sss-detected-name", children: entry.name }), entry.path === undefined ? null : (0, jsx_runtime_1.jsx)("span", { className: "sss-detected-path", children: entry.path }), entry.version === undefined ? null : (0, jsx_runtime_1.jsx)("span", { className: "sss-detected-version", children: entry.version })] }, entry.kind))))] }), (0, jsx_runtime_1.jsxs)("div", { className: "sss-actions", children: [(0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Button, { variant: "outline", size: "sm", disabled: busy, onClick: () => void controller.detect(), children: state.action === 'detect' ? t('detecting') : t('detect') }), (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Button, { variant: "primary", size: "sm", disabled: busy || !snapshot.writable || draft === undefined, onClick: save, children: state.action === 'save' ? t('saving') : t('save') }), !snapshot.writable ? (0, jsx_runtime_1.jsx)("span", { className: "sss-readonly", children: t('readOnly') }) : null] }), state.error === undefined ? null : (0, jsx_runtime_1.jsx)("p", { className: "sss-error", children: t('error', { message: state.error }) }), state.notice === 'saved' ? (0, jsx_runtime_1.jsx)("p", { className: "sss-saved", children: t('saved') }) : null] }));
}
};
__modules["./types.js"] = function(module, exports, require, __load_) {
"use strict";
/**
 * Client-side wire types: the browser mirror of the host endpoint contract.
 *
 * @module dsh-shell-selector/client/types
 */
Object.defineProperty(exports, "__esModule", { value: true });
};
function __resolve(from, request) {
  if (!request.startsWith(".")) return request;
  var parts = from.slice(2).split("/"); parts.pop();
  for (var part of request.split("/")) { if (part === "." || part === "") continue; if (part === "..") parts.pop(); else parts.push(part); }
  return "./" + parts.join("/");
}
function __load(id) {
  if (__modules[id] === undefined) return require(id);
  if (__cache[id] !== undefined) return __cache[id].exports;
  var module = __cache[id] = { exports: {} };
  __modules[id](module, module.exports, require, function(request) { var resolved = __resolve(id, request); return __modules[resolved] === undefined ? require(request) : __load(resolved); });
  return module.exports;
}
return __load("./index.js"); } });
//# sourceMappingURL=client.js.map
