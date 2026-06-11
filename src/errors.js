export class ObfuscationError extends Error {
  constructor(message, { provider, status, code, cause } = {}) {
    super(message);
    this.name = "ObfuscationError";
    this.provider = provider;
    this.status = status;
    this.code = code;
    if (cause) this.cause = cause;
  }
}

export async function describeHttpError(response, provider) {
  const status = response.status;
  let detail = "";
  let code;

  const bodyText = await safeReadText(response);
  if (bodyText) {
    try {
      const json = JSON.parse(bodyText);
      if (Array.isArray(json?.errors)) {
        detail = json.errors
          .map((e) => (e.param ? `${e.param}: ${e.message}` : e.message))
          .filter(Boolean)
          .join("; ");
      } else if (json?.error) {
        detail =
          typeof json.error === "string"
            ? json.error
            : json.error.message || JSON.stringify(json.error);
        code = json.code || json.error?.code;
      } else if (json?.message) {
        detail = json.message;
        code = json.code;
      } else {
        detail = bodyText.slice(0, 500);
      }
    } catch {
      detail = bodyText.slice(0, 500);
    }
  }

  const message =
    `${provider} API error (HTTP ${status})` + (detail ? `: ${detail}` : "");
  return new ObfuscationError(message, { provider, status, code });
}

async function safeReadText(response) {
  try {
    return (await response.text()).trim();
  } catch {
    return "";
  }
}
