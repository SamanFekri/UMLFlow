#!/usr/bin/env node
// UMLFlow CLI entry point (`umlflow` / `npx umlflow`).
//
// Deliberately dependency-free and defensive: every failure path — an unsupported Node.js version, a
// missing or broken build, a thrown error inside a command, a closed pipe — ends with a single-line
// message and a non-zero exit code, never an unhandled exception or a stack trace in the user's terminal.

const MIN_NODE_MAJOR = 20;

function fail(message, code = 1) {
  process.stderr.write(`umlflow: ${message}\n`);
  process.exitCode = code;
}

function describe(err) {
  return err instanceof Error ? err.message : String(err);
}

// `umlflow status | head` closes stdout early; that is not an error worth reporting.
process.stdout.on('error', (err) => {
  if (err && err.code === 'EPIPE') process.exit(0);
  fail(describe(err));
});

// Last line of defence for anything escaping the command layer (timers, event listeners, …).
process.on('uncaughtException', (err) => {
  fail(describe(err));
  process.exit(process.exitCode || 1);
});
process.on('unhandledRejection', (err) => {
  fail(describe(err));
  process.exit(process.exitCode || 1);
});

async function main() {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (!Number.isInteger(major) || major < MIN_NODE_MAJOR) {
    fail(`Node.js ${MIN_NODE_MAJOR} or newer is required (found ${process.versions.node}).`);
    return;
  }

  let runCli;
  try {
    ({ runCli } = await import('../dist/cli/index.js'));
  } catch (err) {
    fail(`the CLI build could not be loaded (${describe(err)}).`);
    process.stderr.write(
      'hint: reinstall with `npm install -g umlflow`; from a git checkout run `npm install && npm run build` first.\n',
    );
    return;
  }

  try {
    await runCli(process.argv);
  } catch (err) {
    fail(describe(err));
  }
}

main();
