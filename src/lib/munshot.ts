import { canonicalUserKey } from './identityKey'

// ─────────────────────────────────────────────────────────────────────────────
// Munshot host identity — the ONLY module that touches the Dashboard SDK.
//
// When this app runs inside the chat.muns.io dashboard iframe, the host injects
// the logged-in user's context via the Munshot Dashboard SDK (postMessage
// envelope protocol: the SDK announces `dashboard:ready`, the host answers
// `host:init` with { context: { userId, email, name, … } }, and may later send
// `host:context:update`). This module resolves that to an Identity — or null
// (anonymous) — and notifies on every change, so the app personalizes per user
// without a page refresh.
//
// The handshake is HOST-initiated (verified against the SDK source): the host
// picks a channelId and sends `host:init`; the SDK client captures it, stores
// the context, and — with autoReady — REPLIES `dashboard:ready` as the ack.
// Because the host may have fired its init before this client existed (iframe
// load races the app bundle), the client also announces `ready()` proactively
// (channelId "pending-channel"), retrying briefly — a host re-sends host:init
// whenever it sees that announcement.
//
// Resolution state machine:
//   detecting    — synchronous: not in an iframe → anonymous immediately (the
//                  SDK script is never even fetched on standalone visits).
//   loading-sdk  — inject the SDK <script>; onerror / 4s timeout / missing
//                  global / client construction throwing → anonymous.
//   awaiting-init— client created; ready() announced (retried every 500ms);
//                  the first explicit host context settles it; 3s of host
//                  silence → anonymous (the client stays alive, so a LATE
//                  host:init is handled as an identity change rather than lost).
//   settled      — later host:init / host:context:update messages transition
//                  the identity (switch / sign-out) and fire onIdentityChange;
//                  same-user updates are no-ops.
//
// Safety (per the Munshot dashboard standards): explicit allowedOrigins (never
// '*'), origin locked on first message, every incoming payload type-checked and
// length-capped, and no handler can throw on hostile input. Identity failure of
// any kind degrades to anonymous — the app stays fully functional.
// ─────────────────────────────────────────────────────────────────────────────

export interface Identity {
  /** The raw host-provided id (userId, falling back to email). For display/debug. */
  userId: string
  /** canonicalUserKey(userId) — what scopes storage, headers, and KV. Never null here. */
  key: string
  email?: string
  name?: string
}

const SDK_URL = 'https://munshot.s3.ap-south-1.amazonaws.com/SDK+script/munshot-dashboard-sdk.v1.0.0.min.js'
const SDK_SCRIPT_TIMEOUT_MS = 4000 // S3 cold-fetch can be slow from far regions; beyond this it's effectively down
const HOST_INIT_TIMEOUT_MS = 3000 // host:init is a same-machine postMessage round trip — 3s is ~30x margin
const READY_ANNOUNCE_INTERVAL_MS = 500 // re-announce ready() while waiting, in case the host's init raced us
const DASHBOARD_ID = 'munshot-podcasts'

// Minimal surface of the SDK client this module relies on. Tolerant on purpose:
// every member is optional and the code degrades to anonymous if absent.
interface MunshotClient {
  getContext?: () => unknown
  onMessage?: (cb: (envelope: unknown, metadata?: unknown) => void) => unknown
  ready?: () => boolean
}

interface MunshotSdk {
  // The published v1.0.0 bundle exports the factory as createDashboardClientSdk
  // (a trailing `var` assignment clobbers the inner `createClient` global);
  // accept every shape so a fixed future build keeps working.
  createDashboardClientSdk?: (options: Record<string, unknown>) => MunshotClient
  createClient?: (options: Record<string, unknown>) => MunshotClient
  DashboardClientSdk?: new (options: Record<string, unknown>) => MunshotClient
}

declare global {
  interface Window {
    MunshotDashboardSDK?: MunshotSdk
  }
}

let current: Identity | null = null
let settled = false
let inFlight: Promise<Identity | null> | null = null
const listeners = new Set<(identity: Identity | null) => void>()

/** Sync snapshot of the latest known identity (null until resolved, or anonymous). */
export function getIdentity(): Identity | null {
  return current
}

/** Fires on every identity TRANSITION after first resolution: user switch,
 *  sign-out (→ null), or a late host:init after the anonymous timeout.
 *  Same-user updates do not fire. Returns an unsubscribe function. */
export function onIdentityChange(cb: (identity: Identity | null) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Resolve the embedded identity once (memoized single-flight — every caller
 *  shares one promise). Resolves null when standalone, the SDK fails to load,
 *  the host stays silent past the timeout, or the context is unusable. */
export function resolveIdentity(): Promise<Identity | null> {
  if (inFlight) return inFlight
  inFlight = new Promise((resolve) => {
    if (!isEmbedded()) {
      settle(null, resolve)
      return
    }
    void loadSdk().then((sdk) => {
      if (settled) return // raced an earlier settle (shouldn't happen, but harmless)
      if (!sdk) {
        settle(null, resolve)
        return
      }
      const factory =
        sdk.createDashboardClientSdk ??
        sdk.createClient ??
        (sdk.DashboardClientSdk ? (o: Record<string, unknown>) => new sdk.DashboardClientSdk!(o) : null)
      if (!factory) {
        settle(null, resolve)
        return
      }
      let client: MunshotClient
      try {
        client = factory({
          dashboardId: DASHBOARD_ID,
          dashboardName: 'Munshot Podcasts',
          autoReady: true, // ack every host:init with dashboard:ready
          targetWindow: window.parent,
          lockOriginOnFirstMessage: true,
          // Explicit allowlist — never '*': only the Munshot host (and, in dev,
          // the same-origin embed harness) may inject an identity. The SDK
          // expects an ARRAY here (it checks .length, then builds its own Set).
          allowedOrigins: ['https://chat.muns.io', ...(import.meta.env.DEV ? [window.location.origin] : [])],
        })
      } catch {
        settle(null, resolve)
        return
      }

      // Announce ourselves until the host's init lands: if the host fired
      // host:init before this client existed (iframe load races the bundle),
      // seeing our dashboard:ready tells it to send host:init again.
      const announce = () => {
        try {
          client.ready?.()
        } catch {
          /* announce is best-effort */
        }
      }
      const announcer = setInterval(announce, READY_ANNOUNCE_INTERVAL_MS)
      const stopWaiting = () => {
        clearTimeout(timer)
        clearInterval(announcer)
      }
      const timer = setTimeout(() => {
        stopWaiting()
        settle(null, resolve)
      }, HOST_INIT_TIMEOUT_MS)
      announce()
      const accept = (ctx: unknown, explicit: boolean) => acceptContext(ctx, explicit, resolve, stopWaiting)

      // Primary path: explicit host messages carrying context.
      try {
        client.onMessage?.((envelope) => {
          try {
            const kind = (envelope as { kind?: unknown } | null)?.kind
            if (kind !== 'host:init' && kind !== 'host:context:update') return
            accept((envelope as { payload?: { context?: unknown } }).payload?.context, true)
          } catch {
            /* hostile/odd payload — never throw out of a message handler */
          }
        })
      } catch {
        /* SDK variant without onMessage — getContext below still covers init */
      }

      // Belt-and-braces: some SDK builds buffer the context behind getContext().
      // Non-explicit — an empty result here just means the host hasn't sent
      // host:init yet, so it must NOT settle us anonymous.
      try {
        const maybe = client.getContext?.()
        if (maybe && typeof (maybe as { then?: unknown }).then === 'function') {
          void (maybe as Promise<unknown>).then(
            (ctx) => accept(ctx, false),
            () => {},
          )
        } else if (maybe) {
          accept(maybe, false)
        }
      } catch {
        /* getContext threw — onMessage covers it */
      }
    })
  })
  return inFlight
}

// ── internals ────────────────────────────────────────────────────────────────

function isEmbedded(): boolean {
  try {
    return window.self !== window.top
  } catch {
    return true // cross-origin access to window.top throws → we ARE embedded
  }
}

let sdkLoad: Promise<Window['MunshotDashboardSDK'] | null> | null = null

function loadSdk(): Promise<Window['MunshotDashboardSDK'] | null> {
  if (sdkLoad) return sdkLoad
  sdkLoad = new Promise((resolve) => {
    if (window.MunshotDashboardSDK) {
      resolve(window.MunshotDashboardSDK)
      return
    }
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(ok ? (window.MunshotDashboardSDK ?? null) : null)
    }
    const timer = setTimeout(() => finish(false), SDK_SCRIPT_TIMEOUT_MS)
    const script = document.createElement('script')
    script.src = SDK_URL
    script.async = true
    script.onload = () => finish(true)
    script.onerror = () => finish(false)
    document.head.appendChild(script)
  })
  return sdkLoad
}

/** Validate an untrusted host context into an Identity (or null). Type-checks,
 *  trims, caps lengths; an identity whose canonical key is null is unusable. */
function parseIdentity(ctx: unknown): Identity | null {
  if (!ctx || typeof ctx !== 'object') return null
  const x = ctx as Record<string, unknown>
  const s = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : undefined)
  const userId = s(x.userId) ?? s(x.email) // email is the fallback identity
  if (!userId) return null
  const key = canonicalUserKey(userId)
  if (!key) return null
  return { userId, key, email: s(x.email), name: s(x.name) }
}

function acceptContext(
  ctx: unknown,
  explicit: boolean, // true = a host:init / host:context:update message; false = a getContext() probe
  resolve: (id: Identity | null) => void,
  stopWaiting: () => void,
): void {
  const id = parseIdentity(ctx)
  if (!id && !explicit) return // empty probe before host:init — keep waiting
  if (!settled) {
    stopWaiting()
    settle(id, resolve)
    return
  }
  // Post-settlement: transition only when the user actually changed.
  if ((id?.key ?? null) === (current?.key ?? null)) return
  current = id
  for (const cb of listeners) {
    try {
      cb(id)
    } catch {
      /* one listener's bug must not break the rest */
    }
  }
}

function settle(id: Identity | null, resolve: (id: Identity | null) => void): void {
  if (settled) return
  settled = true
  current = id
  resolve(id)
}
