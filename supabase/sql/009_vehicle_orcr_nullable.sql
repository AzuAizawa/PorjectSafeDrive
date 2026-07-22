-- SafeDrive 2.0 — allow orcr_path to be set after insert
--
-- Storage RLS (006_storage.sql) requires the vehicle row to already exist
-- (owner_id = auth.uid()) before a file can be uploaded under its id-prefixed
-- path. That means the real upload flow has to be: insert the vehicle row
-- first (documents null), then upload to storage using its now-known id,
-- then update the row with the resulting paths. orcr_path being NOT NULL
-- made that first insert impossible.

alter table vehicles alter column orcr_path drop not null;
