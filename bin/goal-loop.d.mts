/**
 * Type declarations for bin/goal-loop.mjs. Zero runtime dependencies;
 * this file ships with the package so TypeScript consumers can type-check
 * imports of the CLI module.
 */
export const PLUGIN_PACKAGE: string;
export const PLUGIN_SPEC: string;

export interface ScopeResolution {
  scope: "global" | "project";
  dir: string;
  file: string;
}

export interface CliOptions {
  env?: { [key: string]: string | undefined };
  cwd?: string;
  homedir?: string;
  /** uninstall --self: the script to delete. Defaults to process.argv[1]; tests inject it. */
  selfPath?: string;
  /** Injectable fetch for update checks (tests pass a stub; production uses globalThis.fetch). */
  fetch?: (url: string, init?: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
  }) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;
  /** Wall-clock budget for one update check, in milliseconds. */
  timeoutMs?: number;
  /** Pre-resolved update preferences; skips reading the preferences file. */
  prefs?: UpdatePrefs;
}

export interface UpdatePrefs {
  channel: "main" | "dev";
  mode: "auto" | "off";
}

export interface LatestRef {
  channel: "main" | "dev";
  ref: string;
  label: string;
  spec: string;
  source: string;
  url: string;
}

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface OpencodeProbeResult {
  error?: Error & { code?: string } | null;
  status?: number | null;
  signal?: string | null;
  stdout?: string | Buffer;
}

export interface AddPluginResult {
  text: string;
  already: boolean;
}

export interface RemovePluginResult {
  text: string;
  removed: boolean;
  emptyRoot: boolean;
  skeletonRoot: boolean;
}

export function addPluginText(text: string, spec?: string): AddPluginResult;
export function removePluginText(text: string): RemovePluginResult;
export function resolveScope(args: string[], opts?: CliOptions): ScopeResolution;
export function install(args: string[], opts?: CliOptions): CliResult;
export function uninstall(args: string[], opts?: CliOptions): CliResult;
export function probeOpencodeVersion(v: OpencodeProbeResult): string;
export function status(args: string[], opts?: CliOptions): CliResult;
export function readUpdatePrefs(args: string[], opts?: CliOptions): UpdatePrefs;
export function writeUpdatePrefs(args: string[], opts?: CliOptions, prefs?: UpdatePrefs): { file: string; backup: string };
export function resolveLatestRef(channel: "main" | "dev", opts?: CliOptions): Promise<LatestRef>;
export function update(args: string[], opts?: CliOptions): Promise<CliResult>;
export function setChannel(args: string[], opts?: CliOptions): Promise<CliResult>;
export function setUpdates(args: string[], opts?: CliOptions): CliResult;
export function patchHost(args: string[], opts?: CliOptions): CliResult;
export function runCli(argv: string[], opts?: CliOptions): Promise<CliResult>;
