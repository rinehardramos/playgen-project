import ExcelJS from 'exceljs';
import { getPlaylist } from './playlistService';
import type { PlaylistEntry } from './playlistService';

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

function csvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function exportPlaylistXlsx(playlistId: string): Promise<Buffer> {
  const playlist = await getPlaylist(playlistId);
  if (!playlist) {
    throw new Error(`Playlist ${playlistId} not found`);
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'PlayGen';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Playlist');

  // Column definitions with widths
  sheet.columns = [
    { header: 'Hour',     key: 'hour',     width: 8 },
    { header: 'Position', key: 'position', width: 6 },
    { header: 'Category', key: 'category', width: 12 },
    { header: 'Title',    key: 'title',    width: 40 },
    { header: 'Artist',   key: 'artist',   width: 30 },
    { header: 'Override', key: 'override', width: 8 },
  ];

  // Bold header row and freeze it
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.commit();

  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  // Data rows
  for (const entry of playlist.entries) {
    sheet.addRow({
      hour:     formatHour(entry.hour),
      position: entry.position,
      category: entry.category_label,
      title:    entry.song_title,
      artist:   entry.song_artist,
      override: entry.is_manual_override ? 'YES' : '',
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer as unknown as Buffer;
}

export async function exportPlaylistCsv(playlistId: string): Promise<string> {
  const playlist = await getPlaylist(playlistId);
  if (!playlist) {
    throw new Error(`Playlist ${playlistId} not found`);
  }

  const lines: string[] = ['hour,position,category,title,artist,is_override'];

  for (const entry of playlist.entries) {
    const row: string = [
      csvField(formatHour(entry.hour)),
      csvField(String(entry.position)),
      csvField(entry.category_label),
      csvField(entry.song_title),
      csvField(entry.song_artist),
      csvField(entry.is_manual_override ? 'true' : 'false'),
    ].join(',');
    lines.push(row);
  }

  return lines.join('\n');
}
