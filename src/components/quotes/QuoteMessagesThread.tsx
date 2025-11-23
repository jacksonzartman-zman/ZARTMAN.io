import clsx from "clsx";
import type { ReactNode } from "react";
import type { QuoteMessage } from "@/server/quotes/messages";
import { formatDateTime } from "@/lib/formatDate";
import {
  getAuthorBadgeClasses,
  getMessageBubbleClasses,
  QUOTE_AUTHOR_LABELS,
} from "./messageStyles";

type QuoteMessagesThreadProps = {
  messages: QuoteMessage[];
  heading?: string;
  description?: string;
  messageCount?: number;
  isLoading?: boolean;
  error?: string | null;
  emptyState?: ReactNode;
  containerClassName?: string;
};

export function QuoteMessagesThread({
  messages,
  heading,
  description,
  messageCount,
  isLoading,
  error,
  emptyState,
  containerClassName,
}: QuoteMessagesThreadProps) {
  const resolvedMessages = messages ?? [];
  const resolvedCount =
    typeof messageCount === "number" ? messageCount : resolvedMessages.length;
  const shouldRenderHeader =
    Boolean(heading) || Boolean(description) || typeof messageCount === "number";
  const hasMessages = resolvedMessages.length > 0;

  return (
    <div className={clsx("space-y-3", containerClassName)}>
      {shouldRenderHeader && (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            {heading ? (
              <h2 className="text-lg font-semibold text-slate-50">{heading}</h2>
            ) : null}
            {description ? (
              <p className="text-sm text-slate-400">{description}</p>
            ) : null}
          </div>
          <span className="text-xs text-slate-500">
            {resolvedCount} {resolvedCount === 1 ? "message" : "messages"}
          </span>
        </div>
      )}

      {error && (
        <p
          className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"
          role="status"
        >
          {error}
        </p>
      )}

      {isLoading ? (
        <ThreadSkeleton />
      ) : hasMessages ? (
        <div className="md:max-h-[420px] md:overflow-y-auto md:pr-2">
          <ol className="flex flex-col gap-3">
            {resolvedMessages.map((message) => {
              const isAdmin = message.author_type === "admin";
              return (
                <li
                  key={message.id}
                  className={clsx(
                    "flex w-full",
                    isAdmin ? "justify-end" : "justify-start",
                  )}
                >
                  <div className="flex max-w-[92%] flex-col gap-1.5 sm:max-w-[70%]">
                    <div
                      className={clsx(
                        "flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500",
                        isAdmin ? "justify-end text-right" : "text-left",
                      )}
                    >
                      <span
                        className={getAuthorBadgeClasses(message.author_type)}
                      >
                        {QUOTE_AUTHOR_LABELS[message.author_type] ??
                          QUOTE_AUTHOR_LABELS.admin}
                      </span>
                      <span className="text-slate-400">
                        {formatDateTime(message.created_at, {
                          includeTime: true,
                        })}
                      </span>
                      {message.author_name && (
                        <span className="text-slate-500">
                          {message.author_name}
                        </span>
                      )}
                    </div>
                    <div
                      className={clsx(
                        "whitespace-pre-line rounded-2xl border px-3.5 py-2.5 text-sm leading-relaxed",
                        getMessageBubbleClasses(message.author_type),
                        isAdmin ? "rounded-tr-sm" : "rounded-tl-sm",
                      )}
                    >
                      {message.body}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ) : (
        (emptyState as ReactNode) ?? (
          <p className="rounded-2xl border border-dashed border-slate-800/70 bg-black/30 px-4 py-4 text-sm text-slate-400">
            No messages yet. Share the first update to kick things off.
          </p>
        )
      )}
    </div>
  );
}

function ThreadSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className={clsx(
            "flex justify-start",
            index % 2 === 0 ? "justify-end" : "justify-start",
          )}
        >
          <div className="flex max-w-[75%] flex-col gap-2">
            <div className="flex items-center gap-3 text-[11px] text-slate-600">
              <span className="inline-flex h-4 w-20 animate-pulse rounded-full bg-slate-800/70" />
              <span className="inline-flex h-3 w-24 animate-pulse rounded-full bg-slate-900/60" />
            </div>
            <div className="h-16 animate-pulse rounded-2xl bg-slate-900/60" />
          </div>
        </div>
      ))}
    </div>
  );
}
