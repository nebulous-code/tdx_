-- 013: an optional description on a label (t_0647).
--
-- A free-text note on what a tag is FOR, so the user (and Claude agents reading tdx
-- through access_tdx.sh) know what a bare name like #deep-work or #quick represents and
-- stop tagging things wrong. Edited in the label modal, served in the bootstrap payload.
--
-- NULL = no description (every pre-existing label, and any created without one — creation
-- stays name-only). Rides the existing owner_id-scoped labels row; no new scoping.
ALTER TABLE labels ADD COLUMN description TEXT;
