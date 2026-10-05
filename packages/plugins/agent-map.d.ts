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
 * of the interactive elements and their bounding boxes. Published as `prompt-export` until 2.12.0 renamed it.
 */
export declare function agentMap(options?: AgentMapOptions): SnapdomPlugin;

export interface AgentMapEntry {
  i: number;
  n: string;
  r: string;
  b: [number, number, number, number];
  s?: Record<string, string | number | boolean>;
  t?: string;
  a?: Record<string, string>;
  isSemanticOnly?: true;
}
export interface AgentMapResult {
  image?: string;
  map: AgentMapEntry[];
  dimensions: { width: number; height: number };
}
export interface ToAgentMapOptions {
  image?: 'annotated' | 'raw' | false;
  imageFormat?: 'png' | 'jpg' | 'webp';
  imageQuality?: number;
  maxImageWidth?: number;
  width?: number;
  height?: number;
  scale?: number;
  dpr?: number;
  backgroundColor?: string;
}
declare module '@zumer/snapdom' {
  interface CaptureResult {
    toAgentMap(options?: ToAgentMapOptions): Promise<AgentMapResult>;
  }
}
