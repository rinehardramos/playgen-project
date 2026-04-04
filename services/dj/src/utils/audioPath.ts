import path from 'path';

export function buildAudioPath(params: {
  companyId: string;
  stationId: string;
  playlistDate: string; // YYYY-MM-DD
  scriptId: string;
  type: string;
  hour: number;
  position: number;
}): string {
  const hh = params.hour.toString().padStart(2, '0');
  const pp = params.position.toString().padStart(2, '0');
  const filename = `${params.type}_${hh}_${pp}.mp3`;
  
  return path.join(
    params.companyId,
    params.stationId,
    params.playlistDate,
    params.scriptId,
    filename
  );
}
