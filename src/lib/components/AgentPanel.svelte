<script lang="ts">
  import type { ToolCall } from "../types";
  import { getToolIcon } from "../types";

  let {
    agents,
    open,
    onToggle,
  }: {
    agents: ToolCall[];
    open: boolean;
    onToggle: () => void;
  } = $props();

  let expandedId = $state<string | null>(null);

  // Live clock for elapsed timers — ticks every 100ms
  let now = $state(Date.now());
  $effect(() => {
    const interval = setInterval(() => (now = Date.now()), 100);
    return () => clearInterval(interval);
  });

  function toggleExpand(id: string) {
    expandedId = expandedId === id ? null : id;
  }

  function formatDuration(tc: ToolCall): string {
    const end = tc.endTime ?? now;
    const secs = (end - tc.startTime) / 1000;
    if (secs < 60) return `${secs.toFixed(1)}s`;
    return `${Math.floor(secs / 60)}m ${Math.floor(secs % 60)}s`;
  }

  function agentLabel(tc: ToolCall): string {
    const desc = tc.input.description as string | undefined;
    const subtype = tc.input.subagent_type as string | undefined;
    return desc || subtype || "Agent";
  }

  function agentType(tc: ToolCall): string {
    return (tc.input.subagent_type as string) || "general";
  }

  function truncateResult(text: string, lines: number): { text: string; truncated: boolean } {
    const allLines = text.split("\n");
    if (allLines.length <= lines) return { text, truncated: false };
    return { text: allLines.slice(0, lines).join("\n"), truncated: true };
  }

  /** Summarize a child tool call as a short one-liner */
  function childSummary(tc: ToolCall): string {
    const input = tc.input;
    switch (tc.name) {
      case "Read": return (input.file_path as string)?.split(/[\\/]/).pop() || "file";
      case "Write": return (input.file_path as string)?.split(/[\\/]/).pop() || "file";
      case "Edit": return (input.file_path as string)?.split(/[\\/]/).pop() || "file";
      case "Bash": {
        const cmd = (input.command as string) || "";
        return cmd.length > 40 ? cmd.slice(0, 40) + "..." : cmd;
      }
      case "Grep": return (input.pattern as string) || "search";
      case "Glob": return (input.pattern as string) || "pattern";
      case "WebFetch": return "fetch";
      case "WebSearch": return (input.query as string) || "search";
      default: return tc.name;
    }
  }

  /** Get the currently active child (last incomplete one) */
  function activeChild(agent: ToolCall): ToolCall | undefined {
    if (!agent.children?.length) return undefined;
    for (let i = agent.children.length - 1; i >= 0; i--) {
      if (!agent.children[i].isComplete) return agent.children[i];
    }
    return undefined;
  }

  let activeAgents = $derived(agents.filter((a) => !a.isComplete));
  let activeCount = $derived(activeAgents.length);
  let totalCount = $derived(agents.length);
</script>

<!-- Toggle tab — always visible when there are agents, hidden when panel is open -->
{#if !open && totalCount > 0}
  <button
    class="panel-tab"
    class:has-active={activeCount > 0}
    onclick={onToggle}
    title="Show agents"
  >
    <span class="tab-icon">A</span>
    {#if activeCount > 0}
      <span class="tab-badge">{activeCount}</span>
    {:else}
      <span class="tab-badge dim">{totalCount}</span>
    {/if}
  </button>
{/if}

{#if open && totalCount > 0}
  <aside class="agent-panel">
    <div class="panel-header">
      <span class="panel-title">agents</span>
      <span class="panel-count">{totalCount}</span>
      <button class="panel-close" onclick={onToggle} title="Close">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" stroke-width="1.2" />
          <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
    </div>

    <div class="agent-list">
      {#each agents as agent (agent.id)}
        {@const isExpanded = expandedId === agent.id}
        <div
          class="agent-card"
          class:expanded={isExpanded}
          class:done={agent.isComplete}
        >
          <button
            class="agent-header"
            onclick={() => toggleExpand(agent.id)}
          >
            <div class="agent-status">
              {#if !agent.isComplete}
                <span class="pulse-dot"></span>
              {:else}
                <span class="done-dot"></span>
              {/if}
            </div>
            <div class="agent-info">
              <span class="agent-label">{agentLabel(agent)}</span>
              <span class="agent-type">{agentType(agent)}</span>
            </div>
            <div class="agent-meta">
              <span class="agent-dur" class:live={!agent.isComplete}>{formatDuration(agent)}</span>
              <span class="expand-chevron" class:open={isExpanded}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </span>
            </div>
          </button>

          <!-- Live activity: show current child tool when agent is running (collapsed) -->
          {#if !agent.isComplete && !isExpanded && agent.children?.length}
            {@const current = activeChild(agent)}
            {#if current}
              <div class="agent-activity">
                <span class="activity-icon">{getToolIcon(current.name)}</span>
                <span class="activity-tool">{current.name}</span>
                <span class="activity-detail">{childSummary(current)}</span>
              </div>
            {/if}
          {/if}

          {#if isExpanded}
            <div class="agent-body">
              <!-- Children activity feed -->
              {#if agent.children?.length}
                <div class="agent-section">
                  <span class="section-label">activity ({agent.children.length})</span>
                  <div class="children-list">
                    {#each agent.children as child (child.id)}
                      <div class="child-row" class:child-done={child.isComplete} class:child-error={child.isError}>
                        <span class="child-status">
                          {#if !child.isComplete}
                            <span class="child-pulse"></span>
                          {:else if child.isError}
                            <span class="child-error-dot"></span>
                          {:else}
                            <span class="child-done-dot"></span>
                          {/if}
                        </span>
                        <span class="child-icon">{getToolIcon(child.name)}</span>
                        <span class="child-name">{child.name}</span>
                        <span class="child-detail">{childSummary(child)}</span>
                        <span class="child-dur">{formatDuration(child)}</span>
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}

              {#if agent.input.prompt}
                <div class="agent-section">
                  <span class="section-label">prompt</span>
                  <pre class="section-content">{agent.input.prompt}</pre>
                </div>
              {/if}
              {#if agent.result}
                {@const r = truncateResult(agent.result, 30)}
                <div class="agent-section">
                  <span class="section-label">result</span>
                  <pre class="section-content result">{r.text}{#if r.truncated}<span class="fade-out"></span>{/if}</pre>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </aside>
{/if}

<style>
  /* ── Toggle tab ── */
  .panel-tab {
    position: absolute;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    z-index: 10;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 8px 5px;
    background: var(--bg-glass);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
    border: 1px solid var(--border-subtle);
    border-right: none;
    border-radius: 8px 0 0 8px;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s var(--ease-out-quart);
  }

  .panel-tab:hover {
    color: var(--text);
    background: var(--bg-glass-hover);
    border-color: var(--border);
  }

  .tab-icon {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
  }

  .panel-tab.has-active {
    color: var(--text-secondary);
  }

  .tab-badge {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 600;
    line-height: 1;
    min-width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 7px;
    background: rgba(255, 255, 255, 0.12);
    color: var(--text);
    animation: fadeIn 0.3s var(--ease-out-expo);
  }

  .tab-badge.dim {
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-tertiary);
  }

  /* ── Floating panel ── */
  .agent-panel {
    position: absolute;
    right: 12px;
    top: 12px;
    bottom: 12px;
    width: 280px;
    background: rgba(255, 255, 255, 0.06);
    -webkit-backdrop-filter: blur(40px) saturate(1.3);
    backdrop-filter: blur(40px) saturate(1.3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    z-index: 9;
    animation: panelSlideIn 0.25s var(--ease-out-expo);
    overflow: hidden;
    will-change: backdrop-filter;
  }

  @keyframes panelSlideIn {
    from { transform: translateX(16px) scale(0.96); opacity: 0; }
    to { transform: translateX(0) scale(1); opacity: 1; }
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 10px 10px 14px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .panel-close {
    margin-left: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 4px;
    border: none;
    background: none;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: all 0.2s var(--ease-out-quart);
    opacity: 0.4;
  }
  .panel-close:hover {
    color: var(--text-secondary);
    background: rgba(255, 255, 255, 0.06);
    opacity: 1;
    transform: rotate(90deg);
  }

  .panel-title {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--text-tertiary);
    opacity: 0.6;
  }

  .panel-count {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-tertiary);
    background: rgba(255, 255, 255, 0.05);
    padding: 1px 6px;
    border-radius: 4px;
  }

  .panel-empty {
    padding: 24px 16px;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-tertiary);
    opacity: 0.5;
  }

  /* ── Agent list ── */
  .agent-list {
    display: flex;
    flex-direction: column;
    padding: 6px;
    gap: 2px;
    flex: 1;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.06) transparent;
  }

  .agent-card {
    border-radius: 8px;
    transition: background 0.15s ease;
  }

  .agent-card:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .agent-card.expanded {
    background: rgba(255, 255, 255, 0.03);
  }

  /* ── Agent header ── */
  .agent-header {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
  }

  .agent-status {
    flex-shrink: 0;
    width: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .pulse-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.5);
    animation: glow 2s ease-in-out infinite;
  }

  @keyframes glow {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }

  .done-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.12);
  }

  .agent-card.done {
    opacity: 0.6;
  }

  .agent-card.done:hover {
    opacity: 0.85;
  }

  .agent-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .agent-label {
    font-family: var(--font-sans);
    font-size: 11.5px;
    font-weight: 450;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.3;
  }

  .agent-type {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-tertiary);
    opacity: 0.7;
  }

  .agent-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .agent-dur {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-tertiary);
    opacity: 0.6;
  }

  .agent-dur.live {
    color: var(--text-secondary);
    opacity: 0.8;
  }

  .expand-chevron {
    color: var(--text-tertiary);
    opacity: 0;
    transition: opacity 0.15s ease, transform 0.2s var(--ease-out-expo);
    display: flex;
    align-items: center;
  }

  .agent-card:hover .expand-chevron {
    opacity: 0.4;
  }

  .expand-chevron.open {
    transform: rotate(180deg);
    opacity: 0.5;
  }

  /* ── Expanded body ── */
  .agent-body {
    padding: 0 10px 10px 26px;
    animation: bodyIn 0.2s var(--ease-out-expo);
  }

  @keyframes bodyIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .agent-section {
    margin-top: 6px;
  }

  .section-label {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 500;
    color: var(--text-tertiary);
    opacity: 0.6;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    display: block;
    margin-bottom: 4px;
  }

  .section-content {
    font-family: var(--font-mono);
    font-size: 10.5px;
    line-height: 1.5;
    color: var(--text-secondary);
    margin: 0;
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 6px;
    max-height: 200px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.06) transparent;
  }

  .section-content.result {
    color: var(--text-tertiary);
    font-size: 10px;
    position: relative;
  }

  .fade-out {
    display: block;
    height: 20px;
    background: linear-gradient(to bottom, transparent, rgba(0, 0, 0, 0.2));
    margin: 0 -8px -6px;
    pointer-events: none;
  }

  /* ── Live activity bar (collapsed) ── */
  .agent-activity {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 10px 6px 28px;
    animation: fadeIn 0.2s ease;
    overflow: hidden;
  }

  .activity-icon {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-tertiary);
    opacity: 0.5;
    flex-shrink: 0;
  }

  .activity-tool {
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--text-tertiary);
    opacity: 0.7;
    flex-shrink: 0;
  }

  .activity-detail {
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--text-tertiary);
    opacity: 0.45;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  /* ── Children list (expanded) ── */
  .children-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: rgba(0, 0, 0, 0.15);
    border-radius: 6px;
    padding: 4px 0;
    max-height: 200px;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.06) transparent;
  }

  .child-row {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    transition: opacity 0.15s ease;
  }

  .child-row.child-done {
    opacity: 0.5;
  }

  .child-row.child-error {
    opacity: 0.8;
  }

  .child-status {
    flex-shrink: 0;
    width: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .child-pulse {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.6);
    animation: glow 1.5s ease-in-out infinite;
  }

  .child-done-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.15);
  }

  .child-error-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: rgba(255, 100, 100, 0.5);
  }

  .child-icon {
    font-family: var(--font-mono);
    font-size: 8px;
    color: var(--text-tertiary);
    opacity: 0.4;
    flex-shrink: 0;
    width: 8px;
    text-align: center;
  }

  .child-name {
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--text-tertiary);
    opacity: 0.8;
    flex-shrink: 0;
  }

  .child-detail {
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--text-tertiary);
    opacity: 0.4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    flex: 1;
  }

  .child-dur {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--text-tertiary);
    opacity: 0.35;
    flex-shrink: 0;
  }

  :global([data-theme="light"]) .agent-panel {
    background: var(--bg-glass);
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.5);
  }

  :global([data-theme="light"]) .children-list {
    background: rgba(0, 0, 0, 0.04);
  }
</style>
