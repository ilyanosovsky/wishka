import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ru.json";
import { WishForm, type WishFormValues } from "./wish-form";

afterEach(cleanup);

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

// wish-form calls useUploadThing unconditionally on every render (the photo
// picker); stub it so rendering never depends on UploadThing's own setup.
vi.mock("@/lib/uploadthing-client", () => ({
  useUploadThing: () => ({ startUpload: vi.fn() }),
}));

function renderForm(props: Partial<Parameters<typeof WishForm>[0]> = {}) {
  const onSubmit = props.onSubmit ?? vi.fn(async () => ({ ok: true as const }));
  render(
    <NextIntlClientProvider locale="ru" messages={messages}>
      <WishForm
        submitLabel="Добавить в список"
        onSubmit={onSubmit}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { onSubmit };
}

beforeEach(() => {
  window.localStorage.clear();
  push.mockClear();
});

describe("WishForm — title requirement", () => {
  it("blocks submit and shows the helper when title is empty", async () => {
    const { onSubmit } = renderForm();

    fireEvent.click(screen.getByRole("button", { name: "Добавить в список" }));

    expect(
      await screen.findByText("Без названия не сохранить"),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits once a title is entered", async () => {
    const onSubmit = vi.fn(async (values: WishFormValues) => {
      void values;
      return { ok: true as const };
    });
    renderForm({ onSubmit });

    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Керамическая ваза" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Добавить в список" }));

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const submitted = onSubmit.mock.calls[0][0];
    expect(submitted.title).toBe("Керамическая ваза");
    expect(submitted.type).toBe("product");
    expect(submitted.priority).toBe("nice");
    expect(submitted.priceType).toBe("none");
  });

  it("surfaces a server-side title error the same way as the client check", async () => {
    const onSubmit = vi.fn(async () => ({
      ok: false as const,
      error: "title",
    }));
    renderForm({ onSubmit });

    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "X" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Добавить в список" }));

    expect(
      await screen.findByText("Без названия не сохранить"),
    ).toBeInTheDocument();
  });

  it("maps an unmapped server error code to the generic message, not the raw code", async () => {
    const onSubmit = vi.fn(async () => ({
      ok: false as const,
      error: "currency",
    }));
    renderForm({ onSubmit });

    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "X" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Добавить в список" }));

    expect(
      await screen.findByText("Не получилось сохранить — попробуй ещё раз"),
    ).toBeInTheDocument();
    expect(screen.queryByText("currency")).toBeNull();
  });

  it("maps a server 'url' error onto the link field's helper", async () => {
    const onSubmit = vi.fn(async () => ({ ok: false as const, error: "url" }));
    renderForm({ onSubmit });

    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Ваза" },
    });
    fireEvent.change(screen.getByLabelText("Ссылка"), {
      target: { value: "not-a-url" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Добавить в список" }));

    expect(
      await screen.findByText("Ссылка должна начинаться с http(s)://"),
    ).toBeInTheDocument();
  });
});

describe("WishForm — price", () => {
  it("blocks submit and shows priceInvalid when the range is backwards", async () => {
    const onSubmit = vi.fn(async () => ({ ok: true as const }));
    renderForm({ onSubmit });

    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Ваза" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Вилка от–до" }));
    fireEvent.change(screen.getByLabelText("от"), { target: { value: "300" } });
    fireEvent.change(screen.getByLabelText("до"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Добавить в список" }));

    expect(
      await screen.findByText("Проверь цену: «от» не больше «до»"),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("blocks submit and shows priceMissing for an empty exact amount, not priceInvalid", async () => {
    const onSubmit = vi.fn(async () => ({ ok: true as const }));
    renderForm({ onSubmit });

    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Ваза" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Точная" }));
    // Amount left empty — never typed into.
    fireEvent.click(screen.getByRole("button", { name: "Добавить в список" }));

    expect(await screen.findByText("Укажи цену")).toBeInTheDocument();
    expect(screen.queryByText("Проверь цену: «от» не больше «до»")).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("treats a zero or non-numeric amount as missing too", async () => {
    const onSubmit = vi.fn(async () => ({ ok: true as const }));
    renderForm({ onSubmit });

    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Ваза" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Точная" }));
    fireEvent.change(screen.getByLabelText("Точная"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Добавить в список" }));

    expect(await screen.findByText("Укажи цену")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("defaults the currency once a price mode is picked", () => {
    renderForm();
    fireEvent.click(screen.getByRole("tab", { name: "Точная" }));
    // The trigger's accessible name is now form.currencyLabel ("Валюта"); the
    // code/symbol live in its text content instead.
    expect(screen.getByRole("button", { name: "Валюта" })).toHaveTextContent(
      "USD",
    );
  });
});

describe("WishForm — priority and category", () => {
  it("selects a priority option", () => {
    renderForm();
    const idea = screen.getByRole("button", { name: "Просто идея" });
    fireEvent.click(idea);
    expect(idea).toHaveAttribute("aria-pressed", "true");
  });

  it("toggles a category chip off when tapped again", () => {
    renderForm();
    const chip = screen.getByRole("button", { name: "Дом" });
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "false");
  });
});

describe("WishForm — back navigation", () => {
  it("defaults the back control to '/'", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Назад" }));
    expect(push).toHaveBeenCalledWith("/");
  });

  it("honors a custom backHref (the edit form points back at the wish)", () => {
    renderForm({ backHref: "/wishes/abc123" });
    fireEvent.click(screen.getByRole("button", { name: "Назад" }));
    expect(push).toHaveBeenCalledWith("/wishes/abc123");
  });
});

const DRAFT_FIXTURE = {
  type: "product",
  title: "Черновик вазы",
  url: null,
  imageUrl: null,
  priceType: "none",
  priceMin: null,
  priceMax: null,
  currency: null,
  priority: "nice",
  isDream: false,
  category: null,
  notes: null,
};

describe("WishForm — draft (enableDraft)", () => {
  it("offers to resume a saved draft on mount", async () => {
    window.localStorage.setItem(
      "wishka-wish-draft:user-1",
      JSON.stringify(DRAFT_FIXTURE),
    );

    renderForm({ enableDraft: true, draftScope: "user-1" });

    fireEvent.click(await screen.findByRole("button", { name: "Продолжить" }));
    expect(screen.getByLabelText("Название")).toHaveValue("Черновик вазы");
  });

  it("does not offer a draft when there is none saved", () => {
    renderForm({ enableDraft: true, draftScope: "user-1" });
    expect(screen.queryByText("Черновик")).toBeNull();
  });

  it("keys the draft by draftScope, so one user's draft never surfaces for another", () => {
    window.localStorage.setItem(
      "wishka-wish-draft:user-1",
      JSON.stringify(DRAFT_FIXTURE),
    );

    // Same browser, different signed-in user — must not see user-1's draft.
    renderForm({ enableDraft: true, draftScope: "user-2" });
    expect(screen.queryByText("Черновик")).toBeNull();
    expect(screen.getByLabelText("Название")).toHaveValue("");
  });

  it("cancels the pending autosave on submit so it cannot resurrect a cleared draft", async () => {
    vi.useFakeTimers();
    try {
      const onSubmit = vi.fn(async (values: WishFormValues) => {
        void values;
        return { ok: true as const };
      });
      renderForm({ enableDraft: true, draftScope: "user-1", onSubmit });

      fireEvent.change(screen.getByLabelText("Название"), {
        target: { value: "Ваза" },
      });

      // The 500ms autosave is now pending; submit fires well before it would.
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Добавить в список" }),
        );
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(
        window.localStorage.getItem("wishka-wish-draft:user-1"),
      ).toBeNull();

      // If the pending timer hadn't been cancelled, it would fire here and
      // resurrect the draft that submit's success path just cleared.
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(
        window.localStorage.getItem("wishka-wish-draft:user-1"),
      ).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("WishForm — description field", () => {
  it("renders the description field and round-trips its value", async () => {
    const onSubmit = vi.fn(async (values: WishFormValues) => {
      void values;
      return { ok: true as const };
    });
    renderForm({ onSubmit });

    const description = screen.getByLabelText("Описание");
    expect(description).toHaveValue("");

    fireEvent.change(description, { target: { value: "Размер M, синий" } });
    expect(description).toHaveValue("Размер M, синий");

    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Свитер" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Добавить в список" }));

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].description).toBe("Размер M, синий");
  });

  it("prefills the description from `initial` (e.g. edit form)", () => {
    renderForm({ initial: { description: "Уже вручную заполнено" } });
    expect(screen.getByLabelText("Описание")).toHaveValue(
      "Уже вручную заполнено",
    );
  });
});

describe("WishForm — parsedPartial", () => {
  it("shows the partial-notice banner and highlights an empty title upfront", () => {
    renderForm({
      parsedUrl: true,
      parsedPartial: true,
      initial: { url: "https://shop.example.com/x" },
    });

    expect(
      screen.getByText("Собрали не всё — дозаполни, чего не хватает"),
    ).toBeInTheDocument();
    // No submit attempt has happened yet — the highlight comes from
    // parsedPartial alone, matching §6.3 step 2 "подсвеченные пустые поля".
    expect(screen.getByText("Без названия не сохранить")).toBeInTheDocument();
  });

  it("clears the title highlight once a title is entered", () => {
    renderForm({ parsedUrl: true, parsedPartial: true });

    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Кружка" },
    });

    expect(screen.queryByText("Без названия не сохранить")).toBeNull();
  });

  it("does not show the banner or the upfront highlight without parsedPartial", () => {
    renderForm();
    expect(
      screen.queryByText("Собрали не всё — дозаполни, чего не хватает"),
    ).toBeNull();
    expect(screen.queryByText("Без названия не сохранить")).toBeNull();
  });
});

describe("WishForm — parsedUrl", () => {
  it("renders the parsed-link variant with the 'from parser' meta label", () => {
    renderForm({
      parsedUrl: true,
      initial: { url: "https://shop.example.com/mug" },
    });

    expect(
      screen.getByText("https://shop.example.com/mug"),
    ).toBeInTheDocument();
    expect(screen.getByText("из парсера")).toBeInTheDocument();
    // The read-only row isn't a labelled form control.
    expect(screen.queryByLabelText("Ссылка")).toBeNull();
  });

  it("the edit affordance restores the editable link input", () => {
    renderForm({
      parsedUrl: true,
      initial: { url: "https://shop.example.com/mug" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Редактировать" }));

    const input = screen.getByLabelText("Ссылка");
    expect(input).toHaveValue("https://shop.example.com/mug");

    fireEvent.change(input, {
      target: { value: "https://shop.example.com/mug-2" },
    });
    expect(input).toHaveValue("https://shop.example.com/mug-2");
  });

  it("renders the ordinary editable link field when parsedUrl is not set", () => {
    renderForm();
    expect(screen.getByLabelText("Ссылка")).toBeInTheDocument();
  });
});
