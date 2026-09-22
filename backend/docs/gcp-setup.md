# Croplytix backend — Google Cloud setup, step by step

You run these yourself, one block at a time, and read the *why* before each one.
Every command is idempotent enough that re-running after a typo is safe. Region is
`us-central1` throughout: it is one of the three regions where Cloud Storage's free
5 GB counts, and it is the pricing baseline for Cloud Run's free tier.

Estimated time: 30–40 minutes, most of it waiting for the first Cloud Build.

---

## 0. Preflight — know which project you're in

```bash
gcloud auth list                 # the account with the * is the one gcloud acts as
gcloud config get project        # this must print the free-trial project id
```

Then pin the values every later command uses. Paste these into the same terminal
you'll keep using (they are shell variables, they vanish when the terminal closes):

```bash
export PROJECT_ID=$(gcloud config get project)
export REGION=us-central1
export BUCKET=croplytix-${PROJECT_ID}-uploads
export SA=croplytix-api
export SA_EMAIL=${SA}@${PROJECT_ID}.iam.gserviceaccount.com
echo $PROJECT_ID $REGION $BUCKET $SA_EMAIL
```

*Why the project id is inside the bucket name:* bucket names are global across every
Google customer. `croplytix-uploads` is almost certainly taken; `croplytix-<your
project>-uploads` is not.

## 1. Turn on the APIs

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com \
  iam.googleapis.com
```

*Why:* every Google service is switched off per project until you enable it. This
is free and instant. What each one is for: **Cloud Run** hosts the container,
**Cloud Build** builds the image from the Dockerfile, **Artifact Registry** stores
the built image, **Firestore** holds the trial/flight records, **Cloud Storage**
holds the files, **IAM** lets you create the service account in step 3.

## 2. The bucket — where the bytes live

```bash
gcloud storage buckets create gs://$BUCKET \
  --location=$REGION \
  --uniform-bucket-level-access \
  --public-access-prevention
```

*Why each flag:*

- `--location=$REGION` — a single region, not `US` multi-region. Multi-region
  storage is not in the free tier and every read from Cloud Run would cross a
  region boundary. Same region as the API = free, fast reads.
- `--uniform-bucket-level-access` — permissions are set once, on the bucket, with
  IAM. The alternative (per-object ACLs) is a legacy model that makes "who can read
  this file?" unanswerable at scale. Uniform is what Google recommends for new
  buckets.
- `--public-access-prevention` — a hard lock: even if someone later grants
  `allUsers` by mistake, the bucket stays private. Field imagery and plot rosters
  are not public data; the API is the only door.

Check it:

```bash
gcloud storage buckets describe gs://$BUCKET
```

In the output look for `location: US-CENTRAL1`, a `STANDARD` storage class,
uniform bucket-level access `true`, and public access prevention `enforced`.

## 3. Firestore — where the records live

```bash
gcloud firestore databases create --location=$REGION
```

That creates the database named `(default)` in Native mode, Standard edition
(those are the flag defaults; `--database`, `--type`, `--edition` if you want to
spell them out).

*Why these choices:*

- **`(default)` and only one database.** The free quota (1 GiB stored, 50k reads /
  20k writes / 20k deletes per day) applies to one database per project. A second
  database is billed from the first byte.
- **Native mode**, not Datastore mode. Native is the document model the backend's
  `FirestoreRepo` is written against; Datastore mode is a compatibility shim for an
  older product.
- **The location is permanent.** You cannot move a Firestore database later, only
  delete and recreate. Putting it in the same region as the bucket and the API
  keeps every hop local.
- Why Firestore rather than Cloud SQL: Cloud SQL's smallest instance is not in the
  free tier and bills by the hour whether or not anyone is using it. Firestore
  bills per operation and idles at zero — the right shape for an app that gets used
  in bursts on flight days.

Check it:

```bash
gcloud firestore databases describe --database="(default)"
```

Look for `locationId: us-central1` and `type: FIRESTORE_NATIVE`.

## 4. A service account for the API — its own identity, minimum rights

```bash
gcloud iam service-accounts create $SA --display-name="Croplytix API (Cloud Run)"

# May read/write objects in THIS bucket only.
gcloud storage buckets add-iam-policy-binding gs://$BUCKET \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/storage.objectAdmin"

# May read/write Firestore documents. (Firestore's roles still carry the old
# "datastore" name.) This one has to be project-level.
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/datastore.user"
```

*Why not just use the default?* If you don't pick a service account, Cloud Run runs
your container as the *Compute Engine default service account*, which on a
personal project usually holds the **Editor** role — it could delete your VM,
create new ones, read any bucket. The API needs to touch one bucket and one
database. Giving it exactly that means a bug (or a stranger who finds the URL)
can't reach anything else. This is the single most valuable IAM habit to build.

*Why the bucket binding is on the bucket, not the project:* `objectAdmin` at
project level would cover every bucket in the project, including any you create
later. Bound to `gs://$BUCKET` it covers one.

Check it:

```bash
gcloud storage buckets get-iam-policy gs://$BUCKET --format="yaml(bindings)"
```

## 5. Fill in the Cloud Run environment file

Open `backend/deploy/env.cloudrun.yaml` and replace both `REPLACE_ME_PROJECT_ID`
occurrences with your project id (`echo $PROJECT_ID` prints it). Leave
`CORS_ORIGINS` alone for now — you'll set it in step 8 once the frontend has a URL.

*Why a file and not flags:* the container reads its configuration from environment
variables — the exact same names as in `.env.example` for local runs. That is what
lets one image run on your laptop against a folder, and on Cloud Run against GCS
and Firestore, with no code change. The YAML file just avoids `--set-env-vars`'s
habit of splitting on commas.

## 6. Build and deploy — one command touches three services

From the `backend/` directory:

```bash
gcloud run deploy croplytix-api \
  --source . \
  --region $REGION \
  --service-account $SA_EMAIL \
  --env-vars-file deploy/env.cloudrun.yaml \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 2 \
  --concurrency 20 \
  --timeout 300
```

The first run asks whether to create an Artifact Registry repository called
`cloud-run-source-deploy` in `us-central1`. Say **yes** — that's where the built
image goes (0.5 GB is free; each image is ~150 MB and old ones can be deleted).
Then it uploads the directory (minus `.gcloudignore` entries), Cloud Build runs the
Dockerfile, pushes the image, and Cloud Run rolls out a revision. Expect 2–4
minutes the first time; later builds reuse the dependency layer and are faster.

*Why each flag:*

- `--source .` — "build it for me." Cloud Build sees the `Dockerfile` and uses it.
  Without a Dockerfile it would guess with buildpacks; we don't want guessing.
- `--service-account` — run as the identity from step 4, not the default.
- `--allow-unauthenticated` — the browser calls this API directly, and browsers
  can't carry Google IAM credentials. So the URL is public. **That means anyone
  who finds it can create trials and upload files.** Acceptable for a demo; the
  next backend slice is a login (Identity Platform / Firebase Auth) so the API can
  check a user token.
- `--memory 512Mi` — Cloud Run's filesystem is RAM. A 30 MB upload spools into
  it while streaming to GCS; 512 MiB leaves room. `--cpu 1` is the smallest
  sensible size.
- `--min-instances 0` — scale to zero. This is the whole reason Cloud Run fits the
  free tier: no requests, no bill. The cost is a *cold start* of ~1–2 s on the
  first request after idle. If that would look bad in the demo, warm it up with a
  `curl` to `/api/health` a minute before you present.
- `--max-instances 2` — a ceiling. If something loops or a script hammers the API,
  it cannot fan out to hundreds of containers and burn the credit.
- `--concurrency 20` — requests per container before it scales out. The handlers
  are synchronous (they block on Google's client libraries) and FastAPI runs them
  in a thread pool; 20 is comfortable.
- `--timeout 300` — five minutes per request, plenty for a 30 MB upload on a slow
  link.

When it finishes it prints `Service URL: https://croplytix-api-....run.app`.
Keep that:

```bash
export API_URL=$(gcloud run services describe croplytix-api --region $REGION --format='value(status.url)')
echo $API_URL
```

**If the build fails with a permissions error** mentioning
`...-compute@developer.gserviceaccount.com`: Cloud Build in newer projects runs as
the Compute default service account and occasionally lacks the builder role. Fix:

```bash
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/cloudbuild.builds.builder"
```

then re-run the deploy.

## 7. Prove it works, end to end, with nothing but curl

```bash
curl -s $API_URL/api/health
```

Expect `{"ok":true,"storage":"gs://croplytix-...-uploads","db":"firestore:(default)"}`.
That line is the adapters reporting *which* backends this process wired up — the
first thing to check when something works locally and not in the cloud.

```bash
curl -s -X POST $API_URL/api/trials \
  -H 'content-type: application/json' \
  -d '{"name":"Demo Yam Trial","crop":"Yam","site":"Guadeloupe","season":"2026","plots":144}'
```

Now go look at the record from the other side: **Console → Firestore → Data** — a
`trials` collection with a document id `demo-yam-trial-2026`. That's the slug the
API minted from name + season.

Upload a flight (any small files will do for the check — a real .tif and shapefile
parts once the frontend is wired):

```bash
printf 'fake' > /tmp/o.tif; printf 'fake' > /tmp/p.shp; printf 'fake' > /tmp/p.prj
curl -s -X POST $API_URL/api/trials/demo-yam-trial-2026/flights \
  -F 'meta={"flightDate":"2026-08-20","source":"ortho","capture":"12-ms","modelId":"cc-v1","plots":144}' \
  -F ortho=@/tmp/o.tif -F shapefile=@/tmp/p.shp -F shapefile=@/tmp/p.prj

gcloud storage ls -r gs://$BUCKET
```

The `ls` shows `trials/demo-yam-trial-2026/flights/flt_.../ortho/o.tif` and the two
shapefile parts. Buckets are flat — those slashes are just characters in the
object name — but the naming convention makes the bucket browse like a tree and
lets you attach lifecycle rules per prefix later.

Logs, when anything surprises you:

```bash
gcloud run services logs read croplytix-api --region $REGION --limit 30
```

## 8. Deploy the frontend next to it

The frontend image is nginx serving the built React app, with one extra rule:
requests to `/api/…` are proxied to the backend service over TLS. The backend's
hostname arrives as an environment variable (`API_HOST`), rendered into the nginx
config when the container starts — so the image is built once and pointed
wherever.

From the `frontend/` directory:

```bash
export API_HOST=${API_URL#https://}     # strips the scheme: croplytix-api-....run.app
echo $API_HOST

gcloud run deploy croplytix-web \
  --source . \
  --region $REGION \
  --allow-unauthenticated \
  --set-env-vars API_HOST=$API_HOST \
  --port 8080 \
  --memory 256Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 2
```

The first build is the slow one (npm install + Vite build inside Cloud Build,
3–5 minutes). When it finishes:

```bash
export WEB_URL=$(gcloud run services describe croplytix-web --region $REGION --format='value(status.url)')
echo $WEB_URL
curl -s $WEB_URL/api/health          # goes browser → nginx → Cloud Run API
```

If that `curl` returns the same health JSON as step 7, the proxy is right. Open
`$WEB_URL` in a browser: the trials list is now the Firestore collection, and
"New trial" writes to it.

*Why proxy instead of calling the API URL from the browser directly?* Three
reasons. Same-origin means no CORS headers, no preflight requests, and — later —
cookies for login just work. The API address is a deploy-time setting, not
something compiled into the JavaScript, so one build serves every environment.
And the browser only ever sees one hostname, which is what users and TLS expect.
The cost is one extra hop (nginx → API) inside Google's network, a few
milliseconds.

*Why the frontend runs as the default service account:* it never touches a Google
API — it serves static files and forwards HTTP. Nothing to scope.

*Fallback if Cloud Run misbehaves during the demo:* the same image runs on the
free-tier VM with `docker run -p 80:8080 -e API_HOST=$API_HOST <image>`, since
nothing about it is Cloud Run-specific.

## 9. Two guardrails worth two minutes

A budget alert, so the credit can't silently drain:

```bash
gcloud services enable billingbudgets.googleapis.com
gcloud billing accounts list          # copy the ACCOUNT_ID
gcloud billing budgets create \
  --billing-account=ACCOUNT_ID \
  --display-name="Croplytix guardrail" \
  --budget-amount=50USD \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.9
```

And a note in your calendar for **day 85 of the trial**: at day 90 the $300 expires
and, unless you upgrade the billing account, *every resource in the project is
stopped*. Upgrading doesn't cost anything by itself — the Always Free limits keep
applying — it just means overage would bill your card instead of the credit.

---

## Optional, but the best lesson in here: run the API on your laptop against the real cloud

```bash
gcloud auth application-default login
```

That writes a credential file the Google client libraries find automatically.
It's what "Application Default Credentials" means: the *same* `storage.Client()`
line in `app/storage.py` uses your user login on your laptop, and the service
account on Cloud Run, with no code aware of the difference.

Then in `backend/`:

```bash
cp .env.example .env
# edit .env: STORAGE_BACKEND=gcs, DB_BACKEND=firestore, GCS_BUCKET=<your bucket>, GCP_PROJECT=<id>
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000
curl -s localhost:8000/api/health
```

`/api/health` now says `gs://...` and `firestore:(default)` — same code, different
environment, real cloud. `pytest` still runs entirely offline, because the tests
override the adapters.

## What this costs

At demo scale everything above sits inside Always Free: a few hundred Firestore
ops a day against 50k/20k, a few hundred MB in the bucket against 5 GB, a few
hundred requests against 2 million, one ~150 MB image against 0.5 GB in Artifact
Registry. The one thing that *will* consume credit if you leave it on is
`--min-instances 1` (keeps a container warm, ~$8–10/month at 512Mi). Everything
here scales to zero.
