/**
 * Transient, auto-dismissing notifications.
 *
 * Nova's `showErrorMessage` / `showWarningMessage` / `showInformativeMessage`
 * are modal alerts that block until the user clicks a button. We rarely want to
 * interrupt like that, so everything routes through the Notification Center as
 * a banner: it appears, then dismisses on its own (a `NotificationRequest` with
 * no `actions` shows no buttons).
 */

type Kind = "info" | "warn" | "error";

function post(kind: Kind, message: string, detail?: string): void {
  // A stable identifier per kind means repeated messages replace the previous
  // banner instead of stacking up.
  const request = new NotificationRequest(`com.parkcedar.java.${kind}`);
  const prefix = kind === "error" ? "⚠︎ " : "";
  request.title = `${prefix}${message}`;
  if (detail) request.body = detail;
  // No `actions` → no buttons → the banner auto-dismisses.
  nova.notifications.add(request).catch(() => {
    console.error(`[${kind}] ${message}${detail ? ` — ${detail}` : ""}`);
  });
}

export const notify = {
  info: (message: string, detail?: string) => post("info", message, detail),
  warn: (message: string, detail?: string) => post("warn", message, detail),
  error: (message: string, detail?: string) => post("error", message, detail),
};
