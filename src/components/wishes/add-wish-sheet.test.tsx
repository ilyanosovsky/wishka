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

/**
 * `parseUrlAction` is a server action; this suite mocks it so the sheet's
 * state machine (parse → ok/partial/blocked/duplicate) is tested in isolation
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

const emptyFields: ParseFields = {
  title: null,
  description: null,
  imageUrl: null,
  priceMin: null,
  priceMax: null,
  currency: null,
};

function renderSheet(onClose = vi.fn()) {
  render(
    <NextIntlClientProvider locale="ru" messages={messages}>
      <AddWishSheet open onClose={onClose} />
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
