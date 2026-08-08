import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ru.json";
import { AddWishSheet } from "./add-wish-sheet";
import type { ParseFields, ParseUrlResult } from "@/app/wishes/parse-actions";
import type { AiQuotaSnapshot } from "@/lib/ai/types";

/**
 * `parseUrlAction`/`draftWishFromTextAction` are server actions; this suite
 * mocks both so the sheet's state machines (parse → ok/partial/blocked/
 * duplicate; words → ok/quota/unavailable/failed) are tested in isolation
 * without a DB, network, or session.
 */

afterEach(cleanup);

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const parseUrlAction = vi.fn();
vi.mock("@/app/wishes/parse-actions", () => ({
  parseUrlAction: (url: string) => parseUrlAction(url),
}));

const draftWishFromTextAction = vi.fn();
vi.mock("@/app/wishes/ai-actions", () => ({
  draftWishFromTextAction: (text: string) => draftWishFromTextAction(text),
}));

const emptyFields: ParseFields = {
  title: null,
  description: null,
  imageUrl: null,
  priceMin: null,
  priceMax: null,
  currency: null,
};

function renderSheet(onClose = vi.fn(), ai?: AiQuotaSnapshot) {
  render(
    <NextIntlClientProvider locale="ru" messages={messages}>
      <AddWishSheet open onClose={onClose} ai={ai} />
    </NextIntlClientProvider>,
  );
  return { onClose };
}

function typeUrl(value: string) {
  fireEvent.change(screen.getByLabelText("Ссылка на товар"), {
    target: { value },
  });
}

function clickParse() {
  fireEvent.click(screen.getByRole("button", { name: "Добавить по ссылке" }));
}

beforeEach(() => {
  push.mockClear();
  parseUrlAction.mockReset();
  draftWishFromTextAction.mockReset();
  window.sessionStorage.clear();
});

describe("AddWishSheet — ok/partial", () => {
  it("writes the sessionStorage handoff and navigates on a successful parse", async () => {
    const fields: ParseFields = {
      title: "Кружка керамическая",
      description: "Ручная работа",
      imageUrl: "https://cdn.wishka.app/img/1.jpg",
      priceMin: "1200",
      priceMax: null,
      currency: "RUB",
    };
    parseUrlAction.mockResolvedValue({
      status: "ok",
      fields,
      url: "https://shop.example.com/mug",
      duplicate: null,
    } satisfies ParseUrlResult);

    renderSheet();
    typeUrl("https://shop.example.com/mug");
    clickParse();

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/wishes/new?parsed=1"),
    );
    expect(parseUrlAction).toHaveBeenCalledWith("https://shop.example.com/mug");
    expect(
      JSON.parse(window.sessionStorage.getItem("wishka-parsed-wish") ?? "null"),
    ).toEqual({ fields, url: "https://shop.example.com/mug", partial: false });
  });
});

describe("AddWishSheet — duplicate", () => {
  const duplicate = { id: "wish-42", title: "Уже в списке" };

  it("shows the duplicate block first and opens the existing wish", async () => {
    parseUrlAction.mockResolvedValue({
      status: "ok",
      fields: emptyFields,
      url: "https://shop.example.com/x",
      duplicate,
    } satisfies ParseUrlResult);

    renderSheet();
    typeUrl("https://shop.example.com/x");
    clickParse();

    expect(
      await screen.findByText("Это уже есть в твоём списке"),
    ).toBeInTheDocument();
    expect(screen.getByText("Уже в списке")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Открыть её" }));
    expect(push).toHaveBeenCalledWith("/wishes/wish-42");
  });

  it("'Всё равно добавить' resumes the outcome the duplicate check set aside", async () => {
    parseUrlAction.mockResolvedValue({
      status: "ok",
      fields: emptyFields,
      url: "https://shop.example.com/x",
      duplicate,
    } satisfies ParseUrlResult);

    renderSheet();
    typeUrl("https://shop.example.com/x");
    clickParse();

    fireEvent.click(
      await screen.findByRole("button", { name: "Всё равно добавить" }),
    );

    expect(push).toHaveBeenCalledWith("/wishes/new?parsed=1");
    expect(
      JSON.parse(window.sessionStorage.getItem("wishka-parsed-wish") ?? "null"),
    ).toEqual({
      fields: emptyFields,
      url: "https://shop.example.com/x",
      partial: false,
    });
  });
});

describe("AddWishSheet — stoplist/failed", () => {
  it("shows a calm warning banner and keeps the url for the manual form", async () => {
    parseUrlAction.mockResolvedValue({
      status: "manual",
      reason: "failed",
      url: "https://blocked.example.com/item",
      duplicate: null,
    } satisfies ParseUrlResult);

    renderSheet();
    typeUrl("https://blocked.example.com/item");
    clickParse();

    expect(
      await screen.findByText(
        "Этот магазин не делится данными — заполним вместе",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Заполнить вручную" }));
    expect(push).toHaveBeenCalledWith(
      `/wishes/new?url=${encodeURIComponent("https://blocked.example.com/item")}`,
    );
  });

  it("degrades to the calm manual path when the action itself rejects", async () => {
    // Network failure / server crash / session-redirect rejection.
    parseUrlAction.mockRejectedValue(new Error("network down"));

    renderSheet();
    typeUrl("https://shop.example.com/z");
    clickParse();

    expect(
      await screen.findByText(
        "Этот магазин не делится данными — заполним вместе",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Заполнить вручную" }));
    expect(push).toHaveBeenCalledWith(
      `/wishes/new?url=${encodeURIComponent("https://shop.example.com/z")}`,
    );
  });
});

describe("AddWishSheet — quota", () => {
  it("shows the quota banner and the same manual-with-url path", async () => {
    parseUrlAction.mockResolvedValue({
      status: "manual",
      reason: "quota",
      url: "https://shop.example.com/y",
      duplicate: null,
    } satisfies ParseUrlResult);

    renderSheet();
    typeUrl("https://shop.example.com/y");
    clickParse();

    expect(
      await screen.findByText(
        "Лимит парсинга на сегодня исчерпан — заполни вручную",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Заполнить вручную" }));
    expect(push).toHaveBeenCalledWith(
      `/wishes/new?url=${encodeURIComponent("https://shop.example.com/y")}`,
    );
  });
});

describe("AddWishSheet — invalid url", () => {
  it("shows an inline field error and stays in the sheet", async () => {
    parseUrlAction.mockResolvedValue({
      status: "manual",
      reason: "invalid_url",
      url: "not-a-url",
      duplicate: null,
    } satisfies ParseUrlResult);

    renderSheet();
    typeUrl("not-a-url");
    clickParse();

    expect(
      await screen.findByText("Ссылка должна начинаться с http(s)://"),
    ).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    // Back in the idle view, so the field is still there to correct.
    expect(screen.getByLabelText("Ссылка на товар")).toBeInTheDocument();
  });
});

describe("AddWishSheet — slow parsing", () => {
  it("swaps in the slow caption after 5s and ignores a late result after 'fillManually'", async () => {
    vi.useFakeTimers();
    try {
      let resolveParse: (value: ParseUrlResult) => void = () => {};
      parseUrlAction.mockImplementation(
        () =>
          new Promise<ParseUrlResult>((resolve) => {
            resolveParse = resolve;
          }),
      );

      renderSheet();
      typeUrl("https://slow.example.com/item");
      clickParse();

      expect(screen.getByText("Смотрим, что там…")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Заполнить вручную" }),
      ).toBeNull();

      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      expect(
        screen.getByText("Магазин отвечает медленно, продолжаем…"),
      ).toBeInTheDocument();

      fireEvent.click(
        screen.getByRole("button", { name: "Заполнить вручную" }),
      );
      expect(push).toHaveBeenCalledWith(
        `/wishes/new?url=${encodeURIComponent("https://slow.example.com/item")}`,
      );
      expect(push).toHaveBeenCalledTimes(1);

      // The parse "arrives" after the user already bailed to the manual
      // form — must not fire a second navigation or write the handoff.
      await act(async () => {
        resolveParse({
          status: "ok",
          fields: emptyFields,
          url: "https://slow.example.com/item",
          duplicate: null,
        });
        await Promise.resolve();
      });

      expect(push).toHaveBeenCalledTimes(1);
      expect(window.sessionStorage.getItem("wishka-parsed-wish")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("AddWishSheet — words entry (AI)", () => {
  it("orders the three entry options as link -> words -> divider -> manual (§6.3)", () => {
    renderSheet(vi.fn(), { text: 5, image: 3 });

    const labels = screen
      .getAllByRole("button")
      .map((button) => button.textContent);
    const parseIndex = labels.indexOf("Добавить по ссылке");
    const wordsIndex = labels.indexOf("Добавь словами");
    const manualIndex = labels.indexOf("Заполнить вручную");

    // "Добавь словами" reads as a peer of the link entry, above the divider
    // — not a subordinate fourth item under "или" + manual entry.
    expect(parseIndex).toBeGreaterThanOrEqual(0);
    expect(wordsIndex).toBeGreaterThan(parseIndex);
    expect(manualIndex).toBeGreaterThan(wordsIndex);
  });

  it("hides the 'Добавь словами' entry when ai is undefined", () => {
    renderSheet();
    expect(screen.queryByText("Добавь словами")).toBeNull();
  });

  it("shows the entry and its counter when ai is available", () => {
    renderSheet(vi.fn(), { text: 5, image: 3 });
    fireEvent.click(screen.getByRole("button", { name: "Добавь словами" }));
    expect(
      screen.getByText("Осталось 5 AI-подсказок сегодня"),
    ).toBeInTheDocument();
  });

  it("tapping back returns to the idle phase", () => {
    renderSheet(vi.fn(), { text: 5, image: 3 });

    fireEvent.click(screen.getByRole("button", { name: "Добавь словами" }));
    expect(screen.getByLabelText("Что хочется?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Назад" }));
    expect(screen.queryByLabelText("Что хочется?")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Добавь словами" }),
    ).toBeInTheDocument();
  });

  it("happy path — writes the ai-draft handoff and navigates to ?ai=1", async () => {
    draftWishFromTextAction.mockResolvedValue({
      ok: true,
      value: { title: "Поплавать с китами", type: "experience" },
      remaining: 4,
    });
    renderSheet(vi.fn(), { text: 5, image: 3 });

    fireEvent.click(screen.getByRole("button", { name: "Добавь словами" }));
    fireEvent.change(screen.getByLabelText("Что хочется?"), {
      target: { value: "поплавать с китами" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Собрать карточку" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/wishes/new?ai=1"));
    expect(draftWishFromTextAction).toHaveBeenCalledWith("поплавать с китами");
    expect(
      JSON.parse(window.sessionStorage.getItem("wishka-ai-draft") ?? "null"),
    ).toEqual({
      draft: { title: "Поплавать с китами", type: "experience" },
    });
  });

  it("quota — shows the exhausted banner and falls back to the manual form", async () => {
    draftWishFromTextAction.mockResolvedValue({
      ok: false,
      reason: "quota",
      remaining: 0,
    });
    renderSheet(vi.fn(), { text: 1, image: 3 });

    fireEvent.click(screen.getByRole("button", { name: "Добавь словами" }));
    fireEvent.change(screen.getByLabelText("Что хочется?"), {
      target: { value: "что-нибудь" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Собрать карточку" }));

    expect(
      await screen.findByText("AI-лимит на сегодня исчерпан — заполни вручную"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Заполнить вручную" }));
    expect(push).toHaveBeenCalledWith("/wishes/new");
  });

  it("unavailable — shows the unavailable banner", async () => {
    draftWishFromTextAction.mockResolvedValue({
      ok: false,
      reason: "unavailable",
    });
    renderSheet(vi.fn(), { text: 5, image: 3 });

    fireEvent.click(screen.getByRole("button", { name: "Добавь словами" }));
    fireEvent.change(screen.getByLabelText("Что хочется?"), {
      target: { value: "что-нибудь" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Собрать карточку" }));

    expect(
      await screen.findByText("AI сейчас недоступен — попробуй позже"),
    ).toBeInTheDocument();
  });

  it("error/rejected — shows the draft-failed banner with a retry, and retrying works", async () => {
    draftWishFromTextAction.mockRejectedValueOnce(new Error("network down"));
    draftWishFromTextAction.mockResolvedValueOnce({
      ok: true,
      value: { title: "Плед" },
      remaining: 4,
    });
    renderSheet(vi.fn(), { text: 5, image: 3 });

    fireEvent.click(screen.getByRole("button", { name: "Добавь словами" }));
    fireEvent.change(screen.getByLabelText("Что хочется?"), {
      target: { value: "плед на диван" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Собрать карточку" }));

    expect(
      await screen.findByText(
        "Не получилось собрать — попробуй ещё раз или заполни вручную",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Попробовать ещё" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/wishes/new?ai=1"));
    expect(draftWishFromTextAction).toHaveBeenCalledTimes(2);
  });
});

describe("AddWishSheet — clipboard (§6.3, states audit #14)", () => {
  function withClipboard(text: string | Error) {
    const readText = vi.fn(() =>
      text instanceof Error ? Promise.reject(text) : Promise.resolve(text),
    );
    Object.defineProperty(navigator, "clipboard", {
      value: { readText },
      configurable: true,
      writable: true,
    });
    return readText;
  }

  it("fills the field when the clipboard holds a link", async () => {
    withClipboard("https://shop.example/vase");
    renderSheet();

    fireEvent.click(screen.getByRole("button", { name: "Вставить из буфера" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Ссылка на товар")).toHaveValue(
        "https://shop.example/vase",
      ),
    );
    expect(
      screen.queryByText("Ссылка должна начинаться с http(s)://"),
    ).toBeNull();
  });

  it("accepts a link pasted without a scheme, like the parser does", async () => {
    withClipboard("shop.example/vase");
    renderSheet();

    fireEvent.click(screen.getByRole("button", { name: "Вставить из буфера" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Ссылка на товар")).toHaveValue(
        "shop.example/vase",
      ),
    );
  });

  it("refuses non-link clipboard text instead of pasting junk", async () => {
    withClipboard("напомнить купить вазу");
    renderSheet();

    fireEvent.click(screen.getByRole("button", { name: "Вставить из буфера" }));

    expect(
      await screen.findByText("Ссылка должна начинаться с http(s)://"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Ссылка на товар")).toHaveValue("");
  });

  it("says nothing when the clipboard is empty", async () => {
    withClipboard("   ");
    renderSheet();

    fireEvent.click(screen.getByRole("button", { name: "Вставить из буфера" }));

    await waitFor(() =>
      expect(navigator.clipboard.readText).toHaveBeenCalledTimes(1),
    );
    expect(
      screen.queryByText("Ссылка должна начинаться с http(s)://"),
    ).toBeNull();
    expect(screen.getByLabelText("Ссылка на товар")).toHaveValue("");
  });

  it("stays silent when clipboard access is refused", async () => {
    withClipboard(new Error("denied"));
    renderSheet();

    fireEvent.click(screen.getByRole("button", { name: "Вставить из буфера" }));

    await waitFor(() =>
      expect(navigator.clipboard.readText).toHaveBeenCalledTimes(1),
    );
    expect(
      screen.queryByText("Ссылка должна начинаться с http(s)://"),
    ).toBeNull();
  });
});
