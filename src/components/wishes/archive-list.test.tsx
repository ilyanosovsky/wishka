import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ru.json";
import type { OwnerWish } from "@/db/access/types";
import { ArchiveList } from "./archive-list";

afterEach(cleanup);

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
}));

const restoreWishAction = vi.fn(async (id: string) => {
  void id;
  return { ok: true };
});
const destroyWishAction = vi.fn(async (id: string) => {
  void id;
  return { ok: true };
});
vi.mock("@/app/wishes/actions", () => ({
  restoreWishAction: (id: string) => restoreWishAction(id),
  destroyWishAction: (id: string) => destroyWishAction(id),
}));

beforeEach(() => {
  refresh.mockClear();
  restoreWishAction.mockClear();
  destroyWishAction.mockClear();
});

function wish(overrides: Partial<OwnerWish>): OwnerWish {
  return {
    id: "id-1",
    ownerId: "owner-1",
    type: "product",
    title: "Ваза",
    url: null,
    imageKey: null,
    imageStatus: "none",
    description: null,
    priceType: "none",
    priceMin: null,
    priceMax: null,
    currency: null,
    priority: "nice",
    isDream: false,
    category: null,
    notes: null,
    visibility: "everyone",
    status: "gifted",
    giftedAt: new Date("2026-05-12T00:00:00.000Z"),
    giftedBy: "Маша",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function renderList(wishes: OwnerWish[]) {
  render(
    <NextIntlClientProvider locale="ru" messages={messages}>
      <ArchiveList wishes={wishes} />
    </NextIntlClientProvider>,
  );
}

describe("ArchiveList — grouping", () => {
  it("shows the empty state when there is nothing archived", () => {
    renderList([]);
    expect(
      screen.getByText("Здесь будут подарки, которые тебе уже вручили"),
    ).toBeInTheDocument();
  });

  it("groups by giftedAt year, newest first, unknown year last", () => {
    renderList([
      wish({ id: "a", title: "Из 2025", giftedAt: new Date("2025-03-01") }),
      wish({ id: "b", title: "Из 2026", giftedAt: new Date("2026-06-01") }),
      wish({ id: "c", title: "Без даты", giftedAt: null }),
    ]);

    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(headings).toEqual(["— 2026 —", "— 2025 —", "— — —"]);
  });
});

describe("ArchiveList — actions", () => {
  it("opens the action sheet for a tapped wish and restores it", async () => {
    renderList([wish({ id: "a", title: "Керамическая ваза" })]);

    fireEvent.click(screen.getByText("Керамическая ваза"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Вернуть в список" }),
    );

    await vi.waitFor(() => expect(restoreWishAction).toHaveBeenCalledWith("a"));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("requires confirmation before deleting forever", async () => {
    renderList([wish({ id: "a", title: "Керамическая ваза" })]);

    fireEvent.click(screen.getByText("Керамическая ваза"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Удалить навсегда" }),
    );

    expect(destroyWishAction).not.toHaveBeenCalled();
    expect(await screen.findByText("Удалить навсегда?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));

    await vi.waitFor(() => expect(destroyWishAction).toHaveBeenCalledWith("a"));
    await vi.waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

describe("ArchiveList — action failures", () => {
  it("shows common.actionFailed when restore fails, instead of failing silently", async () => {
    restoreWishAction.mockResolvedValueOnce({ ok: false });
    renderList([wish({ id: "a", title: "Керамическая ваза" })]);

    fireEvent.click(screen.getByText("Керамическая ваза"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Вернуть в список" }),
    );

    expect(
      await screen.findByText("Не получилось — попробуй ещё раз"),
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows common.actionFailed when deleting forever fails", async () => {
    destroyWishAction.mockResolvedValueOnce({ ok: false });
    renderList([wish({ id: "a", title: "Керамическая ваза" })]);

    fireEvent.click(screen.getByText("Керамическая ваза"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Удалить навсегда" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Удалить" }));

    expect(
      await screen.findByText("Не получилось — попробуй ещё раз"),
    ).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
