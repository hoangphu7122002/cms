# DNS for blog.phufamily.com

One CNAME to GitHub Pages. Account id and state bucket are not committed (this repo is public).

```
cp <your backend.hcl> backend.hcl      # bucket, key = cms/dns/terraform.tfstate, region, encrypt, use_lockfile
echo 'account_id = "<aws account id>"' > terraform.tfvars
terraform init -backend-config=backend.hcl
terraform plan -out dns.tfplan && terraform apply dns.tfplan
```

Then in GitHub: Settings, Pages, Custom domain `blog.phufamily.com`, Enforce HTTPS.
