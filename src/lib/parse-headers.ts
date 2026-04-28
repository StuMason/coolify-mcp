export function parseHeaders(argv: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--header' && i + 1 < argv.length) {
      const value = argv[i + 1];
      const colonIndex = value.indexOf(':');
      if (colonIndex > 0) {
        headers[value.slice(0, colonIndex).trim()] = value.slice(colonIndex + 1).trim();
      }
      i++;
    }
  }
  return headers;
}
