-- generation_jobs.station_id blocked station deletion once any playlist had
-- been generated for the station. Jobs are per-station bookkeeping — cascade.
ALTER TABLE generation_jobs
  DROP CONSTRAINT generation_jobs_station_id_fkey;

ALTER TABLE generation_jobs
  ADD CONSTRAINT generation_jobs_station_id_fkey
    FOREIGN KEY (station_id) REFERENCES stations(id) ON DELETE CASCADE;
