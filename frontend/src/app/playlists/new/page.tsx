import { redirect } from 'next/navigation';
import Link from 'next/link';
import { isFeatureEnabled } from '@/lib/features';

/**
 * /playlists/new — manual playlist creation.
 *
 * Gated behind the `ui.advancedPlaylistCreation` feature flag (T-N, issue #304).
 * Off by default; set NEXT_PUBLIC_FEATURE_UI_ADVANCED_PLAYLIST_CREATION=true to enable.
 *
 * Once T-C (generate-day-from-Programs orchestration) ships, this page will be
 * wired up to the new orchestration route. Until then it renders a placeholder
 * that explains the recommended workflow.
 */
export default function PlaylistsNewPage() {
  if (!isFeatureEnabled('ui.advancedPlaylistCreation')) {
    redirect('/playlists');
  }

  return (
    <div className="p-6 md:p-8 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-bold text-white">New Playlist</h1>
        <p className="text-gray-500 text-xs mt-0.5">Advanced manual creation</p>
      </div>

      <div className="bg-yellow-900/10 border border-yellow-700/30 rounded-xl px-5 py-4 mb-6 flex items-start gap-3">
        <svg className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        </svg>
        <div>
          <p className="text-sm text-yellow-200 font-medium">Advanced feature</p>
          <p className="text-xs text-yellow-300/70 mt-1">
            Manual playlist creation bypasses the Program-driven generation flow. For most
            use-cases, generate logs from the <strong>Station Logs</strong> page instead.
          </p>
        </div>
      </div>

      <p className="text-gray-400 text-sm mb-6">
        Full manual creation will be available once the Programs orchestration route (T-C)
        ships. In the meantime, use the <Link href="/playlists" className="text-violet-400 hover:text-violet-300">Station Logs</Link> page
        to generate a playlist for any date.
      </p>

      <Link
        href="/playlists"
        className="inline-block bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-5 py-2.5 rounded-lg transition-colors"
      >
        Go to Station Logs
      </Link>
    </div>
  );
}
