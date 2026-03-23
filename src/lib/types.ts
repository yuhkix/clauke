/** Types for Claude stream-json events and UI state */

export type ToolName =
  | "Read"
  | "Write"
  | "Edit"
  | "Bash"
  | "Glob"
  | "Grep"
  | "Agent"
  | "WebFetch"
  | "WebSearch"
  | string;

export interface ToolCall {
  id: string;
  name: ToolName;
  input: Record<string, unknown>;
  result?: string;
  isComplete: boolean;
  isError?: boolean;
  startTime: number;
  endTime?: number;
  /** For Agent tool calls: nested tool calls made by the sub-agent */
  children?: ToolCall[];
}

/** A content block — text, image, thinking, or a tool call, rendered in order */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "image"; path: string }
  | { type: "tool_call"; toolCall: ToolCall };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: ContentBlock[];
  timestamp: number;
}

export interface ClaudeEvent {
  type: string;
  tab_id?: string;
  [key: string]: unknown;
}

export type ClaudeModel = "sonnet" | "opus" | "haiku";
export type EffortLevel = "low" | "medium" | "high" | "max";
export type PermissionMode = "bypass" | "acceptEdits" | "plan" | "default";

export const PERMISSION_LABELS: Record<PermissionMode, string> = {
  bypass: "Bypass",
  acceptEdits: "Accept Edits",
  plan: "Plan",
  default: "Ask",
};

/** Tools allowed per permission mode (bypass allows everything via CLI flag) */
export const PERMISSION_TOOL_SETS: Record<string, string[]> = {
  acceptEdits: ["Read", "Write", "Edit", "Glob", "Grep", "Agent", "WebFetch", "WebSearch", "TodoWrite", "NotebookEdit", "Skill"],
  plan: ["Read", "Glob", "Grep", "WebFetch", "WebSearch", "Agent", "TodoWrite"],
  default: [],
};

/** All known Claude Code tools that can be individually allowed/denied */
export const ALL_TOOLS = [
  "Read", "Write", "Edit", "Bash", "Glob", "Grep",
  "Agent", "WebFetch", "WebSearch", "TodoWrite",
  "NotebookEdit", "Skill",
] as const;
export type KnownTool = typeof ALL_TOOLS[number];

export const MODEL_LABELS: Record<ClaudeModel, string> = {
  sonnet: "Sonnet",
  opus: "Opus",
  haiku: "Haiku",
};

/** Context window limits per model (in tokens) — all current Claude models use 200k */
export const MODEL_CONTEXT_LIMITS: Record<ClaudeModel, number> = {
  opus: 200_000,
  sonnet: 200_000,
  haiku: 200_000,
};

export const EFFORT_LABELS: Record<EffortLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  max: "Max",
};

/** Token usage stats for a single response or accumulated session */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
  };
}

/** Format token count for display (e.g., 1234 → "1.2k", 123456 → "123k") */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10000) return (n / 1000).toFixed(1) + "k";
  return Math.round(n / 1000) + "k";
}

export interface Tab {
  id: string;
  name: string;
  messages: ChatMessage[];
  isRunning: boolean;
  cwd: string;
  model: ClaudeModel;
  effort: EffortLevel;
  sessionId?: string;
  usage?: TokenUsage;
  /** Last input token count — approximates current context window fill level */
  contextTokens?: number;
  permissionMode: PermissionMode;
  /** Per-tab system prompt (overrides global default when set) */
  systemPrompt?: string;
}

/** A single task from Claude's TodoWrite tool */
export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

/** Extract the latest todo list from messages (last TodoWrite call wins) */
export function extractTodos(messages: ChatMessage[]): TodoItem[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    for (let j = msg.content.length - 1; j >= 0; j--) {
      const block = msg.content[j];
      if (block.type === "tool_call" && block.toolCall.name === "TodoWrite") {
        const input = block.toolCall.input;
        if (Array.isArray(input.todos)) {
          return input.todos as TodoItem[];
        }
      }
    }
  }
  return [];
}

/** Hook event types supported by Claude Code CLI */
export const HOOK_EVENTS = [
  "PreToolUse",
  "PostToolUse",
  "SessionStart",
  "SessionEnd",
  "Stop",
] as const;
export type HookEvent = typeof HOOK_EVENTS[number];

export const HOOK_EVENT_LABELS: Record<HookEvent, string> = {
  PreToolUse: "Before tool use",
  PostToolUse: "After tool use",
  SessionStart: "Session start",
  SessionEnd: "Session end",
  Stop: "On stop",
};

/** A single hook action */
export interface HookAction {
  type: "command";
  command: string;
}

/** A hook rule: matcher + list of actions */
export interface HookRule {
  matcher: string;
  hooks: HookAction[];
}

/** Full hook configuration (event → rules) */
export type HookConfig = Record<string, HookRule[]>;

/** MCP server configuration */
export interface McpServer {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** Archived session record for the session manager */
export interface SessionRecord {
  /** Unique archive ID */
  id: string;
  /** Claude CLI session ID (for --resume) */
  sessionId: string;
  /** Tab name / conversation title */
  name: string;
  /** Working directory */
  cwd: string;
  model: ClaudeModel;
  effort: EffortLevel;
  /** When the session was first created */
  createdAt: number;
  /** When the session was last active */
  lastActiveAt: number;
  /** Total message count */
  messageCount: number;
  /** Preview text (first user message) */
  preview: string;
  /** Stored messages (tool results truncated) */
  messages: ChatMessage[];
}

/** Max number of archived sessions to keep */
export const MAX_SESSION_HISTORY = 50;

/** Slash command definition */
export interface SlashCommand {
  name: string;
  description: string;
  /** "local" commands are handled by clauke, "cli" are sent as prompts, "custom" are user/plugin skills */
  kind: "local" | "cli" | "custom";
  /** Where this command comes from */
  source?: string;
}

/** Built-in commands that are always available (handled locally or by the CLI) */
export const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: "/clear", description: "Clear conversation", kind: "local" },
  { name: "/compact", description: "Compact conversation history", kind: "cli" },
  { name: "/config", description: "View/modify configuration", kind: "cli" },
  { name: "/cost", description: "Show token usage & cost", kind: "cli" },
  { name: "/doctor", description: "Run diagnostics", kind: "cli" },
  { name: "/help", description: "Get help with Claude Code", kind: "cli" },
  { name: "/init", description: "Initialize project with CLAUDE.md", kind: "cli" },
  { name: "/login", description: "Switch accounts or login", kind: "cli" },
  { name: "/memory", description: "View & edit Claude's memory", kind: "cli" },
  { name: "/mcp", description: "Manage MCP servers", kind: "cli" },
  { name: "/permissions", description: "View & manage permissions", kind: "cli" },
  { name: "/review", description: "Review code changes", kind: "cli" },
  { name: "/status", description: "Show session status", kind: "cli" },
  { name: "/terminal-setup", description: "Install shell integration", kind: "cli" },
  { name: "/vim", description: "Toggle vim keybindings", kind: "cli" },
  { name: "/bug", description: "Report a bug", kind: "cli" },
];

/** File stats tracked per session for the file tree */
export interface FileStats {
  path: string;
  added: number;
  removed: number;
  reads: number;
  writes: number;
}

/** Extract file stats from messages — tracks which files were touched and diff stats */
export function extractFileStats(messages: ChatMessage[]): Map<string, FileStats> {
  const stats = new Map<string, FileStats>();

  function getOrCreate(path: string): FileStats {
    let s = stats.get(path);
    if (!s) {
      s = { path, added: 0, removed: 0, reads: 0, writes: 0 };
      stats.set(path, s);
    }
    return s;
  }

  function countLines(text: unknown): number {
    if (typeof text !== "string" || !text) return 0;
    return text.split("\n").length;
  }

  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    for (const block of msg.content) {
      if (block.type !== "tool_call") continue;
      const tc = block.toolCall;
      const input = tc.input;
      const filePath = input.file_path as string | undefined;

      switch (tc.name) {
        case "Edit": {
          if (!filePath) break;
          const s = getOrCreate(filePath);
          const oldLines = countLines(input.old_string);
          const newLines = countLines(input.new_string);
          if (newLines > oldLines) s.added += newLines - oldLines;
          else if (oldLines > newLines) s.removed += oldLines - newLines;
          // Even if same line count, there were changes
          if (oldLines === newLines && oldLines > 0) { s.added += 1; s.removed += 1; }
          s.writes++;
          break;
        }
        case "Write": {
          if (!filePath) break;
          const s = getOrCreate(filePath);
          s.added += countLines(input.content);
          s.writes++;
          break;
        }
        case "Read": {
          if (!filePath) break;
          const s = getOrCreate(filePath);
          s.reads++;
          break;
        }
        case "Glob":
        case "Grep": {
          // Extract file paths from results
          if (tc.result) {
            const lines = tc.result.split("\n").filter(l => l.trim());
            for (const line of lines) {
              // Only consider lines that look like file paths
              if (line.match(/^[A-Za-z]?:?[\\/]/) || line.match(/^\.?\//)) {
                const p = line.trim();
                if (p && !stats.has(p)) {
                  // Just mark as referenced, don't increment reads
                  getOrCreate(p);
                }
              }
            }
          }
          break;
        }
      }
    }
  }

  return stats;
}

/** Build a tree node structure from flat file paths */
export interface TreeNode {
  name: string;
  fullPath: string;
  children: TreeNode[];
  stats?: FileStats;
  isDir: boolean;
  /** Aggregate stats for directories */
  totalAdded: number;
  totalRemoved: number;
}

export function buildFileTree(stats: Map<string, FileStats>, cwd: string): TreeNode[] {
  const root: Map<string, TreeNode> = new Map();

  // Normalize and relativize paths (case-insensitive for Windows)
  function relativize(path: string): string | null {
    const normalized = path.replace(/\\/g, "/");
    const normalizedCwd = cwd.replace(/\\/g, "/").replace(/\/$/, "");
    if (!normalizedCwd) return normalized;
    const normLower = normalized.toLowerCase();
    const cwdLower = normalizedCwd.toLowerCase();
    if (normLower.startsWith(cwdLower + "/")) {
      return normalized.slice(normalizedCwd.length + 1);
    }
    // File is outside CWD — skip it
    return null;
  }

  function ensureDir(parts: string[], tree: Map<string, TreeNode>): TreeNode {
    const name = parts[0];
    let node = tree.get(name);
    if (!node) {
      node = { name, fullPath: "", children: [], isDir: true, totalAdded: 0, totalRemoved: 0 };
      tree.set(name, node);
    }
    if (parts.length > 1) {
      const childMap = new Map(node.children.map(c => [c.name, c]));
      const child = ensureDir(parts.slice(1), childMap);
      node.children = Array.from(childMap.values());
      return child;
    }
    return node;
  }

  for (const [path, fileStat] of stats) {
    const rel = relativize(path);
    if (rel === null) continue; // Outside CWD — skip
    const parts = rel.split("/").filter(Boolean);
    if (parts.length === 0) continue;

    if (parts.length === 1) {
      const existing = root.get(parts[0]);
      if (existing) {
        existing.stats = fileStat;
        existing.fullPath = path;
      } else {
        root.set(parts[0], {
          name: parts[0],
          fullPath: path,
          children: [],
          stats: fileStat,
          isDir: false,
          totalAdded: 0,
          totalRemoved: 0,
        });
      }
    } else {
      const dirParts = parts.slice(0, -1);
      const fileName = parts[parts.length - 1];
      const dirNode = ensureDir(dirParts, root);
      const childMap = new Map(dirNode.children.map(c => [c.name, c]));
      childMap.set(fileName, {
        name: fileName,
        fullPath: path,
        children: [],
        stats: fileStat,
        isDir: false,
        totalAdded: 0,
        totalRemoved: 0,
      });
      dirNode.children = Array.from(childMap.values());
    }
  }

  // Aggregate stats up the tree
  function aggregate(node: TreeNode): { added: number; removed: number } {
    let added = node.stats?.added || 0;
    let removed = node.stats?.removed || 0;
    for (const child of node.children) {
      const childStats = aggregate(child);
      added += childStats.added;
      removed += childStats.removed;
    }
    node.totalAdded = added;
    node.totalRemoved = removed;
    return { added, removed };
  }

  const nodes = Array.from(root.values());
  for (const node of nodes) aggregate(node);

  // Sort: directories first, then alphabetically
  function sortTree(nodes: TreeNode[]): TreeNode[] {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) sortTree(n.children);
    return nodes;
  }

  return sortTree(nodes);
}

/** Tool icons (simple text-based) */
export const TOOL_ICONS: Record<string, string> = {
  Bash: "$",
  Read: "R",
  Edit: "E",
  Write: "W",
  Grep: "/",
  Glob: "*",
  Agent: "A",
  WebFetch: "~",
  WebSearch: "?",
};

export function getToolIcon(name: string): string {
  return TOOL_ICONS[name] || "#";
}
