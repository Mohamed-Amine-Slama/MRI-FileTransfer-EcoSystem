BEGIN;

-- The files behind an application: a doctor's identity document (passport,
-- national ID card or driving licence) and medical certificate, a clinic's
-- facility permit. Until now a `file` requirement rendered as a text box, so
-- ops approved on a typed-in name and nothing else.
--
-- IN POSTGRES, NOT THE BLOB STORE. The blob store's originals bucket is
-- write-once and keyed by patient; these are a handful of small files per
-- application that an applicant must be able to replace while the application
-- is pending. The size cap keeps that honest.
CREATE TABLE identity_verification_documents (
  organisation_id uuid NOT NULL REFERENCES identity_organisations(id),
  -- A corridor documentRequirements key (`identityDocument`, ...).
  doc_key         text NOT NULL CHECK (doc_key ~ '^[a-z][A-Za-z0-9]{0,63}$'),
  content_type    text NOT NULL
                    CHECK (content_type IN ('application/pdf','image/jpeg','image/png')),
  bytes           bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 10485760),
  sha256          text NOT NULL,
  uploaded_by     uuid NOT NULL REFERENCES identity_users(id),
  uploaded_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organisation_id, doc_key)
);

ALTER TABLE identity_verification_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_verification_documents FORCE  ROW LEVEL SECURITY;

-- Identity papers are ops' business only. Not even colleagues in the same
-- organisation read them, so there is no member policy.
CREATE POLICY verification_documents_ops ON identity_verification_documents FOR SELECT
  USING (app_current_role() = 'admin');

-- Attaching goes through a definer for the same reason creating the
-- organisation does: the rule (owner, applicant, still pending) lives with the
-- write, not in a policy wide enough to express it.
CREATE OR REPLACE FUNCTION identity_attach_verification_document(
  p_org          uuid,
  p_doc_key      text,
  p_content_type text,
  p_bytes        bytea,
  p_sha256       text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF app_current_role() IS DISTINCT FROM 'applicant' OR NOT app_owns_org(p_org) THEN
    RETURN false;
  END IF;

  -- Once decided, the evidence is frozen: replacing a document after approval
  -- would leave an approved provider whose file ops never saw.
  IF NOT EXISTS (
    SELECT 1 FROM identity_organisations WHERE id = p_org AND verification_status = 'pending'
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO identity_verification_documents
    (organisation_id, doc_key, content_type, bytes, sha256, uploaded_by)
  VALUES (p_org, p_doc_key, p_content_type, p_bytes, p_sha256, app_current_user_id())
  ON CONFLICT (organisation_id, doc_key) DO UPDATE
    SET content_type = EXCLUDED.content_type,
        bytes        = EXCLUDED.bytes,
        sha256       = EXCLUDED.sha256,
        uploaded_by  = EXCLUDED.uploaded_by,
        uploaded_at  = now();
  RETURN true;
END;
$$;

GRANT SELECT ON identity_verification_documents TO mir_app;
GRANT EXECUTE ON FUNCTION identity_attach_verification_document(uuid, text, text, bytea, text)
  TO mir_app;

COMMIT;
