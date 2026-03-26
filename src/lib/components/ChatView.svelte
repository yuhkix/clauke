<script lang="ts">
  import type { ChatMessage } from "../types";
  import MessageBubble from "./MessageBubble.svelte";
  import { tick } from "svelte";

  let {
    messages,
    isRunning,
    runStartTime,
    autoScrollEnabled = true,
    onFork,
    onCopy,
    onEditMessage,
  }: {
    messages: ChatMessage[];
    isRunning: boolean;
    runStartTime?: number;
    autoScrollEnabled?: boolean;
    onFork?: (messageId: string) => void;
    onCopy?: (messageId: string) => void;
    onEditMessage?: (messageId: string) => void;
  } = $props();

  // Elapsed timer
  let elapsed = $state(0);
  let timerInterval: ReturnType<typeof setInterval> | undefined;

  $effect(() => {
    if (isRunning && runStartTime) {
      elapsed = Math.floor((Date.now() - runStartTime) / 1000);
      timerInterval = setInterval(() => {
        elapsed = Math.floor((Date.now() - runStartTime) / 1000);
      }, 1000);
    } else {
      clearInterval(timerInterval);
    }
    return () => clearInterval(timerInterval);
  });

  function formatElapsed(s: number): string {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  }

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
      {#each messages as message, i (message.id)}
        {#if message.role === "system"}
          <div class="system-divider" id={message.id}>
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
          <MessageBubble {message} {onFork} {onCopy} onEdit={onEditMessage} isStreaming={isRunning && i === messages.length - 1 && message.role === 'assistant'} />
        {/if}
      {/each}

      {#if isRunning}
        <div class="thinking-indicator">
          <div class="think-orbit">
            <span class="orb orb-1"></span>
            <span class="orb orb-2"></span>
            <span class="orb orb-3"></span>
            <span class="orbit-trail"></span>
          </div>
          <span class="think-timer">{formatElapsed(elapsed)}</span>
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

  /* ── Thinking indicator: waveform + timer ── */
  .thinking-indicator {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 2px;
    animation: thinkFadeIn 0.4s var(--ease-out-expo);
  }

  @keyframes thinkFadeIn {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* ── Orbital animation ── */
  .think-orbit {
    position: relative;
    width: 42px;
    height: 28px;
  }

  .orb {
    position: absolute;
    border-radius: 50%;
    will-change: transform, opacity;
  }

  /* Main orb — elliptical orbit, Kepler-style: fast near center, slow at edges */
  .orb-1 {
    width: 6px;
    height: 6px;
    background: radial-gradient(circle, rgba(167, 139, 250, 1), rgba(129, 100, 230, 0.6));
    box-shadow: 0 0 12px 3px rgba(167, 139, 250, 0.5), 0 0 24px 5px rgba(167, 139, 250, 0.15);
    top: 50%;
    left: 50%;
    animation: orbit1 3s linear infinite;
  }

  /* Second orb — counter-orbit */
  .orb-2 {
    width: 5px;
    height: 5px;
    background: radial-gradient(circle, rgba(130, 170, 255, 0.95), rgba(100, 140, 230, 0.5));
    box-shadow: 0 0 10px 2px rgba(130, 170, 255, 0.45), 0 0 20px 4px rgba(130, 170, 255, 0.12);
    top: 50%;
    left: 50%;
    animation: orbit2 3s linear infinite;
  }

  /* Third orb — fast inner orbit */
  .orb-3 {
    width: 3.5px;
    height: 3.5px;
    background: radial-gradient(circle, rgba(200, 180, 255, 0.95), rgba(170, 150, 230, 0.4));
    box-shadow: 0 0 8px 2px rgba(200, 180, 255, 0.4);
    top: 50%;
    left: 50%;
    animation: orbit3 2s linear infinite;
  }

  /* Faint ring trail */
  .orbit-trail {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 30px;
    height: 18px;
    transform: translate(-50%, -50%);
    border: 1px solid rgba(167, 139, 250, 0.07);
    border-radius: 50%;
    animation: trailPulse 3s linear infinite;
  }

  /* Kepler orbit: positions bunch up at far edges (slow), spread out near center (fast).
     12 keyframes for smooth continuous motion. */
  @keyframes orbit1 {
    0%      { transform: translate(calc(-50% + 16px), calc(-50% + 0px));  opacity: 0.95; }
    8.33%   { transform: translate(calc(-50% + 13px), calc(-50% - 7px)); opacity: 0.85; }
    16.67%  { transform: translate(calc(-50% + 5px),  calc(-50% - 10px)); opacity: 0.75; }
    25%     { transform: translate(calc(-50% - 3px),  calc(-50% - 9px));  opacity: 0.7; }
    33.33%  { transform: translate(calc(-50% - 10px), calc(-50% - 5px)); opacity: 0.75; }
    41.67%  { transform: translate(calc(-50% - 14px), calc(-50% + 0px));  opacity: 0.85; }
    50%     { transform: translate(calc(-50% - 14px), calc(-50% + 2px));  opacity: 0.9; }
    58.33%  { transform: translate(calc(-50% - 10px), calc(-50% + 7px)); opacity: 0.85; }
    66.67%  { transform: translate(calc(-50% - 3px),  calc(-50% + 10px)); opacity: 0.75; }
    75%     { transform: translate(calc(-50% + 5px),  calc(-50% + 9px));  opacity: 0.7; }
    83.33%  { transform: translate(calc(-50% + 13px), calc(-50% + 5px)); opacity: 0.8; }
    91.67%  { transform: translate(calc(-50% + 16px), calc(-50% + 2px)); opacity: 0.9; }
    100%    { transform: translate(calc(-50% + 16px), calc(-50% + 0px));  opacity: 0.95; }
  }

  @keyframes orbit2 {
    0%      { transform: translate(calc(-50% - 13px), calc(-50% + 2px));  opacity: 0.9; }
    8.33%   { transform: translate(calc(-50% - 11px), calc(-50% - 5px)); opacity: 0.8; }
    16.67%  { transform: translate(calc(-50% - 4px),  calc(-50% - 9px)); opacity: 0.7; }
    25%     { transform: translate(calc(-50% + 4px),  calc(-50% - 8px));  opacity: 0.75; }
    33.33%  { transform: translate(calc(-50% + 10px), calc(-50% - 4px)); opacity: 0.85; }
    41.67%  { transform: translate(calc(-50% + 13px), calc(-50% + 1px));  opacity: 0.95; }
    50%     { transform: translate(calc(-50% + 12px), calc(-50% + 4px));  opacity: 0.9; }
    58.33%  { transform: translate(calc(-50% + 8px),  calc(-50% + 8px)); opacity: 0.8; }
    66.67%  { transform: translate(calc(-50% + 1px),  calc(-50% + 9px)); opacity: 0.7; }
    75%     { transform: translate(calc(-50% - 6px),  calc(-50% + 8px));  opacity: 0.75; }
    83.33%  { transform: translate(calc(-50% - 11px), calc(-50% + 5px)); opacity: 0.85; }
    91.67%  { transform: translate(calc(-50% - 13px), calc(-50% + 3px)); opacity: 0.9; }
    100%    { transform: translate(calc(-50% - 13px), calc(-50% + 2px));  opacity: 0.9; }
  }

  @keyframes orbit3 {
    0%      { transform: translate(calc(-50% + 7px),  calc(-50% - 1px)); opacity: 0.8; }
    8.33%   { transform: translate(calc(-50% + 5px),  calc(-50% - 5px)); opacity: 0.7; }
    16.67%  { transform: translate(calc(-50% + 0px),  calc(-50% - 6px)); opacity: 0.65; }
    25%     { transform: translate(calc(-50% - 5px),  calc(-50% - 4px)); opacity: 0.7; }
    33.33%  { transform: translate(calc(-50% - 7px),  calc(-50% + 0px)); opacity: 0.8; }
    41.67%  { transform: translate(calc(-50% - 6px),  calc(-50% + 4px)); opacity: 0.85; }
    50%     { transform: translate(calc(-50% - 3px),  calc(-50% + 6px)); opacity: 0.9; }
    58.33%  { transform: translate(calc(-50% + 1px),  calc(-50% + 6px)); opacity: 0.85; }
    66.67%  { transform: translate(calc(-50% + 5px),  calc(-50% + 4px)); opacity: 0.75; }
    75%     { transform: translate(calc(-50% + 7px),  calc(-50% + 1px)); opacity: 0.7; }
    83.33%  { transform: translate(calc(-50% + 7px),  calc(-50% - 2px)); opacity: 0.75; }
    91.67%  { transform: translate(calc(-50% + 6px),  calc(-50% - 4px)); opacity: 0.7; }
    100%    { transform: translate(calc(-50% + 7px),  calc(-50% - 1px)); opacity: 0.8; }
  }

  @keyframes trailPulse {
    0%, 100% { opacity: 0.25; transform: translate(-50%, -50%) scale(1); }
    50% { opacity: 0.55; transform: translate(-50%, -50%) scale(1.1); }
  }

  .think-timer {
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 450;
    color: var(--text-tertiary);
    letter-spacing: 0.5px;
    font-variant-numeric: tabular-nums;
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

  /* Search highlight flash */
  :global(.search-highlight) {
    animation: searchFlash 1.5s ease-out;
  }

  @keyframes searchFlash {
    0% { background: rgba(167, 139, 250, 0.15); }
    100% { background: transparent; }
  }
</style>
