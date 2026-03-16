const ANSI = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m"
};

let installed = false;

export function installTestConsoleColors(): void {
  if (installed) {
    return;
  }
  installed = true;

  const originalLog = console.log.bind(console);
  const originalError = console.error.bind(console);

  console.log = (...args: unknown[]): void => {
    if (args.length === 1 && typeof args[0] === "string") {
      const line = args[0];
      if (isPassLine(line)) {
        originalLog(`${ANSI.green}${line}${ANSI.reset}`);
        return;
      }
      if (isWarnLine(line)) {
        originalLog(`${ANSI.yellow}${line}${ANSI.reset}`);
        return;
      }
    }

    originalLog(...args);
  };

  console.error = (...args: unknown[]): void => {
    if (args.length === 1 && typeof args[0] === "string") {
      const line = args[0];
      if (isFailLine(line)) {
        originalError(`${ANSI.red}${line}${ANSI.reset}`);
        return;
      }
    }

    originalError(...args);
  };
}

function isPassLine(line: string): boolean {
  return /^PASS\b/i.test(line) || /\btests passed\b/i.test(line) || /\bfixture test passed\b/i.test(line);
}

function isFailLine(line: string): boolean {
  return /^FAIL\b/i.test(line) || /\[.*FAIL.*\]/i.test(line) || /\btests failed\b/i.test(line);
}

function isWarnLine(line: string): boolean {
  return /warning/i.test(line) || /^SKIP\b/i.test(line);
}

installTestConsoleColors();
