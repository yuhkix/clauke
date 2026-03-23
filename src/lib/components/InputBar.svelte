<script lang="ts">
  import { convertFileSrc, invoke } from "@tauri-apps/api/core";
  import type { ClaudeModel, EffortLevel, PermissionMode, SlashCommand } from "../types";
  import { MODEL_LABELS, EFFORT_LABELS, PERMISSION_LABELS, BUILTIN_COMMANDS } from "../types";

  let {
    onSend,
    onSteer,
    onStop,
    onCommand,
    isRunning,
    canSteer = false,
    commands = BUILTIN_COMMANDS,
    model = $bindable<ClaudeModel>("sonnet"),
    effort = $bindable<EffortLevel>("high"),
    permissionMode = $bindable<PermissionMode>("bypass"),
    hasSystemPrompt = false,
    onToggleSystemPrompt,
    prefill = "",
    onPrefillConsumed,
  }: {
    onSend: (prompt: string, images: string[]) => void;
    onSteer: (message: string) => void;
    onStop: () => void;
    onCommand: (cmd: SlashCommand) => void;
    isRunning: boolean;
    /** Whether steering (follow-up messages) is available (interactive mode only) */
    canSteer?: boolean;
    commands?: SlashCommand[];
    model: ClaudeModel;
    effort: EffortLevel;
    permissionMode: PermissionMode;
    hasSystemPrompt?: boolean;
    onToggleSystemPrompt?: () => void;
    /** Pre-fill the input with this text (e.g., from edit & resend) */
    prefill?: string;
    onPrefillConsumed?: () => void;
  } = $props();

  let input = $state("");
  let textarea: HTMLTextAreaElement;

  // Consume prefill from parent (edit & resend)
  $effect(() => {
    if (prefill) {
      input = prefill;
      if (onPrefillConsumed) onPrefillConsumed();
      requestAnimationFrame(() => {
        autoResize();
        textarea?.focus();
      });
    }
  });
  let modelOpen = $state(false);
  let effortOpen = $state(false);
  let permOpen = $state(false);
  let attachedImages = $state<string[]>([]);
  let fileInput: HTMLInputElement;

  // Slash command state
  let showCommands = $state(false);
  let selectedCommandIdx = $state(0);
  let commandMenuEl = $state<HTMLDivElement>();

  const models: ClaudeModel[] = ["opus", "sonnet", "haiku"];
  const efforts: EffortLevel[] = ["low", "medium", "high", "max"];
  const permModes: PermissionMode[] = ["bypass", "acceptEdits", "plan", "default"];

  // Extract the slash-command word at the cursor position
  function getSlashQuery(): string | null {
    if (!textarea) return input.startsWith("/") ? input : null;
    const pos = textarea.selectionStart;
    const textBeforeCursor = input.slice(0, pos);
    // Find the last "/" that starts a word (preceded by space or at start)
    const match = textBeforeCursor.match(/(\/\S*)$/);
    return match ? match[1] : null;
  }

  // Filter commands based on the slash word at cursor
  let filteredCommands = $derived.by(() => {
    if (!showCommands) return [];
    const query = slashQuery;
    if (!query) return [];
    if (query === "/") return commands;
    const q = query.toLowerCase();
    return commands.filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q),
    );
  });

  let slashQuery = $state<string | null>(null);

  function handleKeydown(e: KeyboardEvent) {
    const cmds = filteredCommands;

    if (showCommands && cmds.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        selectedCommandIdx = (selectedCommandIdx + 1) % cmds.length;
        scrollSelectedIntoView();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        selectedCommandIdx =
          (selectedCommandIdx - 1 + cmds.length) % cmds.length;
        scrollSelectedIntoView();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        selectCommand(cmds[selectedCommandIdx]);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        // Tab-complete the command name, replacing the /query portion
        const cmd = cmds[selectedCommandIdx];
        if (textarea && slashQuery) {
          const pos = textarea.selectionStart;
          const before = input.slice(0, pos - slashQuery.length);
          const after = input.slice(pos);
          input = before + cmd.name + " " + after;
          const newPos = before.length + cmd.name.length + 1;
          requestAnimationFrame(() => textarea.setSelectionRange(newPos, newPos));
        } else {
          input = cmd.name + " ";
        }
        showCommands = false;
        slashQuery = null;
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        showCommands = false;
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function scrollSelectedIntoView() {
    requestAnimationFrame(() => {
      if (!commandMenuEl) return;
      const items = commandMenuEl.querySelectorAll(".cmd-item");
      const item = items[selectedCommandIdx] as HTMLElement;
      if (item) {
        item.scrollIntoView({ block: "nearest" });
      }
    });
  }

  function selectCommand(cmd: SlashCommand) {
    showCommands = false;
    input = "";
    slashQuery = null;
    if (textarea) textarea.style.height = "auto";
    onCommand(cmd);
  }

  function send() {
    const text = input.trim();
    if (!text && attachedImages.length === 0) return;

    if (isRunning) {
      // Steering: only available in interactive mode
      if (!canSteer) return;
      if (text) {
        onSteer(text);
        input = "";
        showCommands = false;
        if (textarea) textarea.style.height = "auto";
      }
      return;
    }

    onSend(text, [...attachedImages]);
    input = "";
    attachedImages = [];
    showCommands = false;
    if (textarea) textarea.style.height = "auto";
  }

  function handleAttachClick() {
    fileInput?.click();
  }

  function handleFileSelect(e: Event) {
    const target = e.target as HTMLInputElement;
    if (!target.files) return;
    for (const file of target.files) {
      // webkitRelativePath won't work, use path from File if available
      const path = (file as any).path as string | undefined;
      if (path) {
        attachedImages = [...attachedImages, path];
      }
    }
    // Reset so same file can be re-selected
    target.value = "";
  }

  function removeImage(idx: number) {
    attachedImages = attachedImages.filter((_, i) => i !== idx);
  }

  async function handlePaste(e: ClipboardEvent) {
    if (!e.clipboardData || isRunning) return;
    const items = e.clipboardData.items;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (!blob) continue;
        const arrayBuffer = await blob.arrayBuffer();
        const data = Array.from(new Uint8Array(arrayBuffer));
        const path = await invoke<string>("save_clipboard_image", {
          data,
          mime: item.type,
        });
        attachedImages = [...attachedImages, path];
      }
    }
  }

  function handleInput() {
    autoResize();
    // Show command menu when typing a /word anywhere in input
    slashQuery = getSlashQuery();
    if (slashQuery && !isRunning) {
      showCommands = true;
      selectedCommandIdx = 0;
    } else {
      showCommands = false;
    }
  }

  function autoResize() {
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + "px";
  }

  function selectModel(m: ClaudeModel) {
    model = m;
    modelOpen = false;
  }

  function selectEffort(e: EffortLevel) {
    effort = e;
    effortOpen = false;
  }

  function selectPermMode(p: PermissionMode) {
    permissionMode = p;
    permOpen = false;
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest(".dropdown")) {
      modelOpen = false;
      effortOpen = false;
      permOpen = false;
    }
    if (!target.closest(".island-inner")) {
      showCommands = false;
    }
  }

  // ── Drag & drop ──
  let dragOver = $state(false);

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    if (isRunning) return;
    dragOver = true;
  }

  function handleDragLeave() {
    dragOver = false;
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    if (isRunning || !e.dataTransfer) return;

    for (const file of e.dataTransfer.files) {
      if (file.type.startsWith("image/")) {
        const path = (file as any).path as string | undefined;
        if (path) {
          attachedImages = [...attachedImages, path];
        }
      }
    }
  }
</script>

<svelte:window onclick={handleClickOutside} />

<div
  class="island"
  class:drag-over={dragOver}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
>
  <div class="island-inner">
    <!-- Slash command menu -->
    {#if showCommands && filteredCommands.length > 0}
      <div class="cmd-menu" bind:this={commandMenuEl}>
        {#each filteredCommands as cmd, i}
          <button
            class="cmd-item"
            class:selected={i === selectedCommandIdx}
            onmouseenter={() => (selectedCommandIdx = i)}
            onclick={(e) => {
              e.stopPropagation();
              selectCommand(cmd);
            }}
          >
            <span class="cmd-name">{cmd.name}</span>
            <span class="cmd-desc">{cmd.description}</span>
            {#if cmd.source}
              <span class="cmd-source">{cmd.source}</span>
            {/if}
          </button>
        {/each}
      </div>
    {/if}

    <!-- Hidden file input for image selection -->
    <input
      bind:this={fileInput}
      type="file"
      accept="image/*"
      multiple
      style="display:none"
      onchange={handleFileSelect}
    />

    <!-- Image previews -->
    {#if attachedImages.length > 0}
      <div class="image-previews">
        {#each attachedImages as img, i}
          <div class="image-preview">
            <img src={convertFileSrc(img)} alt="attached" />
            <button class="image-remove" onclick={() => removeImage(i)} title="Remove">
              <svg width="10" height="10" viewBox="0 0 10 10">
                <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" stroke-width="1.5" />
                <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" stroke-width="1.5" />
              </svg>
            </button>
            <span class="image-name">{img.split(/[\\/]/).pop()}</span>
          </div>
        {/each}
      </div>
    {/if}

    <textarea
      bind:this={textarea}
      bind:value={input}
      class="input"
      class:steering={isRunning && canSteer}
      placeholder={isRunning ? (canSteer ? "steer claude\u2026" : "running\u2026") : "message"}
      disabled={isRunning && !canSteer}
      rows="1"
      onkeydown={handleKeydown}
      oninput={handleInput}
      onpaste={handlePaste}
    ></textarea>

    <div class="controls">
      <div class="controls-left">
        <!-- Attach image -->
        <button
          class="chip"
          onclick={handleAttachClick}
          disabled={isRunning}
          title="Attach image"
        >
          <svg class="chip-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>

        <!-- System prompt toggle -->
        {#if onToggleSystemPrompt}
          <button
            class="chip"
            class:chip-active={hasSystemPrompt}
            onclick={onToggleSystemPrompt}
            title="System prompt"
          >
            <svg class="chip-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </button>
        {/if}

        <span class="separator"></span>

        <!-- Model selector -->
        <div class="dropdown">
          <button
            class="chip"
            onclick={(e: MouseEvent) => {
              e.stopPropagation();
              modelOpen = !modelOpen;
              effortOpen = false;
            }}
          >
            <svg
              class="chip-icon"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path
                d="M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z"
              />
            </svg>
            <span>{MODEL_LABELS[model]}</span>
            <svg
              class="chevron"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"><path d="M6 9l6 6 6-6" /></svg
            >
          </button>
          {#if modelOpen}
            <div class="dropdown-menu">
              {#each models as m}
                <button
                  class="dropdown-item"
                  class:active={m === model}
                  onclick={(e: MouseEvent) => {
                    e.stopPropagation();
                    selectModel(m);
                  }}
                >
                  {MODEL_LABELS[m]}
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <span class="separator"></span>

        <!-- Effort selector -->
        <div class="dropdown">
          <button
            class="chip"
            onclick={(e: MouseEvent) => {
              e.stopPropagation();
              effortOpen = !effortOpen;
              modelOpen = false;
            }}
          >
            <span>{EFFORT_LABELS[effort]}</span>
            <svg
              class="chevron"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"><path d="M6 9l6 6 6-6" /></svg
            >
          </button>
          {#if effortOpen}
            <div class="dropdown-menu">
              {#each efforts as e}
                <button
                  class="dropdown-item"
                  class:active={e === effort}
                  onclick={(ev: MouseEvent) => {
                    ev.stopPropagation();
                    selectEffort(e);
                  }}
                >
                  {EFFORT_LABELS[e]}
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <span class="separator"></span>

        <!-- Permission mode selector -->
        <div class="dropdown">
          <button
            class="chip"
            class:chip-plan={permissionMode === "plan"}
            onclick={(e: MouseEvent) => {
              e.stopPropagation();
              permOpen = !permOpen;
              modelOpen = false;
              effortOpen = false;
            }}
          >
            {#if permissionMode === "bypass"}
              <svg class="chip-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            {:else if permissionMode === "plan"}
              <svg class="chip-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
              </svg>
            {:else}
              <svg class="chip-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            {/if}
            <span>{PERMISSION_LABELS[permissionMode]}</span>
            <svg
              class="chevron"
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"><path d="M6 9l6 6 6-6" /></svg
            >
          </button>
          {#if permOpen}
            <div class="dropdown-menu">
              {#each permModes as p}
                <button
                  class="dropdown-item"
                  class:active={p === permissionMode}
                  onclick={(ev: MouseEvent) => {
                    ev.stopPropagation();
                    selectPermMode(p);
                  }}
                >
                  {PERMISSION_LABELS[p]}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      <div class="controls-right">
        {#if isRunning && canSteer}
          <button
            class="btn-action btn-steer"
            onclick={send}
            disabled={!input.trim()}
            title="Steer"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        {/if}

        <!-- Send / Stop morph button -->
        <button
          class="btn-action btn-morph"
          class:is-stop={isRunning}
          onclick={isRunning ? onStop : send}
          disabled={!isRunning && !input.trim() && attachedImages.length === 0}
          title={isRunning ? "Stop" : "Send"}
        >
          <div class="morph-icon-wrap">
            <svg
              class="morph-icon icon-send"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
            <svg
              class="morph-icon icon-stop"
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="currentColor"
            >
              <rect x="2" y="2" width="8" height="8" rx="1.5" />
            </svg>
          </div>
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .island {
    padding: 12px 20px 16px;
  }

  .island.drag-over .island-inner {
    border-color: rgba(167, 139, 250, 0.4);
    box-shadow:
      0 4px 24px rgba(0, 0, 0, 0.3),
      0 0 0 2px rgba(167, 139, 250, 0.15);
  }

  .island-inner {
    position: relative;
    max-width: 860px;
    margin: 0 auto;
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: 20px;
    padding: 14px 16px 10px;
    transition: all 0.3s var(--ease-out-expo);
    box-shadow:
      0 4px 24px rgba(0, 0, 0, 0.3),
      0 0 0 1px rgba(255, 255, 255, 0.03);
  }

  .island-inner:focus-within {
    border-color: var(--border-focus);
    box-shadow:
      0 4px 32px rgba(0, 0, 0, 0.4),
      0 0 0 1px rgba(255, 255, 255, 0.06);
    transform: translateY(-1px);
  }

  .input {
    width: 100%;
    background: none;
    border: none;
    outline: none;
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 14px;
    line-height: 1.5;
    resize: none;
    min-height: 24px;
    max-height: 200px;
    padding: 0 2px;
  }

  .input::placeholder {
    color: var(--text-tertiary);
  }

  .input.steering {
    opacity: 0.7;
  }

  .input.steering::placeholder {
    color: var(--accent, #a78bfa);
    opacity: 0.5;
  }

  .input:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .input:disabled::placeholder {
    color: var(--text-tertiary);
    opacity: 0.6;
  }

  /* ── Slash command menu ── */
  .cmd-menu {
    position: absolute;
    bottom: 100%;
    left: 0;
    right: 0;
    margin-bottom: 6px;
    max-height: 280px;
    overflow-y: auto;
    background: rgba(30, 30, 34, 0.72);
    backdrop-filter: blur(40px) saturate(1.3);
    -webkit-backdrop-filter: blur(40px) saturate(1.3);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    padding: 4px;
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.4);
    animation: cmdMenuIn 0.2s var(--ease-out-expo);
    z-index: 200;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.08) transparent;
  }

  .cmd-menu::-webkit-scrollbar {
    width: 5px;
  }
  .cmd-menu::-webkit-scrollbar-track {
    background: transparent;
  }
  .cmd-menu::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
  }

  @keyframes cmdMenuIn {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .cmd-item {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 9px 14px;
    background: none;
    border: none;
    border-radius: 10px;
    cursor: pointer;
    text-align: left;
    transition: background 0.1s ease;
  }

  .cmd-item:hover,
  .cmd-item.selected {
    background: rgba(255, 255, 255, 0.06);
  }

  .cmd-name {
    font-family: var(--font-mono);
    font-size: 13px;
    font-weight: 500;
    color: var(--text);
    white-space: nowrap;
    min-width: 110px;
  }

  .cmd-desc {
    font-family: var(--font-sans);
    font-size: 12px;
    color: var(--text-tertiary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }

  .cmd-source {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-tertiary);
    opacity: 0.5;
    padding: 1px 6px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.04);
    white-space: nowrap;
    flex-shrink: 0;
  }

  /* ── Controls ── */
  .controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 8px;
    padding-top: 2px;
  }

  .controls-left {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .controls-right {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .separator {
    width: 1px;
    height: 14px;
    background: var(--border);
    margin: 0 6px;
  }

  /* Chip buttons */
  .chip {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 8px;
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 450;
    color: var(--text-secondary);
    background: none;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s var(--ease-out-quart);
    white-space: nowrap;
  }

  .chip:hover {
    color: var(--text);
    background: rgba(255, 255, 255, 0.06);
  }

  .chip-icon {
    opacity: 0.5;
  }

  .chip-active {
    color: rgba(167, 139, 250, 0.8);
  }
  .chip-active .chip-icon {
    opacity: 0.8;
  }

  .chip-plan {
    color: rgba(251, 191, 36, 0.8);
  }
  .chip-plan .chip-icon {
    opacity: 0.8;
  }

  .chevron {
    opacity: 0.35;
    margin-left: -1px;
  }

  /* Dropdown */
  .dropdown {
    position: relative;
  }

  .dropdown-menu {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    background: rgba(30, 30, 34, 0.72);
    backdrop-filter: blur(40px) saturate(1.3);
    -webkit-backdrop-filter: blur(40px) saturate(1.3);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    padding: 4px;
    min-width: 120px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
    animation: dropdownIn 0.25s var(--ease-out-expo);
    transform-origin: bottom left;
    z-index: 100;
  }

  @keyframes dropdownIn {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .dropdown-item {
    display: block;
    width: 100%;
    padding: 7px 12px;
    font-family: var(--font-sans);
    font-size: 12.5px;
    font-weight: 400;
    color: var(--text-secondary);
    background: none;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
    transition: all 0.15s var(--ease-out-quart);
  }

  .dropdown-item:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text);
  }

  .dropdown-item.active {
    color: var(--text);
    background: rgba(255, 255, 255, 0.04);
  }

  /* Action buttons */
  .btn-action {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    border: none;
    cursor: pointer;
    flex-shrink: 0;
    transition: all 0.2s var(--ease-out-quart);
  }

  .btn-action:hover {
    transform: scale(1.08);
  }

  .btn-action:active {
    transform: scale(0.95);
  }

  /* ── Morph button (send ↔ stop) ── */
  .btn-morph {
    background: rgba(255, 255, 255, 0.1);
    color: var(--text-secondary);
    transition:
      background 0.4s cubic-bezier(0.16, 1, 0.3, 1),
      color 0.4s cubic-bezier(0.16, 1, 0.3, 1),
      border-radius 0.5s cubic-bezier(0.16, 1, 0.3, 1),
      transform 0.2s var(--ease-out-quart);
  }
  .btn-morph:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.18);
    color: var(--text);
  }
  .btn-morph:disabled {
    opacity: 0.15;
    cursor: default;
  }
  .btn-morph.is-stop {
    background: rgba(239, 68, 68, 0.18);
    color: rgba(248, 113, 113, 0.9);
    border-radius: 8px;
  }
  .btn-morph.is-stop:hover {
    background: rgba(239, 68, 68, 0.35);
    color: #fca5a5;
  }

  .morph-icon-wrap {
    position: relative;
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .morph-icon {
    position: absolute;
    transition:
      opacity 0.35s cubic-bezier(0.16, 1, 0.3, 1),
      transform 0.35s cubic-bezier(0.16, 1, 0.3, 1);
  }

  .icon-send {
    opacity: 1;
    transform: scale(1) rotate(0deg);
  }
  .icon-stop {
    opacity: 0;
    transform: scale(0.3) rotate(90deg);
  }

  .is-stop .icon-send {
    opacity: 0;
    transform: scale(0.3) rotate(-90deg);
  }
  .is-stop .icon-stop {
    opacity: 1;
    transform: scale(1) rotate(0deg);
  }

  /* ── Steer button (hard expo curve) ── */
  .btn-steer {
    background: rgba(167, 139, 250, 0.12);
    color: rgba(167, 139, 250, 0.8);
    /* Hard expo ease: fast attack, slow settle */
    transition:
      background 0.2s var(--ease-out-quart),
      color 0.2s var(--ease-out-quart),
      transform 0.2s var(--ease-out-quart);
    animation: steerIn 0.4s cubic-bezier(0.0, 0.9, 0.1, 1.0) both;
  }
  .btn-steer:hover:not(:disabled) {
    background: rgba(167, 139, 250, 0.25);
    color: rgba(167, 139, 250, 1);
  }
  .btn-steer:disabled {
    opacity: 0.2;
    cursor: default;
  }

  @keyframes steerIn {
    0% {
      opacity: 0;
      transform: scale(0) translateY(8px);
    }
    /* Hard expo: 60% of the motion done by 15% of the time */
    15% {
      opacity: 0.9;
      transform: scale(1.15) translateY(-1px);
    }
    40% {
      transform: scale(0.95) translateY(0);
    }
    100% {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  /* ── Image previews ── */
  .image-previews {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }

  .image-preview {
    position: relative;
    width: 64px;
    height: 64px;
    border-radius: 10px;
    overflow: hidden;
    border: 1px solid var(--border-subtle);
    background: rgba(0, 0, 0, 0.3);
  }

  .image-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .image-preview .image-name {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    font-size: 8px;
    padding: 2px 4px;
    background: rgba(0, 0, 0, 0.7);
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .image-remove {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: none;
    background: rgba(0, 0, 0, 0.7);
    color: var(--text-secondary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  .image-preview:hover .image-remove {
    opacity: 1;
  }

  .image-remove:hover {
    background: rgba(220, 60, 60, 0.8);
    color: #fff;
  }
</style>
