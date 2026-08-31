/**
 * Nova's showErrorMessage / showWarningMessage / showInformativeMessage are
 * modal alerts that block until dismissed. These go to the Notification Center
 * instead, where a request with no `actions` auto-dismisses.
 */

type Kind = "info" | "warn" | "error";

function post(kind: Kind, message: string, detail?: string): void {
  // One identifier per kind, so a repeat replaces its banner instead of stacking.
  const request = new NotificationRequest(`com.parkcedar.java.${kind}`);
  request.title = kind === "error" ? `⚠︎ ${message}` : message;
  if (detail) request.body = detail;
  nova.notifications.add(request).catch(() => {
    console.error(`[${kind}] ${message}${detail ? ` — ${detail}` : ""}`);
  });
}

export const notify = {
  info: (message: string, detail?: string) => post("info", message, detail),
  warn: (message: string, detail?: string) => post("warn", message, detail),
  error: (message: string, detail?: string) => post("error", message, detail),
};
