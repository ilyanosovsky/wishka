"use client";

import { List, User, Users } from "lucide-react";
import { useState } from "react";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Avatar, AvatarGroup, SquareAvatar } from "@/components/ui/avatar";
import {
  DreamStamp,
  NullPill,
  PriorityFlag,
  StatusBadge,
  VisibilityLockBadge,
} from "@/components/ui/badges";
import { AlertBanner } from "@/components/ui/banner";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { FilterChip, NoGiftChip, TagChip } from "@/components/ui/chip";
import { Dialog } from "@/components/ui/dialog";
import { Fab } from "@/components/ui/fab";
import { Field, TextField } from "@/components/ui/field";
import { Skeleton, SkeletonWishCard } from "@/components/ui/skeleton";
import { TabBar } from "@/components/ui/tab-bar";
import { Tabs } from "@/components/ui/tabs";
import { InfoToast, UndoToast } from "@/components/ui/toast";
import { WishCard, type BaseWish } from "@/components/ui/wish-card";

const IMG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="#c98d5e"/><circle cx="200" cy="210" r="90" fill="#e8cbb0"/><rect x="120" y="330" width="160" height="90" fill="#93582f"/></svg>`,
  );

const baseWish: BaseWish = {
  title: "Bambu Lab A1 Mini + AMS Lite — стартовый набор для печати",
  imageUrl: IMG,
  imageStatus: "ready",
  category: "Хобби",
  priceType: "exact",
  priceMin: "2200",
  priceMax: null,
  currency: "GEL",
  priority: "want",
  isDream: false,
};

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-b border-rule pb-6">
      <h2 className="pt-2 font-mono text-[10.5px] font-medium tracking-[0.1em] uppercase text-mute">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function UiPlayground() {
  const [tab, setTab] = useState("all");
  const [priceMode, setPriceMode] = useState("exact");
  const [chips, setChips] = useState<string[]>(["dreams"]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draftOpen, setDraftOpen] = useState(false);
  const [undoOpen, setUndoOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  function toggleChip(key: string) {
    setChips((prev) =>
      prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key],
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-105 flex-col gap-6 px-6 pt-10 pb-32">
      <header className="border-b-2 border-ink pb-4">
        <h1 className="font-serif text-[24px] font-semibold tracking-[-0.01em]">
          UI Playground
        </h1>
        <div className="mt-3 flex gap-3">
          <ThemeSwitcher />
          <LocaleSwitcher />
        </div>
      </header>

      <Section title="Buttons">
        <div className="flex flex-wrap gap-2">
          <Button>Default</Button>
          <Button variant="primary">Primary</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="primary" loading>
            Сохраняем…
          </Button>
        </div>
      </Section>

      <Section title="Fields">
        <TextField label="Почта" placeholder="you@example.com" />
        <TextField
          label="С ошибкой"
          error
          helperText="Похоже, в адресе опечатка"
          defaultValue="bad@"
        />
        <TextField
          label="Заблокировано"
          locked
          defaultValue="wishka.app/u/ilya"
        />
        <Field
          variant="parsed-link"
          value="https://store.example.com/item/bambu-a1-mini"
          meta="из парсера"
          readOnly
        />
      </Section>

      <Section title="Tabs / segmented">
        <Tabs
          fill="ink"
          value={tab}
          onChange={setTab}
          items={[
            { value: "all", label: "Все", count: 7 },
            { value: "dreams", label: "Мечты" },
            { value: "home", label: "Дом" },
          ]}
        />
        <Tabs
          fill="accent"
          value={priceMode}
          onChange={setPriceMode}
          items={[
            { value: "exact", label: "Точная" },
            { value: "range", label: "Вилка от–до" },
          ]}
        />
      </Section>

      <Section title="Chips">
        <div className="flex flex-wrap gap-2">
          {["dreams", "tech", "home"].map((key) => (
            <FilterChip
              key={key}
              selected={chips.includes(key)}
              onClick={() => toggleChip(key)}
            >
              {key === "dreams"
                ? "Мечты"
                : key === "tech"
                  ? "Электроника"
                  : "Дом"}
            </FilterChip>
          ))}
          <TagChip>люблю чай</TagChip>
          <TagChip>настолки</TagChip>
          <NoGiftChip>не дарить: свечи</NoGiftChip>
        </div>
      </Section>

      <Section title="Avatars">
        <div className="flex items-center gap-4">
          <Avatar size="sm" name="Маша" />
          <Avatar size="md" name="Илья" />
          <Avatar size="lg" name="Wishka" src={IMG} />
          <SquareAvatar initial="И" />
          <AvatarGroup
            avatars={[
              { name: "Маша" },
              { name: "Илья" },
              { name: "Ната" },
              { name: "Лев" },
              { name: "Оля" },
            ]}
            max={3}
          />
        </div>
      </Section>

      <Section title="Banners">
        <AlertBanner tone="error">Не получилось отправить письмо</AlertBanner>
        <AlertBanner tone="warning">Лимит AI на сегодня исчерпан</AlertBanner>
        <AlertBanner tone="success" actionLabel="Вставить" onAction={() => {}}>
          Добавить ссылку из буфера?
        </AlertBanner>
      </Section>

      <Section title="Badges">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status="free" label="Свободно" />
          <StatusBadge status="reserved" label="Забронировано" />
          <StatusBadge status="reservedByYou" label="Забронировано вами" />
          <StatusBadge status="gifted" label="Подарено" />
          <DreamStamp label="Мечта" />
          <NullPill label="нет цены" />
          <VisibilityLockBadge label="Видно не всем" />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <PriorityFlag priority="want" label="Очень хочу" />
          <PriorityFlag priority="nice" label="Было бы приятно" />
          <PriorityFlag priority="idea" label="Просто идея" />
        </div>
      </Section>

      <Section title="Wish card — owner">
        <div className="grid grid-cols-2 gap-3">
          <WishCard role="owner" wish={baseWish} />
          <WishCard
            role="owner"
            restrictedVisibility
            wish={{
              ...baseWish,
              title: "Нижнее бельё",
              imageUrl: null,
              imageStatus: "none",
              category: "Одежда",
              priceType: "range",
              priceMin: "80",
              priceMax: "120",
              currency: "EUR",
              priority: "nice",
            }}
          />
          <WishCard
            role="owner"
            wish={{
              ...baseWish,
              title: "Поплавать с китами",
              imageStatus: "generating",
              imageUrl: null,
              category: "Впечатления",
              priceType: "none",
              priceMin: null,
              priceMax: null,
              currency: null,
              isDream: true,
              priority: "idea",
            }}
          />
          <WishCard
            role="owner"
            wish={{
              ...baseWish,
              title: "Dyson Airwrap HS09",
              imageStatus: "failed",
              imageUrl: null,
              category: "Красота",
            }}
            onRetryImage={() => {}}
            onUploadImage={() => {}}
          />
        </div>
      </Section>

      <Section title="Wish card — viewer">
        <div className="grid grid-cols-2 gap-3">
          <WishCard role="viewer" reservationStatus="free" wish={baseWish} />
          <WishCard
            role="viewer"
            reservationStatus="reserved"
            wish={baseWish}
          />
          <WishCard
            role="viewer"
            reservationStatus="reserved_by_you"
            wish={baseWish}
          />
          <WishCard
            role="archive"
            giftedAt="2026-05-12"
            giftedBy="Маша"
            wish={{ ...baseWish, title: "Stitch Funko Pop" }}
          />
        </div>
      </Section>

      <Section title="Skeletons">
        <div className="grid grid-cols-2 gap-3">
          <SkeletonWishCard />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="aspect-square w-full" />
          </div>
        </div>
      </Section>

      <Section title="Overlays">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setSheetOpen(true)}>Bottom sheet</Button>
          <Button variant="danger" onClick={() => setDialogOpen(true)}>
            Удалить желание
          </Button>
          <Button onClick={() => setDraftOpen(true)}>Черновик</Button>
          <Button onClick={() => setUndoOpen(true)}>Undo toast</Button>
          <Button onClick={() => setInfoOpen(true)}>Info toast</Button>
        </div>
      </Section>

      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Кому видно"
      >
        <p className="text-mute">
          Содержимое шита — прокрутка блокируется, скрим закрывает.
        </p>
      </BottomSheet>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Удалить желание?"
        description="Его можно будет вернуть в течение 5 секунд."
        actions={[
          {
            label: "Отмена",
            onClick: () => setDialogOpen(false),
            tone: "neutral",
          },
          {
            label: "Удалить",
            onClick: () => {
              setDialogOpen(false);
              setUndoOpen(true);
            },
            tone: "destructive",
          },
        ]}
      />

      <Dialog
        open={draftOpen}
        onClose={() => setDraftOpen(false)}
        title="Сохранить черновик?"
        actions={[
          {
            label: "Удалить",
            onClick: () => setDraftOpen(false),
            tone: "neutral",
          },
          {
            label: "Сохранить",
            onClick: () => setDraftOpen(false),
            tone: "accent",
          },
        ]}
      />

      <UndoToast
        open={undoOpen}
        message="Желание удалено"
        actionLabel="Отменить"
        onAction={() => setUndoOpen(false)}
        onDismiss={() => setUndoOpen(false)}
      />
      <InfoToast
        open={infoOpen}
        message="Картинка готова"
        actionLabel="Показать"
        onAction={() => setInfoOpen(false)}
        onDismiss={() => setInfoOpen(false)}
      />

      <Fab ariaLabel="Добавить желание" onClick={() => setSheetOpen(true)} />
      <TabBar
        items={[
          { key: "list", label: "Список", icon: List, href: "/dev/ui" },
          { key: "people", label: "Люди", icon: Users, href: "/dev/ui#people" },
          {
            key: "profile",
            label: "Профиль",
            icon: User,
            href: "/dev/ui#profile",
          },
        ]}
      />
    </main>
  );
}
