variable "name_prefix" {
  description = "Prefix shared with the storage module, e.g. mir-prod."
  type        = string
}

variable "source_bucket_arn" {
  description = "ARN of the primary originals bucket (storage module output)."
  type        = string
}

variable "source_kms_key_arn" {
  description = "The primary's multi-region objects key; this module replicates it into the DR region."
  type        = string
}

variable "source_region" {
  description = "Region of the primary bucket."
  type        = string
}

variable "dr_region" {
  description = "Region of this replica. Must match the provider this module is given."
  type        = string
}

variable "tags" {
  description = "Tags applied to every resource."
  type        = map(string)
  default     = {}
}
