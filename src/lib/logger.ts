const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";
const ANSI_GREEN = "\x1b[32m";
const ANSI_RED = "\x1b[31m";
const ANSI_YELLOW = "\x1b[33m";
const ANSI_CYAN = "\x1b[36m";

const formatPrefix = (color: string, label: string): string => {
  return `${color}${ANSI_BOLD}${label}${ANSI_RESET}`;
};

const writeStdoutLine = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

const writeStderrLine = (message: string): void => {
  process.stderr.write(`${message}\n`);
};

/**
 * Writes a plain message to standard output.
 */
export const log = (message: string): void => {
  writeStdoutLine(message);
};

/**
 * Writes an informational message with a cyan prefix.
 */
export const info = (message: string): void => {
  writeStdoutLine(`${formatPrefix(ANSI_CYAN, "[INFO]")} ${message}`);
};

/**
 * Writes a warning message with a yellow prefix.
 */
export const warn = (message: string): void => {
  writeStderrLine(`${formatPrefix(ANSI_YELLOW, "[WARN]")} ${message}`);
};

/**
 * Writes an error message with a red prefix.
 */
export const error = (message: string): void => {
  writeStderrLine(`${formatPrefix(ANSI_RED, "[ERROR]")} ${message}`);
};

/**
 * Writes a success message with a green check prefix.
 */
export const success = (message: string): void => {
  writeStdoutLine(`${formatPrefix(ANSI_GREEN, "[✓]")} ${message}`);
};

/**
 * Writes a debug message only when VERBOSE=true.
 */
export const debug = (message: string): void => {
  if (process.env.VERBOSE !== "true") {
    return;
  }

  writeStdoutLine(`${formatPrefix(ANSI_CYAN, "[DEBUG]")} ${message}`);
};
