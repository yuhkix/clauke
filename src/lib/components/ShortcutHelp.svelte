<script lang="ts">
  let {
    open = false,
    onClose,
  }: {
    open: boolean;
    onClose: () => void;
  } = $props();

  let visible = $state(false);
  let closing = $state(false);

  $effect(() => {
    if (open) {
      visible = true;
      closing = false;
    } else if (visible) {
      closing = true;
      setTimeout(() => { visible = false; closing = false; }, 200);
    }
  });

  function handleClose() {
    onClose();
  }

  const shortcuts = [
    { section: "tabs" },
    { keys: "Ctrl + T", desc: "New tab" },
    { keys: "Ctrl + W", desc: "Close tab" },
    { keys: "Ctrl + 1–9", desc: "Switch to tab N" },
    { section: "chat" },
    { keys: "Enter", desc: "Send prompt" },
    { keys: "Shift + Enter", desc: "New line" },
    { keys: "Ctrl + L", desc: "Clear chat" },
    { keys: "Ctrl + F", desc: "Search conversation" },
    { section: "panels" },
    { keys: "Ctrl + B", desc: "Toggle file explorer" },
    { keys: "Ctrl + /", desc: "Show shortcuts" },
    { section: "input" },
    { keys: "Tab", desc: "Complete slash command" },
    { keys: "↑ / ↓", desc: "Navigate suggestions" },
    { keys: "Escape", desc: "Dismiss suggestions" },
  ];
</script>

{#if visible}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="overlay" class:closing onclick={handleClose} onkeydown={(e) => e.key === "Escape" && handleClose()}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal" class:closing onclick={(e) => e.stopPropagation()}>
      <div class="modal-header">
        <span class="modal-title">shortcuts</span>
        <button class="close-btn" title="Close" onclick={handleClose}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" stroke-width="1.2" />
            <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" stroke-width="1.2" />
          </svg>
        </button>
      </div>

      <div class="shortcut-list">
        {#each shortcuts as item}
          {#if 'section' in item && item.section}
            <div class="section-label">{item.section}</div>
          {:else if 'keys' in item}
            <div class="shortcut-row">
              <div class="keys">
                {#each item.keys.split(" + ") as part, i}
                  {#if part === "+" || part === "/" || part === "–"}
                    <span class="separator">{part}</span>
                  {:else if part.includes("–")}
                    <!-- range like 1–9 -->
                    <kbd>{part.split("–")[0]}</kbd><span class="separator">–</span><kbd>{part.split("–")[1]}</kbd>
                  {:else if part.includes(" / ")}
                    <kbd>{part.split(" / ")[0]}</kbd><span class="separator">/</span><kbd>{part.split(" / ")[1]}</kbd>
                  {:else}
                    {#if i > 0}<span class="separator">+</span>{/if}
                    <kbd>{part}</kbd>
                  {/if}
                {/each}
              </div>
              <span class="desc">{item.desc}</span>
            </div>
          {/if}
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
    animation: fadeIn 0.2s ease;
  }

  .overlay.closing {
    animation: fadeOut 0.2s ease forwards;
  }

  .modal {
    background: var(--bg-base);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    width: 380px;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
    animation: slideUp 0.25s var(--ease-out-expo);
  }

  .modal.closing {
    animation: slideDown 0.2s ease forwards;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .modal-title {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: var(--text-secondary);
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border: none;
    background: none;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.15s ease;
  }

  .close-btn:hover {
    color: var(--text-secondary);
    background: var(--bg-glass-hover);
  }

  .shortcut-list {
    padding: 8px 18px 16px;
  }

  .section-label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    color: var(--text-tertiary);
    margin-top: 14px;
    margin-bottom: 6px;
  }

  .section-label:first-child {
    margin-top: 6px;
  }

  .shortcut-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 0;
    gap: 12px;
  }

  .keys {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
  }

  kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 22px;
    height: 22px;
    padding: 0 6px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 500;
    color: var(--text-secondary);
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--border);
    border-radius: 4px;
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04);
  }

  .separator {
    font-size: 10px;
    color: var(--text-tertiary);
    padding: 0 1px;
  }

  .desc {
    font-size: 12.5px;
    color: var(--text-secondary);
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes fadeOut {
    from { opacity: 1; }
    to { opacity: 0; }
  }

  @keyframes slideDown {
    from { transform: translateY(0); opacity: 1; }
    to { transform: translateY(8px); opacity: 0; }
  }
</style>
