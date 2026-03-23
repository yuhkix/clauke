<script lang="ts">
  import { tick } from "svelte";
  import type { ChatMessage } from "../types";

  let {
    messages,
    open,
    onClose,
    onNavigate,
  }: {
    messages: ChatMessage[];
    open: boolean;
    onClose: () => void;
    /** Called with messageId + block index when user navigates to a result */
    onNavigate?: (messageId: string) => void;
  } = $props();

  let query = $state("");
  let inputEl = $state<HTMLInputElement>();
  let currentIdx = $state(0);

  interface SearchResult {
    messageId: string;
    blockIdx: number;
    text: string;
    /** Start offset of match within text */
    offset: number;
  }

  const results = $derived.by(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    const hits: SearchResult[] = [];
    for (const msg of messages) {
      if (msg.role === "system") continue;
      for (let bi = 0; bi < msg.content.length; bi++) {
        const block = msg.content[bi];
        if (block.type !== "text") continue;
        const text = block.text;
        const lower = text.toLowerCase();
        let pos = 0;
        while ((pos = lower.indexOf(q, pos)) !== -1) {
          hits.push({
            messageId: msg.id,
            blockIdx: bi,
            text: text.slice(Math.max(0, pos - 30), pos + query.length + 30),
            offset: pos,
          });
          pos += q.length;
        }
      }
    }
    return hits;
  });

  // Reset index when results change
  $effect(() => {
    void results.length;
    currentIdx = 0;
  });

  // Focus input when opened
  $effect(() => {
    if (open) {
      tick().then(() => inputEl?.focus());
    }
  });

  function navigate(direction: 1 | -1) {
    if (results.length === 0) return;
    currentIdx = (currentIdx + direction + results.length) % results.length;
    const hit = results[currentIdx];
    if (hit && onNavigate) {
      onNavigate(hit.messageId);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      navigate(e.shiftKey ? -1 : 1);
    }
  }

  // Export current query and results for highlight integration
  export function getHighlightQuery(): string {
    return open ? query : "";
  }
</script>

{#if open}
  <div class="search-bar">
    <input
      bind:this={inputEl}
      class="search-input"
      type="text"
      placeholder="search in conversation..."
      bind:value={query}
      onkeydown={handleKeydown}
    />
    <span class="search-count">
      {#if query.trim()}
        {results.length > 0 ? `${currentIdx + 1}/${results.length}` : "no results"}
      {/if}
    </span>
    <button class="search-btn" onclick={() => navigate(-1)} disabled={results.length === 0} title="Previous (Shift+Enter)">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="18 15 12 9 6 15" />
      </svg>
    </button>
    <button class="search-btn" onclick={() => navigate(1)} disabled={results.length === 0} title="Next (Enter)">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
    <button class="search-btn search-close" onclick={onClose} title="Close (Esc)">
      <svg width="10" height="10" viewBox="0 0 10 10">
        <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" stroke-width="1.2" />
        <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" stroke-width="1.2" />
      </svg>
    </button>
  </div>
{/if}

<style>
  .search-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 12px;
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border-subtle);
    animation: searchIn 0.2s var(--ease-out-expo);
  }

  @keyframes searchIn {
    from {
      opacity: 0;
      transform: translateY(-100%);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .search-input {
    flex: 1;
    min-width: 0;
    padding: 5px 10px;
    font-family: var(--font-sans);
    font-size: 13px;
    color: var(--text);
    background: var(--bg-input);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    outline: none;
    transition: border-color 0.2s ease;
  }
  .search-input:focus {
    border-color: var(--border-focus);
  }
  .search-input::placeholder {
    color: var(--text-tertiary);
  }

  .search-count {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-tertiary);
    white-space: nowrap;
    min-width: 50px;
    text-align: center;
  }

  .search-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    background: none;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }
  .search-btn:hover:not(:disabled) {
    color: var(--text-secondary);
    background: rgba(255, 255, 255, 0.06);
  }
  .search-btn:disabled {
    opacity: 0.2;
    cursor: default;
  }
  .search-close:hover {
    color: var(--text-secondary);
  }
</style>
