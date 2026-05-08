#!/usr/bin/env node
import { main } from "../dist/cli.js";
main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
