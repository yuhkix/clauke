<script lang="ts">
  import type { Tab } from "../types";

  let {
    tabs,
    activeTabId,
    onSelect,
    onClose,
    onNew,
  }: {
    tabs: Tab[];
    activeTabId: string;
    onSelect: (id: string) => void;
    onClose: (id: string) => void;
    onNew: () => void;
  } = $props();
</script>

<div class="tab-bar">
  <div class="tabs-scroll">
    {#each tabs as tab (tab.id)}
      <div
        class="tab"
        class:active={tab.id === activeTabId}
        class:running={tab.isRunning}
        role="tab"
        tabindex="0"
        onclick={() => onSelect(tab.id)}
        onkeydown={(e: KeyboardEvent) => e.key === "Enter" && onSelect(tab.id)}
        title={tab.cwd || tab.name}
      >
        <span class="tab-name">{tab.name}</span>
        {#if tab.isRunning}
          <span class="tab-indicator"></span>
        {/if}
        {#if tabs.length > 1}
          <button
            class="tab-close"
            onclick={(e: MouseEvent) => { e.stopPropagation(); onClose(tab.id); }}
            title="Close tab"
          >
            &times;
          </button>
        {/if}
      </div>
    {/each}
  </div>
  <button class="tab-new" onclick={onNew} title="New tab">
    +
  </button>
</div>

<style>
  .tab-bar {
    display: flex;
    align-items: stretch;
    gap: 0;
    padding: 0 12px;
    background: var(--bg-glass);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
    border-bottom: 1px solid var(--border-subtle);
    -webkit-app-region: no-drag;
    min-height: 34px;
    overflow: hidden;
  }

  .tabs-scroll {
    display: flex;
    align-items: stretch;
    gap: 1px;
    overflow-x: auto;
    flex: 1;
    scrollbar-width: none;
  }
  .tabs-scroll::-webkit-scrollbar {
    display: none;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 14px;
    height: 34px;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 400;
    color: var(--text-tertiary);
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    transition: all 0.25s var(--ease-out-expo);
    white-space: nowrap;
    flex-shrink: 0;
    position: relative;
    animation: scaleIn 0.25s var(--ease-out-expo);
  }

  .tab:hover {
    color: var(--text-secondary);
    background: var(--bg-surface);
  }

  .tab.active {
    color: var(--text);
    border-bottom-color: rgba(255, 255, 255, 0.2);
  }

  .tab-name {
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tab-indicator {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.35);
    animation: pulse 1.6s ease-in-out infinite;
    flex-shrink: 0;
  }

  .tab-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    font-size: 13px;
    color: var(--text-tertiary);
    background: none;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    opacity: 0;
    transition: all 0.2s var(--ease-out-quart);
    padding: 0;
    line-height: 1;
    flex-shrink: 0;
  }

  .tab:hover .tab-close {
    opacity: 1;
  }

  .tab-close:hover {
    background: rgba(255, 255, 255, 0.08);
    color: var(--text-secondary);
  }

  .tab-new {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 34px;
    font-family: var(--font-mono);
    font-size: 16px;
    font-weight: 300;
    color: var(--text-tertiary);
    background: none;
    border: none;
    cursor: pointer;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }

  .tab-new:hover {
    color: var(--text-secondary);
    background: var(--bg-surface);
  }
</style>
