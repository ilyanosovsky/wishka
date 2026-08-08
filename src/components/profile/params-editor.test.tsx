import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ru.json";
import { ParamsEditor, type ParamsEditorInitial } from "./params-editor";

/**
 * `updatePublicParams` is a server action; this suite mocks it so the
 * editor's local state (add/remove taste, add/remove no-gift, fill hint,
 * save) is tested without a DB or session — same pattern as
 * add-wish-sheet.test.tsx for parseUrlAction.
 */

afterEach(cleanup);

const updatePublicParams = vi.fn();
vi.mock("@/app/profile/actions", () => ({
  updatePublicParams: (input: unknown) => updatePublicParams(input),
}));

const EMPTY: ParamsEditorInitial = { sizes: {}, tastes: [], noGift: [] };

function renderEditor(initial: ParamsEditorInitial = EMPTY) {
  render(
    <NextIntlClientProvider locale="ru" messages={messages}>
      <ParamsEditor initial={initial} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  updatePublicParams.mockReset();
  updatePublicParams.mockResolvedValue({ ok: true });
});

describe("ParamsEditor — fill hint", () => {
  it("shows the hint when sizes, tastes and no-gift are all empty", () => {
    renderEditor();
    expect(
      screen.getByText("Заполни, чтобы тебе дарили точнее"),
    ).toBeInTheDocument();
  });

  it("hides the hint once a taste is present", () => {
    renderEditor({ sizes: {}, tastes: ["coffee"], noGift: [] });
    expect(
      screen.queryByText("Заполни, чтобы тебе дарили точнее"),
    ).not.toBeInTheDocument();
  });

  it("hides the hint once a size field has a value", () => {
    renderEditor({ sizes: { clothing: "M" }, tastes: [], noGift: [] });
    expect(
      screen.queryByText("Заполни, чтобы тебе дарили точнее"),
    ).not.toBeInTheDocument();
  });
});

describe("ParamsEditor — tastes", () => {
  it("adds a taste on Enter and clears the input", () => {
    renderEditor();
    const input = screen.getByPlaceholderText("Например: люблю чай, настолки");

    fireEvent.change(input, { target: { value: "coffee" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText("coffee")).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("adds a taste via the add button", () => {
    renderEditor();
    const input = screen.getByPlaceholderText("Например: люблю чай, настолки");

    fireEvent.change(input, { target: { value: "board games" } });
    fireEvent.click(screen.getByRole("button", { name: "Добавить вкус" }));

    expect(screen.getByText("board games")).toBeInTheDocument();
  });

  it("removes a taste via its chip's remove button", () => {
    renderEditor({ sizes: {}, tastes: ["coffee"], noGift: [] });

    expect(screen.getByText("coffee")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Удалить"));

    expect(screen.queryByText("coffee")).not.toBeInTheDocument();
  });

  it("ignores an empty or duplicate taste", () => {
    renderEditor({ sizes: {}, tastes: ["coffee"], noGift: [] });
    const input = screen.getByPlaceholderText("Например: люблю чай, настолки");

    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "coffee" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getAllByText("coffee")).toHaveLength(1);
  });
});

describe("ParamsEditor — no-gift", () => {
  it("adds a no-gift item via the add button", () => {
    renderEditor();
    const input = screen.getByPlaceholderText("Добавить");

    fireEvent.change(input, { target: { value: "perfume" } });
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));

    expect(screen.getByText("perfume")).toBeInTheDocument();
  });

  it("removes a no-gift item via its chip's remove button", () => {
    renderEditor({ sizes: {}, tastes: [], noGift: ["perfume"] });

    expect(screen.getByText("perfume")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Удалить"));

    expect(screen.queryByText("perfume")).not.toBeInTheDocument();
  });
});

describe("ParamsEditor — save", () => {
  it("calls updatePublicParams with the current state and shows the saved toast", async () => {
    renderEditor({ sizes: { clothing: "M" }, tastes: ["coffee"], noGift: [] });

    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await vi.waitFor(() => expect(updatePublicParams).toHaveBeenCalledTimes(1));
    expect(updatePublicParams).toHaveBeenCalledWith({
      sizes: { clothing: "M" },
      tastes: ["coffee"],
      noGift: [],
    });
    expect(await screen.findByText("Сохранено")).toBeInTheDocument();
  });

  it("shows a generic error toast when the action reports failure", async () => {
    updatePublicParams.mockResolvedValue({ ok: false });
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(
      await screen.findByText("Не получилось — попробуй ещё раз"),
    ).toBeInTheDocument();
  });
});
