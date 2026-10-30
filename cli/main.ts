#!/usr/bin/env node
import { readFileSync } from "node:fs";

import pkg from "../package.json" with { type: "json" };
import { run } from "./run";

/** The file descriptor of standard input, which `-` stands for. */
const STDIN = 0;

process.exitCode = run(process.argv.slice(2), {
  read: (path) => readFileSync(path === "-" ? STDIN : path, "utf8"),
  out: (line) => {
    process.stdout.write(`${line}\n`);
  },
  err: (line) => {
    process.stderr.write(`${line}\n`);
  },
  version: pkg.version,
});
