"use client";

import CadViewerClient from "@/components/CadViewerClient";

export type QuoteFileViewerProps = {
  fileName?: string | null;
  fileUrl?: string | null;
  fallbackMessage?: string;
  height?: number;
};

export function QuoteFileViewer({
  fileName,
  fileUrl,
  fallbackMessage,
  height = 360,
}: QuoteFileViewerProps) {
  return (
    <CadViewerClient
      src={fileUrl}
      fileName={fileName}
      fallbackMessage={fallbackMessage}
      height={height}
    />
  );
}
