import { describe, expect, it } from "vitest";
import { escapeHtml, renderLedgerEmail } from "./template";

describe("escapeHtml", () => {
  it("escapes a hostile payload attempting a stored XSS", () => {
    const hostile = `<img src=x onerror="alert(1)">`;
    const escaped = escapeHtml(hostile);
    expect(escaped).not.toContain("<img");
    expect(escaped).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});

describe("renderLedgerEmail", () => {
  it("renders heading, body lines and CTA into the HTML and text output", () => {
    const { subject, html, text } = renderLedgerEmail({
      locale: "ru",
      subject: "Бронь подтверждена",
      heading: "Бронь подтверждена",
      bodyLines: ["Первая строка", "Вторая строка"],
      cta: { label: "Управлять бронью", url: "https://wishka.app/g/abc" },
      footnote: "Это письмо отправлено автоматически.",
    });

    expect(subject).toBe("Бронь подтверждена");
    expect(html).toContain("Бронь подтверждена");
    expect(html).toContain("Первая строка");
    expect(html).toContain("Вторая строка");
    expect(html).toContain("https://wishka.app/g/abc");
    expect(html).toContain("Управлять бронью");
    expect(html).toContain("Это письмо отправлено автоматически.");
    expect(text).toContain("Управлять бронью: https://wishka.app/g/abc");
  });

  it("omits the CTA block and footnote row when not provided", () => {
    const { html } = renderLedgerEmail({
      locale: "en",
      heading: "Gift delivered",
      bodyLines: ["Thanks for making someone happy!"],
    });
    expect(html).not.toContain("<a href=");
  });

  it("HTML-escapes a hostile wish title while keeping the text part plain", () => {
    const hostile = `<img src=x onerror=alert(1)>`;
    const { html, text } = renderLedgerEmail({
      locale: "en",
      heading: "The wish was deleted",
      // Raw, not pre-escaped: the template owns escaping now.
      bodyLines: [`The wish "${hostile}" was removed.`],
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    // The plain-text alternative stays human-readable, no HTML entities.
    expect(text).toContain(`The wish "${hostile}" was removed.`);
    expect(text).not.toContain("&lt;");
  });

  it("escapes a hostile CTA url in the href attribute", () => {
    const { html } = renderLedgerEmail({
      locale: "en",
      heading: "Booking confirmed",
      bodyLines: ["Manage below."],
      cta: { label: "Manage", url: `https://x/"><script>alert(1)</script>` },
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });
});
