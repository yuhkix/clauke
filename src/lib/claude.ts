/**
 * Claude event parser — transforms raw stream-json events into UI-friendly structures.
 *
 * Claude Code's stream-json format emits newline-delimited JSON.
 * This module normalizes different event shapes into a consistent format.
 */

import type { ChatMessage, ToolCall, ContentBlock, ClaudeEvent, TokenUsage } from "./types";

let idCounter = 0;
function nextId(): string {
  return `msg-${++idCounter}-${Date.now()}`;
}

/**
 * Per-tab stack of currently-running Agent tool call IDs.
 * Keyed by tab_id so that multi-tab usage doesn't cross-contaminate.
 * When an Agent tool_use starts, its ID is pushed onto the tab's stack.
 * When its tool_result arrives, the ID is popped.
 * Any tool calls created while the stack is non-empty are added
 * as children of the top-most Agent instead of as top-level content blocks.
 */
const agentStacks = new Map<string, string[]>();

function getAgentStack(tabId: string): string[] {
  let stack = agentStacks.get(tabId);
  if (!stack) {
    stack = [];
    agentStacks.set(tabId, stack);
  }
  return stack;
}

export interface EventResult {
  modified: boolean;
  sessionId?: string;
  usage?: TokenUsage;
  /** Last input tokens — approximates current context fill */
  contextTokens?: number;
  /** True when a context compaction was detected */
  compacted?: boolean;
}

/**
 * Process a raw Claude event and update the messages array in place.
 * Returns an EventResult with session_id and usage if present.
 */
export function processClaudeEvent(
  event: ClaudeEvent,
  messages: ChatMessage[],
  tabId?: string,
): EventResult {
  const type = event.type;
  const activeAgentStack = getAgentStack(tabId || (event.tab_id as string) || "default");

  // Debug: log every event so we can trace what the CLI actually sends
  console.debug("[clauke] event:", type, event);

  // Get or create the current assistant message
  function getAssistantMessage(): ChatMessage {
    const last = messages[messages.length - 1];
    if (last && last.role === "assistant") {
      return last;
    }
    const msg: ChatMessage = {
      id: nextId(),
      role: "assistant",
      content: [],
      timestamp: Date.now(),
    };
    messages.push(msg);
    return msg;
  }

  /** Get (or create) the last text block to append to */
  function getLastTextBlock(msg: ChatMessage): ContentBlock & { type: "text" } {
    const last = msg.content[msg.content.length - 1];
    if (last && last.type === "text") {
      return last;
    }
    const block: ContentBlock = { type: "text", text: "" };
    msg.content.push(block);
    return block as ContentBlock & { type: "text" };
  }

  /**
   * Add a tool call — either as a top-level content block or as a child
   * of the currently-active Agent (if one is running).
   */
  function addToolCall(msg: ChatMessage, tc: ToolCall): void {
    // If there's an active Agent and this isn't an Agent itself,
    // nest it as a child of the most recent active Agent.
    if (activeAgentStack.length > 0 && tc.name !== "Agent") {
      const parentId = activeAgentStack[activeAgentStack.length - 1];
      const parent = findToolCallGlobal(parentId);
      if (parent) {
        if (!parent.children) parent.children = [];
        parent.children.push(tc);
        return;
      }
    }
    msg.content.push({ type: "tool_call", toolCall: tc });
    // If this is an Agent tool, push onto the stack
    if (tc.name === "Agent") {
      activeAgentStack.push(tc.id);
    }
  }

  /** Find a tool call by ID across all content blocks (including agent children) */
  function findToolCall(msg: ChatMessage, id: string): ToolCall | undefined {
    for (const block of msg.content) {
      if (block.type === "tool_call") {
        if (block.toolCall.id === id) return block.toolCall;
        // Search inside agent children
        if (block.toolCall.children) {
          for (const child of block.toolCall.children) {
            if (child.id === id) return child;
          }
        }
      }
    }
    return undefined;
  }

  /** Find a tool call by ID across ALL messages (including agent children) */
  function findToolCallGlobal(id: string): ToolCall | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        const tc = findToolCall(messages[i], id);
        if (tc) return tc;
      }
    }
    return undefined;
  }

  /** Get the last (most recently started) tool call, including agent children */
  function getLastToolCall(msg: ChatMessage): ToolCall | undefined {
    for (let i = msg.content.length - 1; i >= 0; i--) {
      const block = msg.content[i];
      if (block.type === "tool_call") {
        // If this Agent has children, the last incomplete child is the most recent tool
        if (block.toolCall.children?.length) {
          const lastChild = block.toolCall.children[block.toolCall.children.length - 1];
          if (!lastChild.isComplete) return lastChild;
        }
        return block.toolCall;
      }
    }
    return undefined;
  }

  /**
   * Mark all incomplete tool calls in a message as complete.
   * Called when we see evidence that the tool has finished (new content starts,
   * or explicit tool_result).
   *
   * IMPORTANT: Agents on the activeAgentStack are SKIPPED — they're still
   * waiting for their tool_result and will have more children arriving.
   * Marking them complete here would break the UI (show "done" prematurely)
   * and leave the stack dirty.
   */
  function markPendingToolsComplete(msg: ChatMessage): void {
    for (const block of msg.content) {
      if (block.type === "tool_call" && !block.toolCall.isComplete) {
        // Don't mark Agents that are still on the active stack — they're running
        if (block.toolCall.name === "Agent" && activeAgentStack.includes(block.toolCall.id)) {
          // But DO mark their incomplete children (the previous child is done
          // if a new event is starting)
          if (block.toolCall.children) {
            for (const child of block.toolCall.children) {
              if (!child.isComplete) {
                child.isComplete = true;
                if (!child.endTime) child.endTime = Date.now();
              }
            }
          }
          continue;
        }
        block.toolCall.isComplete = true;
        if (!block.toolCall.endTime) block.toolCall.endTime = Date.now();
        // Also mark children and pop from agent stack
        if (block.toolCall.children) {
          for (const child of block.toolCall.children) {
            if (!child.isComplete) {
              child.isComplete = true;
              if (!child.endTime) child.endTime = Date.now();
            }
          }
        }
        if (block.toolCall.name === "Agent") {
          const idx = activeAgentStack.indexOf(block.toolCall.id);
          if (idx !== -1) activeAgentStack.splice(idx, 1);
        }
      }
    }
  }

  const MODIFIED: EventResult = { modified: true };
  const UNMODIFIED: EventResult = { modified: false };

  /** Process a tool result event (shared logic) */
  function handleToolResult(toolUseId: string, rawContent: unknown, isError?: boolean): EventResult {
    const msg = getAssistantMessage();
    let resultText = "";
    if (typeof rawContent === "string") {
      resultText = rawContent;
    } else if (Array.isArray(rawContent)) {
      resultText = (rawContent as Array<Record<string, unknown>>)
        .map((c) => (c.text as string) || JSON.stringify(c))
        .join("\n");
    } else if (rawContent && typeof rawContent === "object") {
      const obj = rawContent as Record<string, unknown>;
      resultText = (obj.text as string) || JSON.stringify(rawContent);
    }

    let tc: ToolCall | undefined;
    if (toolUseId) {
      tc = findToolCallGlobal(toolUseId);
    }
    if (!tc) {
      // Fallback: mark the last incomplete tool call
      const lastTc = getLastToolCall(msg);
      if (lastTc && !lastTc.isComplete) {
        tc = lastTc;
      }
    }

    if (tc) {
      tc.result = resultText;
      tc.isComplete = true;
      tc.isError = isError || false;
      tc.endTime = Date.now();
      // If this is an Agent completing, mark all its children as complete and pop from stack
      if (tc.name === "Agent") {
        if (tc.children) {
          for (const child of tc.children) {
            if (!child.isComplete) {
              child.isComplete = true;
              if (!child.endTime) child.endTime = Date.now();
            }
          }
        }
        const idx = activeAgentStack.indexOf(tc.id);
        if (idx !== -1) activeAgentStack.splice(idx, 1);
      }
    }
    return MODIFIED;
  }

  /** Extract usage data from an event */
  function extractUsage(ev: ClaudeEvent): TokenUsage | undefined {
    const usage = ev.usage as Record<string, unknown> | undefined;
    if (!usage) return undefined;
    const input = (usage.input_tokens as number) || 0;
    const output = (usage.output_tokens as number) || 0;
    if (input === 0 && output === 0) return undefined;
    return {
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: (usage.cache_read_input_tokens as number) || (usage.cache_read_tokens as number) || 0,
      cacheCreationTokens: (usage.cache_creation_input_tokens as number) || (usage.cache_creation_tokens as number) || 0,
    };
  }

  switch (type) {
    // System init or compact notification
    case "system": {
      // Detect auto-compact events from the CLI
      const subtype = event.subtype as string | undefined;
      if (subtype === "compact" || subtype === "auto_compact") {
        // Insert a system message showing compaction happened
        const sysMsg: ChatMessage = {
          id: nextId(),
          role: "system",
          content: [{ type: "text", text: "context compacted" }],
          timestamp: Date.now(),
        };
        messages.push(sysMsg);
        return { modified: true, compacted: true };
      }
      return UNMODIFIED;
    }

    // Assistant text content
    case "assistant": {
      const msg = getAssistantMessage();
      const message = event.message as Record<string, unknown> | undefined;
      if (!message) return UNMODIFIED;

      if (message.type === "text") {
        // New text block starting → any pending tool calls have finished
        markPendingToolsComplete(msg);
        getLastTextBlock(msg).text += (message.text as string) || "";
      } else if (message.type === "tool_use") {
        // New tool_use → any previously pending tool calls have finished
        markPendingToolsComplete(msg);
        const tc: ToolCall = {
          id: (message.id as string) || nextId(),
          name: (message.name as string) || "unknown",
          input: (message.input as Record<string, unknown>) || {},
          isComplete: false,
          startTime: Date.now(),
        };
        addToolCall(msg, tc);
      } else if (message.content) {
        // Full message format: {"role":"assistant","content":[...]}
        // Mark any pending tools from previous assistant turn
        markPendingToolsComplete(msg);
        const content = message.content as Array<Record<string, unknown>>;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text") {
              getLastTextBlock(msg).text += (block.text as string) || "";
            } else if (block.type === "tool_use") {
              const tc: ToolCall = {
                id: (block.id as string) || nextId(),
                name: (block.name as string) || "unknown",
                input: (block.input as Record<string, unknown>) || {},
                isComplete: false,
                startTime: Date.now(),
              };
              addToolCall(msg, tc);
            } else if (block.type === "tool_result") {
              // Tool result embedded in content array
              handleToolResult(
                block.tool_use_id as string,
                block.content,
                block.is_error as boolean | undefined,
              );
            }
          }
        }
      }
      return MODIFIED;
    }

    // Content block events (streaming API format)
    case "content_block_start": {
      const msg = getAssistantMessage();
      const block = event.content_block as Record<string, unknown> | undefined;
      if (block?.type === "tool_use") {
        // New tool starting → mark any previous pending tools as complete
        markPendingToolsComplete(msg);
        const tc: ToolCall = {
          id: (block.id as string) || nextId(),
          name: (block.name as string) || "unknown",
          input: {},
          isComplete: false,
          startTime: Date.now(),
        };
        addToolCall(msg, tc);
      } else if (block?.type === "text") {
        // Text block starting → any pending tool calls are done
        markPendingToolsComplete(msg);
      }
      return MODIFIED;
    }

    case "content_block_delta": {
      const msg = getAssistantMessage();
      const delta = event.delta as Record<string, unknown> | undefined;
      if (delta?.type === "text_delta") {
        // Text arriving after a tool_use → tool is done
        const lastTc = getLastToolCall(msg);
        if (lastTc && !lastTc.isComplete) {
          // Check if the last content block is NOT the tool call (i.e., text is appending elsewhere)
          const lastBlock = msg.content[msg.content.length - 1];
          if (!lastBlock || lastBlock.type !== "tool_call") {
            markPendingToolsComplete(msg);
          }
        }
        getLastTextBlock(msg).text += (delta.text as string) || "";
      } else if (delta?.type === "input_json_delta") {
        // Tool input streaming — append to last tool call's raw input
        const lastTc = getLastToolCall(msg);
        if (lastTc) {
          const partial = delta.partial_json as string;
          if (partial) {
            if (!lastTc.input.__raw) lastTc.input.__raw = "";
            lastTc.input.__raw += partial;
          }
        }
      }
      return MODIFIED;
    }

    case "content_block_stop": {
      const msg = getAssistantMessage();
      const lastTc = getLastToolCall(msg);
      if (lastTc?.input.__raw) {
        try {
          const parsed = JSON.parse(lastTc.input.__raw as string);
          Object.assign(lastTc.input, parsed);
        } catch {
          // Keep raw if parse fails
        }
        delete lastTc.input.__raw;
      }
      return MODIFIED;
    }

    // Tool result — explicit type
    case "tool_result":
    case "tool": {
      return handleToolResult(
        (event.tool_use_id as string) || (event.id as string),
        event.content ?? event.output,
        event.is_error as boolean | undefined,
      );
    }

    // Result event — can be either tool_result or final completion
    case "result": {
      const subtype = event.subtype as string | undefined;

      // Tool result disguised as "result" event — match broadly
      if (
        subtype === "tool_result" ||
        subtype === "tool_use_result" ||
        event.tool_use_id
      ) {
        return handleToolResult(
          event.tool_use_id as string,
          event.content ?? event.output,
          event.is_error as boolean | undefined,
        );
      }

      // Final completion — turn is over, all agents must be done
      const msg = getAssistantMessage();
      const resultText =
        (event.result as string) || (event.text as string) || "";
      const hasText = msg.content.some(
        (b) => b.type === "text" && b.text.trim(),
      );
      if (resultText && !hasText) {
        getLastTextBlock(msg).text = resultText;
      }
      // Clear agent stack — the turn is finished, nothing is still running
      activeAgentStack.length = 0;
      // Mark any remaining incomplete tool calls (and their children) as done
      for (const block of msg.content) {
        if (block.type === "tool_call" && !block.toolCall.isComplete) {
          block.toolCall.isComplete = true;
          if (!block.toolCall.endTime) block.toolCall.endTime = Date.now();
        }
        if (block.type === "tool_call" && block.toolCall.children) {
          for (const child of block.toolCall.children) {
            if (!child.isComplete) {
              child.isComplete = true;
              if (!child.endTime) child.endTime = Date.now();
            }
          }
        }
      }
      // Extract session_id and usage for conversation continuation
      const sessionId = event.session_id as string | undefined;
      const usage = extractUsage(event);
      const contextTokens = usage?.inputTokens;
      return { modified: true, sessionId, usage, contextTokens };
    }

    // Error
    case "error": {
      const msg = getAssistantMessage();
      const errObj = event.error as Record<string, unknown> | undefined;
      const errorText =
        (event.text as string) ||
        (errObj?.message as string) ||
        (typeof event.message === "string" ? event.message : null) ||
        "Unknown error";
      getLastTextBlock(msg).text += `\n\n**Error:** ${errorText}`;
      return MODIFIED;
    }

    // Raw text (non-JSON output)
    case "raw": {
      const msg = getAssistantMessage();
      getLastTextBlock(msg).text += (event.text as string) || "";
      return MODIFIED;
    }

    default:
      console.debug("[clauke] unhandled event type:", type, event);
      return UNMODIFIED;
  }
}
