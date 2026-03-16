<script lang="ts">
  import { untrack } from "svelte";
  import type { TreeNode } from "../types";

  let {
    tree,
    open,
    onToggle,
  }: {
    tree: TreeNode[];
    open: boolean;
    onToggle: () => void;
  } = $props();

  let expanded = $state<Set<string>>(new Set());

  function toggleDir(name: string) {
    const next = new Set(expanded);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    expanded = next;
  }

  // Auto-expand directories with changes (additive, won't collapse user-toggled dirs)
  let prevAutoKeys = new Set<string>();
  $effect(() => {
    const toExpand = new Set<string>();
    function walk(nodes: TreeNode[], prefix: string) {
      for (const node of nodes) {
        const key = prefix + node.name;
        if (node.isDir && (node.totalAdded > 0 || node.totalRemoved > 0)) {
          toExpand.add(key);
        }
        if (node.children.length > 0) {
          walk(node.children, key + "/");
        }
      }
    }
    walk(tree, "");
    // Only expand keys we haven't seen before
    const newKeys: string[] = [];
    for (const k of toExpand) {
      if (!prevAutoKeys.has(k)) newKeys.push(k);
    }
    prevAutoKeys = toExpand;
    if (newKeys.length > 0) {
      untrack(() => {
        const next = new Set(expanded);
        for (const k of newKeys) next.add(k);
        expanded = next;
      });
    }
  });

  const totalFiles = $derived(countFiles(tree));
  const totalAdded = $derived(tree.reduce((s, n) => s + n.totalAdded, 0));
  const totalRemoved = $derived(tree.reduce((s, n) => s + n.totalRemoved, 0));

  function countFiles(nodes: TreeNode[]): number {
    let count = 0;
    for (const n of nodes) {
      if (!n.isDir) count++;
      count += countFiles(n.children);
    }
    return count;
  }
</script>

{#snippet treeNodes(nodes: TreeNode[], prefix: string, depth: number)}
  {#each nodes as node}
    {@const key = prefix + node.name}
    {@const isExpanded = expanded.has(key)}
    {#if node.isDir}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="tree-item dir"
        style:padding-left="{12 + depth * 14}px"
        onclick={() => toggleDir(key)}
      >
        <svg class="chevron" class:open={isExpanded} width="10" height="10" viewBox="0 0 10 10">
          <polyline points="3,2 7,5 3,8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <svg class="icon-dir" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        <span class="name">{node.name}</span>
        {#if node.totalAdded > 0 || node.totalRemoved > 0}
          <span class="diff-stats">
            {#if node.totalAdded > 0}<span class="diff-add">+{node.totalAdded}</span>{/if}
            {#if node.totalRemoved > 0}<span class="diff-rm">-{node.totalRemoved}</span>{/if}
          </span>
        {/if}
      </div>
      {#if isExpanded}
        {@render treeNodes(node.children, key + "/", depth + 1)}
      {/if}
    {:else}
      <div
        class="tree-item file"
        class:modified={node.stats && (node.stats.added > 0 || node.stats.removed > 0)}
        class:read-only={node.stats && node.stats.reads > 0 && node.stats.writes === 0}
        style:padding-left="{12 + depth * 14 + 14}px"
        title={node.fullPath}
      >
        <svg class="icon-file" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span class="name">{node.name}</span>
        {#if node.stats && (node.stats.added > 0 || node.stats.removed > 0)}
          <span class="diff-stats">
            {#if node.stats.added > 0}<span class="diff-add">+{node.stats.added}</span>{/if}
            {#if node.stats.removed > 0}<span class="diff-rm">-{node.stats.removed}</span>{/if}
          </span>
        {/if}
      </div>
    {/if}
  {/each}
{/snippet}

<!-- Tab handle — only visible when panel is closed -->
{#if !open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="filetree-tab" onclick={onToggle}>
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
    {#if totalFiles > 0}
      <span class="tab-count">{totalFiles}</span>
    {/if}
  </div>
{/if}

{#if open && tree.length > 0}
  <div class="filetree-panel">
    <div class="panel-header">
      <span class="panel-title">files</span>
      <div class="panel-header-right">
        {#if totalAdded > 0 || totalRemoved > 0}
          <span class="total-diff">
            {#if totalAdded > 0}<span class="diff-add">+{totalAdded}</span>{/if}
            {#if totalRemoved > 0}<span class="diff-rm">-{totalRemoved}</span>{/if}
          </span>
        {/if}
        <button class="close-btn" onclick={onToggle} title="Close file tree">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" stroke-width="1.2" />
            <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" stroke-width="1.2" />
          </svg>
        </button>
      </div>
    </div>
    <div class="tree-scroll">
      {@render treeNodes(tree, "", 0)}
    </div>
  </div>
{/if}

<style>
  .filetree-tab {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 6px;
    background: var(--bg-glass);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
    border: 1px solid var(--border-subtle);
    border-left: none;
    border-radius: 0 6px 6px 0;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: all 0.2s ease;
    z-index: 10;
    writing-mode: vertical-lr;
  }

  .filetree-tab:hover {
    color: var(--text-secondary);
    background: var(--bg-glass-hover);
    border-color: var(--border);
  }

  .tab-count {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 600;
    color: var(--text-tertiary);
    writing-mode: horizontal-tb;
  }

  .filetree-panel {
    position: absolute;
    left: 12px;
    top: 12px;
    bottom: 12px;
    width: 260px;
    background: rgba(255, 255, 255, 0.06);
    -webkit-backdrop-filter: blur(40px) saturate(1.3);
    backdrop-filter: blur(40px) saturate(1.3);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    z-index: 9;
    animation: slideIn 0.25s var(--ease-out-expo);
    overflow: hidden;
    will-change: backdrop-filter;
  }

  @keyframes slideIn {
    from { transform: translateX(-16px) scale(0.96); opacity: 0; }
    to { transform: translateX(0) scale(1); opacity: 1; }
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 10px 10px 14px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .panel-header-right {
    display: flex;
    align-items: center;
    gap: 8px;
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
    opacity: 0.4;
  }
  .close-btn:hover {
    color: var(--text-secondary);
    background: rgba(255, 255, 255, 0.06);
    opacity: 1;
    transform: rotate(90deg);
  }

  .total-diff {
    display: flex;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
  }

  .tree-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 4px 0;
  }

  .tree-item {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 10px 3px 8px;
    cursor: default;
    transition: background 0.1s ease;
    min-height: 24px;
  }

  .tree-item:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  .tree-item.dir {
    cursor: pointer;
  }

  .chevron {
    flex-shrink: 0;
    transition: transform 0.15s ease;
    color: var(--text-tertiary);
    opacity: 0.5;
  }

  .chevron.open {
    transform: rotate(90deg);
  }

  .icon-dir {
    flex-shrink: 0;
    color: var(--text-tertiary);
    opacity: 0.5;
  }

  .icon-file {
    flex-shrink: 0;
    color: var(--text-tertiary);
    opacity: 0.4;
  }

  .tree-item.modified .icon-file {
    color: rgba(180, 160, 255, 0.7);
    opacity: 0.8;
  }

  .tree-item.read-only .icon-file {
    opacity: 0.3;
  }

  .name {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }

  .tree-item.dir .name {
    font-weight: 450;
  }

  .tree-item.read-only .name {
    color: var(--text-tertiary);
    opacity: 0.6;
  }

  .diff-stats {
    display: flex;
    gap: 4px;
    margin-left: auto;
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }

  .diff-add {
    color: rgba(100, 220, 140, 0.85);
  }

  .diff-rm {
    color: rgba(255, 100, 100, 0.75);
  }

  :global([data-theme="light"]) .filetree-panel {
    background: var(--bg-glass);
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.5);
  }

  :global([data-theme="light"]) .filetree-tab {
    background: rgba(255, 255, 255, 0.6);
  }

  :global([data-theme="light"]) .diff-add {
    color: rgba(30, 160, 70, 0.9);
  }

  :global([data-theme="light"]) .diff-rm {
    color: rgba(210, 50, 50, 0.85);
  }
</style>
