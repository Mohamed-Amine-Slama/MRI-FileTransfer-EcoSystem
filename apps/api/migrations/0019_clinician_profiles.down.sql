-- Reverse of 0019_clinician_profiles.up.sql.

BEGIN;

DROP FUNCTION IF EXISTS identity_organisation_clinicians(uuid);
DROP FUNCTION IF EXISTS identity_set_membership_specialty(uuid, uuid, text);

ALTER TABLE identity_memberships DROP COLUMN specialty;

COMMIT;
