/**
 * Type declarations for bin/opencode-goal.mjs. Zero runtime dependencies;
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
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  homedir?: string;
}

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
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

export function addPluginText(text: string): AddPluginResult;
export function removePluginText(text: string): RemovePluginResult;
export function resolveScope(args: string[], opts?: CliOptions): ScopeResolution;
export function install(args: string[], opts?: CliOptions): CliResult;
export function uninstall(args: string[], opts?: CliOptions): CliResult;
export function status(args: string[], opts?: CliOptions): CliResult;
export function runCli(argv: string[], opts?: CliOptions): CliResult;
