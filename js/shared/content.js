export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

export function safeUrl(value, { image = false } = {}) {
  const input = String(value || '');
  try {
    const url = new URL(input, location.href);
    if (['http:', 'https:'].includes(url.protocol)) return url.href;
    if (!image && url.protocol === 'mailto:') return url.href;
    if (image && url.protocol === 'blob:') return url.href;
  } catch { /* Invalid URL is intentionally blank. */ }
  return '';
}

// Preserve the existing editor's simple rich text, removing all scripts/handlers/styles.
export function sanitizeHtml(value) {
  const source = new DOMParser().parseFromString(String(value ?? ''), 'text/html');
  const allowed = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'A', 'DIV']);
  const dangerous = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'FORM', 'INPUT']);
  function clean(parent) {
    for (const node of [...parent.childNodes]) {
      if (node.nodeType === Node.COMMENT_NODE) { node.remove(); continue; }
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (dangerous.has(node.tagName)) { node.remove(); continue; }
      clean(node);
      if (!allowed.has(node.tagName)) { node.replaceWith(...node.childNodes); continue; }
      const href = node.tagName === 'A' ? safeUrl(node.getAttribute('href')) : '';
      for (const attr of [...node.attributes]) node.removeAttribute(attr.name);
      if (href) { node.setAttribute('href', href); node.setAttribute('rel', 'noopener noreferrer'); }
    }
  }
  clean(source.body);
  return source.body.innerHTML;
}

export function plainText(html) {
  return new DOMParser().parseFromString(String(html || ''), 'text/html').body.textContent.trim();
}
