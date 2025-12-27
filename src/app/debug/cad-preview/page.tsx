import { CadPreviewDebugClient } from "@/app/debug/cad-preview/CadPreviewDebugClient";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<{ token?: string; kind?: string }>;
};

export default async function CadPreviewDebugPage({ searchParams }: PageProps) {
  const sp = await Promise.resolve(searchParams).catch(() => null);
  return (
    <CadPreviewDebugClient
      initialKind={typeof sp?.kind === "string" ? sp.kind : ""}
      initialToken={typeof sp?.token === "string" ? sp.token : ""}
    />
  );
}

