export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function shortSha(sha: string | undefined, n = 12): string {
  if (!sha) return "—";
  return sha.slice(0, n);
}
