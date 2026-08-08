import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/ru.json";
import type { ViewerWish } from "@/db/access/types";
import { PublicList, type PublicListProps } from "./public-list";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => "/u/ilya",
}));

// The merge banner pulls in the reserve server actions; keep them off the
// client test's import graph.
vi.mock("@/app/reserve/actions", () => ({
  mergeGuestReservationsAction: vi.fn(async () => ({ ok: true, moved: 0 })),
}));

beforeEach(() => {
  push.mockClear();
  window.sessionStorage.clear();
});

// LocaleSwitcher (guest banner) imports the server action; stub it out.
vi.mock("@/i18n/actions", () => ({
  setLocale: vi.fn(async () => {}),
}));

function viewerWish(overrides: Partial<ViewerWish> = {}): ViewerWish {
  return {
    id: "w-1",
    ownerId: "owner-1",
    type: "product",
    title: "Керамическая ваза",
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
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    reservationStatus: "free",
    ...overrides,
  };
}

function renderPublicList(props: Partial<PublicListProps> = {}) {
  return render(
    <NextIntlClientProvider locale="ru" messages={messages}>
      <PublicList
        name="ilya"
        nickname="ilya"
        wishes={[viewerWish()]}
        sizes={{}}
        tastes={[]}
        noGift={[]}
        isGuest={false}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("PublicList — guest vs friend chrome", () => {
  it("shows the guest banner and hides the tab bar for a guest", () => {
    renderPublicList({ isGuest: true });

    expect(screen.getByText("Вы смотрите список: ilya")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Создать свой" }),
    ).toBeInTheDocument();
    // No app chrome for anonymous visitors.
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("sends «Создать свой» back to this list after login", () => {
    renderPublicList({ isGuest: true });

    fireEvent.click(screen.getByRole("button", { name: "Создать свой" }));

    expect(push).toHaveBeenCalledWith("/login?next=%2Fu%2Filya");
  });

  it("shows the tab bar and no guest banner for a logged-in viewer", () => {
    renderPublicList({ isGuest: false });

    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.queryByText("Вы смотрите список: ilya")).toBeNull();
  });
});

describe("PublicList — guest booking merge prompt", () => {
  it("is absent when this device holds no guest bookings", async () => {
    renderPublicList();
    await vi.waitFor(() =>
      expect(screen.queryByRole("button", { name: "Перенести" })).toBeNull(),
    );
  });

  it("appears when the signed-in viewer still carries guest bookings", async () => {
    renderPublicList({ mergeCount: 1 });

    expect(
      await screen.findByRole("button", { name: "Перенести" }),
    ).toBeInTheDocument();
  });
});

describe("PublicList — what matters block", () => {
  it("is omitted when the profile has no public parameters", () => {
    renderPublicList();
    expect(screen.queryByText("Что важно знать")).toBeNull();
  });

  it("appears when at least one parameter is set", () => {
    renderPublicList({ tastes: ["coffee"] });
    expect(screen.getByText("Что важно знать")).toBeInTheDocument();
  });
});

describe("PublicList — empty state", () => {
  it("shows the owner-empty message with a hint for a logged-in viewer", () => {
    renderPublicList({ wishes: [], isGuest: false });
    expect(screen.getByText("Список ilya: пока пусто")).toBeInTheDocument();
    expect(screen.getByText(/Загляните в «Что важно знать»/)).toBeInTheDocument();
  });

  it("drops the friend hint for a guest", () => {
    renderPublicList({ wishes: [], isGuest: true });
    expect(screen.getByText("Список ilya: пока пусто")).toBeInTheDocument();
    expect(screen.queryByText(/Загляните в «Что важно знать»/)).toBeNull();
  });
});

describe("PublicList — owner identity (§6.5, states audit #1)", () => {
  it("shows the display name, never the nickname, in header and banner", () => {
    renderPublicList({
      name: "Маша",
      nickname: "ilya-nosovsky",
      isGuest: true,
    });

    expect(screen.getByRole("heading", { name: "Маша" })).toBeInTheDocument();
    expect(screen.getByText("Вы смотрите список: Маша")).toBeInTheDocument();
    // The nickname survives only where it belongs: inside the share URL.
    expect(screen.queryByText("ilya-nosovsky")).toBeNull();
    expect(screen.getByText(/\/u\/ilya-nosovsky$/)).toBeInTheDocument();
  });

  it("renders the owner's avatar image when they have one", () => {
    const { container } = renderPublicList({
      name: "Маша",
      image: "https://app123.ufs.sh/f/avatar-masha",
    });

    expect(
      container.querySelector(
        'img[src="https://app123.ufs.sh/f/avatar-masha"]',
      ),
    ).not.toBeNull();
  });

  it("falls back to the initial tile when there is no avatar", () => {
    renderPublicList({ name: "Маша", image: null });

    expect(screen.getByRole("img", { name: "Маша" }).textContent).toBe("М");
  });
});
