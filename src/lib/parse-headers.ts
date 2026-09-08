export function parseHeaders(argv: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--header' && i + 1 < argv.length) {
      const value = argv[i + 1];
      const colonIndex = value.indexOf(':');
      if (colonIndex > 0) {
        const key = value.slice(0, colonIndex).trim();
        // Header names are case-insensitive on the wire: a repeated flag
        // replaces rather than accumulating two spellings, which fetch would
        // send comma-joined.
        for (const existing of Object.keys(headers)) {
          if (existing.toLowerCase() === key.toLowerCase()) delete headers[existing];
        }
        headers[key] = value.slice(colonIndex + 1).trim();
      }
      i++;
    }
  }
  return headers;
}
