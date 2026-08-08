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
// picker); stub it so rendering never depends on UploadThing's own setup. A
// controllable mock (not a fresh `vi.fn()` per render) so the mutual-
// exclusion test can drive a specific upload outcome.
const startUpload = vi.fn();
vi.mock("@/lib/uploadthing-client", () => ({
  useUploadThing: () => ({ startUpload }),
}));

// Real ai-actions.ts is a "use server" module that pulls in the DB layer
// (server-only); mock it the same way the rest of the suite mocks server
// actions (see add-wish-sheet.test.tsx's parseUrlAction).
const suggestDescriptionAction = vi.fn();
const suggestPriceAction = vi.fn();
vi.mock("@/app/wishes/ai-actions", () => ({
  suggestDescriptionAction: (input: unknown) => suggestDescriptionAction(input),
  suggestPriceAction: (input: unknown) => suggestPriceAction(input),
}));

// downscaleForWish uses createImageBitmap/canvas, unavailable in jsdom — the
// mutual-exclusion test only cares that a photo was picked, not the actual
// downscale, so pass the file straight through.
vi.mock("@/lib/wish-image", () => ({
  downscaleForWish: (file: File) => Promise.resolve(file),
}));

function renderForm(props: Partial<Parameters<typeof WishForm>[0]> = {}) {
  const onSubmit = props.onSubmit ?? vi.fn(async () => ({ ok: true as const }));
  const result = render(
    <NextIntlClientProvider locale="ru" messages={messages}>
      <WishForm
        submitLabel="Добавить в список"
        onSubmit={onSubmit}
        {...props}
      />
    </NextIntlClientProvider>,
  );
  return { onSubmit, container: result.container };
}

beforeEach(() => {
  window.localStorage.clear();
  push.mockClear();
  startUpload.mockReset();
  suggestDescriptionAction.mockReset();
  suggestPriceAction.mockReset();
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

  it("recovers from a submit that throws instead of resolving", async () => {
    const onSubmit = vi.fn(async () => {
      throw new Error("network");
    });
    renderForm({ onSubmit });

    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Ваза" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Добавить в список" }));

    expect(
      await screen.findByText("Не получилось сохранить — попробуй ещё раз"),
    ).toBeInTheDocument();
    // The button must leave the "Saving…" state, or the form is stuck for good.
    expect(screen.queryByText("Сохраняем…")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Добавить в список" }),
    ).toBeEnabled();
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

  it("never resumes a draft's armed generateImage flag (mirrors the edit form)", async () => {
    window.localStorage.setItem(
      "wishka-wish-draft:user-1",
      JSON.stringify({ ...DRAFT_FIXTURE, generateImage: true }),
    );
    renderForm({ ai: AI_QUOTA, enableDraft: true, draftScope: "user-1" });

    fireEvent.click(await screen.findByRole("button", { name: "Продолжить" }));

    expect(
      screen.getByRole("button", { name: "Сгенерировать (AI)" }),
    ).toHaveAttribute("aria-pressed", "false");
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

const CANDIDATES = {
  groups: [{ id: "g-1", name: "Семья", emoji: "🎁", color: null }],
  people: [{ userId: "u-2", name: "Борис", image: null, isPartner: false }],
};

describe("WishForm — «Кому видно»", () => {
  it("summarises 'everyone' by default", () => {
    renderForm({ candidates: CANDIDATES });

    expect(
      screen.getByRole("button", { name: /Кому видно/ }),
    ).toHaveTextContent("Всем");
  });

  it("summarises the subject count once the audience is narrowed", () => {
    renderForm({
      candidates: CANDIDATES,
      initial: {
        audience: { mode: "restricted", groupIds: ["g-1"], userIds: ["u-2"] },
      },
    });

    expect(
      screen.getByRole("button", { name: /Кому видно/ }),
    ).toHaveTextContent("2 получателям");
  });

  it("submits the audience picked in the sheet", async () => {
    const onSubmit = vi.fn(async (values: WishFormValues) => {
      void values;
      return { ok: true as const };
    });
    renderForm({ candidates: CANDIDATES, onSubmit });

    fireEvent.click(screen.getByRole("button", { name: /Кому видно/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Группам" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Семья/ }));
    fireEvent.click(screen.getByRole("button", { name: "Готово" }));

    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Ваза" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Добавить в список" }));

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].audience).toEqual({
      mode: "restricted",
      groupIds: ["g-1"],
      userIds: [],
    });
  });

  it("submits 'everyone' when the sheet is never opened", async () => {
    const onSubmit = vi.fn(async (values: WishFormValues) => {
      void values;
      return { ok: true as const };
    });
    renderForm({ candidates: CANDIDATES, onSubmit });

    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Ваза" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Добавить в список" }));

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].audience).toEqual({
      mode: "everyone",
      groupIds: [],
      userIds: [],
    });
  });

  it("keeps a restored draft's audience to the subjects still on offer", async () => {
    window.localStorage.setItem(
      "wishka-wish-draft:user-1",
      JSON.stringify({
        ...DRAFT_FIXTURE,
        audience: {
          mode: "restricted",
          groupIds: ["g-1", "g-gone"],
          userIds: ["u-gone"],
        },
      }),
    );
    const onSubmit = vi.fn(async (values: WishFormValues) => {
      void values;
      return { ok: true as const };
    });
    renderForm({
      enableDraft: true,
      draftScope: "user-1",
      candidates: CANDIDATES,
      onSubmit,
    });

    fireEvent.click(await screen.findByRole("button", { name: "Продолжить" }));
    fireEvent.click(screen.getByRole("button", { name: "Добавить в список" }));

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].audience).toEqual({
      mode: "restricted",
      groupIds: ["g-1"],
      userIds: [],
    });
  });

  it("points an 'empty_audience' rejection at the visibility control", async () => {
    const onSubmit = vi.fn(async () => ({
      ok: false as const,
      error: "empty_audience",
    }));
    renderForm({ candidates: CANDIDATES, onSubmit });

    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Ваза" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Добавить в список" }));

    expect(
      await screen.findByText(
        "Выбери хотя бы одного — иначе желание увидишь только ты",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Не получилось сохранить — попробуй ещё раз"),
    ).toBeNull();
  });

  it("reports an 'invalid_subject' rejection next to the audience, and clears it once it is re-picked", async () => {
    const onSubmit = vi.fn(async () => ({
      ok: false as const,
      error: "invalid_subject",
    }));
    renderForm({ candidates: CANDIDATES, onSubmit });

    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Ваза" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Добавить в список" }));

    expect(
      await screen.findByText("Не получилось — попробуй ещё раз"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Кому видно/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Группам" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Семья/ }));
    fireEvent.click(screen.getByRole("button", { name: "Готово" }));

    expect(screen.queryByText("Не получилось — попробуй ещё раз")).toBeNull();
  });

  it("falls back to 'everyone' for a draft saved before audiences existed", async () => {
    window.localStorage.setItem(
      "wishka-wish-draft:user-1",
      JSON.stringify(DRAFT_FIXTURE),
    );
    const onSubmit = vi.fn(async (values: WishFormValues) => {
      void values;
      return { ok: true as const };
    });
    renderForm({ enableDraft: true, draftScope: "user-1", onSubmit });

    fireEvent.click(await screen.findByRole("button", { name: "Продолжить" }));
    fireEvent.click(screen.getByRole("button", { name: "Добавить в список" }));

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].audience).toEqual({
      mode: "everyone",
      groupIds: [],
      userIds: [],
    });
  });
});

const AI_QUOTA = { text: 5, image: 3 };

describe("WishForm — AI unavailable (ai prop undefined)", () => {
  it("renders no AI affordance at all", () => {
    renderForm();
    expect(screen.queryByText("Предложить описание")).toBeNull();
    expect(screen.queryByText("Предложить цену")).toBeNull();
    expect(screen.queryByText("Сгенерировать (AI)")).toBeNull();
  });
});

describe("WishForm — aiDraft meta", () => {
  it("shows the ai.fromAi note when aiDraft is set", () => {
    renderForm({ aiDraft: true });
    expect(screen.getByText("собрано по описанию")).toBeInTheDocument();
  });

  it("does not show it otherwise", () => {
    renderForm();
    expect(screen.queryByText("собрано по описанию")).toBeNull();
  });
});

describe("WishForm — description suggestion", () => {
  it("accepts a suggestion into the description field", async () => {
    suggestDescriptionAction.mockResolvedValue({
      ok: true,
      value: { description: "Ручная работа, синий цвет" },
      remaining: 4,
    });
    renderForm({ ai: AI_QUOTA });

    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Свитер" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Предложить описание" }),
    );

    expect(
      await screen.findByText("Ручная работа, синий цвет"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Принять" }));

    expect(screen.getByLabelText("Описание")).toHaveValue(
      "Ручная работа, синий цвет",
    );
    // The candidate card is gone once accepted.
    expect(screen.queryByRole("button", { name: "Принять" })).toBeNull();
  });

  it("dismisses a suggestion without touching the field", async () => {
    suggestDescriptionAction.mockResolvedValue({
      ok: true,
      value: { description: "Не то" },
      remaining: 4,
    });
    renderForm({ ai: AI_QUOTA });

    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Свитер" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Предложить описание" }),
    );
    expect(await screen.findByText("Не то")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Скрыть" }));

    expect(screen.queryByText("Не то")).toBeNull();
    expect(screen.getByLabelText("Описание")).toHaveValue("");
  });

  it("shows the quota banner and disables the trigger once remaining hits 0", async () => {
    suggestDescriptionAction.mockResolvedValue({
      ok: false,
      reason: "quota",
      remaining: 0,
    });
    renderForm({ ai: AI_QUOTA });

    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Свитер" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Предложить описание" }),
    );

    // `remaining: 0` moves the shared `text` pool to 0, so the price
    // trigger's caption switches to the same exhausted copy too.
    await vi.waitFor(() =>
      expect(
        screen.getAllByText("AI-лимит на сегодня исчерпан — заполни вручную"),
      ).toHaveLength(2),
    );
    expect(
      screen.getByRole("button", { name: "Предложить описание" }),
    ).toBeDisabled();
  });

  it("disables the trigger while the title is empty, without ever calling the action", () => {
    renderForm({ ai: AI_QUOTA });

    expect(
      screen.getByRole("button", { name: "Предложить описание" }),
    ).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", { name: "Предложить описание" }),
    );
    expect(suggestDescriptionAction).not.toHaveBeenCalled();
  });

  it("shows the exhausted caption and dims the trigger before any click when the quota is already 0 on mount", () => {
    renderForm({ ai: { text: 0, image: 3 } });

    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Свитер" },
    });

    // Both the description and the price trigger share the `text` pool, so
    // the exhausted caption shows next to each.
    expect(
      screen.getAllByText("AI-лимит на сегодня исчерпан — заполни вручную"),
    ).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Предложить описание" }),
    ).toBeDisabled();
  });
});

describe("WishForm — price suggestion", () => {
  it("accepts a range suggestion into the price fields, stripping normalizeAmount's trailing .00", async () => {
    // `normalizeAmount` (shared with the parser and the AI prompts) always
    // answers a fixed-2 string — exercise that realistic shape, not a
    // pre-trimmed one.
    suggestPriceAction.mockResolvedValue({
      ok: true,
      value: { priceMin: "1200.00", priceMax: "1800.00", currency: "RUB" },
      remaining: 4,
    });
    renderForm({ ai: AI_QUOTA });

    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Ваза" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Предложить цену" }));
    expect(await screen.findByText("1200–1800 ₽")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Принять" }));

    expect(screen.getByRole("tab", { name: "Вилка от–до" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByLabelText("от")).toHaveValue("1200");
    expect(screen.getByLabelText("до")).toHaveValue("1800");
  });
});

describe("WishForm — generate-image (armed)", () => {
  it("arms and disarms the chip", () => {
    renderForm({ ai: AI_QUOTA });
    const chip = screen.getByRole("button", { name: "Сгенерировать (AI)" });

    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByText("Сгенерируем после сохранения"),
    ).toBeInTheDocument();

    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "false");
  });

  it("disables the chip and shows the exhausted caption when the image quota is 0", () => {
    renderForm({ ai: { text: 5, image: 0 } });
    expect(
      screen.getByRole("button", { name: "Сгенерировать (AI)" }),
    ).toBeDisabled();
    expect(
      screen.getByText("AI-лимит на сегодня исчерпан — загрузи своё фото"),
    ).toBeInTheDocument();
  });

  it("shows the armed state instead of an existing photo preview, and restores the preview on disarm", () => {
    renderForm({
      ai: AI_QUOTA,
      initial: { imageUrl: "https://cdn.example.com/vase.jpg" },
    });

    // Before arming: the existing photo is visible, no armed copy yet.
    expect(
      document.querySelector('img[src="https://cdn.example.com/vase.jpg"]'),
    ).not.toBeNull();
    expect(screen.queryByText("Сгенерируем после сохранения")).toBeNull();

    const chip = screen.getByRole("button", { name: "Сгенерировать (AI)" });
    fireEvent.click(chip);

    // Armed: the preview slot shows the armed state, not the photo — the
    // outcome (photo will be replaced) is visible before saving.
    expect(
      document.querySelector('img[src="https://cdn.example.com/vase.jpg"]'),
    ).toBeNull();
    expect(
      screen.getByText("Сгенерируем после сохранения"),
    ).toBeInTheDocument();

    fireEvent.click(chip);

    // Disarming restores the untouched photo value.
    expect(
      document.querySelector('img[src="https://cdn.example.com/vase.jpg"]'),
    ).not.toBeNull();
    expect(screen.queryByText("Сгенерируем после сохранения")).toBeNull();
  });

  it("picking and uploading a photo disarms an armed chip", async () => {
    startUpload.mockResolvedValue([
      { ufsUrl: "https://cdn.example.com/x.jpg" },
    ]);
    const { container } = renderForm({ ai: AI_QUOTA });

    const chip = screen.getByRole("button", { name: "Сгенерировать (AI)" });
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");

    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();
    const file = new File(["x"], "photo.png", { type: "image/png" });

    await act(async () => {
      fireEvent.change(fileInput as HTMLInputElement, {
        target: { files: [file] },
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() =>
      expect(chip).toHaveAttribute("aria-pressed", "false"),
    );
  });
});

describe("WishForm — AI never blocks submit (regression)", () => {
  it("still submits with just a title after a suggestion action rejects", async () => {
    suggestDescriptionAction.mockRejectedValue(new Error("boom"));
    const onSubmit = vi.fn(async (values: WishFormValues) => {
      void values;
      return { ok: true as const };
    });
    renderForm({ ai: AI_QUOTA, onSubmit });

    fireEvent.change(screen.getByLabelText("Название"), {
      target: { value: "Ваза" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Предложить описание" }),
    );
    expect(
      await screen.findByText("Не получилось — попробуй ещё раз"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Добавить в список" }));

    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].title).toBe("Ваза");
  });
});

describe("WishForm — base currency (§6.3, states audit #6)", () => {
  it("anchors an empty price on the owner's base currency, not USD", () => {
    renderForm({ baseCurrency: "GEL" });

    fireEvent.click(screen.getByRole("tab", { name: "Точная" }));

    expect(
      screen.getByRole("button", { name: "Валюта" }).textContent,
    ).toContain("GEL");
  });

  it("pins the base currency at the top of the currency sheet", () => {
    renderForm({ baseCurrency: "GEL", initial: { priceType: "exact" } });

    fireEvent.click(screen.getByRole("button", { name: "Валюта" }));

    const recentHeading = screen.getByText("Базовая и недавние");
    const recentSection = recentHeading.parentElement as HTMLElement;
    expect(recentSection.textContent).toContain("GEL");
  });

  it("falls back to USD only when no caller supplies a base currency", () => {
    renderForm();

    fireEvent.click(screen.getByRole("tab", { name: "Точная" }));

    expect(
      screen.getByRole("button", { name: "Валюта" }).textContent,
    ).toContain("USD");
  });
});

describe("WishForm — photo picker (a11y #3, §6.3 error kinds)", () => {
  function pick(container: HTMLElement, file: File) {
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    return act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
      await Promise.resolve();
    });
  }

  it("exposes the picker as a focusable button, not a bare label", () => {
    renderForm();

    const picker = screen.getByRole("button", { name: "Фото" });
    picker.focus();
    expect(document.activeElement).toBe(picker);
  });

  it("names a non-image pick instead of failing generically", async () => {
    const { container } = renderForm();

    await pick(
      container,
      new File(["x"], "notes.pdf", { type: "application/pdf" }),
    );

    expect(screen.getByText("Это не картинка")).toBeInTheDocument();
    expect(startUpload).not.toHaveBeenCalled();
  });

  it("names an oversized pick instead of failing generically", async () => {
    const { container } = renderForm();
    const huge = new File(["x"], "huge.png", { type: "image/png" });
    Object.defineProperty(huge, "size", { value: 40 * 1024 * 1024 });

    await pick(container, huge);

    expect(screen.getByText("Файл слишком большой")).toBeInTheDocument();
    expect(startUpload).not.toHaveBeenCalled();
  });

  it("still shows the generic message when the upload itself fails", async () => {
    startUpload.mockRejectedValue(new Error("network"));
    const { container } = renderForm();

    await pick(container, new File(["x"], "photo.png", { type: "image/png" }));

    expect(
      await screen.findByText("Не получилось загрузить"),
    ).toBeInTheDocument();
  });
});

describe("WishForm — focus visibility (a11y #4)", () => {
  it("gives the dream toggle a focus cue on its label", () => {
    const { container } = renderForm();

    const checkbox = container.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    const label = checkbox.closest("label") as HTMLElement;

    expect(label.className).toContain("focus-within:border-accent");
  });

  it("labels the price-mode tablist", () => {
    renderForm();

    expect(screen.getByRole("tablist", { name: "Цена" })).toBeInTheDocument();
  });
});
