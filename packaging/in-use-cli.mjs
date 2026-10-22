// Command-line entry for the in-use helper (058 research D9): `node in-use-cli.mjs [--nsis] <install root>`.
//
// The decision lives in in-use.mjs, which can also run as a script of its own. THIS file is what the
// setup runs from its plugins folder: an entry point that always runs, with nothing to detect. The
// helper's own "was I started as the script" check compares two spellings of one path, and a setup's
// temp folder (an 8.3 short name, a junction) is where that comparison has been wrong before, leaving a
// helper that printed nothing and exited 0, which the setup took as "no one is using this copy".
import { main } from './in-use.mjs';

const result = await main(process.argv.slice(2));
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.code;
