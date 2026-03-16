<script lang="ts">
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { tick } from "svelte";
  import type { ChatMessage } from "../types";
  import { marked } from "marked";
  import hljs from "highlight.js";
  import ToolCallCard from "./ToolCallCard.svelte";

  let {
    message,
    onFork,
    onCopy,
  }: {
    message: ChatMessage;
    onFork?: (messageId: string) => void;
    onCopy?: (messageId: string) => void;
  } = $props();

  const isUser = $derived(message.role === "user");
  let copied = $state(false);

  function handleCopy() {
    if (onCopy) onCopy(message.id);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  /** For user messages, combine all text blocks into one string */
  const userText = $derived(
    message.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { type: "text"; text: string }).text)
      .join(""),
  );

  // Custom renderer with syntax highlighting
  const renderer = new marked.Renderer();
  renderer.code = function ({ text, lang }: { text: string; lang?: string; escaped?: boolean }) {
    let highlighted: string;
    const language = lang || "";
    if (language && hljs.getLanguage(language)) {
      highlighted = hljs.highlight(text, { language }).value;
    } else if (language) {
      // Unknown language, try auto-detect
      highlighted = hljs.highlightAuto(text).value;
    } else {
      highlighted = hljs.highlightAuto(text).value;
    }
    const langLabel = language ? `<span class="code-lang">${language}</span>` : "";
    return `<div class="code-block">${langLabel}<pre><code class="hljs">${highlighted}</code></pre></div>`;
  };

  marked.setOptions({
    breaks: true,
    gfm: true,
  });

  function renderMarkdown(text: string): string {
    return marked.parse(text, { async: false, renderer }) as string;
  }

  // Add copy buttons to code blocks after render
  let contentEl: HTMLDivElement | undefined = $state();

  $effect(() => {
    // Track content changes to re-run
    const _track = message.content.length +
      message.content.filter(b => b.type === "text").map(b => (b as any).text?.length || 0).reduce((a: number, b: number) => a + b, 0);

    tick().then(() => {
      if (!contentEl) return;
      const blocks = contentEl.querySelectorAll(".code-block");
      blocks.forEach((block) => {
        if (block.querySelector(".copy-btn")) return;
        const btn = document.createElement("button");
        btn.className = "copy-btn";
        btn.textContent = "Copy";
        btn.addEventListener("click", async () => {
          const code = block.querySelector("code")?.textContent || "";
          try {
            await navigator.clipboard.writeText(code);
            btn.textContent = "Copied!";
            btn.classList.add("copied");
            setTimeout(() => {
              btn.textContent = "Copy";
              btn.classList.remove("copied");
            }, 1500);
          } catch {
            // Fallback
            const ta = document.createElement("textarea");
            ta.value = code;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
            btn.textContent = "Copied!";
            setTimeout(() => (btn.textContent = "Copy"), 1500);
          }
        });
        block.appendChild(btn);
      });
    });
  });
</script>

<div class="message" class:user={isUser} class:assistant={!isUser} bind:this={contentEl}>
  <div class="meta">
    <span class="role">{isUser ? "you" : "claude"}</span>
    <span class="time">
      {new Date(message.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}
    </span>
  </div>

  {#if isUser}
    {#each message.content as block}
      {#if block.type === "image"}
        <div class="user-images">
          <img src={convertFileSrc(block.path)} alt="attached" class="user-image" />
        </div>
      {/if}
    {/each}
    {#if userText}
      <div class="text">{userText}</div>
    {/if}
  {:else}
    {#each message.content as block}
      {#if block.type === "text" && block.text}
        <div class="prose">{@html renderMarkdown(block.text)}</div>
      {:else if block.type === "tool_call"}
        <div class="tools">
          <ToolCallCard toolCall={block.toolCall} />
        </div>
      {/if}
    {/each}

    <!-- Action bar -->
    <div class="actions">
      <button class="action-btn" class:copied onclick={handleCopy} title="Copy message">
        {#if copied}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        {:else}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        {/if}
      </button>
      {#if onFork}
        <button class="action-btn" onclick={() => onFork(message.id)} title="Fork conversation from here">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="18" r="3" />
            <circle cx="6" cy="6" r="3" />
            <circle cx="18" cy="6" r="3" />
            <path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9" />
            <path d="M12 12v3" />
          </svg>
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .message {
    animation: slideUp 0.35s var(--ease-out-expo);
    padding: 10px 2px;
  }

  .user {
    background: var(--bg-glass);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    padding: 12px 18px;
    margin-left: 80px;
    transition: border-color 0.3s var(--ease-out-quart);
  }

  .user:hover {
    border-color: var(--border);
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }

  .role {
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--text-tertiary);
  }

  .time {
    font-size: 10.5px;
    color: var(--text-tertiary);
    opacity: 0.6;
  }

  .text {
    font-size: var(--chat-font-size, 13.5px);
    line-height: 1.65;
    color: var(--text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* Markdown prose styling */
  .prose {
    font-size: var(--chat-font-size, 13.5px);
    line-height: 1.7;
    color: var(--text);
    word-break: break-word;
  }

  .prose :global(p) {
    margin: 0 0 8px;
  }
  .prose :global(p:last-child) {
    margin-bottom: 0;
  }

  .prose :global(h1),
  .prose :global(h2),
  .prose :global(h3),
  .prose :global(h4) {
    margin: 16px 0 6px;
    font-weight: 600;
    color: var(--text);
    line-height: 1.3;
  }
  .prose :global(h1) { font-size: 18px; }
  .prose :global(h2) { font-size: 16px; }
  .prose :global(h3) { font-size: 14.5px; }
  .prose :global(h4) { font-size: 13.5px; }

  .prose :global(strong) {
    font-weight: 600;
    color: var(--text);
  }

  .prose :global(em) {
    font-style: italic;
  }

  .prose :global(code) {
    font-family: var(--font-mono);
    font-size: 12px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    padding: 1px 5px;
  }

  .prose :global(pre) {
    margin: 0;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--border-subtle);
    border-radius: 0 0 var(--radius-sm) var(--radius-sm);
    padding: 12px 16px;
    overflow-x: auto;
  }

  .prose :global(pre code) {
    background: none;
    border: none;
    padding: 0;
    font-size: 12px;
    line-height: 1.5;
  }

  /* Code block wrapper with language label + copy button */
  .prose :global(.code-block) {
    position: relative;
    margin: 8px 0;
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .prose :global(.code-lang) {
    display: block;
    padding: 4px 12px;
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 500;
    color: var(--text-tertiary);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--border-subtle);
    border-bottom: none;
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    text-transform: lowercase;
    letter-spacing: 0.5px;
  }

  /* When no lang label, restore full border-radius on pre */
  .prose :global(.code-block:not(:has(.code-lang)) pre) {
    border-radius: var(--radius-sm);
  }

  .prose :global(.copy-btn) {
    position: absolute;
    top: 4px;
    right: 6px;
    padding: 2px 8px;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    color: var(--text-tertiary);
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--border-subtle);
    border-radius: 4px;
    cursor: pointer;
    opacity: 0;
    transition: all 0.2s ease;
    z-index: 2;
  }

  .prose :global(.code-block:hover .copy-btn) {
    opacity: 1;
  }

  .prose :global(.copy-btn:hover) {
    color: var(--text-secondary);
    background: rgba(255, 255, 255, 0.1);
    border-color: var(--border);
  }

  .prose :global(.copy-btn.copied) {
    color: rgba(130, 220, 160, 0.9);
    border-color: rgba(130, 220, 160, 0.3);
    opacity: 1;
  }

  .prose :global(ul),
  .prose :global(ol) {
    margin: 6px 0;
    padding-left: 20px;
  }

  .prose :global(li) {
    margin: 3px 0;
  }

  .prose :global(blockquote) {
    margin: 8px 0;
    padding: 4px 12px;
    border-left: 3px solid var(--border);
    color: var(--text-secondary);
  }

  .prose :global(hr) {
    border: none;
    border-top: 1px solid var(--border-subtle);
    margin: 12px 0;
  }

  .prose :global(a) {
    color: rgba(140, 160, 255, 0.8);
    text-decoration: none;
  }
  .prose :global(a:hover) {
    text-decoration: underline;
  }

  .prose :global(table) {
    border-collapse: collapse;
    margin: 8px 0;
    font-size: 12.5px;
  }
  .prose :global(th),
  .prose :global(td) {
    border: 1px solid var(--border);
    padding: 6px 10px;
    text-align: left;
  }
  .prose :global(th) {
    background: rgba(255, 255, 255, 0.03);
    font-weight: 500;
  }

  /* ── Action bar (copy, fork) ── */
  .actions {
    display: flex;
    gap: 2px;
    margin-top: 4px;
    opacity: 0;
    transition: opacity 0.2s var(--ease-out-quart);
  }

  .message.assistant:hover .actions {
    opacity: 1;
  }

  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    background: none;
    color: var(--text-tertiary);
    cursor: pointer;
    border-radius: 6px;
    transition: all 0.15s var(--ease-out-quart);
  }

  .action-btn:hover {
    color: var(--text-secondary);
    background: var(--bg-glass-hover);
  }

  .action-btn.copied {
    color: rgba(130, 220, 160, 0.9);
  }

  .tools {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 4px 0;
  }

  .user-images {
    margin: 4px 0 6px;
  }

  .user-image {
    max-width: 320px;
    max-height: 240px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-subtle);
    object-fit: contain;
  }
</style>
