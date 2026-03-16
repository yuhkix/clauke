<script lang="ts">
  import { getCurrentWindow, Effect, EffectState } from "@tauri-apps/api/window";
  import { invoke } from "@tauri-apps/api/core";
  import { open } from "@tauri-apps/plugin-dialog";
  import type { ClaudeModel, EffortLevel, PermissionMode, McpServer, HookRule } from "../types";
  import { MODEL_LABELS, EFFORT_LABELS, PERMISSION_LABELS, HOOK_EVENTS, HOOK_EVENT_LABELS } from "../types";
  import type { HookEvent } from "../types";

  let {
    open: isOpen,
    onClose,
    onSettingsChange,
  }: {
    open: boolean;
    onClose: () => void;
    onSettingsChange: (settings: Record<string, string>) => void;
  } = $props();

  let visible = $state(false);
  let closing = $state(false);

  const appWindow = getCurrentWindow();

  // ── Persisted settings ──
  let theme = $state<"dark" | "light">(
    (localStorage.getItem("clauke:theme") as "dark" | "light") || "dark",
  );
  let transparency = $state(
    localStorage.getItem("clauke:transparency") !== "false",
  );
  let defaultModel = $state<ClaudeModel>(
    (localStorage.getItem("clauke:defaultModel") as ClaudeModel) || "opus",
  );
  let defaultEffort = $state<EffortLevel>(
    (localStorage.getItem("clauke:defaultEffort") as EffortLevel) || "max",
  );
  let defaultCwd = $state(localStorage.getItem("clauke:defaultCwd") || "");
  let fontSize = $state(
    parseInt(localStorage.getItem("clauke:fontSize") || "14", 10),
  );
  let autoScroll = $state(
    localStorage.getItem("clauke:autoScroll") !== "false",
  );
  let permissionMode = $state<PermissionMode>(
    (localStorage.getItem("clauke:permissionMode") as PermissionMode) || "bypass",
  );
  let systemPrompt = $state(
    localStorage.getItem("clauke:systemPrompt") || "",
  );
  let clipboardRetention = $state(
    parseInt(localStorage.getItem("clauke:clipboardRetention") || "7", 10),
  );
  let lastCleanupResult = $state<string | null>(null);

  // Sync open prop to visible with close animation
  $effect(() => {
    if (isOpen && !visible) {
      closing = false;
      visible = true;
    } else if (!isOpen && visible && !closing) {
      closing = true;
      setTimeout(() => {
        visible = false;
        closing = false;
      }, 200);
    }
  });

  function handleClose() {
    closing = true;
    setTimeout(() => {
      visible = false;
      closing = false;
      onClose();
    }, 200);
  }

  function save(key: string, value: string) {
    localStorage.setItem(`clauke:${key}`, value);
    emitAll();
  }

  function emitAll() {
    onSettingsChange({
      defaultModel,
      defaultEffort,
      defaultCwd,
      fontSize: String(fontSize),
      autoScroll: String(autoScroll),
      permissionMode,
      systemPrompt,
    });
  }

  // ── Transparency (special — needs window API) ──
  async function applyTransparency(enabled: boolean) {
    localStorage.setItem("clauke:transparency", String(enabled));
    document.documentElement.classList.toggle("transparent", enabled);

    if (enabled) {
      await appWindow.setEffects({
        effects: [Effect.Acrylic],
        state: EffectState.Active,
        color: "#0b0b0e00",
      });
    } else {
      await appWindow.clearEffects();
    }
  }

  function toggleTransparency() {
    transparency = !transparency;
    applyTransparency(transparency);
  }

  // ── Theme ──
  function applyTheme(t: "dark" | "light") {
    document.documentElement.setAttribute("data-theme", t);
  }

  function toggleTheme() {
    theme = theme === "dark" ? "light" : "dark";
    save("theme", theme);
    applyTheme(theme);
  }

  // ── Font size ──
  function setFontSize(size: number) {
    fontSize = Math.max(10, Math.min(22, size));
    save("fontSize", String(fontSize));
    document.documentElement.style.setProperty("--chat-font-size", `${fontSize}px`);
  }

  // ── Toggle helpers ──
  function toggleAutoScroll() {
    autoScroll = !autoScroll;
    save("autoScroll", String(autoScroll));
  }

  const permModes: PermissionMode[] = ["bypass", "acceptEdits", "plan", "default"];

  function cyclePermissionMode() {
    const idx = permModes.indexOf(permissionMode);
    permissionMode = permModes[(idx + 1) % permModes.length];
    save("permissionMode", permissionMode);
  }

  // ── Model/Effort selectors ──
  function cycleModel() {
    const models: ClaudeModel[] = ["sonnet", "opus", "haiku"];
    const idx = models.indexOf(defaultModel);
    defaultModel = models[(idx + 1) % models.length];
    save("defaultModel", defaultModel);
  }

  function cycleEffort() {
    const levels: EffortLevel[] = ["low", "medium", "high", "max"];
    const idx = levels.indexOf(defaultEffort);
    defaultEffort = levels[(idx + 1) % levels.length];
    save("defaultEffort", defaultEffort);
  }

  // ── Browse default CWD ──
  async function browseCwd() {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      defaultCwd = selected as string;
      save("defaultCwd", defaultCwd);
    }
  }

  // ── Clipboard retention ──
  function setClipboardRetention(days: number) {
    clipboardRetention = Math.max(1, Math.min(365, days));
    save("clipboardRetention", String(clipboardRetention));
  }

  async function runCleanupNow() {
    try {
      const deleted = await invoke<number>("cleanup_clipboard", { maxAgeDays: clipboardRetention });
      lastCleanupResult = deleted > 0 ? `${deleted} file${deleted > 1 ? "s" : ""} deleted` : "nothing to clean";
      setTimeout(() => (lastCleanupResult = null), 3000);
    } catch (e) {
      lastCleanupResult = "cleanup failed";
      setTimeout(() => (lastCleanupResult = null), 3000);
    }
  }

  // ── MCP Servers ──
  let mcpServers = $state<McpServer[]>([]);
  let mcpLoading = $state(false);
  let mcpAddOpen = $state(false);
  let mcpNewName = $state("");
  let mcpNewCommand = $state("");
  let mcpNewArgs = $state("");

  async function loadMcpServers() {
    mcpLoading = true;
    try {
      mcpServers = await invoke<McpServer[]>("list_mcp_servers");
    } catch {
      mcpServers = [];
    }
    mcpLoading = false;
  }

  async function addMcpServer() {
    const name = mcpNewName.trim();
    const command = mcpNewCommand.trim();
    if (!name || !command) return;
    const args = mcpNewArgs.trim() ? mcpNewArgs.trim().split(/\s+/) : [];
    try {
      await invoke("add_mcp_server", { name, command, args, env: {} });
      mcpNewName = "";
      mcpNewCommand = "";
      mcpNewArgs = "";
      mcpAddOpen = false;
      await loadMcpServers();
    } catch { /* silently fail */ }
  }

  async function removeMcpServer(name: string) {
    try {
      await invoke("remove_mcp_server", { name });
      await loadMcpServers();
    } catch { /* silently fail */ }
  }

  // ── Hooks ──
  let hooksConfig = $state<Record<string, HookRule[]>>({});
  let hooksLoading = $state(false);
  let hookAddOpen = $state(false);
  let hookNewEvent = $state<HookEvent>("PostToolUse");
  let hookNewMatcher = $state("");
  let hookNewCommand = $state("");

  async function loadHooks() {
    hooksLoading = true;
    try {
      hooksConfig = await invoke<Record<string, HookRule[]>>("list_hooks");
    } catch {
      hooksConfig = {};
    }
    hooksLoading = false;
  }

  async function addHook() {
    const command = hookNewCommand.trim();
    if (!command) return;
    const matcher = hookNewMatcher.trim() || ".*";
    try {
      await invoke("add_hook", { event: hookNewEvent, matcher, command });
      hookNewCommand = "";
      hookNewMatcher = "";
      hookAddOpen = false;
      await loadHooks();
    } catch { /* silently fail */ }
  }

  async function removeHook(event: string, index: number) {
    try {
      await invoke("remove_hook", { event, index });
      await loadHooks();
    } catch { /* silently fail */ }
  }

  const hookEntries = $derived(
    Object.entries(hooksConfig).flatMap(([event, rules]) =>
      rules.map((rule, idx) => ({ event, rule, idx }))
    )
  );

  // Apply saved settings on first render
  document.documentElement.style.setProperty("--chat-font-size", `${fontSize}px`);
  applyTheme(theme);
  applyTransparency(transparency);
  // Emit initial settings
  emitAll();

  // Load MCP servers and hooks when panel opens
  $effect(() => {
    if (isOpen) {
      loadMcpServers();
      loadHooks();
    }
  });
</script>

{#if visible}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="overlay"
    class:closing
    onclick={handleClose}
    onkeydown={(e) => e.key === "Escape" && handleClose()}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="panel" class:closing onclick={(e) => e.stopPropagation()}>
      <div class="panel-header">
        <span class="panel-title">settings</span>
        <button class="close-btn" title="Close" onclick={handleClose}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" stroke-width="1.2" />
            <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" stroke-width="1.2" />
          </svg>
        </button>
      </div>

      <div class="sections">
        <!-- ── Appearance ── -->
        <div class="section">
          <div class="section-title">appearance</div>

          <div class="row">
            <div class="label-group">
              <span class="label">theme</span>
              <span class="desc">{theme === "dark" ? "midnight cloak" : "daylight"}</span>
            </div>
            <button class="pill" onclick={toggleTheme}>{theme}</button>
          </div>

          <div class="row">
            <div class="label-group">
              <span class="label">transparency</span>
              <span class="desc">frosted glass with desktop blur</span>
            </div>
            <button
              class="toggle"
              class:active={transparency}
              title="Toggle transparency"
              onclick={toggleTransparency}
            >
              <span class="toggle-knob"></span>
            </button>
          </div>

          <div class="row">
            <div class="label-group">
              <span class="label">font size</span>
              <span class="desc">chat text size ({fontSize}px)</span>
            </div>
            <div class="stepper">
              <button class="step-btn" onclick={() => setFontSize(fontSize - 1)} title="Decrease font size">-</button>
              <span class="step-value">{fontSize}</span>
              <button class="step-btn" onclick={() => setFontSize(fontSize + 1)} title="Increase font size">+</button>
            </div>
          </div>
        </div>

        <!-- ── Defaults ── -->
        <div class="section">
          <div class="section-title">defaults for new tabs</div>

          <div class="row">
            <div class="label-group">
              <span class="label">model</span>
              <span class="desc">default model for new tabs</span>
            </div>
            <button class="pill" onclick={cycleModel}>{MODEL_LABELS[defaultModel]}</button>
          </div>

          <div class="row">
            <div class="label-group">
              <span class="label">effort</span>
              <span class="desc">default effort level</span>
            </div>
            <button class="pill" onclick={cycleEffort}>{EFFORT_LABELS[defaultEffort]}</button>
          </div>

          <div class="row">
            <div class="label-group">
              <span class="label">working directory</span>
              <span class="desc">{defaultCwd || "none set"}</span>
            </div>
            <button class="pill" onclick={browseCwd}>browse</button>
          </div>
        </div>

        <!-- ── Behavior ── -->
        <div class="section">
          <div class="section-title">behavior</div>

          <div class="row">
            <div class="label-group">
              <span class="label">auto-scroll</span>
              <span class="desc">follow new content during streaming</span>
            </div>
            <button
              class="toggle"
              class:active={autoScroll}
              title="Toggle auto-scroll"
              onclick={toggleAutoScroll}
            >
              <span class="toggle-knob"></span>
            </button>
          </div>
        </div>

        <!-- ── Permissions ── -->
        <div class="section">
          <div class="section-title">permissions</div>

          <div class="row">
            <div class="label-group">
              <span class="label">default mode</span>
              <span class="desc">{PERMISSION_LABELS[permissionMode]} — default for new tabs</span>
            </div>
            <button class="pill" onclick={cyclePermissionMode}>{PERMISSION_LABELS[permissionMode]}</button>
          </div>
        </div>

        <!-- ── MCP Servers ── -->
        <div class="section">
          <div class="section-title">mcp servers</div>

          {#if mcpLoading}
            <div class="mcp-empty">loading…</div>
          {:else if mcpServers.length === 0 && !mcpAddOpen}
            <div class="mcp-empty">no servers configured</div>
          {:else}
            {#each mcpServers as server}
              <div class="mcp-row">
                <div class="mcp-info">
                  <span class="mcp-name">{server.name}</span>
                  <span class="mcp-cmd">{server.command} {server.args.join(" ")}</span>
                </div>
                <button
                  class="mcp-remove"
                  onclick={() => removeMcpServer(server.name)}
                  title="Remove {server.name}"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10">
                    <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" stroke-width="1.2" />
                    <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" stroke-width="1.2" />
                  </svg>
                </button>
              </div>
            {/each}
          {/if}

          {#if mcpAddOpen}
            <div class="mcp-add-form">
              <input class="mcp-input" placeholder="name" bind:value={mcpNewName} />
              <input class="mcp-input" placeholder="command (e.g. npx)" bind:value={mcpNewCommand} />
              <input class="mcp-input" placeholder="args (space separated)" bind:value={mcpNewArgs} />
              <div class="mcp-add-actions">
                <button class="pill" onclick={addMcpServer}>add</button>
                <button class="pill" onclick={() => (mcpAddOpen = false)}>cancel</button>
              </div>
            </div>
          {:else}
            <div class="row" style="justify-content: flex-end; padding-top: 4px;">
              <button class="pill" onclick={() => (mcpAddOpen = true)}>+ add server</button>
            </div>
          {/if}
        </div>

        <!-- ── Hooks ── -->
        <div class="section">
          <div class="section-title">hooks</div>

          {#if hooksLoading}
            <div class="mcp-empty">loading…</div>
          {:else if hookEntries.length === 0 && !hookAddOpen}
            <div class="mcp-empty">no hooks configured</div>
          {:else}
            {#each hookEntries as { event, rule, idx }}
              <div class="hook-row">
                <div class="hook-info">
                  <div class="hook-header">
                    <span class="hook-event">{event}</span>
                    {#if rule.matcher !== ".*"}
                      <span class="hook-matcher">{rule.matcher}</span>
                    {/if}
                  </div>
                  {#each rule.hooks as action}
                    <span class="hook-cmd">{action.command}</span>
                  {/each}
                </div>
                <button
                  class="mcp-remove"
                  onclick={() => removeHook(event, idx)}
                  title="Remove hook"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10">
                    <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" stroke-width="1.2" />
                    <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" stroke-width="1.2" />
                  </svg>
                </button>
              </div>
            {/each}
          {/if}

          {#if hookAddOpen}
            <div class="mcp-add-form">
              <select class="hook-select" bind:value={hookNewEvent}>
                {#each HOOK_EVENTS as ev}
                  <option value={ev}>{HOOK_EVENT_LABELS[ev]}</option>
                {/each}
              </select>
              <input class="mcp-input" placeholder="matcher (regex, e.g. Edit|Write)" bind:value={hookNewMatcher} />
              <input class="mcp-input" placeholder="shell command" bind:value={hookNewCommand} />
              <div class="mcp-add-actions">
                <button class="pill" onclick={addHook}>add</button>
                <button class="pill" onclick={() => (hookAddOpen = false)}>cancel</button>
              </div>
            </div>
          {:else}
            <div class="row" style="justify-content: flex-end; padding-top: 4px;">
              <button class="pill" onclick={() => (hookAddOpen = true)}>+ add hook</button>
            </div>
          {/if}
        </div>

        <!-- ── Advanced ── -->
        <div class="section">
          <div class="section-title">advanced</div>

          <div class="row-col">
            <div class="label-group">
              <span class="label">system prompt</span>
              <span class="desc">appended to default system prompt</span>
            </div>
            <textarea
              class="sys-prompt"
              placeholder="e.g. Always respond in German..."
              bind:value={systemPrompt}
              onblur={() => save("systemPrompt", systemPrompt)}
            ></textarea>
          </div>
        </div>

        <!-- ── Storage ── -->
        <div class="section">
          <div class="section-title">storage</div>

          <div class="row">
            <div class="label-group">
              <span class="label">clipboard retention</span>
              <span class="desc">delete pasted images after {clipboardRetention}d</span>
            </div>
            <div class="stepper">
              <button class="step-btn" onclick={() => setClipboardRetention(clipboardRetention - 1)} title="Decrease">-</button>
              <span class="step-value">{clipboardRetention}</span>
              <button class="step-btn" onclick={() => setClipboardRetention(clipboardRetention + 1)} title="Increase">+</button>
            </div>
          </div>

          <div class="row">
            <div class="label-group">
              <span class="label">clean up now</span>
              <span class="desc">{lastCleanupResult || "remove old clipboard images"}</span>
            </div>
            <button class="pill" onclick={runCleanupNow}>clean</button>
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: flex-start;
    justify-content: flex-end;
    padding: 48px 16px;
    background: rgba(0, 0, 0, 0);
    animation: overlayIn 0.25s var(--ease-out-expo) forwards;
  }

  .overlay.closing {
    animation: overlayOut 0.2s var(--ease-in-out) forwards;
  }

  @keyframes overlayIn {
    from { background: rgba(0, 0, 0, 0); }
    to { background: rgba(0, 0, 0, 0.15); }
  }

  @keyframes overlayOut {
    from { background: rgba(0, 0, 0, 0.15); }
    to { background: rgba(0, 0, 0, 0); }
  }

  .panel {
    --panel-bg: rgba(255, 255, 255, 0.06);
    --panel-header-bg: rgba(255, 255, 255, 0.08);
    --panel-border: rgba(255, 255, 255, 0.1);
    --panel-divider: rgba(255, 255, 255, 0.06);
    --panel-hover: rgba(255, 255, 255, 0.06);
    --panel-control-bg: rgba(255, 255, 255, 0.04);
    --panel-control-active: rgba(255, 255, 255, 0.12);
    --panel-control-active-border: rgba(255, 255, 255, 0.18);
    --panel-shadow: 0 8px 40px rgba(0, 0, 0, 0.4);
    --panel-inset: inset 0 1px 0 rgba(255, 255, 255, 0.06);

    width: 300px;
    max-height: calc(100vh - 96px);
    overflow-y: auto;
    background: var(--panel-bg);
    backdrop-filter: blur(48px) saturate(1.4);
    -webkit-backdrop-filter: blur(48px) saturate(1.4);
    border: 1px solid var(--panel-border);
    border-radius: var(--radius-md);
    box-shadow: var(--panel-shadow), var(--panel-inset);
    animation: panelIn 0.3s var(--ease-out-expo) forwards;
    transform-origin: top right;
  }

  :global([data-theme="light"]) .panel {
    --panel-bg: rgba(255, 255, 255, 0.45);
    --panel-header-bg: rgba(255, 255, 255, 0.5);
    --panel-border: rgba(0, 0, 0, 0.1);
    --panel-divider: rgba(0, 0, 0, 0.06);
    --panel-hover: rgba(0, 0, 0, 0.04);
    --panel-control-bg: rgba(0, 0, 0, 0.04);
    --panel-control-active: rgba(0, 0, 0, 0.1);
    --panel-control-active-border: rgba(0, 0, 0, 0.18);
    --panel-shadow: 0 8px 40px rgba(0, 0, 0, 0.1);
    --panel-inset: inset 0 1px 0 rgba(255, 255, 255, 0.5);
  }

  .panel.closing {
    animation: panelOut 0.2s var(--ease-in-out) forwards;
  }

  @keyframes panelIn {
    from {
      opacity: 0;
      transform: translateY(-12px) scale(0.92);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes panelOut {
    from {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
    to {
      opacity: 0;
      transform: translateY(-8px) scale(0.95);
    }
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--panel-divider);
    position: sticky;
    top: 0;
    background: var(--panel-header-bg);
    backdrop-filter: blur(48px);
    -webkit-backdrop-filter: blur(48px);
    z-index: 1;
  }

  .panel-title {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--text-tertiary);
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border: none;
    background: none;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.2s var(--ease-out-quart);
  }
  .close-btn:hover {
    color: var(--text-secondary);
    background: var(--panel-hover);
    transform: rotate(90deg);
  }

  .sections {
    padding: 4px 0;
  }

  .section {
    padding: 8px 16px;
  }

  .section-title {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--text-tertiary);
    opacity: 0.6;
    margin-bottom: 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 0;
  }

  .row-col {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 0;
  }

  .label-group {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .label {
    font-size: 12.5px;
    color: var(--text-secondary);
    font-weight: 450;
  }

  .desc {
    font-size: 10.5px;
    color: var(--text-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .toggle {
    width: 36px;
    height: 20px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--panel-control-bg);
    cursor: pointer;
    position: relative;
    transition: all 0.3s var(--ease-out-expo);
    flex-shrink: 0;
    padding: 0;
  }

  .toggle.active {
    background: var(--panel-control-active);
    border-color: var(--panel-control-active-border);
  }

  .toggle-knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--text-tertiary);
    transition: all 0.3s var(--ease-spring);
  }

  .toggle.active .toggle-knob {
    left: 19px;
    background: var(--text);
  }

  .pill {
    padding: 3px 10px;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 450;
    color: var(--text-secondary);
    background: var(--panel-control-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }
  .pill:hover {
    color: var(--text);
    background: var(--panel-hover);
    border-color: var(--border-focus);
  }

  .stepper {
    display: flex;
    align-items: center;
    gap: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .step-btn {
    width: 24px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 500;
    color: var(--text-tertiary);
    background: var(--panel-control-bg);
    border: none;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .step-btn:hover {
    color: var(--text);
    background: var(--panel-hover);
  }

  .step-value {
    width: 28px;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-secondary);
    border-left: 1px solid var(--border-subtle);
    border-right: 1px solid var(--border-subtle);
    line-height: 22px;
  }

  .mcp-empty {
    font-size: 11px;
    color: var(--text-tertiary);
    opacity: 0.5;
    font-style: italic;
    padding: 4px 0;
  }

  .mcp-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 0;
  }

  .mcp-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .mcp-name {
    font-family: var(--font-mono);
    font-size: 11.5px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .mcp-cmd {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-tertiary);
    opacity: 0.6;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mcp-remove {
    width: 20px;
    height: 20px;
    border: none;
    background: none;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }

  .mcp-row:hover .mcp-remove {
    opacity: 0.5;
  }

  .mcp-remove:hover {
    opacity: 1 !important;
    color: #f87171;
    background: rgba(248, 113, 113, 0.1);
  }

  .mcp-add-form {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 0;
  }

  .mcp-input {
    width: 100%;
    padding: 5px 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-secondary);
    background: var(--bg-input);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    outline: none;
    transition: border-color 0.2s ease;
  }

  .mcp-input:focus {
    border-color: var(--border-focus);
    color: var(--text);
  }

  .mcp-input::placeholder {
    color: var(--text-tertiary);
  }

  .mcp-add-actions {
    display: flex;
    gap: 4px;
    justify-content: flex-end;
    padding-top: 2px;
  }

  .hook-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 5px 0;
  }

  .hook-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .hook-header {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .hook-event {
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 500;
    color: var(--text-secondary);
    padding: 1px 5px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 3px;
  }

  .hook-matcher {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-tertiary);
    opacity: 0.7;
  }

  .hook-cmd {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-tertiary);
    opacity: 0.6;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hook-select {
    width: 100%;
    padding: 5px 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-secondary);
    background: var(--bg-input);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    outline: none;
    cursor: pointer;
    transition: border-color 0.2s ease;
    appearance: none;
  }

  .hook-select:focus {
    border-color: var(--border-focus);
    color: var(--text);
  }

  .sys-prompt {
    width: 100%;
    min-height: 48px;
    max-height: 120px;
    resize: none;
    padding: 8px 10px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-secondary);
    background: var(--bg-input);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    outline: none;
    transition: border-color 0.2s ease;
  }
  .sys-prompt:focus {
    border-color: var(--border-focus);
    color: var(--text);
  }
  .sys-prompt::placeholder {
    color: var(--text-tertiary);
  }
</style>
