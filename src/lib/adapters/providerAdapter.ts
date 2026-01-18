import type { ProviderRow } from "@/server/providers";
import { emailAdapter } from "./emailAdapter";
import { webFormAdapter } from "./webFormAdapter";

export type OutboundRfqCustomer = {
  name?: string | null;
  email?: string | null;
  company?: string | null;
  phone?: string | null;
};

export type OutboundRfqFileLink = {
  label: string;
  url: string;
};

export type OutboundRfqDestination = {
  id: string;
  offerLink?: string | null;
};

export type OutboundRfqQuote = {
  id: string;
  title?: string | null;
  process?: string | null;
  material?: string | null;
  quantity?: string | number | null;
  tolerances?: string | null;
  finish?: string | null;
  targetDate?: string | null;
  desiredLeadTime?: string | null;
};

export type BuildOutboundArgs = {
  provider: ProviderRow;
  quote: OutboundRfqQuote;
  destination?: OutboundRfqDestination | null;
  customer?: OutboundRfqCustomer | null;
  files?: OutboundRfqFileLink[];
};

export type OutboundRfqDispatch =
  | {
      mode: "email";
      subject: string;
      body: string;
    }
  | {
      mode: "web_form";
      webFormUrl: string | null;
      webFormInstructions: string;
    }
  | {
      mode: "api";
      payloadJson: Record<string, unknown>;
    };

export type ProviderAdapter = {
  supports(provider: ProviderRow): boolean;
  buildOutbound(args: BuildOutboundArgs): OutboundRfqDispatch;
};

const ADAPTERS: ProviderAdapter[] = [emailAdapter, webFormAdapter];

export function getAdapterForProvider(provider: ProviderRow): ProviderAdapter | null {
  return ADAPTERS.find((adapter) => adapter.supports(provider)) ?? null;
}
