#!/usr/bin/env bash
# Set up GitHub secrets and provision AWS EC2 for ugpt
# Prerequisites: gh cli authenticated, aws cli configured
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
KEY_NAME="ugpt-key"
SG_NAME="ugpt-sg"
INSTANCE_TYPE="t4g.nano"

echo "==> Step 1: AWS — Create security group"
SG_ID=$(aws ec2 create-security-group \
  --group-name "$SG_NAME" \
  --description "ugpt backend" \
  --region "$REGION" \
  --query 'GroupId' --output text 2>/dev/null || \
  aws ec2 describe-security-groups \
    --group-names "$SG_NAME" \
    --region "$REGION" \
    --query 'SecurityGroups[0].GroupId' --output text)

echo "   Security group: $SG_ID"

# Allow SSH, HTTP, HTTPS
for PORT in 22 80 443; do
  aws ec2 authorize-security-group-ingress \
    --group-id "$SG_ID" \
    --protocol tcp --port "$PORT" --cidr 0.0.0.0/0 \
    --region "$REGION" 2>/dev/null || true
done

echo "==> Step 2: AWS — Create key pair"
if [ ! -f "$KEY_NAME.pem" ]; then
  aws ec2 create-key-pair \
    --key-name "$KEY_NAME" \
    --key-type ed25519 \
    --query 'KeyMaterial' --output text \
    --region "$REGION" > "$KEY_NAME.pem"
  chmod 400 "$KEY_NAME.pem"
  echo "   Key saved to $KEY_NAME.pem"
else
  echo "   Key $KEY_NAME.pem already exists, skipping"
fi

echo "==> Step 3: AWS — Find Ubuntu 24.04 ARM64 AMI"
AMI_ID=$(aws ec2 describe-images \
  --owners 099720109477 \
  --filters \
    "Name=name,Values=ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-arm64-server-*" \
    "Name=state,Values=available" \
  --query 'Images | sort_by(@, &CreationDate) | [-1].ImageId' \
  --output text \
  --region "$REGION")

echo "   AMI: $AMI_ID"

echo "==> Step 4: AWS — Launch t4g.nano instance"
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id "$AMI_ID" \
  --instance-type "$INSTANCE_TYPE" \
  --key-name "$KEY_NAME" \
  --security-group-ids "$SG_ID" \
  --count 1 \
  --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=ugpt-backend}]" \
  --region "$REGION" \
  --query 'Instances[0].InstanceId' --output text)

echo "   Instance: $INSTANCE_ID"
echo "   Waiting for instance to be running..."
aws ec2 wait instance-running --instance-ids "$INSTANCE_ID" --region "$REGION"

echo "==> Step 5: AWS — Allocate and associate Elastic IP"
ALLOC_ID=$(aws ec2 allocate-address \
  --domain vpc \
  --region "$REGION" \
  --query 'AllocationId' --output text)

ELASTIC_IP=$(aws ec2 describe-addresses \
  --allocation-ids "$ALLOC_ID" \
  --region "$REGION" \
  --query 'Addresses[0].PublicIp' --output text)

aws ec2 associate-address \
  --instance-id "$INSTANCE_ID" \
  --allocation-id "$ALLOC_ID" \
  --region "$REGION" > /dev/null

echo "   Elastic IP: $ELASTIC_IP"

echo "==> Step 6: GitHub — Set secrets"
gh secret set EC2_HOST --body "$ELASTIC_IP"
gh secret set EC2_SSH_KEY < "$KEY_NAME.pem"

echo ""
echo "========================================="
echo "Setup complete!"
echo ""
echo "EC2 Instance: $INSTANCE_ID"
echo "Elastic IP:   $ELASTIC_IP"
echo "SSH:          ssh -i $KEY_NAME.pem ubuntu@$ELASTIC_IP"
echo ""
echo "Next steps:"
echo "  1. Wait ~60s for instance to boot"
echo "  2. SSH in and run: bash deploy-scripts/ec2-setup.sh"
echo "  3. Edit /opt/ugpt/.env with real API keys"
echo "  4. Set up DNS: api.ugpt.ca → $ELASTIC_IP"
echo "  5. Push to main to trigger first deploy"
echo "========================================="
