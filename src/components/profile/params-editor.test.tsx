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
    fireEvent.click(screen.getByLabelText("Удалить: coffee"));

    expect(screen.queryByText("coffee")).not.toBeInTheDocument();
  });

  /** Nine identically-labelled «Удалить» buttons are nine indistinguishable
   *  announcements for a screen-reader user — each one names its own item. */
  it("names every remove button after the item it removes", () => {
    renderEditor({
      sizes: { рост: "180" },
      tastes: ["coffee", "tea"],
      noGift: ["perfume"],
    });

    for (const name of ["coffee", "tea", "perfume", "рост"]) {
      expect(screen.getByLabelText(`Удалить: ${name}`)).toBeInTheDocument();
    }
    expect(screen.queryByLabelText("Удалить")).toBeNull();
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
    fireEvent.click(screen.getByLabelText("Удалить: perfume"));

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

describe("ParamsEditor — custom size parameters (§6.6)", () => {
  it("adds an arbitrary parameter row, lower-cased, and saves it", async () => {
    renderEditor();

    fireEvent.change(screen.getByLabelText("Свой параметр"), {
      target: { value: " Рост " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Добавить параметр" }));

    // The new row lands in the sizes list with its own value field.
    const valueField = screen.getByLabelText("рост");
    fireEvent.change(valueField, { target: { value: "180" } });

    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await vi.waitFor(() => expect(updatePublicParams).toHaveBeenCalledTimes(1));
    expect(updatePublicParams).toHaveBeenCalledWith({
      sizes: { рост: "180" },
      tastes: [],
      noGift: [],
    });
  });

  it("renders custom keys that came from the server and can remove them", () => {
    renderEditor({
      sizes: { clothing: "M", рост: "180" },
      tastes: [],
      noGift: [],
    });

    expect(screen.getByLabelText("рост")).toHaveValue("180");
    // The four known rows have no remove button — only the custom one does.
    fireEvent.click(screen.getByLabelText("Удалить: рост"));
    expect(screen.queryByLabelText("рост")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Одежда")).toHaveValue("M");
  });

  it("will not add an empty name, and never duplicates a known key", () => {
    renderEditor({ sizes: { clothing: "M" }, tastes: [], noGift: [] });
    const add = screen.getByRole("button", { name: "Добавить параметр" });
    expect(add).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Свой параметр"), {
      target: { value: "clothing" },
    });
    fireEvent.click(add);

    // No second "Одежда" row appeared, and the existing value survived.
    expect(screen.getAllByLabelText("Одежда")).toHaveLength(1);
    expect(screen.getByLabelText("Одежда")).toHaveValue("M");
  });

  /**
   * The refusal used to clear the input first and return silently, so a
   * rejected name looked exactly like an accepted one. The name stays put and
   * the field is marked invalid — the only "reason" available without inventing
   * a copy key for it.
   */
  it("keeps a refused name in the field and marks it invalid", () => {
    renderEditor({ sizes: { рост: "180" }, tastes: [], noGift: [] });
    const input = screen.getByLabelText("Свой параметр");

    fireEvent.change(input, { target: { value: "Рост" } });
    fireEvent.click(screen.getByRole("button", { name: "Добавить параметр" }));

    expect(input).toHaveValue("Рост");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getAllByLabelText("рост")).toHaveLength(1);

    // Editing the name clears the refusal.
    fireEvent.change(input, { target: { value: "Ростом" } });
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("refuses a name that only matches Object.prototype, and accepts it as a row", () => {
    renderEditor();
    const input = screen.getByLabelText("Свой параметр");

    // `"constructor" in sizes` is true — `Object.hasOwn` is what makes this
    // perfectly ordinary parameter name work.
    fireEvent.change(input, { target: { value: "constructor" } });
    fireEvent.click(screen.getByRole("button", { name: "Добавить параметр" }));

    expect(screen.getByLabelText("constructor")).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("drops a custom row left blank on save, so the list matches what saved", async () => {
    renderEditor({ sizes: { рост: "180" }, tastes: [], noGift: [] });

    fireEvent.change(screen.getByLabelText("Свой параметр"), {
      target: { value: "любимый цвет" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Добавить параметр" }));
    expect(screen.getByLabelText("любимый цвет")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await vi.waitFor(() => expect(updatePublicParams).toHaveBeenCalledTimes(1));
    // The blank row is not sent…
    expect(updatePublicParams).toHaveBeenCalledWith({
      sizes: { рост: "180" },
      tastes: [],
      noGift: [],
    });
    // …and does not linger on screen pretending it was.
    expect(screen.queryByLabelText("любимый цвет")).toBeNull();
    expect(screen.getByLabelText("рост")).toHaveValue("180");
  });
});
