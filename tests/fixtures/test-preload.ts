process.env.GITTRIBUTOR_RUN_FIXTURE_FAILURES = process.argv[1]?.includes(
  "tests/fixtures/test-repo/tests/utils.test.ts",
)
  ? "true"
  : "false";

const stdoutWrite = process.stdout.write.bind(process.stdout);

process.stderr.write = ((chunk: string | Uint8Array, encoding?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void) => {
  if (typeof encoding === "function") {
    stdoutWrite(chunk, encoding);
    return true;
  }

  stdoutWrite(chunk, encoding, callback);
  return true;
}) as typeof process.stderr.write;
