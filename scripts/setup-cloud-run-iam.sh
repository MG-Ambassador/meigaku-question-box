#!/usr/bin/env bash
# Run once as a project administrator, outside GitHub Actions.
set -euo pipefail

PROJECT_ID=${1:?Usage: bash scripts/setup-cloud-run-iam.sh PROJECT_ID}
DEPLOYER="github-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME="meigaku-api-runner@${PROJECT_ID}.iam.gserviceaccount.com"

# Verify the existing identities before making changes. WIF is configured separately.
gcloud iam service-accounts describe "$DEPLOYER" --project="$PROJECT_ID" >/dev/null
gcloud iam service-accounts describe "$RUNTIME" --project="$PROJECT_ID" >/dev/null
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com firestore.googleapis.com \
  firebaserules.googleapis.com firebase.googleapis.com iamcredentials.googleapis.com \
  --project="$PROJECT_ID"

# Discover the actual build identity; older projects may use the legacy Cloud Build SA.
BUILD_RESOURCE=$(gcloud builds get-default-service-account --project="$PROJECT_ID" --region=asia-northeast1)
BUILD_ACCOUNT=${BUILD_RESOURCE##*/}
if [[ "$BUILD_ACCOUNT" != *@*.gserviceaccount.com ]]; then
  echo "Could not determine the Cloud Build service account: $BUILD_RESOURCE" >&2
  exit 1
fi

# Source deployment, public service IAM, and Firebase rules/index deployment.
for role in roles/run.sourceDeveloper roles/run.admin \
  roles/serviceusage.serviceUsageConsumer roles/firebaserules.admin \
  roles/datastore.indexAdmin roles/firebase.viewer; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$DEPLOYER" --role="$role" --condition=None --quiet >/dev/null
done

# actAs is scoped to the identities used by this workflow, not every project SA.
for account in "$RUNTIME" "$BUILD_ACCOUNT"; do
  gcloud iam service-accounts add-iam-policy-binding "$account" \
    --project="$PROJECT_ID" --member="serviceAccount:$DEPLOYER" \
    --role=roles/iam.serviceAccountUser --condition=None --quiet >/dev/null
done
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$BUILD_ACCOUNT" --role=roles/run.builder --condition=None --quiet >/dev/null

echo "Deployment IAM configured. Allow time for IAM propagation, then rerun Deploy Cloud Run API."
