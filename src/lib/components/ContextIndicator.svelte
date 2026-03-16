<script lang="ts">
  /** Context Window Indicator — glowing arc that shows how full the context is */
  import type { ClaudeModel } from "../types";

  const CONTEXT_LIMITS: Record<ClaudeModel, number> = {
    opus: 1_000_000,
    sonnet: 200_000,
    haiku: 200_000,
  };

  let { tokens = 0, model = "opus" as ClaudeModel }: { tokens: number; model?: ClaudeModel } = $props();

  let maxContext = $derived(CONTEXT_LIMITS[model] || 200_000);
  let fill = $derived(Math.min(tokens / maxContext, 1));
  let pct = $derived(Math.round(fill * 100));

  // Color stages: neutral → warm → hot
  let color = $derived.by(() => {
    if (fill < 0.4) return "rgba(255, 255, 255, 0.35)";
    if (fill < 0.65) return `hsl(45, 70%, 55%)`;  // warm amber
    if (fill < 0.85) return `hsl(25, 80%, 55%)`;   // orange
    return `hsl(5, 80%, 55%)`;                      // red
  });

  let glowIntensity = $derived(fill > 0.8 ? (fill - 0.8) * 5 : 0);
  let showLabel = $state(false);
</script>

{#if tokens > 0}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="context-indicator"
    onmouseenter={() => (showLabel = true)}
    onmouseleave={() => (showLabel = false)}
  >
    <div class="track">
      <div
        class="fill"
        class:pulse={fill > 0.85}
        style:width="{Math.max(fill * 100, 0.5)}%"
        style:background={color}
        style:box-shadow={glowIntensity > 0
          ? `0 0 ${8 + glowIntensity * 12}px ${color}`
          : 'none'}
      ></div>
    </div>
    {#if showLabel}
      <div class="tooltip">
        <span class="tooltip-pct">{pct}%</span>
        <span class="tooltip-detail">{Math.round(tokens / 1000)}k / {maxContext / 1000}k</span>
      </div>
    {/if}
  </div>
{/if}

<style>
  .context-indicator {
    position: relative;
    padding: 0 16px;
  }

  .track {
    height: 2px;
    border-radius: 1px;
    background: rgba(255, 255, 255, 0.04);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    border-radius: 1px;
    transition: width 0.8s cubic-bezier(0.16, 1, 0.3, 1),
                background 0.6s ease,
                box-shadow 0.6s ease;
  }

  .fill.pulse {
    animation: contextPulse 2s ease-in-out infinite;
  }

  @keyframes contextPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }

  .tooltip {
    position: absolute;
    bottom: 8px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    background: var(--bg-glass);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    white-space: nowrap;
    pointer-events: none;
    animation: tooltipIn 0.15s var(--ease-out-expo) forwards;
    z-index: 10;
  }

  @keyframes tooltipIn {
    from { opacity: 0; transform: translateX(-50%) translateY(4px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }

  .tooltip-pct {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .tooltip-detail {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-tertiary);
    font-variant-numeric: tabular-nums;
  }

  :global([data-theme="light"]) .track {
    background: rgba(0, 0, 0, 0.06);
  }

  :global([data-theme="light"]) .tooltip {
    background: rgba(240, 240, 245, 0.92);
  }
</style>
