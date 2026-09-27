###############################################################################
# dev environment — BUILD_SPEC P2.1.
#
# ⚠️ NOT APPLIED. No AWS account is attached to this repository. `terraform
# init` and `terraform plan` have NOT been run, so the P2.1 gate ("plan runs
# with zero errors; state stored remotely") is OPEN. So are P2.2 (database
# unreachable from the internet, verified by connection attempt), P2.3 (four
# keys with rotation), P2.4 (delete rejected, replication confirmed), P2.5
# (failover + PITR restore) and P2.6 (health check over TLS).
#
# ADR-7 applies here as much as anywhere: dev and staging use SYNTHETIC data
# only. There is no path by which production data reaches this account.
###############################################################################

terraform {
  required_version = "~> 1.9"

  required_providers {
    aws = {
      source = "hashicorp/aws"
      # Pinned to a minor range (P2.1 rule 3). An unpinned provider means a
      # `terraform init` months from now silently changes resource behaviour.
      version = "~> 5.70"
    }
  }

  # P2.1: S3 remote state with DynamoDB locking, encrypted and versioned.
  # Two engineers applying at once without a lock corrupts state, and corrupt
  # state on an Object-Lock bucket is very hard to recover from.
  backend "s3" {
    bucket         = "mir-tfstate-prod"
    key            = "prod/terraform.tfstate"
    region         = "eu-south-1"
    dynamodb_table = "mir-tfstate-lock"
    encrypt        = true
  }
}

# DECISION D5: Milan primary, Paris as fallback and DR.
#
# UNVERIFIED PRECONDITION: eu-south-1 is an OPT-IN region and must be enabled
# on the account. Milan must also be confirmed to support S3 Object Lock in
# compliance mode, S3 cross-region replication, RDS PostgreSQL 16 multi-AZ,
# and customer-managed KMS with rotation. If any is missing, switch to
# eu-west-3 — which is why the region is a variable, not a literal.
provider "aws" {
  region = var.primary_region

  default_tags {
    tags = local.tags
  }
}

provider "aws" {
  alias  = "dr"
  region = var.dr_region

  default_tags {
    tags = local.tags
  }
}

locals {
  environment = "prod"
  tags = {
    Project     = "mir"
    Environment = local.environment
    ManagedBy   = "terraform"
    # Every environment is tagged so a stray resource holding patient data
    # cannot hide in the bill.
    DataClass = "patient-data"
  }
}

module "kms" {
  source      = "../../modules/kms"
  environment = local.environment
  tags        = local.tags
}

module "network" {
  source              = "../../modules/network"
  environment         = local.environment
  availability_zones  = var.availability_zones
  flow_log_bucket_arn = var.flow_log_bucket_arn
  tags                = local.tags
}

module "storage" {
  source      = "../../modules/storage"
  name_prefix = "mir-${local.environment}"

  kms_key_arn_objects = module.kms.key_arns["objects"]
  kms_key_arn_backups = module.kms.key_arns["backups"]

  # BLOCKING L5 — placeholders. See modules/storage/variables.tf.
  imaging_retention_days = var.imaging_retention_days
  audit_retention_days   = var.audit_retention_days

  # Replication is off in dev: it doubles storage cost for synthetic data and
  # proves nothing that the staging drill will not prove better.
  enable_replication   = true
  replication_role_arn = module.replica.replication_role_arn
  replica_bucket_arn   = module.replica.replica_bucket_arn
  replica_kms_key_arn  = module.replica.replica_kms_key_arn

  tags = local.tags
}

# What the replication rule above points at: DR key, bucket and role, in the
# DR region. Without this, enable_replication named nothing and could not apply.
module "replica" {
  source    = "../../modules/replica"
  providers = { aws = aws.dr }

  name_prefix        = "mir-${local.environment}"
  source_bucket_arn  = module.storage.originals_bucket_arn
  source_kms_key_arn = module.kms.key_arns["objects"]
  source_region      = var.primary_region
  dr_region          = var.dr_region

  tags = local.tags
}
