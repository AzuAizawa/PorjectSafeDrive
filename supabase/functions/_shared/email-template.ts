// Shared HTML shell for every outbound email (notifications + login codes) so
// there's one place to keep the SafeDrive branding consistent, instead of
// duplicating this markup across edge functions.
export function renderEmailHtml(message: string) {
  return `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <div style="display: inline-flex; align-items: center; gap: 8px; font-weight: 700; font-size: 16px; margin-bottom: 20px;">
        <span style="display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 6px; background: #0e7c6b; color: white; font-size: 11px;">SD</span>
        SafeDrive
      </div>
      <p style="font-size: 14px; line-height: 1.6; color: #14191a;">${message}</p>
      <p style="font-size: 12px; color: #82938f; margin-top: 24px;">
        This is an automated notification from SafeDrive, a school capstone project.
      </p>
    </div>
  `;
}
