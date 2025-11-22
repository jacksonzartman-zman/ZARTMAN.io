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
  emptyState?: ReactNode;
  containerClassName?: string;
};

export function QuoteMessagesThread({
  messages,
  emptyState,
  containerClassName,
}: QuoteMessagesThreadProps) {
  if (!messages?.length) {
    return (
      (emptyState as ReactNode) ?? (
        <p className="rounded-2xl border border-dashed border-slate-800/70 bg-black/30 px-4 py-4 text-sm text-slate-400">
          No messages yet. Share the first update to kick things off.
        </p>
      )
    );
  }

  return (
    <div className={clsx("md:max-h-[420px] md:overflow-y-auto md:pr-2", containerClassName)}>
      <ol className="flex flex-col gap-3">
        {messages.map((message) => {
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
                  <span className={getAuthorBadgeClasses(message.author_type)}>
                    {QUOTE_AUTHOR_LABELS[message.author_type] ??
                      QUOTE_AUTHOR_LABELS.admin}
                  </span>
                  <span className="text-slate-400">
                    {formatDateTime(message.created_at, { includeTime: true })}
                  </span>
                  {message.author_name && (
                    <span className="text-slate-500">{message.author_name}</span>
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
  );
}
