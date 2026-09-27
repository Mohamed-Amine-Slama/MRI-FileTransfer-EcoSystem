BEGIN;

DROP FUNCTION IF EXISTS identity_attach_verification_document(uuid, text, text, bytea, text);
DROP TABLE IF EXISTS identity_verification_documents;

COMMIT;
