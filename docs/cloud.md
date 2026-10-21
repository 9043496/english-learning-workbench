# Optional cloud deployment

The dependency-free local starter is the quickest path. This page is a separate deployment workflow for an operator's own Cloudflare Pages and Supabase project. The repository contains no hosted account, personal learning data or working cloud credentials.

## Architecture

Browser → same-origin Pages Worker → Supabase Auth/PostgreSQL/private Storage. Access and refresh tokens use HttpOnly Secure SameSite cookies. Learner rows are owner-scoped; coaches need an explicit trusted mapping. The frontend receives only the public Supabase key through the Worker environment, never an administrator/service-role secret.

## Provision an empty project

1. Sign into your own Cloudflare and Supabase accounts. Confirm plan and limits directly before creating resources; free tiers and third-party TTS availability may change. This project does not automatically upgrade a plan or promise free audio generation.
2. In a new, empty Supabase project, execute `cloud/sql/001_workbench.sql` followed by `002_coach.sql` using the trusted SQL editor or CLI. They are initial schema files, not rerunnable upgrades for a populated database. They create owner/coach guards and the private `workbench-audio` bucket.
3. Disable open signup in your project's Auth settings. Create your learner and separate coach through trusted Auth administration. Set trusted `app_metadata.workbench_role` to `learner` or `coach`, `engineering_fixture` to false, and the learner's `workbench_ready` to true after verifying initialization. Do not use editable user_metadata for permissions.
4. Through trusted SQL, insert one row into `public.wb_coaches(coach_id,learner_id)` using the actual two Auth UUIDs. Inspect the table declaration in 001 before executing; do not paste example identities into a live database.
5. Use your own authenticated coach for materials; learners must not receive coach/admin credentials. For isolated integration tests, use separate explicitly marked engineering accounts in a separate project, never real learner answers.

## Build and deploy

Requires Node 22+ and npm. From `cloud/` run `npm ci`, `npm test`, and `node tools/build.mjs --output ../dist/pages`.

Authorize the bundled Wrangler CLI through its official login flow, then deploy the generated directory to your own Pages project using `npx wrangler pages deploy ../dist/pages --project-name <your-project> --no-bundle`.

Configure **SUPABASE_URL** and **SUPABASE_PUBLISHABLE_KEY** as Pages production/preview bindings. The Worker deliberately refuses `SUPABASE_SERVICE_ROLE_KEY`. Re-deploy after configuration changes. Request `/health` to confirm configuration, then `/login` with your learner account. Do not treat health as a proof of all data/microphone paths.

## Connect an authorized teaching agent

Copy the installer's private config, set mode to cloud, base_url to your HTTPS root, learner_id to the actual learner UUID, and coach_credentials_file to a private 0600 JSON file containing your authorized coach email/password (or a valid coach access_token). Keep it outside the Git checkout. Export WORKBENCH_CONFIG as the private config path, then use the publishing Skill's snapshot/release commands.

The agent uses restricted Pages endpoints, not direct database writes. If the coach mapping is missing, stop on 403; do not disable RLS. Local mode instead reads the token generated in its own private data directory.

## iPhone and operational limits

Open your HTTPS Pages URL in Safari and sign in. You can add it to the home screen. Test real playback, word meanings, sentence translation, microphone access, 3-second shadowing reference delay, early-stop discard, multiple recordings, manual upload/download and conflict handling. There is no complete offline cold-start service worker.

Local loopback HTTP can record on the desktop but is not a secure remote phone endpoint. Use your deployed HTTPS site or an explicitly approved trusted HTTPS tunnel; do not expose the shared local-token server publicly. Optional Mac/Tailscale source is provided for advanced setup; it is not automatically installed or started.

The current app reserves 25 MB per cloud audio file and 800 MB per learner index. Actual project storage/bandwidth/Auth limits are shared across users and include orphaned objects. Monitor your provider's current quotas. More learners also require invitation/account, content assignment, coach and budget operations; the product is not a public self-signup service.
