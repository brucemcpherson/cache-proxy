PROJECT=YOUR_PROJECT
SECRET=redis_secrets
P=$(gcloud config get project)
if [ "$P" = "$PROJECT" ] ; then
  REDIS_SECRETS=$(gcloud secrets versions access latest --secret=${SECRET})
  export REDIS_SECRETS
else
   echo "current project ${P} doesnt match required project ${PROJECT}"
fi