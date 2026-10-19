#!/usr/bin/env bash
# One-time setup so GitHub Actions can deploy Hosting with no stored key
# (Workload Identity Federation). Only pushes to main of wintokk/home24-studio
# can use it, and the service account can only manage Hosting.
# Run in Cloud Shell: bash scripts/setup-auto-deploy.sh
set -euo pipefail
PROJECT=home24-studio
REPO=wintokk/home24-studio
SA=github-deploy
POOL=github
NUM=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
SA_EMAIL="$SA@$PROJECT.iam.gserviceaccount.com"

gcloud services enable iamcredentials.googleapis.com sts.googleapis.com --project "$PROJECT"

gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT" >/dev/null 2>&1 ||
  gcloud iam service-accounts create "$SA" --project "$PROJECT" --display-name "GitHub Actions deploy (Hosting only)"

for ROLE in roles/firebasehosting.admin roles/firebase.viewer roles/serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member "serviceAccount:$SA_EMAIL" --role "$ROLE" --condition None -q >/dev/null
done

gcloud iam workload-identity-pools describe "$POOL" --location global --project "$PROJECT" >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools create "$POOL" --location global --project "$PROJECT" --display-name GitHub

gcloud iam workload-identity-pools providers describe "$POOL" --location global --workload-identity-pool "$POOL" --project "$PROJECT" >/dev/null 2>&1 ||
  gcloud iam workload-identity-pools providers create-oidc "$POOL" --location global --workload-identity-pool "$POOL" --project "$PROJECT" \
    --display-name "GitHub Actions" \
    --issuer-uri https://token.actions.githubusercontent.com \
    --attribute-mapping google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref \
    --attribute-condition "assertion.repository=='$REPO' && assertion.ref=='refs/heads/main'"

gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" --project "$PROJECT" --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/$NUM/locations/global/workloadIdentityPools/$POOL/attribute.repository/$REPO" >/dev/null

echo "AUTO-DEPLOY READY"
echo "provider:        projects/$NUM/locations/global/workloadIdentityPools/$POOL/providers/$POOL"
echo "service account: $SA_EMAIL"
