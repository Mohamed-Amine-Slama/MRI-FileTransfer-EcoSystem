output "replication_role_arn" {
  value = aws_iam_role.replication.arn
}

output "replica_bucket_arn" {
  value = aws_s3_bucket.replica.arn
}

output "replica_kms_key_arn" {
  value = aws_kms_replica_key.replica.arn
}
