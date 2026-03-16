<script lang="ts">
  import type { SessionRecord } from "../types";

  let {
    open,
    sessions,
    onClose,
    onRestore,
    onDelete,
  }: {
    open: boolean;
    sessions: SessionRecord[];
    onClose: () => void;
    onRestore: (session: SessionRecord) => void;
    onDelete: (id: string) => void;
  } = $props();

  let search = $state("");
  let closing = $state(false);

  function close() {
    closing = true;
    setTimeout(() => {
      closing = false;
      onClose();
    }, 200);
  }

  const filtered = $derived(
    search.trim()
      ? sessions.filter(
          (s) =>
            s.name.toLowerCase().includes(search.toLowerCase()) ||
            s.preview.toLowerCase().includes(search.toLowerCase()) ||
            s.cwd.toLowerCase().includes(search.toLowerCase()),
        )
      : sessions,
  );

  /** Group sessions by date category */
  const grouped = $derived.by(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    const yesterdayMs = todayMs - 86400000;
    const weekMs = todayMs - 7 * 86400000;

    const groups: { label: string; items: SessionRecord[] }[] = [];
    const buckets = new Map<string, SessionRecord[]>();

    for (const s of filtered) {
      let label: string;
      if (s.lastActiveAt >= todayMs) {
        label = "Today";
      } else if (s.lastActiveAt >= yesterdayMs) {
        label = "Yesterday";
      } else if (s.lastActiveAt >= weekMs) {
        label = "This Week";
      } else {
        label = "Older";
      }
      if (!buckets.has(label)) buckets.set(label, []);
      buckets.get(label)!.push(s);
    }

    // Preserve order: Today → Yesterday → This Week → Older
    for (const label of ["Today", "Yesterday", "This Week", "Older"]) {
      const items = buckets.get(label);
      if (items && items.length > 0) {
        groups.push({ label, items });
      }
    }
    return groups;
  });

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="overlay"
    class:closing
    onclick={close}
    onkeydown={handleKeydown}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="panel" class:closing onclick={(e) => e.stopPropagation()}>
      <div class="panel-header">
        <span class="panel-title">sessions</span>
        <span class="session-count">{sessions.length}</span>
        <button class="btn-close" onclick={close} title="Close">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" stroke-width="1.4" />
            <line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" stroke-width="1.4" />
          </svg>
        </button>
      </div>

      <div class="search-wrap">
        <input
          class="search-input"
          type="text"
          placeholder="search sessions..."
          bind:value={search}
        />
      </div>

      <div class="session-list">
        {#if grouped.length === 0}
          <div class="empty">
            {#if search.trim()}
              <span class="empty-text">no matching sessions</span>
            {:else}
              <span class="empty-text">no archived sessions yet</span>
              <span class="empty-hint">closed tabs with a session ID will appear here</span>
            {/if}
          </div>
        {:else}
          {#each grouped as group}
            <div class="group">
              <div class="group-label">{group.label}</div>
              {#each group.items as session (session.id)}
                <div class="session-card">
                  <button class="session-main" onclick={() => onRestore(session)}>
                    <div class="session-top">
                      <span class="session-name">{session.name}</span>
                      <span class="session-model">{session.model}</span>
                    </div>
                    {#if session.preview}
                      <div class="session-preview">{session.preview}</div>
                    {/if}
                    <div class="session-meta">
                      <span class="session-time">{formatTime(session.lastActiveAt)}</span>
                      <span class="session-dot">·</span>
                      <span class="session-msgs">{session.messageCount} msg{session.messageCount !== 1 ? "s" : ""}</span>
                      {#if session.cwd}
                        <span class="session-dot">·</span>
                        <span class="session-cwd">{session.cwd.split(/[\\/]/).pop()}</span>
                      {/if}
                    </div>
                  </button>
                  <button
                    class="btn-delete"
                    onclick={(e) => { e.stopPropagation(); onDelete(session.id); }}
                    title="Delete session"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12">
                      <line x1="3" y1="3" x2="9" y2="9" stroke="currentColor" stroke-width="1.2" />
                      <line x1="9" y1="3" x2="3" y2="9" stroke="currentColor" stroke-width="1.2" />
                    </svg>
                  </button>
                </div>
              {/each}
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    z-index: 100;
    animation: fadeOverlayIn 0.2s ease;
  }
  .overlay.closing {
    animation: fadeOverlayOut 0.2s ease forwards;
  }

  .panel {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    width: 340px;
    max-width: 90vw;
    background: rgba(22, 22, 28, 0.97);
    border-right: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    animation: slideInLeft 0.25s var(--ease-out-expo);
  }
  .panel.closing {
    animation: slideOutLeft 0.2s ease forwards;
  }

  .panel-header {
    display: flex;
    align-items: center;
    padding: 16px 18px 12px;
    gap: 8px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .panel-title {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 500;
    letter-spacing: 0.8px;
    color: var(--text-secondary);
    text-transform: uppercase;
  }

  .session-count {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-tertiary);
    background: rgba(255, 255, 255, 0.07);
    padding: 1px 6px;
    border-radius: 8px;
  }

  .btn-close {
    margin-left: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    background: none;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.15s ease;
  }
  .btn-close:hover {
    color: var(--text-secondary);
    background: rgba(255, 255, 255, 0.06);
  }

  .search-wrap {
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .search-input {
    width: 100%;
    padding: 7px 12px;
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--text);
    background: var(--bg-input);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    outline: none;
    transition: all 0.2s ease;
  }
  .search-input:focus {
    border-color: var(--border-focus);
    background: var(--bg-input-focus);
  }
  .search-input::placeholder {
    color: var(--text-tertiary);
  }

  .session-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 40px 20px;
    text-align: center;
  }
  .empty-text {
    font-size: 12.5px;
    color: var(--text-tertiary);
  }
  .empty-hint {
    font-size: 11px;
    color: var(--text-tertiary);
    opacity: 0.6;
  }

  .group {
    margin-bottom: 4px;
  }

  .group-label {
    padding: 8px 18px 4px;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--text-tertiary);
  }

  .session-card {
    display: flex;
    align-items: stretch;
    margin: 2px 8px;
    border-radius: var(--radius-sm);
    transition: background 0.15s ease;
  }
  .session-card:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .session-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 10px 14px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--text);
  }

  .session-top {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .session-name {
    font-size: 12.5px;
    font-weight: 500;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  .session-model {
    font-family: var(--font-mono);
    font-size: 9.5px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-tertiary);
    background: rgba(255, 255, 255, 0.07);
    padding: 1px 5px;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .session-preview {
    font-size: 11.5px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    opacity: 0.7;
  }

  .session-meta {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 10.5px;
    color: var(--text-tertiary);
  }

  .session-dot {
    opacity: 0.4;
  }

  .session-cwd {
    font-family: var(--font-mono);
    font-size: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100px;
  }

  .btn-delete {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    opacity: 0;
    transition: all 0.15s ease;
    flex-shrink: 0;
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  }
  .session-card:hover .btn-delete {
    opacity: 1;
  }
  .btn-delete:hover {
    color: rgba(220, 100, 100, 0.9);
    background: rgba(220, 100, 100, 0.08);
  }

  @keyframes fadeOverlayIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes fadeOverlayOut {
    from { opacity: 1; }
    to { opacity: 0; }
  }
  @keyframes slideInLeft {
    from { transform: translateX(-100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes slideOutLeft {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(-100%); opacity: 0; }
  }
</style>
