-- Ensure one manifest per script version
ALTER TABLE dj_show_manifests ADD CONSTRAINT dj_show_manifests_script_id_key UNIQUE (script_id);
