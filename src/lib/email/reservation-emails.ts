import "server-only";

import { getFromAddress, getResend } from "./client";
import { renderLedgerEmail, type LedgerEmailCta } from "./template";
import {
  formatChangedFields,
  giftGiven,
  guestBookingConfirmation,
  reservedWishChanged,
  reservedWishDeleted,
  reservedWishHidden,
  type Locale,
  type ReservationChangedField,
} from "./copy";

/**
 * All five senders take ready-built params (URLs included — callers own
 * NEXT_PUBLIC_APP_URL) and never touch the DB. They run inside next/server
 * `after()`, post-response: a failed send must never surface as a request
 * error, so every sender catches and console.error's instead of throwing.
 */

async function send(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const { error } = await getResend().emails.send({
    from: getFromAddress(),
    to: params.to,
    subject: params.subject,
    html: params.html,
    text: params.text,
  });
  if (error)
    throw new Error(`Resend send failed: ${error.name}: ${error.message}`);
}

export async function sendGuestBookingConfirmation(params: {
  to: string;
  locale: Locale;
  guestName: string;
  wishTitle: string;
  manageUrl: string;
}): Promise<void> {
  try {
    const cta: LedgerEmailCta = {
      label: guestBookingConfirmation.cta[params.locale],
      url: params.manageUrl,
    };
    const { subject, html, text } = renderLedgerEmail({
      locale: params.locale,
      subject: guestBookingConfirmation.subject[params.locale],
      heading: guestBookingConfirmation.heading[params.locale],
      bodyLines: guestBookingConfirmation.body(params.wishTitle, params.locale),
      cta,
    });
    await send({ to: params.to, subject: subject!, html, text });
  } catch (err) {
    console.error("sendGuestBookingConfirmation failed:", err);
  }
}

export async function sendReservedWishChanged(params: {
  to: string;
  locale: Locale;
  wishTitle: string;
  changedFields: ReservationChangedField[];
  wishAppUrl: string;
}): Promise<void> {
  try {
    const changedFieldsLabel = formatChangedFields(
      params.changedFields,
      params.locale,
    );
    const cta: LedgerEmailCta = {
      label: reservedWishChanged.cta[params.locale],
      url: params.wishAppUrl,
    };
    const { subject, html, text } = renderLedgerEmail({
      locale: params.locale,
      subject: reservedWishChanged.subject[params.locale],
      heading: reservedWishChanged.heading[params.locale],
      bodyLines: reservedWishChanged.body(
        params.wishTitle,
        changedFieldsLabel,
        params.locale,
      ),
      cta,
    });
    await send({ to: params.to, subject: subject!, html, text });
  } catch (err) {
    console.error("sendReservedWishChanged failed:", err);
  }
}

export async function sendReservedWishDeleted(params: {
  to: string;
  locale: Locale;
  wishTitle: string;
}): Promise<void> {
  try {
    const { subject, html, text } = renderLedgerEmail({
      locale: params.locale,
      subject: reservedWishDeleted.subject[params.locale],
      heading: reservedWishDeleted.heading[params.locale],
      bodyLines: reservedWishDeleted.body(params.wishTitle, params.locale),
    });
    await send({ to: params.to, subject: subject!, html, text });
  } catch (err) {
    console.error("sendReservedWishDeleted failed:", err);
  }
}

/**
 * Sent when the owner narrowed a wish's audience past the holder of a booking. Like
 * every sender here it takes plain params: it must not be able to look a
 * reserver up, only to be handed one inside `after()`.
 */
export async function sendReservedWishHidden(params: {
  to: string;
  locale: Locale;
  wishTitle: string;
}): Promise<void> {
  try {
    const { subject, html, text } = renderLedgerEmail({
      locale: params.locale,
      subject: reservedWishHidden.subject[params.locale],
      heading: reservedWishHidden.heading[params.locale],
      bodyLines: reservedWishHidden.body(params.wishTitle, params.locale),
    });
    await send({ to: params.to, subject: subject!, html, text });
  } catch (err) {
    console.error("sendReservedWishHidden failed:", err);
  }
}

export async function sendGiftGiven(params: {
  to: string;
  locale: Locale;
  wishTitle: string;
}): Promise<void> {
  try {
    const { subject, html, text } = renderLedgerEmail({
      locale: params.locale,
      subject: giftGiven.subject[params.locale],
      heading: giftGiven.heading[params.locale],
      bodyLines: giftGiven.body(params.wishTitle, params.locale),
    });
    await send({ to: params.to, subject: subject!, html, text });
  } catch (err) {
    console.error("sendGiftGiven failed:", err);
  }
}
