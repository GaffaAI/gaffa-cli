#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { runDoctor, processContext } from "./doctor.js";

const pkg = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const HELP = `gaffa - the Gaffa command line tool

Usage
  gaffa [command] [options]

Commands
  doctor          Report which AI coding tools are installed and whether the
                  gaffa skills are set up in them. Add --json for machine output.

Options
  -v, --version   Print the version and exit
  -h, --help      Show this help and exit
`;

function main(argv: string[]): number {
  const args = argv.slice(2);

  if (args.includes("-v") || args.includes("--version")) {
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }

  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    process.stdout.write(HELP);
    return 0;
  }

  if (args[0] === "doctor") {
    const json = args.includes("--json");
    process.stdout.write(runDoctor(processContext(), json));
    return 0;
  }

  process.stderr.write(
    `Unknown command: ${args.join(" ")}\nRun "gaffa --help" for usage.\n`,
  );
  return 1;
}

process.exit(main(process.argv));
