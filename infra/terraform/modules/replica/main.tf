###############################################################################
# DR replica of the originals bucket — BUILD_SPEC P2.4, P15.2.
#
# The storage module has always had a replication rule; nothing ever created
# what it points at. staging and prod set enable_replication = true with no
# role, no destination bucket and no DR key, so the first apply would have
# failed — or, worse, been "fixed" by switching replication off.
#
# Applied with the DR-region provider (environments/*: providers = aws.dr).
# NOT APPLIED — same caveat as the storage module: no AWS account yet.
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

data "aws_caller_identity" "current" {}

locals {
  bucket_name = "${var.name_prefix}-originals-replica-${data.aws_caller_identity.current.account_id}"
}

# A REPLICA of the primary's multi-region objects key, not a new key: the kms
# module made that key multi-region for exactly this (P2.4), so both regions
# share key material and rotation, and there is one key to reason about.
resource "aws_kms_replica_key" "replica" {
  description     = "MIR originals replica (DR region)"
  primary_key_arn = var.source_kms_key_arn
  # Same reasoning as the primary keys: deleting this destroys every replica.
  deletion_window_in_days = 30
  policy                  = data.aws_iam_policy_document.replica_key.json
  tags                    = var.tags
}

data "aws_iam_policy_document" "replica_key" {
  # checkov:skip=CKV_AWS_109:A key policy's resource is the key it is attached to; "*" is self-referential.
  # checkov:skip=CKV_AWS_111:Same. Administration is scoped to the account root, as in modules/kms.
  # checkov:skip=CKV_AWS_356:Same -- "*" is self-referential within a key policy.

  # Root keeps administrative control, which is also what lets the IAM
  # replication role's kms: grants take effect (modules/kms does the same).
  statement {
    sid       = "EnableRootAccountManagement"
    effect    = "Allow"
    actions   = ["kms:*"]
    resources = ["*"]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }
  }
}

resource "aws_kms_alias" "replica" {
  name          = "alias/${var.name_prefix}-originals-replica"
  target_key_id = aws_kms_replica_key.replica.key_id
}

resource "aws_s3_bucket" "replica" {
  # checkov:skip=CKV2_AWS_61:The replica mirrors an Object Lock (COMPLIANCE) source of record. Replicated objects carry the source's retention; an expiry rule here would be refused or would remove the only other copy.
  # checkov:skip=CKV2_AWS_62:No consumer for S3 events on the DR copy.
  # checkov:skip=CKV_AWS_144:This IS the cross-region copy; replicating it again buys nothing.
  # checkov:skip=CKV_AWS_18:Access logging for the DR copy lives with the primary's access-log design (storage module); tracked with the audit-bucket follow-up.
  bucket = local.bucket_name

  # S3 only replicates objects under Object Lock into a bucket that has it,
  # and it must be set at creation.
  object_lock_enabled = true

  lifecycle {
    prevent_destroy = true
  }

  tags = merge(var.tags, {
    Name      = local.bucket_name
    DataClass = "patient-imaging"
    Role      = "dr-replica"
  })
}

resource "aws_s3_bucket_versioning" "replica" {
  bucket = aws_s3_bucket.replica.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "replica" {
  bucket = aws_s3_bucket.replica.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_replica_key.replica.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "replica" {
  bucket                  = aws_s3_bucket.replica.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "replica" {
  bucket = aws_s3_bucket.replica.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

# The role S3 assumes in the PRIMARY bucket's replication rule. IAM is global;
# it is created here only so every DR-side resource lives in one place.
resource "aws_iam_role" "replication" {
  name = "${var.name_prefix}-originals-replication"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "s3.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = var.tags
}

resource "aws_iam_role_policy" "replication" {
  name = "replicate-originals"
  role = aws_iam_role.replication.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadSourceConfig"
        Effect   = "Allow"
        Action   = ["s3:GetReplicationConfiguration", "s3:ListBucket"]
        Resource = var.source_bucket_arn
      },
      {
        Sid    = "ReadSourceVersions"
        Effect = "Allow"
        Action = [
          "s3:GetObjectVersionForReplication",
          "s3:GetObjectVersionAcl",
          "s3:GetObjectVersionTagging",
          "s3:GetObjectRetention",
          "s3:GetObjectLegalHold",
        ]
        Resource = "${var.source_bucket_arn}/*"
      },
      {
        Sid      = "WriteReplica"
        Effect   = "Allow"
        Action   = ["s3:ReplicateObject", "s3:ReplicateTags"]
        Resource = "${aws_s3_bucket.replica.arn}/*"
        # Delete markers are deliberately NOT replicated (storage module), so
        # the role is not granted s3:ReplicateDelete at all.
      },
      {
        Sid      = "DecryptSource"
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = var.source_kms_key_arn
        Condition = {
          StringLike = { "kms:ViaService" = "s3.${var.source_region}.amazonaws.com" }
        }
      },
      {
        Sid      = "EncryptReplica"
        Effect   = "Allow"
        Action   = ["kms:Encrypt", "kms:GenerateDataKey"]
        Resource = aws_kms_replica_key.replica.arn
        Condition = {
          StringLike = { "kms:ViaService" = "s3.${var.dr_region}.amazonaws.com" }
        }
      },
    ]
  })
}
