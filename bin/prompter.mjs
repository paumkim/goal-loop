#!/usr/bin/env bun
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import path from "node:path"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const cli = path.join(root, "src", "prompter", "cli.ts")
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { stdio: "inherit" })
process.exit(result.status ?? 1)
