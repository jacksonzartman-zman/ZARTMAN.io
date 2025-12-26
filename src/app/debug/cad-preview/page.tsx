import { requireAdminUser } from "@/server/auth";
import { CadPreviewDebugClient } from "@/app/debug/cad-preview/CadPreviewDebugClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<{ bucket?: string; path?: string; kind?: string }>;
};

export default async function CadPreviewDebugPage({ searchParams }: PageProps) {
  await requireAdminUser({ message: "Admin access required." });
  const sp = await Promise.resolve(searchParams).catch(() => null);
  return (
    <CadPreviewDebugClient
      initialBucket={typeof sp?.bucket === "string" ? sp.bucket : ""}
      initialPath={typeof sp?.path === "string" ? sp.path : ""}
      initialKind={typeof sp?.kind === "string" ? sp.kind : ""}
    />
  );
}

