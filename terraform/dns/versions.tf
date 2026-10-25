terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
  }

  backend "s3" {}
}

provider "aws" {
  region              = "ap-southeast-1"
  allowed_account_ids = [var.account_id]

  default_tags {
    tags = { Project = "phufamily", ManagedBy = "terraform" }
  }
}

variable "account_id" {
  description = "AWS account that owns the phufamily.com zone. Set in terraform.tfvars (gitignored)."
  type        = string
}
