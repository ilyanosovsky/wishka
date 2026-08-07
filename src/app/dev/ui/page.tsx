import { notFound } from "next/navigation";
import { UiPlayground } from "./playground";

/** Dev-only component gallery — every Paper Ledger component in every state.
 *  Check it in BOTH themes and BOTH locales (switchers at the top). */
export default function DevUiPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <UiPlayground />;
}
