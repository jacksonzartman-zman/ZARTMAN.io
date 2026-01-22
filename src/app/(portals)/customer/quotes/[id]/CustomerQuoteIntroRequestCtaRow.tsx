"use client";

import { useState } from "react";
import type { RfqOffer } from "@/server/rfqs/offers";
import { CustomerQuoteDecisionCtaRow } from "./CustomerQuoteDecisionCtaRow";
import { RequestIntroductionModal } from "./RequestIntroductionModal";
import { saveIntroRequestedState } from "./introRequestClientState";

type DecisionCta = {
  label: string;
  href?: string;
  disabled?: boolean;
  kind?: "share";
};

export function CustomerQuoteIntroRequestCtaRow({
  quoteId,
  offers,
  shortlistedOfferIds,
  shortlistOnlyMode,
  defaultEmail,
  defaultCompany,
  statusLabel,
  helperCopy,
  secondary,
  sharePath,
}: {
  quoteId: string;
  offers: RfqOffer[];
  shortlistedOfferIds?: string[] | null;
  shortlistOnlyMode?: boolean;
  defaultEmail?: string | null;
  defaultCompany?: string | null;
  statusLabel: string;
  helperCopy?: string | null;
  secondary?: DecisionCta | null;
  sharePath?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <CustomerQuoteDecisionCtaRow
        statusLabel={statusLabel}
        helperCopy={helperCopy}
        primary={{
          label: "Request introduction",
          kind: "button",
          onClick: () => setOpen(true),
        }}
        secondary={secondary}
        sharePath={sharePath}
      />
      <RequestIntroductionModal
        open={open}
        onClose={() => setOpen(false)}
        quoteId={quoteId}
        offers={offers}
        shortlistedOfferIds={shortlistedOfferIds}
        shortlistOnlyMode={shortlistOnlyMode}
        defaultEmail={defaultEmail}
        defaultCompany={defaultCompany}
        onSubmitted={(payload) => {
          saveIntroRequestedState(payload);
        }}
      />
    </>
  );
}

