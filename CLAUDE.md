# clauke

Claude Code Wrapper — a beautiful cloak around Claude Code CLI.

## What this is

A lightweight Tauri 2 desktop app that wraps the `claude` CLI. It does NOT reimplement
any Claude functionality — it simply spawns `claude --output-format stream-json`
(with configurable permission mode) and renders the streaming JSON events in a nice UI.

## Tech Stack

- **Tauri 2** — native desktop shell, uses system webview (low memory)
- **Rust** backend — spawns `claude` CLI, pipes stream-json to frontend
- **Svelte 5** frontend — renders events as chat UI with tool call cards
- **No bundled Chromium** — uses Windows WebView2

## Project Structure

```
src/                    # Svelte frontend
  App.svelte            # Main app layout (tabs + chat + input + sidebars)
  app.css               # Global styles (midnight/cloak theme, light/dark)
  lib/
    types.ts            # TypeScript types, constants, utility functions
    claude.ts           # Event parser (stream-json → UI state, agent tracking)
    components/
      ChatView.svelte       # Scrollable message list with auto-scroll
      MessageBubble.svelte  # Single message (user/assistant) with markdown
      ToolCallCard.svelte   # Expandable tool call display with diff view
      InputBar.svelte       # Prompt input, model/effort/permission selectors
      TabBar.svelte         # Tab strip with new/close/switch
      SettingsPanel.svelte  # Settings: theme, MCP servers, hooks, permissions
      SessionManager.svelte # Archived session browser with search
      TodoPanel.svelte      # Task tracking panel (TodoWrite integration)
      FileTree.svelte       # File tree sidebar with diff stats
      AgentPanel.svelte     # Sub-agent sidebar with live activity tracking
      DiffView.svelte       # Unified diff renderer (LCS algorithm)
      ContextIndicator.svelte # Context window fill indicator
src-tauri/              # Rust backend
  src/
    main.rs             # Entry point
    lib.rs              # Tauri commands (send_prompt, stop, steer, settings)
    claude.rs           # Claude CLI process management
```

## Running

```bash
npm install
npm run tauri dev
```

## Architecture

1. User types prompt in InputBar (supports images, slash commands, model/effort selection)
2. Frontend calls Rust `send_prompt` command via Tauri IPC
3. Rust spawns `claude -p "prompt" --output-format stream-json [--model X] [--resume Y]`
4. Each JSON line from stdout is emitted as a `claude-event` Tauri event
5. Frontend's `processClaudeEvent()` parses events into reactive message state
6. Tool calls render as collapsible cards; Agent tool calls track nested sub-agent activity
7. Multi-tab sessions persist to localStorage; closed tabs are archived

## Conventions

- Svelte 5 runes syntax ($state, $derived, $props, $effect)
- Dark "midnight cloak" theme — deep purples and violets
- Minimal dependencies — no unnecessary libraries
- All Claude interaction goes through the CLI, never direct API calls
