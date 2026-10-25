# blog.phufamily.com -> GitHub Pages of this repo.
# The zone is owned by another root (banhloc-be-anh/terraform/live/domain); this root adds only its own record.

data "aws_route53_zone" "family" {
  name = "phufamily.com"
}

resource "aws_route53_record" "blog" {
  zone_id = data.aws_route53_zone.family.zone_id
  name    = "blog.phufamily.com"
  type    = "CNAME"
  ttl     = 300
  records = ["hoangphu7122002.github.io"]
}
