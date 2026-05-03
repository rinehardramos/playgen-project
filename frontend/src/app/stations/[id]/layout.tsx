'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';

const TABS = [
  { href: 'details', label: 'Details' },
  { href: 'dj', label: 'DJ' },
  { href: 'pipeline', label: 'Pipeline' },
  { href: 'settings', label: 'Settings' },
];

export default function StationLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const stationId = params.id as string;

  return (
    <div className="flex flex-col min-h-full">
      {/* Station sub-nav */}
      <div className="border-b border-zinc-800 bg-[#13131a] px-6">
        <div className="flex items-center gap-1">
          <Link
            href="/stations"
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors mr-3 py-3"
          >
            ← Stations
          </Link>
          {TABS.map(({ href, label }) => {
            const fullHref = `/stations/${stationId}/${href}`;
            const active = pathname === fullHref || pathname.startsWith(fullHref + '/');
            return (
              <Link
                key={href}
                href={fullHref}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  active
                    ? 'border-violet-500 text-violet-300'
                    : 'border-transparent text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'
                }`}
              >
                {label}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Page content */}
      <div className="flex-1">{children}</div>
    </div>
  );
}
