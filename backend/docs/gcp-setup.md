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
gcloud config get project        # this must print the Croplytix project id (not-croplytixs)
```

Then pin the values every later command uses. Paste these into the same terminal
you'll keep using (they are shell variables, they vanish when the terminal closes):

```bash
export PROJECT_ID=$(gcloud config get project)
export REGION=us-central1
export BUCKET=croplytix-${PROJECT_ID}-uploads
export SA=croplytix-api
export SA_EMAIL=${SA}@${PROJECT_ID}.iam.gserviceaccount.com
export WEB_SA_EMAIL=croplytix-web@${PROJECT_ID}.iam.gserviceaccount.com
echo $PROJECT_ID $REGION $BUCKET $SA_EMAIL $WEB_SA_EMAIL
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
  --concurrency 10 \
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
  can't carry Google IAM credentials. So the URL is public, and the API checks the
  Identity Platform sign-in itself: every route except `/api/health` refuses a
  request without a valid ID token.
- `--memory 512Mi` — file bytes never pass through the API (the browser sends them
  straight to the bucket), so it only handles small JSON requests and the
  occasional small download. 512 MiB is ample. `--cpu 1` is the smallest sensible size.
- `--min-instances 0` — scale to zero. This is the whole reason Cloud Run fits the
  free tier: no requests, no bill. The cost is a *cold start* of ~1–2 s on the
  first request after idle. If that would look bad in the demo, warm it up with a
  `curl` to `/api/health` a minute before you present.
- `--max-instances 2` — a ceiling. If something loops or a script hammers the API,
  it cannot fan out to hundreds of containers and run up the bill.
- `--concurrency 10` — requests per container before Cloud Run starts another.
  With uploads going straight to the bucket this could go higher; the ceiling now
  is the downloads `GET …/files/…` streams back (up to 32 MiB each, 1 MiB in
  memory at a time), so 10 stays a comfortable margin.
- `--timeout 300` — five minutes per request. Requests are quick now; the long
  part of an upload happens between the browser and Cloud Storage.

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

Expect `{"ok":true,"storage":"gs://croplytix-...-uploads","db":"firestore:(default)","auth":"identity-platform:..."}`.
That line is the adapters reporting *which* backends this process wired up — the
first thing to check when something works locally and not in the cloud.

Every other route needs a signed-in user. Get an ID token for your own account
(`scripts/get_token.py` signs in the way the browser does; its header says which
key it needs):

```bash
export ID_TOKEN=$(python3 scripts/get_token.py you@example.com)
AUTH="Authorization: Bearer $ID_TOKEN"
curl -s -H "$AUTH" $API_URL/api/me
```

```bash
curl -s -X POST $API_URL/api/trials -H "$AUTH" \
  -H 'content-type: application/json' \
  -d '{"name":"Demo Yam Trial","crop":"Yam","site":"Guadeloupe","season":"2026","plots":144}'
```

Now go look at the record from the other side: **Console → Firestore → Data** — a
`trials` document with the id `<your uid>:demo-yam-trial-2026`: the account it
belongs to, then the slug the API minted from name + season. Every trial and
flight belongs to an account, and the API shows each user only their own.

Upload a flight the way the browser does. The bytes don't go through the API:
declare the files, send them straight to the bucket, then say you're done.

```bash
printf 'fake' > /tmp/o.tif
curl -s -X POST $API_URL/api/trials/demo-yam-trial-2026/flights -H "$AUTH" \
  -H 'content-type: application/json' \
  -d '{"meta":{"flightDate":"2026-08-20","capture":"12-ms","plots":144},
       "files":[{"role":"ortho","name":"o.tif","size":4}]}' > /tmp/flight.json
FLIGHT=$(python3 -c "import json; print(json.load(open('/tmp/flight.json'))['flight']['id'])")
UPLOAD=$(python3 -c "import json; print(json.load(open('/tmp/flight.json'))['uploads'][0]['url'])")

curl -s -X PUT "$UPLOAD" --data-binary @/tmp/o.tif     # to Cloud Storage; no token
curl -s -X POST $API_URL/api/trials/demo-yam-trial-2026/flights/$FLIGHT/complete -H "$AUTH"

gcloud storage ls -r gs://$BUCKET/accounts/
```

The create call answers with the flight (`awaiting_upload`) and one upload URL per
file: a Cloud Storage *resumable upload session*, opened by the API for exactly the
size declared. The URL is the only credential the upload needs, so treat it like a
password; it lasts about a week. `complete` checks the file arrived at that size,
records its MD5, marks the flight `uploaded` and starts ingest, which then fails on
the fake TIFF and says so on the flight. That's expected.

The `ls` shows `accounts/<uid>/trials/demo-yam-trial-2026/flights/flt_.../ortho/o.tif`.
Buckets are flat — those slashes are just characters in the object name — but the
naming convention makes the bucket browse like a tree and lets you attach lifecycle
rules per prefix later.

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

# Its own identity, holding no roles at all (why: see below).
gcloud iam service-accounts create croplytix-web \
  --display-name="Croplytix web (Cloud Run)" \
  --description="Runs the nginx frontend. Holds no roles on purpose: it calls no Google API."

gcloud run deploy croplytix-web \
  --source . \
  --region $REGION \
  --service-account $WEB_SA_EMAIL \
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

*Why the frontend gets its own service account with no roles:* it never calls a
Google API — it serves files and forwards HTTP — so the right amount of access is
none. Leaving it on the default is not "none": code in any Cloud Run container can
ask the metadata server for an access token for the identity it runs as, and the
Compute Engine default account usually holds **Editor** on the project. That would
make the public-facing nginx container both the most exposed thing in the project
and the holder of its broadest key. A zero-role account's tokens open nothing, and
nothing here needs one: Cloud Run collects stdout/stderr logs itself, Cloud Run's
own service agent pulls the image, and the `/api` proxy is plain HTTPS to a public
URL. Why not take Editor away from the default account instead? Cloud Build runs
as that account (step 6) and needs it to build.

Check it — the first command should print `croplytix-web@…`, the second nothing:

```bash
gcloud run services describe croplytix-web --region $REGION \
  --format='value(spec.template.spec.serviceAccountName)'
gcloud projects get-iam-policy $PROJECT_ID --flatten="bindings[].members" \
  --filter="bindings.members:$WEB_SA_EMAIL" --format="value(bindings.role)"
```

Later `gcloud run deploy` runs keep the account (and `API_HOST`) unless you pass a
different value; the flag above is for a first deploy.

*Fallback if Cloud Run misbehaves during the demo:* the same image runs on the
free-tier VM with `docker run -p 80:8080 -e API_HOST=$API_HOST <image>`, since
nothing about it is Cloud Run-specific.

## 9. A budget alert — it now watches real money

The free trial on this project ended in September 2026 and the billing account is
pay-as-you-go: the Always Free limits still apply, and anything above them bills
the card. A budget emails you before a surprise does:

```bash
gcloud services enable billingbudgets.googleapis.com
BA=$(gcloud billing projects describe $PROJECT_ID --format='value(billingAccountName)')
export BILLING_ACCOUNT=${BA#billingAccounts/}

gcloud billing budgets create \
  --billing-account=$BILLING_ACCOUNT \
  --billing-project=$PROJECT_ID \
  --display-name="Croplytix monthly" \
  --budget-amount=25USD \
  --calendar-period=month \
  --filter-projects=projects/$PROJECT_ID \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.9 \
  --threshold-rule=percent=1.0 \
  --threshold-rule=percent=1.0,basis=forecasted-spend
```

*Why each piece:*

- A budget **alerts; it stops nothing.** The emails go to the billing account's
  administrators and users. The only hard ceilings in this setup are
  `--max-instances 2` on each service and scale-to-zero; storage and Firestore
  have none.
- `--filter-projects` — count this project's spend only, even if the billing
  account later pays for other projects too.
- The `forecasted-spend` rule fires when the month is *trending* past $25, before
  it gets there. Billing data lags usage by hours, so every email arrives after
  the spend it reports.
- `--billing-project` is not about money: it names the project whose API quota the
  call uses. The Budget API refuses a personal `gcloud auth login` without one
  ("end user credentials ... not supported by billingbudgets.googleapis.com").

Check it:

```bash
gcloud billing budgets list --billing-account=$BILLING_ACCOUNT --billing-project=$PROJECT_ID
```

A hard stop also exists: a **spend cap budget** (Preview, set up in the Console)
can pause Cloud Run in one project once that service's cost crosses a limit. Data
is untouched and the service stays paused until you lift the cap. One option while
the API still has no login:
https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps

## 10. The ingest job — every ortho becomes two COGs

Every completed ortho upload starts *ingest* (`app/ingest.py`). It turns the stored
ortho into two Cloud-Optimized GeoTIFFs under the flight's `…/derived/`:

- `cog.tif` — lossless, every band, for the clip and inference jobs;
- `view.tif` — 8-bit natural colour plus a mask, WebP, about a fifth of the
  original's size, for the map.

The flight's `ingest` field records the state (`queued → running → complete` or
`failed`, with the reason) and where the ortho sits (CRS, bounds, size). The flight
page shows it under **Map copies**.

Ingest runs as a Cloud Run **job**, not inside the API. A job is a container that
runs to the end and exits: it gets its own memory, so GDAL never shares the API's
512 MiB, and it bills only while it runs. It is the same image as the API with a
different command, so there is nothing new to build.

From `backend/`, after step 6 has deployed this code:

```bash
export IMAGE=$(gcloud run services describe croplytix-api --region $REGION \
  --format='value(spec.template.spec.containers[0].image)')
echo $IMAGE

gcloud run jobs deploy croplytix-ingest \
  --image $IMAGE \
  --region $REGION \
  --service-account $SA_EMAIL \
  --env-vars-file deploy/env.cloudrun.yaml \
  --command python \
  --args=-m,app.ingest \
  --add-volume mount-path=/mnt/uploads,type=cloud-storage,bucket=$BUCKET,readonly=true \
  --memory 8Gi \
  --cpu 2 \
  --max-retries 0 \
  --task-timeout 30m

# The API may start this one job, with a FLIGHT_ID of its choosing — nothing else.
gcloud run jobs add-iam-policy-binding croplytix-ingest \
  --region $REGION \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/run.jobsExecutorWithOverrides"
```

**Already have the job from before?** Give it the bucket mount and the memory
(the env file now carries `INGEST_SOURCE_DIR`):

```bash
gcloud run jobs update croplytix-ingest --region $REGION \
  --env-vars-file deploy/env.cloudrun.yaml \
  --add-volume mount-path=/mnt/uploads,type=cloud-storage,bucket=$BUCKET,readonly=true \
  --memory 8Gi --cpu 2
```

*Why each piece:*

- `--image $IMAGE` — the image the API is running, so the job and the API run
  the same code.
- `--service-account $SA_EMAIL` — the API's identity. It already reads and writes
  this bucket and Firestore, which is all ingest does.
- `--env-vars-file` — the same bucket and database settings. `INGEST_SOURCE_DIR`
  is for the job; the other `INGEST_*` lines are for the API, and the job ignores them.
- `--add-volume … type=cloud-storage` — mounts the bucket, read-only, as the folder
  `/mnt/uploads`. `INGEST_SOURCE_DIR` in the env file points ingest at it, so it
  reads each ortho in place instead of copying it to the job's disk first. The
  job's disk is RAM, so that copy would cost as much memory as the ortho. The mount
  reads only the parts GDAL asks for, straight from Cloud Storage. If the mount is
  missing, ingest copies the ortho and still works; the flight's `ingest.readFrom`
  says which happened (`mount` or `copy`).
- `--memory 8Gi --cpu 2` — what's left on the RAM disk is ingest's output: the
  lossless COG (about the ortho's size, sometimes more) and the overviews GDAL
  builds for it (about a third more), plus GDAL's cache. Budget about 2× the
  largest ortho plus 1 GiB, so 8 GiB covers orthos up to about 3.5 GB. Raise it
  when real orthos are bigger. Cloud Run allows up to 32 GiB; more memory needs
  more vCPUs, and `gcloud` names the minimum if you ask for too few. A job is
  billed only while it runs, so the size costs little.

  A job killed for running out of memory can't record that it failed. The API
  reports any ingest still `running` 35 minutes after it started (the task
  timeout plus 5) as `failed`, with a note to give the job more memory, and
  **Retry** works on it.
- `--max-retries 0` — a failure is written on the flight with its reason, and
  retrying a corrupt file can't help. **Retry** on the flight page starts a fresh
  execution.
- `--task-timeout 30m` — the default is 10 minutes. The 15 MB sample takes about a
  second; a multi-gigabyte ortho takes minutes.
- `roles/run.jobsExecutorWithOverrides`, granted *on the job* — the API can start
  executions of `croplytix-ingest` and set `FLIGHT_ID`. It can't change the job's
  image or command, or run any other job.

`deploy/env.cloudrun.yaml` sets `INGEST_RUNNER: "cloudrun"` and `INGEST_REGION`.
That's what makes the API start the job instead of running ingest in-process. If
the API was redeployed before the job existed, uploads in between show *failed:
Could not start ingest* — press **Retry** on each one.

**Every API deploy changes the image; the job keeps the old one until told:**

```bash
gcloud run jobs update croplytix-ingest --region $REGION \
  --image $(gcloud run services describe croplytix-api --region $REGION \
    --format='value(spec.template.spec.containers[0].image)')
```

Check it:

```bash
# Run it by hand for one flight (the id is on the flight page's URL).
gcloud run jobs execute croplytix-ingest --region $REGION \
  --update-env-vars FLIGHT_ID=flt_... --wait

gcloud run jobs executions list --job croplytix-ingest --region $REGION --limit 5
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="croplytix-ingest"' \
  --limit 30 --format='value(textPayload)'
gcloud storage ls -l "gs://$BUCKET/trials/*/flights/*/derived/"
```

*What it costs:* job time bills per vCPU-second and GiB-second while it runs.
Check the Cloud Run pricing page for how much the free tier covers. In the bucket,
the two COGs add about 1.5× the ortho's size. In Artifact Registry, rasterio and
numpy make the image about 160 MB bigger unpacked, so delete old images now and
then to stay near the 0.5 GB free tier.

---

## 11. One time: give records from before accounts an owner

Every trial and flight now belongs to an account (one per user), and the API shows
each user only their own. Records written before that have no owner, so nobody sees
them. To give them all to one user, from `backend/`:

```bash
gcloud auth application-default login     # once, if you haven't
python -m scripts.assign_account --project $PROJECT_ID --uid USER_UID           # shows what it will do
python -m scripts.assign_account --project $PROJECT_ID --uid USER_UID --apply   # does it
```

`USER_UID` is in **Identity Platform → Users → User UID** (or `curl -H "$AUTH"
$API_URL/api/me`). Each trial moves to the document id `<uid>:<trial id>`, each
flight gets the account. Files stay where they are: a flight records its files'
keys, so old `trials/…` keys keep working beside new `accounts/…` ones. Running it
again changes nothing.

## 12. The model's weights — into the bucket, once per model version

Processing (step 13) runs the lab's yam canopy U-Net. Its weights are the lab's
file from the model handoff (`Jakes-Handoff/model/unet_canopy_full.pt`, 98 MB). They
stay out of the repository, which is public, and live in the bucket instead, at
the key `app/model_registry.py` names:

```bash
gcloud storage cp "PATH/TO/Jakes-Handoff/model/unet_canopy_full.pt" \
  "gs://$BUCKET/models/base/yam-canopy-unet-v1/unet_canopy_full.pt"

# The registry pins the file by its SHA-256; a job refuses any other file.
shasum -a 256 "PATH/TO/Jakes-Handoff/model/unet_canopy_full.pt"
# 416dfd6c05ffba5e9383d7810df580a6c39aae014877990b5540d6a7c37a5043
```

*Why the bucket:* the processing job already reads it (through its mount, as ingest
does), the API's account already has access, and a new model version is a new
key next to the old one, so results made with the old one stay traceable. Private
and Global models (per account, or shared behind a promotion gate) will follow the
same layout under their own prefixes.

## 13. The processing job — canopy area per plot

Processing turns a flight's COG and plot grid into canopy area per plot
(`app/process.py`, with `app/pipeline/` doing the image work):

1. **Predict:** the U-Net over the whole field in 128 px tiles, 64 px apart,
   averaged into a canopy probability raster.
2. **Watershed:** each plot box is a seed; canopy is flooded from every plot's
   centre at once, split where plants touch at their narrowest point, and
   limited to the date's spacing between boxes.
3. **Write** a new result version: per-plot JSON, the CSV, the field picture, the
   plot-assignment raster and a run record with every input's hash, under
   `…/results/v<n>/`. Nothing is overwritten.

It reproduces the lab's research scripts: `scripts/check_pipeline.py` runs it on the
handoff's test dates and compares with its expected outputs (all 14 dates it can
read pass, within 1/255 of probability and 0.0006 m² of canopy per plot).

The job has its own image, because CPU PyTorch is several hundred MB the API
shouldn't carry. From `backend/`:

```bash
# Build it (5–8 minutes, mostly PyTorch's download)
gcloud builds submit --config cloudbuild.process.yaml .
export PROCESS_IMAGE=us-central1-docker.pkg.dev/$PROJECT_ID/cloud-run-source-deploy/croplytix-process:latest

gcloud run jobs deploy croplytix-process \
  --image $PROCESS_IMAGE \
  --region $REGION \
  --service-account $SA_EMAIL \
  --env-vars-file deploy/env.cloudrun.yaml \
  --add-volume mount-path=/mnt/uploads,type=cloud-storage,bucket=$BUCKET,readonly=true \
  --memory 8Gi \
  --cpu 4 \
  --max-retries 0 \
  --task-timeout 60m

# The API and the ingest job (both run as $SA_EMAIL) may start this one job.
gcloud run jobs add-iam-policy-binding croplytix-process \
  --region $REGION \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/run.jobsExecutorWithOverrides"
```

Then give the API and the ingest job the new environment (the env file now says
`PROCESS_RUNNER: "cloudrun"`), so a finished ingest starts processing:

```bash
gcloud run deploy croplytix-api --source . --region $REGION --env-vars-file deploy/env.cloudrun.yaml
gcloud run jobs update croplytix-ingest --region $REGION \
  --image $(gcloud run services describe croplytix-api --region $REGION \
    --format='value(spec.template.spec.containers[0].image)') \
  --env-vars-file deploy/env.cloudrun.yaml
```

*Why each piece:*

- `--service-account $SA_EMAIL` — the API's identity: it reads the COG, the grid and
  the weights, and writes results to the bucket and Firestore. Nothing else.
- `--add-volume … readonly=true` — the bucket as a folder, so the COG and the weights
  are read in place instead of copied into the job's RAM disk. Results are written
  through the storage API, which is why the mount can stay read-only.
- `--memory 8Gi --cpu 4` — the model is CPU-bound and uses every core (about 25 s for
  Roujol A on 2 vCPUs, so roughly half that on 4). The watershed holds the whole
  field, about 40 bytes a pixel: `PROCESS_MAX_MEGAPIXELS` (150 million pixels at
  2.3 cm, about 8 ha) keeps a run inside 8 GiB, and a bigger field is refused with
  a message rather than killed. Orthophotos much finer than 2.3 cm are averaged
  down to about the model's pixel size first, which is what the model was trained on.
- `--max-retries 0`, `--task-timeout 60m` — a failure is written on the flight with
  its reason; **Try again** on the flight page starts a fresh run. A run still
  "running" 65 minutes after it started is reported as failed (out of memory, most
  likely).

**Every API deploy changes the image; the process job has its own,** so it only needs
rebuilding when `app/` changes in a way processing uses, or its requirements do:

```bash
gcloud builds submit --config cloudbuild.process.yaml .
gcloud run jobs update croplytix-process --region $REGION --image $PROCESS_IMAGE
```

Check it on a flight (the id is on the flight page's URL):

```bash
gcloud run jobs execute croplytix-process --region $REGION --update-env-vars FLIGHT_ID=flt_... --wait
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="croplytix-process"' \
  --limit 30 --format='value(textPayload)'
```

Flights uploaded before this step have no result: open one and press **Process
flight**. A flight with no plot grid can't be processed; the page says so.

*What it costs:* about a minute of 4 vCPU and 8 GiB for a field like Roujol A:
240 vCPU-seconds and 480 GiB-seconds, against a monthly free tier of 240,000 and
450,000, so hundreds of flights a month before it costs anything. The image is
several hundred MB in Artifact Registry, past the free 0.5 GB on its own (about
$0.10 per GB-month beyond it), so keep the cleanup policy from the frontend
checklist. Each result adds a few MB to the bucket.

## 14. Map files in the browser — signed links to the bucket

The Reviewer draws each plot from the flight's map files: the viewing COG ingest
built (`derived/view.tif`) and the result's assignment raster (`results/v<n>/assignment.tif`,
which plot each canopy pixel went to). The browser reads a few 512 px tiles of
each with HTTP Range requests, straight from the bucket, so a plot of a 5 GB
orthophoto costs a few hundred KB and the API never carries the bytes.

The bucket stays private. The API hands the browser *signed URLs*
(`GET …/flights/{id}/map`): a link that reads one object for an hour
(`MAP_LINK_MINUTES`). Two things make that work on Cloud Run:

```bash
# 1. Signing. The API's identity on Cloud Run has no private key, so it signs
#    through the IAM Credentials API, as itself. That needs the API on, and the
#    service account allowed to sign as itself (it can't act as any other).
gcloud services enable iamcredentials.googleapis.com
gcloud iam service-accounts add-iam-policy-binding $SA_EMAIL \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/iam.serviceAccountTokenCreator"
```

```bash
# 2. CORS. Signed URLs are Cloud Storage's XML API, which answers a browser on
#    another origin only as the bucket's CORS rule allows. The rule names the
#    web app's address and the local dev server's, allows reading only, and
#    lets the browser send Range and see Content-Range (geotiff.js needs both).
#    Uploads are unaffected: they go through the JSON API, which allows CORS
#    on its own.
export WEB_URL=$(gcloud run services describe croplytix-web --region $REGION --format='value(status.url)')
printf '[{"origin": ["%s", "http://localhost:3000"], "method": ["GET", "HEAD"], "responseHeader": ["Content-Type", "Content-Range", "Content-Length", "Accept-Ranges", "Range", "ETag"], "maxAgeSeconds": 3600}]\n' "$WEB_URL" > /tmp/croplytix-cors.json
gcloud storage buckets update gs://$BUCKET --cors-file=/tmp/croplytix-cors.json
gcloud storage buckets describe gs://$BUCKET --format="default(cors_config)"
```

If you open the app at any other address (a custom domain, or Cloud Run's other
`…run.app` URL for the same service), add it to `origin` and run the update again.

Then deploy the code that uses it: the API (the endpoint), the processing job
(results now record each plot's box and its value in the assignment raster), and
the web app (the Reviewer):

```bash
gcloud run deploy croplytix-api --source . --region $REGION --env-vars-file deploy/env.cloudrun.yaml
gcloud builds submit --config cloudbuild.process.yaml .
gcloud run jobs update croplytix-process --region $REGION --image $PROCESS_IMAGE
cd ../frontend && gcloud run deploy croplytix-web --source . --region $REGION && cd ../backend
```

Results made before this have no plot boxes; the Reviewer says so. **Run again**
on the flight's page makes a new version with them, reusing the canopy map, so
only the watershed reruns.

*Check it:* open a flagged plot in the Reviewer; the photo should appear with the
plot's canopy in magenta. If the page says the API couldn't sign links, step 1
hasn't taken effect yet (IAM changes can take a minute or two). If the browser's
console shows a CORS error on `storage.googleapis.com`, the origin in step 2
doesn't match the address in the address bar.

*What it costs:* signing is free; each plot reads a few hundred KB from the
bucket, a small fraction of the free tier's monthly egress even for heavy reviewing.

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
Registry. The one thing that *will* cost money if you leave it on is
`--min-instances 1` (keeps a container warm, ~$8–10/month at 512Mi). Everything
here scales to zero.
