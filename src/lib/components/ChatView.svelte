<script lang="ts">
  import type { ChatMessage } from "../types";
  import MessageBubble from "./MessageBubble.svelte";
  import { tick } from "svelte";

  let {
    messages,
    isRunning,
    autoScrollEnabled = true,
    onFork,
    onCopy,
  }: {
    messages: ChatMessage[];
    isRunning: boolean;
    autoScrollEnabled?: boolean;
    onFork?: (messageId: string) => void;
    onCopy?: (messageId: string) => void;
  } = $props();

  let scrollContainer: HTMLDivElement;
  let userScrolledUp = $state(false);
  let programmaticScroll = false;

  function isNearBottom(): boolean {
    if (!scrollContainer) return true;
    const threshold = 150;
    return (
      scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight <
      threshold
    );
  }

  function handleScroll() {
    if (programmaticScroll) return;
    userScrolledUp = !isNearBottom();
  }

  function scrollToBottom() {
    if (!scrollContainer) return;
    programmaticScroll = true;
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
    // Reset flag after scroll completes
    requestAnimationFrame(() => {
      programmaticScroll = false;
    });
  }

  // Auto-scroll when messages update (content changes during streaming)
  $effect(() => {
    // Track array length for new messages
    const len = messages.length;
    // Track last message content for streaming updates
    if (len > 0) {
      const last = messages[len - 1];
      const cLen = last.content.length;
      if (cLen > 0) {
        const block = last.content[cLen - 1];
        if (block.type === "text") void block.text.length;
        if (block.type === "tool_call") void block.toolCall.isComplete;
      }
    }
    void isRunning;

    if (autoScrollEnabled && !userScrolledUp) {
      tick().then(scrollToBottom);
    }
  });
</script>

<div class="chat-view" bind:this={scrollContainer} onscroll={handleScroll}>
  {#if messages.length === 0}
    <div class="empty-state">
      <div class="empty-logo">clauke</div>
      <p class="empty-sub">send a prompt to get started</p>
    </div>
  {:else}
    <div class="messages">
      {#each messages as message (message.id)}
        {#if message.role === "system"}
          <div class="system-divider">
            <div class="system-line"></div>
            <span class="system-label">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="14" y1="10" x2="21" y2="3" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
              {message.content[0]?.type === "text" ? (message.content[0] as any).text : "system"}
            </span>
            <div class="system-line"></div>
          </div>
        {:else}
          <MessageBubble {message} {onFork} {onCopy} />
        {/if}
      {/each}

      {#if isRunning}
        <div class="thinking">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </div>
      {/if}
    </div>
  {/if}

  {#if userScrolledUp}
    <button class="scroll-bottom" onclick={() => { userScrolledUp = false; scrollToBottom(); }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  {/if}
</div>

<style>
  .chat-view {
    height: 100%;
    overflow-y: auto;
    padding: 24px 20px;
    position: relative;
  }

  .scroll-bottom {
    position: sticky;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: var(--bg-surface);
    color: var(--text-secondary);
    cursor: pointer;
    z-index: 10;
    transition: all 0.2s ease;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    margin: 0 auto;
  }
  .scroll-bottom:hover {
    background: var(--bg-glass-hover);
    color: var(--text);
    border-color: var(--border-focus);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 10px;
  }

  .empty-logo {
    font-family: var(--font-mono);
    font-size: 28px;
    font-weight: 400;
    letter-spacing: 2px;
    color: var(--text-tertiary);
    animation: fadeIn 0.6s var(--ease-out-expo);
  }

  .empty-sub {
    font-size: 13px;
    font-weight: 350;
    color: var(--text-tertiary);
    letter-spacing: 0.3px;
    animation: fadeIn 0.6s var(--ease-out-expo) 0.1s both;
  }

  .messages {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: 860px;
    margin: 0 auto;
  }

  .thinking {
    display: flex;
    gap: 5px;
    padding: 16px 2px;
  }

  .dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--text-tertiary);
    animation: dotPulse 1.4s var(--ease-in-out) infinite;
  }
  .dot:nth-child(2) { animation-delay: 0.15s; }
  .dot:nth-child(3) { animation-delay: 0.3s; }

  @keyframes dotPulse {
    0%, 100% { opacity: 0.2; transform: scale(0.8); }
    50% { opacity: 0.9; transform: scale(1.2); }
  }

  /* ── System divider (compact notification, etc.) ── */
  .system-divider {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    animation: slideUp 0.35s var(--ease-out-expo);
  }

  .system-line {
    flex: 1;
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--border-subtle), transparent);
  }

  .system-label {
    display: flex;
    align-items: center;
    gap: 5px;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 450;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--text-tertiary);
    opacity: 0.5;
    white-space: nowrap;
  }

  .system-label svg {
    opacity: 0.6;
  }
</style>
