const SECRET_RULES = [
  {
    pattern: /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/g,
    replacement: "<redacted>"
  },
  {
    pattern: /\btvly-[A-Za-z0-9_-]{12,}\b/g,
    replacement: "<redacted>"
  },
  {
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
    replacement: "Bearer <redacted>"
  },
  {
    pattern: /(["']?(?:api[_-]?key|token|secret|password|authorization)["']?\s*[:=]\s*)["'][^"']+["']/gi,
    replacement: (_match, prefix) => `${prefix}"<redacted>"`
  },
  {
    pattern: /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g,
    replacement: "<redacted-private-key>"
  }
];

export function redactSecrets(value) {
  let text = String(value);
  for (const rule of SECRET_RULES) {
    text = text.replace(rule.pattern, rule.replacement);
  }
  return text;
}

export function containsSecretLikeText(value) {
  const text = String(value)
    .replaceAll("<redacted>", "")
    .replaceAll("<redacted-private-key>", "");
  return SECRET_RULES.some((rule) => {
    rule.pattern.lastIndex = 0;
    return rule.pattern.test(text);
  });
}
