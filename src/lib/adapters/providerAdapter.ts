import type { ProviderRow } from "@/server/providers";
import { emailAdapter } from "./emailAdapter";

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

export type BuildOutboundRfqArgs = {
  provider: ProviderRow;
  quote: OutboundRfqQuote;
  customer?: OutboundRfqCustomer | null;
  fileLinks?: OutboundRfqFileLink[];
};

export type ProviderAdapter = {
  supports(provider: ProviderRow): boolean;
  buildOutboundRfq(args: BuildOutboundRfqArgs): { subject: string; body: string };
};

const ADAPTERS: ProviderAdapter[] = [emailAdapter];

export function getAdapterForProvider(provider: ProviderRow): ProviderAdapter | null {
  return ADAPTERS.find((adapter) => adapter.supports(provider)) ?? null;
}
