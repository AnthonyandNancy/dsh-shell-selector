/**
 * Single source of truth for the boot-time composition expressions.
 *
 * `dsh-shell-selector` changes the shell stack at PROCESS STARTUP — never at
 * runtime. The swap happens in the composition layer, where the loader
 * evaluates `!!js` expressions while activating the executor rows
 * (`bash-sandbox` / `pwsh-sandbox`). Those expressions cannot import anything:
 * the loader evaluates them with `new Function("ctx", "expr", "with(ctx){return
 * eval(expr)}")` inside a bare Cordis context where only `process`, `Buffer`,
 * `fetch`, `globalThis` and the loader context itself (`ctx.baseUrl`) exist.
 * Everything below is therefore one self-contained JavaScript block, evaluated
 * verbatim by the Loader.
 *
 * Where the configuration lives moved in DSH 0.1.7-rc.1: the persisted
 * document is the profile patch row (`cordis.patch.yml` -> `- id:
 * shell-selector`), and `ctx.baseUrl` is the profile directory holding it. The
 * retired `$DSH_HOME/settings.yaml` stays as a second source, so an
 * installation that has not been migrated yet still resolves.
 *
 * The same decision is mirrored in TypeScript (`../resolver.ts`) for the
 * host-side runtime state; `tests/expressions.test.ts` evaluates these exact
 * strings against a fake `$DSH_HOME` and a fake profile directory, and asserts
 * they agree with the mirror.
 *
 * @module dsh-shell-selector/boot-expressions
 */
/**
 * Helper block shared by every row expression. It defines all helpers and
 * computes `eff` (the effective decision). Every declaration lives inside the
 * outer arrow function so the Loader's `with(ctx)` object can never capture
 * them; only `process` resolves through the context chain, exactly like the
 * shipped base patch expressions.
 */
export const EXPRESSION_HELPERS = String.raw `(() => {
  const dshSsrReadProfilePatches = () => {
    const files = [];
    const seen = new Set();
    const add = (value) => {
      if (typeof value !== 'string' || value.length === 0) return;
      const path = process.getBuiltinModule('node:path');
      const url = process.getBuiltinModule('node:url');
      let file;
      try {
        file = value.startsWith('file:')
          ? url.fileURLToPath(new URL('cordis.patch.yml', value))
          : path.resolve(value, 'cordis.patch.yml');
      } catch (err) {
        return;
      }
      if (seen.has(file)) return;
      seen.add(file);
      files.push(file);
    };
    // The Loader's base URL is the profile directory, so ctx.baseUrl names the
    // very document the user's shell-selector row is written to.
    try {
      add(typeof ctx === 'object' && ctx !== null ? ctx.baseUrl : undefined);
    } catch (err) {}
    try {
      const path = process.getBuiltinModule('node:path');
      const os = process.getBuiltinModule('node:os');
      const env = process.env.DSH_HOME;
      const home = env && String(env).trim() ? path.resolve(String(env).trim()) : path.join(os.homedir(), '.dsh');
      const profile = process.env.DSH_PROFILE;
      if (profile && String(profile).trim()) add(path.join(home, 'profiles', String(profile).trim()));
    } catch (err) {}
    return files;
  };
  const dshSsrParseEntryConfig = (text, entryId) => {
    const assign = (state, key, rawValue) => {
      const value = String(rawValue).replace(/\s+#.*$/u, '').trim().replace(/^["']|["']$/gu, '').trim();
      if (value.length === 0) return;
      if (key === 'mode') state.mode = value;
      else if (key === 'shell') state.shell = value;
    };
    const lines = String(text).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!/^-\s*id\s*:/u.test(trimmed)) continue;
      const idValue = trimmed
        .replace(/^-\s*id\s*:\s*/u, '')
        .replace(/\s+#.*$/u, '')
        .trim()
        .replace(/^["']|["']$/gu, '');
      if (idValue !== entryId) continue;
      const state = { mode: undefined, shell: undefined };
      const entryIndent = line.length - line.trimStart().length;
      let configIndent = -1;
      for (let j = i + 1; j < lines.length; j++) {
        const row = lines[j];
        const inner = row.trim();
        if (inner.length === 0 || inner.startsWith('#')) continue;
        const indent = row.length - row.trimStart().length;
        if (indent <= entryIndent) break;
        const config = /^config\s*:\s*(.*)$/u.exec(inner);
        if (configIndent < 0) {
          if (config === null) continue;
          const inline = config[1].trim();
          if (inline.startsWith('{')) {
            for (const part of inline.replace(/^\{|\}$/gu, '').split(',')) {
              const pair = /^\s*([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/u.exec(part);
              if (pair !== null) assign(state, pair[1], pair[2]);
            }
            return state;
          }
          configIndent = indent;
          continue;
        }
        if (indent <= configIndent) break;
        const pair = /^([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/u.exec(inner);
        if (pair !== null) assign(state, pair[1], pair[2]);
      }
      return state;
    }
    return { mode: undefined, shell: undefined };
  };
  const dshSsrReadConfig = () => {
    const fs = process.getBuiltinModule('node:fs');
    const modeOf = (value) => (value === 'fallback' || value === 'explicit' ? value : 'default');
    // DSH 0.1.7-rc.1 persists configuration on the profile patch row, because
    // $DSH_HOME/settings.yaml was retired into the profile by the settings
    // service. Read that row first; the legacy document stays as the second
    // source so a not-yet-migrated rc.6 installation still resolves.
    for (const file of dshSsrReadProfilePatches()) {
      try {
        const row = dshSsrParseEntryConfig(fs.readFileSync(file, 'utf8'), 'shell-selector');
        if (row.mode !== undefined || row.shell !== undefined) {
          return { mode: modeOf(row.mode), shell: row.shell };
        }
      } catch (err) {}
    }
    const os = process.getBuiltinModule('node:os');
    const path = process.getBuiltinModule('node:path');
    let home;
    try {
      const env = process.env.DSH_HOME;
      home = env && String(env).trim() ? path.resolve(String(env).trim()) : path.join(os.homedir(), '.dsh');
    } catch (err) {
      home = path.join(os.homedir(), '.dsh');
    }
    const file = path.join(home, 'settings.yaml');
    const sectionOf = (root) => {
      const section = root && typeof root === 'object' && !Array.isArray(root) ? root['shell-selector'] : undefined;
      return {
        mode: section && typeof section === 'object' ? section['mode'] : undefined,
        shell: section && typeof section === 'object' ? section['shell'] : undefined
      };
    };
    try {
      const text = fs.readFileSync(file, 'utf8');
      try {
        return sectionOf(JSON.parse(text));
      } catch (err) {}
      const lines = text.split(/\r?\n/);
      let inSection = false;
      let mode = 'default';
      let shell = undefined;
      for (const raw of lines) {
        const line = raw.replace(/\s+$/u, '');
        if (/^[A-Za-z0-9_-]+:\s*$/u.test(line)) {
          inSection = line === 'shell-selector:';
          continue;
        }
        if (!inSection) continue;
        if (line.trim() === '') continue;
        if (!/^\s/u.test(raw)) { inSection = false; continue; }
        const m = /^\s*([A-Za-z0-9_-]+):\s*(.*?)\s*$/u.exec(line);
        if (!m) continue;
        const key = m[1];
        const value = m[2].replace(/^["']|["']$/gu, '');
        if (key === 'mode' && (value === 'fallback' || value === 'explicit')) mode = value;
        else if (key === 'shell') shell = value;
      }
      return { mode, shell };
    } catch (err) {
      return { mode: 'default', shell: undefined };
    }
  };
  const dshSsrPathDirs = () => {
    const path = process.getBuiltinModule('node:path');
    const sep = process.platform === 'win32' ? ';' : ':';
    return String(process.env.PATH || '').split(sep).map((p) => p.trim()).filter((p) => p.length > 0).map((p) => path.resolve(p));
  };
  const dshSsrResolveInPath = (exe, extraDirs) => {
    const fs = process.getBuiltinModule('node:fs');
    const path = process.getBuiltinModule('node:path');
    for (const dir of extraDirs.concat(dshSsrPathDirs())) {
      const full = path.join(dir, exe);
      try {
        const st = fs.statSync(full);
        if (st.isFile() || st.isSymbolicLink()) return full;
      } catch (err) {}
    }
    return undefined;
  };
  const dshSsrSystemRoot = () => String(process.env.SystemRoot || process.env.windir || 'C:\\Windows');
  const dshSsrIsWslBash = (p) => {
    const path = process.getBuiltinModule('node:path');
    return path.resolve(p).toLowerCase() === path.resolve(path.join(dshSsrSystemRoot(), 'System32', 'bash.exe')).toLowerCase();
  };
  const dshSsrBashProbeOk = (file) => {
    let cp;
    try {
      cp = process.getBuiltinModule('node:child_process');
    } catch (err) {
      return false;
    }
    try {
      const version = cp.spawnSync(file, ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true, env: process.env });
      if (!version || version.status !== 0) return false;
      const probe = cp.spawnSync(file, ['-c', 'printf "%s" "$BASH_VERSION"'], { encoding: 'utf8', timeout: 5000, windowsHide: true, env: process.env });
      if (!probe || probe.status !== 0) return false;
      return String(probe.stdout || '').trim().length > 0;
    } catch (err) {
      return false;
    }
  };
  const dshSsrBashCandidates = () => {
    const path = process.getBuiltinModule('node:path');
    const fs = process.getBuiltinModule('node:fs');
    const isFile = (p) => {
      try {
        const st = fs.statSync(p);
        return st.isFile() || st.isSymbolicLink();
      } catch (err) { return false; }
    };
    const list = [];
    const seen = new Set();
    const add = (p, source) => {
      if (!isFile(p) || dshSsrIsWslBash(p)) return;
      const key = path.resolve(p).toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      list.push({ path: path.resolve(p), source });
    };
    const addRoot = (root, source) => {
      add(path.join(root, 'bin', 'bash.exe'), source);
      add(path.join(root, 'usr', 'bin', 'bash.exe'), source);
    };
    for (const dir of dshSsrPathDirs()) add(path.join(dir, 'bash.exe'), 'path');
    for (const dir of dshSsrPathDirs()) {
      const git = path.join(dir, 'git.exe');
      if (!isFile(git)) continue;
      addRoot(path.resolve(dir, '..'), 'git-for-windows');
    }
    const pf = String(process.env.ProgramFiles || 'C:\\Program Files');
    const pf86 = String(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)');
    addRoot(path.join(pf, 'Git'), 'git-for-windows');
    addRoot(path.join(pf86, 'Git'), 'git-for-windows');
    const local = process.env.LOCALAPPDATA;
    if (local) addRoot(path.join(local, 'Programs', 'Git'), 'git-for-windows');
    return list;
  };
  const dshSsrHasBash = () => {
    if (process.platform !== 'win32') {
      const path = process.getBuiltinModule('node:path');
      const fs = process.getBuiltinModule('node:fs');
      for (const dir of dshSsrPathDirs().concat(['/bin', '/usr/bin', '/usr/local/bin'])) {
        const full = path.join(dir, 'bash');
        try {
          const st = fs.statSync(full);
          if ((st.isFile() || st.isSymbolicLink()) && dshSsrBashProbeOk(full)) return true;
        } catch (err) {}
      }
      return false;
    }
    for (const candidate of dshSsrBashCandidates()) {
      if (dshSsrBashProbeOk(candidate.path)) return true;
    }
    return false;
  };
  const dshSsrHasPwsh = () => {
    if (process.platform !== 'win32') {
      return dshSsrResolveInPath('pwsh', []) !== undefined;
    }
    const path = process.getBuiltinModule('node:path');
    const pf = String(process.env.ProgramFiles || 'C:\\Program Files');
    return dshSsrResolveInPath('pwsh.exe', [path.join(pf, 'PowerShell', '7')]) !== undefined;
  };
  const dshSsrWindowsPowerShellFile = () => {
    const path = process.getBuiltinModule('node:path');
    return path.join(dshSsrSystemRoot(), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  };
  const dshSsrHasWindowsPowerShell = () => {
    if (process.platform !== 'win32') return false;
    const fs = process.getBuiltinModule('node:fs');
    const full = dshSsrWindowsPowerShellFile();
    try {
      const st = fs.statSync(full);
      return st.isFile() || st.isSymbolicLink();
    } catch (err) {
      return false;
    }
  };
  const dshSsrEffective = () => {
    const cfg = dshSsrReadConfig();
    if (cfg.mode === 'default') return { kind: 'platform' };
    if (process.platform === 'win32') {
      if (cfg.mode === 'fallback') {
        if (dshSsrHasBash()) return { kind: 'bash' };
        if (dshSsrHasPwsh()) return { kind: 'pwsh' };
        if (dshSsrHasWindowsPowerShell()) return { kind: 'powershell' };
        return { kind: 'platform' };
      }
      if (cfg.shell === 'bash') return dshSsrHasBash() ? { kind: 'bash' } : { kind: 'platform' };
      if (cfg.shell === 'pwsh') return dshSsrHasPwsh() ? { kind: 'pwsh' } : { kind: 'platform' };
      if (cfg.shell === 'powershell') return dshSsrHasWindowsPowerShell() ? { kind: 'powershell' } : { kind: 'platform' };
      return { kind: 'platform' };
    }
    if (cfg.mode === 'explicit' && cfg.shell === 'bash') return dshSsrHasBash() ? { kind: 'bash' } : { kind: 'platform' };
    return { kind: 'platform' };
  };
  const eff = dshSsrEffective();
`;
/**
 * `bash-sandbox.disabled` — enable Bash exactly when the decision says Bash.
 * `platform` keeps the shipped rule: disabled on Windows.
 */
export const BASH_SANDBOX_DISABLED_EXPR = `${EXPRESSION_HELPERS}  return eff.kind === 'platform' ? process.platform === 'win32' : eff.kind !== 'bash';
})()`;
/**
 * `pwsh-sandbox.disabled` — enable the PowerShell executor exactly when the
 * decision says pwsh/powershell. `platform` keeps the shipped rule: disabled
 * everywhere except Windows.
 */
export const PWSH_SANDBOX_DISABLED_EXPR = `${EXPRESSION_HELPERS}  return eff.kind === 'platform' ? process.platform !== 'win32' : eff.kind === 'bash';
})()`;
/**
 * `pwsh-sandbox.config.pwshPath` — pin Windows PowerShell when the decision
 * says `powershell`; otherwise stay `undefined` so the executor's own
 * resolution chain (`%ProgramFiles%\PowerShell\7\pwsh.exe` → PATH → Windows
 * PowerShell) applies.
 */
export const PWSH_PATH_EXPR = `${EXPRESSION_HELPERS}  return eff.kind === 'powershell' ? dshSsrWindowsPowerShellFile() : undefined;
})()`;
/** True when a config read means "leave the platform rule in charge". */
export function isPlatformDecision(kind) {
    return kind === 'platform';
}
//# sourceMappingURL=expressions.js.map