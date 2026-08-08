import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ru.json";
import { clearPartnerAction, setPartnerAction } from "@/app/profile/actions";
import { PartnerBlock } from "./partner-block";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("@/app/profile/actions", () => ({
  setPartnerAction: vi.fn(),
  clearPartnerAction: vi.fn(),
}));

const setPartnerActionMock = vi.mocked(setPartnerAction);
const clearPartnerActionMock = vi.mocked(clearPartnerAction);

function renderBlock(props: Partial<Parameters<typeof PartnerBlock>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="ru" messages={messages}>
      <PartnerBlock partner={null} candidates={[]} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("PartnerBlock", () => {
  it("shows the empty state with a create-group link when there are no candidates", () => {
    renderBlock();
    expect(
      screen.getByText("Партнёр выбирается из участников твоих групп"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Создать группу" }),
    ).toHaveAttribute("href", "/people");
  });

  it("opens the picker and sets a partner on tap, confirming with a toast", async () => {
    setPartnerActionMock.mockResolvedValue({ ok: true });
    renderBlock({
      candidates: [
        { userId: "u1", name: "Аня", image: null },
        { userId: "u2", name: "Боря", image: null },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Добавить партнёра" }));
    fireEvent.click(screen.getByRole("button", { name: /Аня/ }));

    await waitFor(() =>
      expect(setPartnerActionMock).toHaveBeenCalledWith("u1"),
    );
    await waitFor(() =>
      expect(screen.getByText("Сохранено")).toBeInTheDocument(),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("filters candidates by the search query", () => {
    renderBlock({
      candidates: [
        { userId: "u1", name: "Аня", image: null },
        { userId: "u2", name: "Боря", image: null },
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Добавить партнёра" }));
    fireEvent.change(screen.getByPlaceholderText("Поиск по участникам"), {
      target: { value: "бор" },
    });

    expect(
      screen.queryByRole("button", { name: /Аня/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Боря/ })).toBeInTheDocument();
  });

  it("shows an existing partner with a remove control", async () => {
    clearPartnerActionMock.mockResolvedValue({ ok: true });
    renderBlock({ partner: { userId: "u1", name: "Аня", image: null } });

    expect(screen.getByText("Аня")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Убрать" }));

    await waitFor(() => expect(clearPartnerActionMock).toHaveBeenCalled());
    expect(refresh).toHaveBeenCalled();
  });

  it("surfaces a failure toast when setting a partner fails", async () => {
    setPartnerActionMock.mockResolvedValue({ ok: false, error: "not_shared" });
    renderBlock({ candidates: [{ userId: "u1", name: "Аня", image: null }] });

    fireEvent.click(screen.getByRole("button", { name: "Добавить партнёра" }));
    fireEvent.click(screen.getByRole("button", { name: /Аня/ }));

    await waitFor(() =>
      expect(
        screen.getByText("Не получилось — попробуй ещё раз"),
      ).toBeInTheDocument(),
    );
  });
});
