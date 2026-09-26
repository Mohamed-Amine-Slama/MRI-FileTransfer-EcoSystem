###############################################################################
# Object storage — BUILD_SPEC P2.4. ⚠️ THE MOST IMPORTANT INFRASTRUCTURE GATE.
#
# "A deletable original is a lost scan is a lawsuit."
#
# Three buckets with genuinely different guarantees. The originals bucket is
# the source of record (ADR-4): once an object lands there it must survive a
# compromised administrator, a buggy deploy, and a malicious insider.
#
# NOT APPLIED. There is no AWS account attached to this repository, so the
# P2.4 gate — upload an object, attempt `aws s3 rm`, confirm it is REJECTED —
# has not been executed. Reading this file is not the same as passing that
# gate, and the pre-launch checklist keeps it open until someone runs it.
###############################################################################

terraform {
  required_version = "~> 1.9"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }
}

locals {
  originals_name = "${var.name_prefix}-dicom-originals"
  derived_name   = "${var.name_prefix}-derived"
  audit_name     = "${var.name_prefix}-audit-logs"
}

###############################################################################
# 0. ACCESS LOGS — who touched which object, and when
###############################################################################
#
# S3 server access logging is separate from the application audit log (P4.4).
# The application log records what the APPLICATION did; this records what S3
# saw, including access that never passed through the application at all.
# During a breach investigation the difference between those two is the whole
# question (docs/runbooks/incident-response.md).
#
# Deliberately NOT Object Lock: a log bucket that cannot expire grows without
# bound, and this is corroborating evidence rather than the source of record —
# the audit bucket below is the immutable one.

resource "aws_s3_bucket" "access_logs" {
  # checkov:skip=CKV2_AWS_62:Event notifications are not part of this design. Nothing consumes S3 events; ingestion is driven by the application (P7.4).
  # checkov:skip=CKV_AWS_144:Access logs are corroborating evidence, not the source of record. The originals bucket replicates; losing a region's access logs does not lose a scan.
  # checkov:skip=CKV_AWS_145:S3 log delivery cannot write to an SSE-KMS bucket. These logs carry request metadata only -- never object contents or patient data -- and are encrypted with SSE-S3 above.
  bucket = "${local.originals_name}-access-logs"

  lifecycle {
    prevent_destroy = true
  }

  tags = merge(var.tags, {
    Name      = "${local.originals_name}-access-logs"
    DataClass = "access-log"
  })
}

resource "aws_s3_bucket_versioning" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_public_access_block" "access_logs" {
  bucket                  = aws_s3_bucket.access_logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# SSE-S3 rather than SSE-KMS: S3 log delivery cannot write to a bucket
# encrypted with a customer-managed key. The logs contain request metadata,
# never object contents or patient data.
resource "aws_s3_bucket_server_side_encryption_configuration" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id
  rule {
    id     = "expire-access-logs"
    status = "Enabled"
    filter {}
    # Long enough to investigate an incident discovered late; short enough that
    # the bucket does not grow forever. Revisit against L5 and L8 once answered.
    expiration { days = 400 }
    noncurrent_version_expiration { noncurrent_days = 30 }
    # Failed multipart uploads are invisible in the console and still billed.
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }
}

resource "aws_s3_bucket_acl" "access_logs" {
  depends_on = [aws_s3_bucket_ownership_controls.access_logs]
  bucket     = aws_s3_bucket.access_logs.id
  acl        = "log-delivery-write"
}

resource "aws_s3_bucket_ownership_controls" "access_logs" {
  # checkov:skip=CKV2_AWS_65:S3 server access log delivery requires the log-delivery-write ACL, so ACLs cannot be disabled on this bucket specifically. Every other bucket keeps them off.
  bucket = aws_s3_bucket.access_logs.id
  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

###############################################################################
# 1. ORIGINALS — immutable source of record
###############################################################################

resource "aws_s3_bucket" "originals" {
  # checkov:skip=CKV2_AWS_61:Deliberate. This is the immutable source of record under Object Lock in COMPLIANCE mode; a lifecycle expiry on it would either be refused or destroy the only copy of a scan. Retention is set by L5, which is unanswered -- see docs/pre-launch-checklist.md.
  # checkov:skip=CKV2_AWS_62:Event notifications are not part of this design; ingestion is driven by the application (P7.4).
  bucket = local.originals_name

  # Object Lock CANNOT be enabled on an existing bucket. It must be set at
  # creation, which is why this is not something that can be "added later" —
  # retrofitting means creating a new bucket and copying every object.
  object_lock_enabled = true

  # A bucket holding the only copy of patients' imaging must never be
  # destroyed by a `terraform destroy` in the wrong directory.
  lifecycle {
    prevent_destroy = true
  }

  tags = merge(var.tags, {
    Name           = local.originals_name
    DataClass      = "patient-imaging"
    SourceOfRecord = "true"
  })
}

# Versioning is a prerequisite for Object Lock, and independently protects
# against an overwrite that would otherwise silently replace a scan.
resource "aws_s3_bucket_versioning" "originals" {
  bucket = aws_s3_bucket.originals.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_object_lock_configuration" "originals" {
  bucket = aws_s3_bucket.originals.id

  rule {
    default_retention {
      # COMPLIANCE mode, not GOVERNANCE. Under governance, a principal with
      # s3:BypassGovernanceRetention can delete anyway — which includes the
      # account root and anyone who can grant themselves that permission.
      # Compliance mode cannot be bypassed by ANY user, including root, for
      # the duration of the retention period.
      #
      # This is deliberately the strictest option, and it is irreversible:
      # retention cannot be shortened once set. That is the point.
      mode = "COMPLIANCE"

      # BLOCKING L5: the correct retention period is a legal question for both
      # Libya and Tunisia and has NOT been answered. The value below is a
      # placeholder that must be replaced before production data is written.
      #
      # Guess too low and records are destroyed before the law allows.
      # Guess too high and they cannot be deleted when a patient exercises a
      # right to erasure — under compliance mode, not even by AWS support.
      days = var.imaging_retention_days
    }
  }

  depends_on = [aws_s3_bucket_versioning.originals]
}

resource "aws_s3_bucket_server_side_encryption_configuration" "originals" {
  bucket = aws_s3_bucket.originals.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.kms_key_arn_objects
    }
    # Cuts KMS request costs and rate-limit pressure on a 120-file study
    # upload, without weakening the encryption.
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "originals" {
  bucket                  = aws_s3_bucket.originals.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Cross-region replication (P2.4, P15.2). The DR drill requires originals to
# be readable from the replica region.
resource "aws_s3_bucket_replication_configuration" "originals" {
  count = var.enable_replication ? 1 : 0

  bucket = aws_s3_bucket.originals.id
  role   = var.replication_role_arn

  lifecycle {
    precondition {
      condition     = var.replication_role_arn != "" && var.replica_bucket_arn != "" && var.replica_kms_key_arn != ""
      error_message = "enable_replication needs replication_role_arn, replica_bucket_arn and replica_kms_key_arn (see modules/replica)."
    }
  }

  rule {
    id     = "replicate-all-originals"
    status = "Enabled"

    filter {}

    delete_marker_replication {
      # Delete markers are NOT replicated. If someone manages to place one in
      # the primary, the replica must still hold the object.
      status = "Disabled"
    }

    destination {
      bucket        = var.replica_bucket_arn
      storage_class = "STANDARD_IA"

      encryption_configuration {
        replica_kms_key_id = var.replica_kms_key_arn
      }

      # Alert if replication falls behind: a replica that is hours stale is
      # not a disaster-recovery position (P13 alerts).
      replication_time {
        status = "Enabled"
        time { minutes = 15 }
      }
      metrics {
        status = "Enabled"
        event_threshold { minutes = 15 }
      }
    }

    source_selection_criteria {
      sse_kms_encrypted_objects {
        status = "Enabled"
      }
    }
  }

  depends_on = [aws_s3_bucket_versioning.originals]
}

# Deny any request that is not TLS, and any attempt to write unencrypted.
resource "aws_s3_bucket_policy" "originals" {
  bucket = aws_s3_bucket.originals.id
  policy = data.aws_iam_policy_document.originals.json
}

data "aws_iam_policy_document" "originals" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.originals.arn,
      "${aws_s3_bucket.originals.arn}/*",
    ]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid       = "DenyUnencryptedObjectUploads"
    effect    = "Deny"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.originals.arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "StringNotEquals"
      variable = "s3:x-amz-server-side-encryption"
      values   = ["aws:kms"]
    }
  }

  # There is deliberately NO statement permitting DeleteObject to anyone.
  # Object Lock already refuses, but an explicit absence documents intent.
}

###############################################################################
# 2. DERIVED — thumbnails and previews. Regenerable, so expiry is fine.
###############################################################################

resource "aws_s3_bucket" "derived" {
  # checkov:skip=CKV2_AWS_62:No consumer for S3 events on this bucket.
  # checkov:skip=CKV_AWS_144:Deliberate. Everything here is DERIVED -- thumbnails and previews regenerated from the originals, which do replicate (ADR-4). Paying to replicate regenerable data buys nothing.
  bucket = local.derived_name
  tags = merge(var.tags, {
    Name      = local.derived_name
    DataClass = "patient-imaging-derived"
  })
}

resource "aws_s3_bucket_versioning" "derived" {
  bucket = aws_s3_bucket.derived.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "derived" {
  bucket = aws_s3_bucket.derived.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.kms_key_arn_objects
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "derived" {
  bucket                  = aws_s3_bucket.derived.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "derived" {
  bucket = aws_s3_bucket.derived.id

  rule {
    id     = "expire-derived"
    status = "Enabled"
    filter {}

    # Safe to expire: every thumbnail can be regenerated from the original.
    # This is the ONLY bucket where expiry is acceptable.
    expiration { days = var.derived_expiry_days }

    noncurrent_version_expiration { noncurrent_days = 30 }
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }
}

###############################################################################
# 3. AUDIT LOGS — append-only history that survives a database compromise
###############################################################################

resource "aws_s3_bucket" "audit" {
  # checkov:skip=CKV2_AWS_61:Object Lock compliance mode. Audit history must outlive any expiry policy; retention follows L5/L8, both unanswered.
  # checkov:skip=CKV2_AWS_62:No consumer for S3 events on this bucket.
  # checkov:skip=CKV_AWS_144:Not required by the BUILD_SPEC P2.4 bucket table. Worth revisiting: a breach investigation that outlives a region loss would want this, and it is cheap. Tracked, not dismissed.
  bucket              = local.audit_name
  object_lock_enabled = true

  lifecycle {
    prevent_destroy = true
  }

  tags = merge(var.tags, {
    Name      = local.audit_name
    DataClass = "audit"
  })
}

resource "aws_s3_bucket_versioning" "audit" {
  bucket = aws_s3_bucket.audit.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_object_lock_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id
  rule {
    default_retention {
      # P4.4: "Ship audit rows to the *-audit-logs object-lock bucket on a
      # schedule so a database compromise cannot erase history." That property
      # only holds if the archived copy is itself undeletable.
      mode = "COMPLIANCE"
      days = var.audit_retention_days
    }
  }
  depends_on = [aws_s3_bucket_versioning.audit]
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.kms_key_arn_backups
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "audit" {
  bucket                  = aws_s3_bucket.audit.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_logging" "originals" {
  bucket        = aws_s3_bucket.originals.id
  target_bucket = aws_s3_bucket.access_logs.id
  target_prefix = "originals/"
}

resource "aws_s3_bucket_logging" "derived" {
  bucket        = aws_s3_bucket.derived.id
  target_bucket = aws_s3_bucket.access_logs.id
  target_prefix = "derived/"
}

resource "aws_s3_bucket_logging" "audit" {
  bucket        = aws_s3_bucket.audit.id
  target_bucket = aws_s3_bucket.access_logs.id
  target_prefix = "audit/"
}
