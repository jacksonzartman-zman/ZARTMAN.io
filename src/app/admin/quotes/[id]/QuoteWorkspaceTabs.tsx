"use client";

import { useId, useMemo, useState } from "react";
import clsx from "clsx";
import type { ReactNode } from "react";

export type QuoteWorkspaceTab =
  | "summary"
  | "messages"
  | "edit"
  | "viewer"
  | "tracking"
  | "bid"
  | "suppliers";

type TabItem = {
  id: QuoteWorkspaceTab;
  label: string;
  count?: number;
  content: ReactNode;
};

type QuoteWorkspaceTabsProps = {
  tabs: TabItem[];
  defaultTab?: QuoteWorkspaceTab;
};

export function QuoteWorkspaceTabs({
  tabs,
  defaultTab = "summary",
}: QuoteWorkspaceTabsProps) {
  const stableId = useId();
  const [activeTab, setActiveTab] = useState<QuoteWorkspaceTab>(
    tabs.find((tab) => tab.id === defaultTab)?.id ?? tabs[0]?.id ?? "summary",
  );

  const resolvedTabs = useMemo(
    () =>
      tabs.filter(
        (tab, index, self) =>
          tab &&
          typeof tab.id === "string" &&
          self.findIndex((candidate) => candidate.id === tab.id) === index,
      ),
    [tabs],
  );

  if (resolvedTabs.length === 0) {
    return null;
  }

  return (
    <div className="space-y-5">
      <div className="overflow-x-auto pb-1">
        <div
          className="flex min-w-max gap-2"
          role="tablist"
          aria-label="Quote workspace navigation"
        >
          {resolvedTabs.map((tab) => {
            const isActive = tab.id === activeTab;
            const tabId = `${stableId}-tab-${tab.id}`;
            const panelId = `${stableId}-panel-${tab.id}`;
            return (
              <button
                key={tab.id}
                id={tabId}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls={panelId}
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  "rounded-full border px-3 py-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
                  isActive
                    ? "border-emerald-400 bg-emerald-500/20 text-emerald-100 shadow-[0_0_25px_rgba(16,185,129,0.25)]"
                    : "border-slate-800 bg-slate-900/70 text-slate-300 hover:border-emerald-400 hover:text-emerald-100",
                )}
              >
                <span>{tab.label}</span>
                {typeof tab.count === "number" && (
                  <span
                    className={clsx(
                      "ml-2 rounded-full border px-2 py-0.5 text-[10px]",
                      isActive
                        ? "border-transparent bg-slate-900/40 text-emerald-100/80"
                        : "border-slate-800 bg-slate-950/70 text-slate-400",
                    )}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        {resolvedTabs.map((tab) => {
          const isActive = tab.id === activeTab;
          const panelId = `${stableId}-panel-${tab.id}`;
          const tabId = `${stableId}-tab-${tab.id}`;
          return (
            <div
              key={tab.id}
              id={panelId}
              role="tabpanel"
              aria-labelledby={tabId}
              className={clsx(
                "space-y-4",
                isActive ? "block" : "hidden",
              )}
              aria-hidden={!isActive}
            >
              {tab.content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
