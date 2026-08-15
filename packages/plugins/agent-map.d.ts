/**
 * Type declarations for `@zumer/snapdom-plugins/agent-map`.
 *
 * The plugin instance type comes from the core package: one definition of what a plugin IS,
 * so a plugin that stops matching the host's contract fails to typecheck instead of failing
 * at capture time.
 */
import type { SnapdomPlugin } from '@zumer/snapdom';

export interface AgentMapOptions {
  /** Image output; 'annotated' overlays numbered badges on interactive elements. */
  image?: 'annotated' | 'raw' | false;
  /** Per-entry shape. */
  fields?: 'minimal' | 'full';
  /** Also include non-interactive semantic elements. */
  semantic?: boolean;
  maxImageWidth?: number;
  imageFormat?: 'png' | 'jpg' | 'webp';
  imageQuality?: number;
  interactiveSelector?: string;
  semanticSelector?: string;
  labelStyle?: Record<string, string>;
  /** How far the capture runs. */
  needs?: 'clone' | 'render';
}

/**
 * Adds `result.toAgentMap()` for visual agents: an annotated screenshot plus a structured map
 * of the interactive elements and their bounding boxes. Published as `prompt-export` before v3.
 */
export declare function agentMap(options?: AgentMapOptions): SnapdomPlugin;
