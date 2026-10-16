# Podcast background work on GitHub

Cloudflare serves Vite's static assets and a stateless `/api/*` gateway. Feed
collection, audio transcription, summarization, PDF generation, email sending and
all persistent data run in standard Ubuntu GitHub Actions runners. Existing
model, transcription and email providers are unchanged; their own charges remain.

The public repository stores only authenticated AES-256-GCM ciphertext on
`codex/podcast-state`. It includes every imported key, raw value, expiration,
metadata and SHA-256 byte hash. Imported expired records remain archived; PDFs
already linked in emails remain available. Subscriber addresses, private feeds,
transcripts, requests and delivery receipts never enter public plaintext files,
workflow inputs or logs. Keep recovery copies of both encryption keys securely.

## Credentials and enablement

GitHub Actions secrets:

- `PODCAST_STATE_KEY`: random 32-byte base64 key, GitHub only.
- `PODCAST_GATEWAY_KEY`: a separate random 32-byte base64 key for encrypted
  queued requests/prepared results; also available to the stateless gateway.
- `PODCAST_GITHUB_TOKEN`: fine-grained token limited to this repository,
  Contents read/write and Actions read/write. The gateway queues durable refs and
  wakes the workflow; this credential never enters the browser bundle.
- `MUNSHOT_EMAIL_TOKEN`, `OPENAI_API_KEY`, `SUMMARY_MODEL`: copy existing values.
- `GROQ_API_KEY`, `DEEPGRAM_API_KEY`: retain existing audio transcription.
- Optional existing configuration: `ANTHROPIC_API_KEY`, `temp_claude_token`,
  `MEMBER_FEEDS`, `SITE_URL`; variables `LLM_PROVIDER`, `BEDROCK_MODEL_ID`,
  `BEDROCK_REGION`, `DEEPGRAM_MODEL`, `EMAIL_ATTACHMENTS` retain their old values.
- `CLOUDFLARE_API_TOKEN`: token restricted to this account's Pages deployment.

Repository variables `PODCAST_DEPLOY_ENABLED` and `PODCAST_BACKGROUND_ENABLED`
default to disabled. Enable only as part of the verified cutover. The deployment
workflow builds in GitHub, configures the production gateway, and uploads static
assets/functions to the existing Pages project. Disconnect *all* Cloudflare Git
build triggers before creating data/queue branches, otherwise they would trigger
unnecessary Cloudflare builds.

## Cutover (requires specific production authorization)

1. Confirm PR CI and review, credentials and rollback evidence. Pause the old
   digest workflow and wait for any active legacy run to finish; never run both
   senders. Disable Pages Git builds for production and previews.
2. Deploy the new gateway with background enablement off. Static pages remain
   available; API operations report maintenance until import is verified. This
   briefly fences legacy writes so a final source snapshot can be consistent.
3. Export **all** Cloudflare KV keys and exact binary values, retain metadata and
   TTLs, hash each value, and repeat the inventory after the write fence. Save an
   encrypted local backup and the project/deployment configuration. Preserve the
   subscriber list, selected schedule, last-sent marker and any partially delivered
   edition's exact parts, attachments, next index and root Message-ID.
4. Stage a compressed AES-encrypted `snapshot.enc` on
   `codex/podcast-migration-snapshot`, then use the **Podcast migration verification**
   workflow's `import` operation. Import refuses to overwrite existing state.
   That workflow has no mail/model credentials. Run its `verify` operation read-only
   and compare all imported hashes/counts; `prepare` refreshes read views/feeds.
   Local recovery may instead run `node .cache/runner.mjs import` with
   `PODCAST_IMPORT_FILE` pointing to the private, locally decrypted archive.
5. Enable the GitHub background variable and workflow; deploy that gateway
   configuration. Let the ordinary schedule continue. Verify the live response
   runtime, existing PDF bytes, selected schedule and subscriber count. Do not
   force-send a validation email. Inspect the next scheduled run for receipts.
6. Keep the original namespace as a frozen rollback copy until separately approved
   for retirement. It is unbound from the application and receives no new writes.
   Do not roll back to the legacy sender after GitHub has sent mail: its older
   markers would be unsafe. Reconcile GitHub delivery receipts first.

## Complete threaded delivery

Every part has the same edition subject. Part 2 onward uses Part 1's confirmed
transport Message-ID as `inReplyTo` and `references`. There is no eight-part cutoff;
oversized blocks continue across balanced HTML parts below the clipping budget.
Every part retains the full PDF link and, when already enabled, attachment.

Before the first send, the exact edition/recipients and the schedule slot are
committed atomically. Before each provider request, a durable delivery claim is
acknowledged by GitHub. Accepted receipts and root IDs survive runner restarts;
replaying a saved edition returns those receipts without repeating provider I/O.
Explicit temporary refusals are retried. Unsent parts are retained indefinitely,
including on-demand queued emails; a later edition never overwrites them.

A provider timeout can mean either accepted or not accepted. Without documented
provider idempotency, automatically retrying that outcome cannot guarantee both
delivery and no duplicates. Such parts remain saved and the workflow fails visibly
for reconciliation against the mail service; they are never silently dropped or
blindly resent. A missing accepted Message-ID also blocks later parts until the
original root can be recovered. No real email is sent by migration verification.

All jobs share one writer concurrency group. Browser requests are durably queued
before dispatch, so GitHub replacing a pending workflow cannot lose requests.
Interactive processing may take a few minutes while a runner starts; the browser
polls the saved job without submitting it again. Background model batches remain
capped at ten episodes per 30-minute bucket, including browser wakeups.
