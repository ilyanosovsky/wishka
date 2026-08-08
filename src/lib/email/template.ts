/**
 * Shared Paper Ledger email template — table-based HTML, inline styles only.
 * Email clients strip <style> tags and ignore CSS custom properties, so the
 * palette below is copy-pasted (light-theme values) from design/uploads/tokens.css
 * rather than referencing the tokens file.
 */

const COLOR = {
  bg: "#f3f0e9",
  paper: "#faf8f2",
  rule: "#e3ddcf",
  ruleStrong: "#cfc7b3",
  ink: "#2b2820",
  mute: "#7c7561",
  accent: "#3c5a4a",
  accentInk: "#324c3f",
} as const;

const FONT_SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, Helvetica, Arial, sans-serif";
const FONT_SERIF = "Georgia, 'Times New Roman', serif";

export type LedgerEmailCta = {
  label: string;
  url: string;
};

export type LedgerEmailInput = {
  locale: "ru" | "en";
  /** Passed through untouched to the returned RenderedEmail — lets callers
   *  build subject + body from the same input object. */
  subject?: string;
  /** Serif masthead heading, e.g. "Бронь подтверждена". */
  heading: string;
  /** Body paragraphs, rendered as separate <p> rows. Plain text — the template
   *  escapes these for the HTML part and uses them verbatim for the text part,
   *  so callers must NOT pre-escape user content. */
  bodyLines: string[];
  cta?: LedgerEmailCta;
  footnote?: string;
};

export type RenderedEmail = {
  subject?: string;
  html: string;
  text: string;
};

/** Escapes text for safe interpolation into the HTML template. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Plain-text fallback: strips nothing (callers pass already-plain strings),
 *  just joins with blank lines the way most mail clients render <p> tags. */
function toPlainText(input: LedgerEmailInput): string {
  const lines = [input.heading, "", ...input.bodyLines];
  if (input.cta) lines.push("", `${input.cta.label}: ${input.cta.url}`);
  if (input.footnote) lines.push("", input.footnote);
  return lines.join("\n");
}

/**
 * Renders the single shared Paper Ledger email shell. User content
 * (wish titles, guest names) is passed in as PLAIN TEXT: this function escapes
 * it for the HTML part and reuses it verbatim for the text part, so the two
 * never diverge and a hostile title cannot break out of either.
 */
export function renderLedgerEmail(input: LedgerEmailInput): RenderedEmail {
  const bodyRows = input.bodyLines
    .map(
      (line) => `
              <tr>
                <td style="padding:0 0 16px;font-family:${FONT_SANS};font-size:15px;line-height:1.55;color:${COLOR.ink};">
                  ${escapeHtml(line)}
                </td>
              </tr>`,
    )
    .join("");

  const ctaRow = input.cta
    ? `
              <tr>
                <td style="padding:8px 0 24px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                    <tr>
                      <td style="background-color:${COLOR.accent};border:1px solid ${COLOR.accentInk};">
                        <a href="${escapeHtml(input.cta.url)}" style="display:inline-block;padding:12px 24px;font-family:${FONT_SANS};font-size:14px;font-weight:600;color:${COLOR.paper};text-decoration:none;">
                          ${escapeHtml(input.cta.label)}
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>`
    : "";

  const footnoteRow = input.footnote
    ? `
              <tr>
                <td style="padding:16px 0 0;border-top:1px solid ${COLOR.rule};font-family:${FONT_SANS};font-size:12px;line-height:1.5;color:${COLOR.mute};">
                  ${escapeHtml(input.footnote)}
                </td>
              </tr>`
    : "";

  const html = `<!doctype html>
<html lang="${input.locale}">
  <body style="margin:0;padding:0;background-color:${COLOR.bg};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${COLOR.bg};">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:480px;max-width:100%;background-color:${COLOR.paper};border:1px solid ${COLOR.ruleStrong};">
            <tr>
              <td style="padding:28px 32px 0;">
                <div style="font-family:${FONT_SANS};font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:${COLOR.mute};">
                  Wishka
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 32px 20px;border-bottom:2px solid ${COLOR.ink};">
                <div style="font-family:${FONT_SERIF};font-size:22px;font-weight:600;color:${COLOR.ink};">
                  ${escapeHtml(input.heading)}
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  ${bodyRows}
                  ${ctaRow}
                  ${footnoteRow}
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject: input.subject, html, text: toPlainText(input) };
}
