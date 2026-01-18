import Link from "next/link";

import { PortalShell } from "@/app/(portals)/components/PortalShell";
import PortalCard from "@/app/(portals)/PortalCard";
import { EmptyStateCard } from "@/components/EmptyStateCard";
import { SavedSearchesList } from "@/app/(portals)/customer/saved/SavedSearchesList";
import { requireCustomerSessionOrRedirect } from "@/app/(portals)/customer/requireCustomerSessionOrRedirect";
import { getCustomerByUserId } from "@/server/customers";
import { listCustomerSavedSearches } from "@/server/customer/savedSearches";
import { primaryCtaClasses, secondaryCtaClasses } from "@/lib/ctas";

export const dynamic = "force-dynamic";

export default async function CustomerSavedSearchesPage() {
  const user = await requireCustomerSessionOrRedirect("/customer/saved");
  const customer = await getCustomerByUserId(user.id);

  if (!customer) {
    return (
      <PortalShell
        workspace="customer"
        title="Saved searches"
        subtitle="Revisit searches you want to keep tabs on."
        actions={
          <Link href="/customer/search" className={secondaryCtaClasses}>
            Back to search
          </Link>
        }
      >
        <EmptyStateCard
          title="Complete your profile"
          description="Finish setting up your customer profile to manage saved searches."
          action={{ label: "Back to dashboard", href: "/customer" }}
        />
      </PortalShell>
    );
  }

  const savedSearches = await listCustomerSavedSearches(customer.id);

  return (
    <PortalShell
      workspace="customer"
      title="Saved searches"
      subtitle="Revisit searches you want to keep tabs on."
      actions={
        <Link href="/customer/search" className={primaryCtaClasses}>
          Search results
        </Link>
      }
    >
      {!savedSearches.supported ? (
        <EmptyStateCard
          title="Saved searches unavailable"
          description="Saved searches have not been enabled for this deployment yet."
          action={{ label: "View search results", href: "/customer/search" }}
        />
      ) : savedSearches.searches.length === 0 ? (
        <EmptyStateCard
          title="No saved searches yet"
          description="Save a search to return to it quickly."
          action={{ label: "Open search results", href: "/customer/search" }}
        />
      ) : (
        <PortalCard
          title="Saved searches"
          description="Open, rename, or remove saved searches."
        >
          <SavedSearchesList searches={savedSearches.searches} />
        </PortalCard>
      )}
    </PortalShell>
  );
}
