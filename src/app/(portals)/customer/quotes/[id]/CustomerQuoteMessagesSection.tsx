import { formatDateTime } from "@/lib/formatDate";
import type { QuoteMessageRecord } from "@/server/quotes/messages";

const MESSAGE_LIMIT = 50;

type CustomerQuoteMessagesSectionProps = {
  quoteId: string;
  messages: QuoteMessageRecord[];
  currentUserId: string | null;
  canPost: boolean;
  postAction: (formData: FormData) => void | Promise<void>;
};

export function CustomerQuoteMessagesSection({
  quoteId,
  messages,
  currentUserId,
  canPost,
  postAction,
}: CustomerQuoteMessagesSectionProps) {
  const recentMessages = messages.slice(-MESSAGE_LIMIT);

  return (
    <div className="space-y-4">
      {recentMessages.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-800/70 bg-black/30 px-4 py-3 text-sm text-slate-400">
          No messages yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {recentMessages.map((message) => {
            const isCurrentUser =
              typeof currentUserId === "string" && message.sender_id === currentUserId;
            const authorLabel = resolveAuthorLabel(message, isCurrentUser);
            const timestamp =
              formatDateTime(message.created_at, { includeTime: true }) ?? "Just now";
            return (
              <li
                key={message.id}
                className={
                  isCurrentUser
                    ? "rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-5 py-4"
                    : "rounded-2xl border border-slate-900/70 bg-slate-950/40 px-5 py-4"
                }
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                  <span
                    className={
                      isCurrentUser
                        ? "rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200"
                        : "rounded-full border border-slate-800/70 bg-slate-950/40 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-200"
                    }
                  >
                    {authorLabel}
                  </span>
                  <span>{timestamp}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-100">
                  {message.body}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {canPost ? (
        <form action={postAction} className="space-y-3 border-t border-slate-900/60 pt-4">
          <div className="space-y-1">
            <label
              htmlFor={`quote-message-body-${quoteId}`}
              className="text-sm font-medium text-slate-200"
            >
              Message
            </label>
            <textarea
              id={`quote-message-body-${quoteId}`}
              name="body"
              rows={4}
              maxLength={2000}
              placeholder="Type your message..."
              className="w-full rounded-xl border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center rounded-full bg-emerald-400 px-4 py-1.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-300 sm:w-auto"
          >
            Send
          </button>
        </form>
      ) : (
        <p className="rounded-xl border border-dashed border-slate-800/70 bg-black/30 px-4 py-3 text-xs text-slate-400">
          Messaging is disabled while viewing this quote in read-only mode.
        </p>
      )}
    </div>
  );
}

function resolveAuthorLabel(message: QuoteMessageRecord, isCurrentUser: boolean): string {
  if (isCurrentUser) return "You";
  const normalized = (message.sender_role ?? "").toLowerCase();
  if (normalized === "customer") return "Customer";
  if (normalized === "supplier") return "Supplier";
  if (normalized === "system") return "System";
  return "Admin";
}
