import clsx from "clsx";

import { PORTAL_SURFACE_CARD } from "@/app/(portals)/components/portalSurfaceTokens";

const PORTAL_SKELETON_PULSE = "motion-safe:animate-pulse motion-reduce:animate-none";

export default function Loading() {
  return (
    <div className="space-y-5">
      <div className={clsx(PORTAL_SURFACE_CARD, PORTAL_SKELETON_PULSE, "h-20")} />
      <div className="space-y-6">
        {Array.from({ length: 2 }).map((_, groupIndex) => (
          <section key={`group-${groupIndex}`} className="space-y-3">
            <div className={clsx("h-3 w-28 rounded bg-slate-800/25", PORTAL_SKELETON_PULSE)} />
            <ul className="space-y-2">
              {Array.from({ length: 4 }).map((_, itemIndex) => (
                <li
                  key={`item-${groupIndex}-${itemIndex}`}
                  className={clsx(PORTAL_SURFACE_CARD, PORTAL_SKELETON_PULSE, "p-4")}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="h-5 w-24 rounded-full bg-slate-800/20" />
                    <div className="h-5 w-16 rounded-full bg-slate-800/15" />
                  </div>
                  <div className="mt-3 space-y-2">
                    <div className="h-4 w-[min(520px,90%)] rounded bg-slate-800/25" />
                    <div className="h-3 w-[min(640px,100%)] rounded bg-slate-800/15" />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

