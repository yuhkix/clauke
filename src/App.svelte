<script lang="ts">
  import { listen } from "@tauri-apps/api/event";
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { open } from "@tauri-apps/plugin-dialog";
  import { onMount } from "svelte";

  const appWindow = getCurrentWindow();
  import ChatView from "./lib/components/ChatView.svelte";
  import InputBar from "./lib/components/InputBar.svelte";
  import TabBar from "./lib/components/TabBar.svelte";
  import SettingsPanel from "./lib/components/SettingsPanel.svelte";
  import AgentPanel from "./lib/components/AgentPanel.svelte";
  import SessionManager from "./lib/components/SessionManager.svelte";
  import TodoPanel from "./lib/components/TodoPanel.svelte";
  import ContextIndicator from "./lib/components/ContextIndicator.svelte";
  import FileTree from "./lib/components/FileTree.svelte";
  import ShortcutHelp from "./lib/components/ShortcutHelp.svelte";
  import type { ChatMessage, ClaudeEvent, Tab, SlashCommand, ToolCall, SessionRecord, TokenUsage, PermissionMode, TodoItem } from "./lib/types";
  import { BUILTIN_COMMANDS, MAX_SESSION_HISTORY, emptyUsage, addUsage, formatTokens, PERMISSION_TOOL_SETS, extractTodos, extractFileStats, buildFileTree } from "./lib/types";
  import { processClaudeEvent } from "./lib/claude";

  let settingsOpen = $state(false);
  let agentPanelOpen = $state(false);
  let sessionManagerOpen = $state(false);
  let fileTreeOpen = $state(false);
  let shortcutHelpOpen = $state(false);
  let allCommands = $state<SlashCommand[]>(BUILTIN_COMMANDS);
  let autoScrollEnabled = $state(
    localStorage.getItem("clauke:autoScroll") !== "false",
  );

  function handleSettingsChange(settings: Record<string, string>) {
    autoScrollEnabled = settings.autoScroll !== "false";
  }

  /** Load custom slash commands from ~/.claude/commands/, plugins, etc. */
  async function loadSlashCommands(cwd?: string) {
    try {
      const discovered: Array<{
        name: string;
        description: string;
        kind: string;
        source: string;
      }> = await invoke("list_slash_commands", { cwd: cwd || null });

      // Merge: built-in first, then custom (skip duplicates)
      const seen = new Set(BUILTIN_COMMANDS.map((c) => c.name));
      const custom: SlashCommand[] = discovered
        .filter((c) => !seen.has(c.name))
        .map((c) => ({
          name: c.name,
          description: c.description,
          kind: c.kind as SlashCommand["kind"],
          source: c.source,
        }));
      allCommands = [...BUILTIN_COMMANDS, ...custom];
    } catch {
      // Silently fall back to built-in commands
      allCommands = BUILTIN_COMMANDS;
    }
  }
  let tabCounter = 0;

  function createTab(): Tab {
    tabCounter++;
    return {
      id: `tab-${tabCounter}-${Date.now()}`,
      name: "neuer tab",
      messages: [],
      isRunning: false,
      cwd: localStorage.getItem("clauke:defaultCwd") || "",
      model: (localStorage.getItem("clauke:defaultModel") as import("./lib/types").ClaudeModel) || "opus",
      effort: (localStorage.getItem("clauke:defaultEffort") as import("./lib/types").EffortLevel) || "max",
      permissionMode: (localStorage.getItem("clauke:permissionMode") as PermissionMode) || "bypass",
    };
  }

  /** Restore tabs from localStorage, or create a fresh tab */
  function restoreTabs(): { tabs: Tab[]; activeId: string } {
    try {
      const raw = localStorage.getItem("clauke:session");
      if (!raw) throw new Error("no session");
      const data = JSON.parse(raw);
      if (!Array.isArray(data.tabs) || data.tabs.length === 0) throw new Error("empty");
      const restored: Tab[] = data.tabs.map((t: any) => {
        // Bump counter so new tabs get higher numbers
        const num = parseInt(t.id?.split("-")[1] || "0", 10);
        if (num > tabCounter) tabCounter = num;
        return {
          id: t.id,
          name: t.name || "tab",
          messages: Array.isArray(t.messages) ? t.messages : [],
          isRunning: false,
          cwd: t.cwd || "",
          model: t.model || "opus",
          effort: t.effort || "max",
          sessionId: t.sessionId,
          permissionMode: t.permissionMode || "bypass",
          contextTokens: t.contextTokens || undefined,
        } as Tab;
      });
      const activeId = data.activeTabId && restored.some((t: Tab) => t.id === data.activeTabId)
        ? data.activeTabId
        : restored[0].id;
      return { tabs: restored, activeId };
    } catch {
      const first = createTab();
      return { tabs: [first], activeId: first.id };
    }
  }

  /** Save current tabs to localStorage (debounced via caller) */
  function persistSession() {
    try {
      // Truncate large tool results to keep storage manageable
      const serializable = tabs.map((t) => ({
        id: t.id,
        name: t.name,
        cwd: t.cwd,
        model: t.model,
        effort: t.effort,
        permissionMode: t.permissionMode,
        sessionId: t.sessionId,
        contextTokens: t.contextTokens,
        messages: t.messages.map((m) => ({
          ...m,
          content: m.content.map((b) => {
            if (b.type === "tool_call" && b.toolCall.result && b.toolCall.result.length > 800) {
              return { ...b, toolCall: { ...b.toolCall, result: b.toolCall.result.slice(0, 800) + "\n…(truncated)" } };
            }
            return b;
          }),
        })),
      }));
      localStorage.setItem("clauke:session", JSON.stringify({ tabs: serializable, activeTabId }));
    } catch {
      // Quota exceeded — silently skip
    }
  }

  // ── Session History (archived sessions) ──

  function loadSessionHistory(): SessionRecord[] {
    try {
      const raw = localStorage.getItem("clauke:sessionHistory");
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  function saveSessionHistory() {
    try {
      localStorage.setItem("clauke:sessionHistory", JSON.stringify(sessionHistory));
    } catch {
      // Quota exceeded
    }
  }

  /** Archive a tab to session history (only if it has a sessionId and messages) */
  function archiveTab(tab: Tab) {
    if (!tab.sessionId || tab.messages.length === 0) return;

    // Don't duplicate — update if already archived
    const existingIdx = sessionHistory.findIndex((s) => s.sessionId === tab.sessionId);

    const firstUserMsg = tab.messages.find((m) => m.role === "user");
    const preview = firstUserMsg
      ? firstUserMsg.content
          .filter((b) => b.type === "text")
          .map((b) => (b as { type: "text"; text: string }).text)
          .join(" ")
          .slice(0, 120)
      : "";

    // Truncate tool results for storage
    const storedMessages = tab.messages.map((m) => ({
      ...m,
      content: m.content.map((b) => {
        if (b.type === "tool_call" && b.toolCall.result && b.toolCall.result.length > 800) {
          return { ...b, toolCall: { ...b.toolCall, result: b.toolCall.result.slice(0, 800) + "\n…(truncated)" } };
        }
        return b;
      }),
    }));

    const record: SessionRecord = {
      id: existingIdx >= 0 ? sessionHistory[existingIdx].id : `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId: tab.sessionId,
      name: tab.name,
      cwd: tab.cwd,
      model: tab.model,
      effort: tab.effort,
      createdAt: existingIdx >= 0 ? sessionHistory[existingIdx].createdAt : (tab.messages[0]?.timestamp || Date.now()),
      lastActiveAt: Date.now(),
      messageCount: tab.messages.length,
      preview,
      messages: storedMessages,
    };

    if (existingIdx >= 0) {
      sessionHistory[existingIdx] = record;
    } else {
      sessionHistory.unshift(record);
    }

    // Cap history
    if (sessionHistory.length > MAX_SESSION_HISTORY) {
      sessionHistory = sessionHistory.slice(0, MAX_SESSION_HISTORY);
    }

    saveSessionHistory();
  }

  function deleteArchivedSession(id: string) {
    sessionHistory = sessionHistory.filter((s) => s.id !== id);
    saveSessionHistory();
  }

  function restoreSession(session: SessionRecord) {
    tabCounter++;
    const newTab: Tab = {
      id: `tab-${tabCounter}-${Date.now()}`,
      name: session.name,
      messages: session.messages,
      isRunning: false,
      cwd: session.cwd,
      model: session.model,
      effort: session.effort,
      sessionId: session.sessionId,
      permissionMode: (localStorage.getItem("clauke:permissionMode") as PermissionMode) || "bypass",
    };
    tabs = [...tabs, newTab];
    activeTabId = newTab.id;
    sessionManagerOpen = false;
  }

  let sessionHistory = $state<SessionRecord[]>(loadSessionHistory());

  const initial = restoreTabs();
  let tabs = $state<Tab[]>(initial.tabs);
  let activeTabId = $state(initial.activeId);

  let activeTab = $derived(tabs.find((t) => t.id === activeTabId)!);

  /** Extract todos from active tab's messages */
  let activeTodos = $derived(extractTodos(activeTab?.messages ?? []));

  /** Build file tree from active tab's tool calls */
  let activeFileTree = $derived.by(() => {
    const stats = extractFileStats(activeTab?.messages ?? []);
    return buildFileTree(stats, activeTab?.cwd || "");
  });

  /** Extract all Agent tool calls from the active tab's messages (newest first) */
  let activeAgents = $derived.by(() => {
    const msgs = activeTab?.messages ?? [];
    const agents: ToolCall[] = [];
    for (const msg of msgs) {
      if (msg.role !== "assistant") continue;
      for (const block of msg.content) {
        if (block.type === "tool_call" && block.toolCall.name === "Agent") {
          agents.push(block.toolCall);
        }
      }
    }
    return agents.reverse();
  });

  function findTab(tabId: string): Tab | undefined {
    return tabs.find((t) => t.id === tabId);
  }

  // Auto-save session whenever tabs change (debounced)
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    // Read reactive state to track changes
    const _track = JSON.stringify(tabs.map(t => ({ id: t.id, name: t.name, msgCount: t.messages.length, sessionId: t.sessionId })));
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistSession, 500);
    return () => clearTimeout(saveTimer);
  });

  onMount(() => {
    // Load custom commands on startup
    loadSlashCommands(activeTab.cwd || undefined);

    const unlistenEvent = listen<ClaudeEvent>("claude-event", (e) => {
      const tabId = e.payload.tab_id;
      if (!tabId) return;
      const tab = findTab(tabId);
      if (!tab) return;
      const result = processClaudeEvent(e.payload, tab.messages, tabId as string);
      // Capture session_id for conversation continuation
      if (result.sessionId) {
        tab.sessionId = result.sessionId;
      }
      // Accumulate token usage
      if (result.usage) {
        tab.usage = addUsage(tab.usage || emptyUsage(), result.usage);
      }
      // Explicit compact event from CLI — keep the current contextTokens
      // (the next result event will update it with actual post-compaction size).
      // Track context window fill (input + cache = actual context size)
      if (result.usage) {
        const ctx = result.usage.inputTokens + result.usage.cacheReadTokens + result.usage.cacheCreationTokens;
        if (ctx > 0) {
          // Heuristic compaction detection: context dropped by >30%
          // Skip if the CLI already told us about it (compacted flag).
          if (tab.contextTokens && ctx < tab.contextTokens * 0.7 && !result.compacted) {
            tab.messages.push({
              id: `sys-compact-${Date.now()}`,
              role: "system",
              content: [{ type: "text", text: "context compacted" }],
              timestamp: Date.now(),
            });
          }
          tab.contextTokens = ctx;
        }
      }
      // Trigger reactivity
      tabs = [...tabs];
    });

    const unlistenDone = listen<string>("claude-done", (e) => {
      const tabId = e.payload;
      const tab = findTab(tabId);
      if (tab) {
        tab.isRunning = false;
        tabs = [...tabs];
      }
    });

    return () => {
      unlistenEvent.then((fn) => fn());
      unlistenDone.then((fn) => fn());
    };
  });

  async function handleSend(prompt: string, images: string[] = []) {
    const tab = activeTab;
    if ((!prompt.trim() && images.length === 0) || tab.isRunning) return;

    const content: import("./lib/types").ContentBlock[] = [];
    for (const img of images) {
      content.push({ type: "image", path: img });
    }
    if (prompt.trim()) {
      content.push({ type: "text", text: prompt });
    }

    tab.messages = [
      ...tab.messages,
      {
        id: `user-${Date.now()}`,
        role: "user",
        content,
        timestamp: Date.now(),
      },
    ];
    tab.isRunning = true;

    // Name tab after first prompt — set a quick label, then auto-title in background
    if (tab.messages.filter((m) => m.role === "user").length === 1) {
      const label = prompt || `image${images.length > 1 ? "s" : ""}`;
      tab.name = label.length > 24 ? label.slice(0, 24) + "\u2026" : label;

      // Fire-and-forget: generate a better title with haiku
      if (prompt) {
        const tabId = tab.id;
        invoke<string>("generate_title", { prompt: prompt.slice(0, 200) })
          .then((title) => {
            const t = findTab(tabId);
            if (t) {
              t.name = title;
              tabs = [...tabs];
            }
          })
          .catch(() => {}); // Silently keep the manual label
      }
    }

    tabs = [...tabs];

    try {
      const mode = tab.permissionMode;
      const skipPerms = mode === "bypass";
      let allowedTools: string[] | null = null;
      if (!skipPerms && mode in PERMISSION_TOOL_SETS) {
        allowedTools = PERMISSION_TOOL_SETS[mode];
      }
      // For plan mode: prepend a plan-first instruction to the system prompt
      let sysPrompt = localStorage.getItem("clauke:systemPrompt") || "";
      if (mode === "plan") {
        const planPrefix = "You are in PLAN MODE. Before making any file changes, first analyze the codebase and create a detailed step-by-step plan. Present the plan clearly and wait for the user to approve it before proceeding with implementation. Only use read-only tools (Read, Glob, Grep, WebFetch, WebSearch) until the user explicitly approves your plan.";
        sysPrompt = sysPrompt ? `${planPrefix}\n\n${sysPrompt}` : planPrefix;
      }
      await invoke("send_prompt", {
        request: {
          prompt: prompt || "Describe the attached image(s).",
          cwd: tab.cwd || null,
          tab_id: tab.id,
          model: tab.model,
          effort: tab.effort,
          session_id: tab.sessionId || null,
          images: images.length > 0 ? images : null,
          skip_permissions: skipPerms,
          allowed_tools: allowedTools,
          system_prompt: sysPrompt || null,
        },
      });
    } catch (err) {
      tab.isRunning = false;
      tab.messages = [
        ...tab.messages,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          content: [{ type: "text", text: `**Error:** ${err}` }],
          timestamp: Date.now(),
        },
      ];
      tabs = [...tabs];
    }
  }

  async function handleSteer(message: string) {
    const tab = activeTab;
    if (!tab.isRunning || !message.trim()) return;

    // Add as user message in chat
    tab.messages = [
      ...tab.messages,
      {
        id: `steer-${Date.now()}`,
        role: "user",
        content: [{ type: "text", text: message }],
        timestamp: Date.now(),
      },
    ];
    tabs = [...tabs];

    try {
      await invoke("steer_claude", { tabId: tab.id, message });
    } catch (err) {
      console.warn("Steering failed:", err);
    }
  }

  async function handleStop() {
    const tab = activeTab;
    try {
      await invoke("stop_claude", { tabId: tab.id });
    } catch {
      // ignore — claude-done event will reset isRunning
    }
  }

  function handleClear() {
    const tab = activeTab;
    if (!tab.isRunning) {
      tab.messages = [];
      tab.sessionId = undefined;
      tabs = [...tabs];
      persistSession();
    }
  }

  function handleCommand(cmd: SlashCommand) {
    if (cmd.kind === "local") {
      if (cmd.name === "/clear") handleClear();
    } else {
      // Both "cli" and "custom" commands are sent as prompts — Claude handles them
      handleSend(cmd.name);
    }
  }

  function handleNewTab() {
    const newTab = createTab();
    tabs = [...tabs, newTab];
    activeTabId = newTab.id;
  }

  function handleCloseTab(id: string) {
    const tab = findTab(id);
    if (tab?.isRunning) {
      invoke("stop_claude", { tabId: id }).catch(() => {});
    }
    // Archive the tab before closing
    if (tab) archiveTab(tab);
    const idx = tabs.findIndex((t) => t.id === id);
    if (tabs.length <= 1) return;
    tabs = tabs.filter((t) => t.id !== id);
    if (activeTabId === id) {
      activeTabId = tabs[Math.min(idx, tabs.length - 1)].id;
    }
  }

  function handleSelectTab(id: string) {
    activeTabId = id;
  }

  async function browseFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      activeTab.cwd = selected as string;
      tabs = [...tabs];
      // Reload commands — project might have its own .claude/commands/
      loadSlashCommands(activeTab.cwd);
    }
  }

  // ── Keyboard shortcuts ──
  function handleGlobalKeydown(e: KeyboardEvent) {
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;

    switch (e.key) {
      case "t":
        e.preventDefault();
        handleNewTab();
        break;
      case "w":
        e.preventDefault();
        handleCloseTab(activeTabId);
        break;
      case "l":
        e.preventDefault();
        handleClear();
        break;
      case "b":
        e.preventDefault();
        fileTreeOpen = !fileTreeOpen;
        break;
      case "/":
        e.preventDefault();
        shortcutHelpOpen = !shortcutHelpOpen;
        break;
      case "1": case "2": case "3": case "4":
      case "5": case "6": case "7": case "8": case "9": {
        const idx = parseInt(e.key) - 1;
        if (idx < tabs.length) {
          e.preventDefault();
          activeTabId = tabs[idx].id;
        }
        break;
      }
    }
  }

  // ── Conversation forking ──
  function handleFork(messageId: string) {
    const tab = activeTab;
    const msgIdx = tab.messages.findIndex((m) => m.id === messageId);
    if (msgIdx < 0) return;

    // Deep-clone messages so mutations in the original tab don't affect the fork
    const forkedMessages = tab.messages.slice(0, msgIdx + 1).map((m) => ({
      ...m,
      content: m.content.map((block) => {
        if (block.type === "tool_call") {
          return {
            type: "tool_call" as const,
            toolCall: {
              ...block.toolCall,
              input: { ...block.toolCall.input },
              children: block.toolCall.children?.map((c) => ({ ...c, input: { ...c.input } })),
            },
          };
        }
        return { ...block };
      }),
    }));

    tabCounter++;
    const newTab: Tab = {
      id: `tab-${tabCounter}-${Date.now()}`,
      name: `${tab.name} (fork)`,
      messages: forkedMessages,
      isRunning: false,
      cwd: tab.cwd,
      model: tab.model,
      effort: tab.effort,
      permissionMode: tab.permissionMode,
      // No sessionId — this is a fresh fork, can't resume the old session
    };
    tabs = [...tabs, newTab];
    activeTabId = newTab.id;
  }

  // ── Copy full assistant message ──
  function handleCopyMessage(messageId: string) {
    const tab = activeTab;
    const msg = tab.messages.find((m) => m.id === messageId);
    if (!msg) return;
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join("\n\n");
    navigator.clipboard.writeText(text).catch(() => {});
  }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<div class="app">
  <header class="titlebar" data-tauri-drag-region>
    <span class="logo">clauke</span>
    <div class="titlebar-center">
      <div class="cwd-wrap">
        <input
          class="cwd-input"
          type="text"
          placeholder="working directory"
          bind:value={activeTab.cwd}
        />
        <button class="btn-browse" onclick={browseFolder} title="Browse folder">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      </div>
    </div>
    <button
      class="btn-history"
      onclick={() => (sessionManagerOpen = !sessionManagerOpen)}
      title="Session history"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    </button>
    <button
      class="btn-clear"
      onclick={handleClear}
      disabled={activeTab.isRunning}
    >
      Clear
    </button>
    <button
      class="btn-settings"
      onclick={() => (settingsOpen = !settingsOpen)}
      title="Settings"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </button>
    <div class="window-controls">
      <button class="wc-btn" onclick={() => appWindow.minimize()} title="Minimize">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
      <button class="wc-btn" onclick={() => appWindow.toggleMaximize()} title="Maximize">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <rect x="1.5" y="1.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
      <button class="wc-btn wc-close" onclick={() => appWindow.close()} title="Close">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" stroke-width="1.2" />
          <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
    </div>
  </header>

  <TabBar
    {tabs}
    {activeTabId}
    onSelect={handleSelectTab}
    onClose={handleCloseTab}
    onNew={handleNewTab}
  />

  <div class="main-row">
    <FileTree
      tree={activeFileTree}
      open={fileTreeOpen}
      onToggle={() => (fileTreeOpen = !fileTreeOpen)}
    />
    <main class="chat-area">
      {#key activeTabId}
        <ChatView messages={activeTab.messages} isRunning={activeTab.isRunning} {autoScrollEnabled} onFork={handleFork} onCopy={handleCopyMessage} />
      {/key}
    </main>
    <AgentPanel
      agents={activeAgents}
      open={agentPanelOpen}
      onToggle={() => (agentPanelOpen = !agentPanelOpen)}
    />
  </div>

  <footer class="input-area">
    <TodoPanel todos={activeTodos} />
    <InputBar
      onSend={handleSend}
      onSteer={handleSteer}
      onStop={handleStop}
      onCommand={handleCommand}
      isRunning={activeTab.isRunning}
      commands={allCommands}
      bind:model={activeTab.model}
      bind:effort={activeTab.effort}
      bind:permissionMode={activeTab.permissionMode}
    />
    {#if activeTab.contextTokens && activeTab.contextTokens > 0}
      <ContextIndicator tokens={activeTab.contextTokens} model={activeTab.model} />
    {/if}
    {#if activeTab.usage && (activeTab.usage.inputTokens > 0 || activeTab.usage.outputTokens > 0)}
      <div class="token-bar">
        <span class="token-stat" title="Input tokens">
          <span class="token-label">in</span>
          <span class="token-value">{formatTokens(activeTab.usage.inputTokens)}</span>
        </span>
        <span class="token-stat" title="Output tokens">
          <span class="token-label">out</span>
          <span class="token-value">{formatTokens(activeTab.usage.outputTokens)}</span>
        </span>
        {#if activeTab.usage.cacheReadTokens > 0}
          <span class="token-stat" title="Cache read tokens">
            <span class="token-label">cache</span>
            <span class="token-value">{formatTokens(activeTab.usage.cacheReadTokens)}</span>
          </span>
        {/if}
        <span class="token-stat total" title="Total tokens">
          <span class="token-label">&Sigma;</span>
          <span class="token-value">{formatTokens(activeTab.usage.inputTokens + activeTab.usage.outputTokens)}</span>
        </span>
      </div>
    {/if}
  </footer>

  <ShortcutHelp open={shortcutHelpOpen} onClose={() => (shortcutHelpOpen = false)} />
  <SettingsPanel open={settingsOpen} onClose={() => (settingsOpen = false)} onSettingsChange={handleSettingsChange} />
  <SessionManager
    open={sessionManagerOpen}
    sessions={sessionHistory}
    onClose={() => (sessionManagerOpen = false)}
    onRestore={restoreSession}
    onDelete={deleteArchivedSession}
  />
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .titlebar {
    display: flex;
    align-items: center;
    padding: 10px 20px;
    gap: 16px;
    background: var(--bg-glass);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
    border-bottom: 1px solid var(--border-subtle);
    user-select: none;
    -webkit-app-region: drag;
  }

  .logo {
    font-family: var(--font-mono);
    font-size: 14px;
    font-weight: 500;
    letter-spacing: 0.5px;
    color: var(--text-secondary);
    -webkit-app-region: no-drag;
    flex-shrink: 0;
  }

  .titlebar-center {
    flex: 1;
    max-width: 400px;
    -webkit-app-region: no-drag;
  }

  .cwd-wrap {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .cwd-input {
    flex: 1;
    min-width: 0;
    padding: 5px 12px;
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--text-secondary);
    background: var(--bg-input);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    outline: none;
    transition: all 0.2s ease;
  }
  .cwd-input:focus {
    border-color: var(--border-focus);
    color: var(--text);
    background: var(--bg-input-focus);
  }
  .cwd-input::placeholder {
    color: var(--text-tertiary);
  }

  .btn-browse {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-subtle);
    background: var(--bg-input);
    color: var(--text-tertiary);
    cursor: pointer;
    flex-shrink: 0;
    transition: all 0.15s ease;
  }
  .btn-browse:hover {
    color: var(--text-secondary);
    border-color: var(--border);
    background: var(--bg-glass-hover);
  }

  .btn-history {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    background: none;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: all 0.2s ease;
    -webkit-app-region: no-drag;
    flex-shrink: 0;
  }
  .btn-history:hover {
    color: var(--text-secondary);
    background: rgba(255, 255, 255, 0.04);
  }

  .btn-clear {
    padding: 4px 14px;
    font-size: 11.5px;
    font-weight: 450;
    color: var(--text-tertiary);
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all 0.2s ease;
    -webkit-app-region: no-drag;
  }
  .btn-clear:hover:not(:disabled) {
    color: var(--text-secondary);
    border-color: var(--border);
    background: var(--bg-surface);
  }
  .btn-clear:disabled {
    opacity: 0.2;
    cursor: default;
  }

  .main-row {
    flex: 1;
    display: flex;
    overflow: hidden;
    position: relative;
    min-height: 0;
  }

  .chat-area {
    flex: 1;
    overflow: hidden;
    min-width: 0;
  }

  .input-area {
    background: none;
  }

  .token-bar {
    display: flex;
    justify-content: center;
    gap: 12px;
    padding: 2px 16px 6px;
    font-family: var(--font-mono);
    animation: fadeIn 0.3s var(--ease-out-expo);
  }

  .token-stat {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
  }

  .token-label {
    color: var(--text-tertiary);
    opacity: 0.6;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .token-value {
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
  }

  .token-stat.total .token-value {
    color: var(--text-secondary);
    opacity: 0.7;
  }

  .btn-settings {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    background: none;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: all 0.25s var(--ease-out-expo);
    -webkit-app-region: no-drag;
    flex-shrink: 0;
  }
  .btn-settings:hover {
    color: var(--text-secondary);
    background: rgba(255, 255, 255, 0.04);
    transform: rotate(45deg);
  }

  .window-controls {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: auto;
    flex-shrink: 0;
    -webkit-app-region: no-drag;
  }

  .wc-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 24px;
    border: none;
    background: none;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.2s var(--ease-out-quart);
  }
  .wc-btn:hover {
    color: var(--text-secondary);
    background: rgba(255, 255, 255, 0.06);
  }
  .wc-close:hover {
    color: #fff;
    background: rgba(220, 60, 60, 0.8);
  }
</style>
