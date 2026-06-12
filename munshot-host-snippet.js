/**
 * Munshot Dashboard SDK — HOST side. → ADD THIS TO chat.muns.io (NOT this repo).
 *
 * chat.muns.io/dashboards currently embeds dashboards without ever sending
 * `host:init`, so every dashboard runs identity-less ("Not signed in" in the
 * podcast dashboard's sidebar badge). This snippet is the missing host half of
 * the Munshot Dashboard SDK handshake. Include it once on the dashboards page
 * (any time after the iframes exist; it sweeps existing frames on install):
 *
 *   1. On install, it sends `host:init` with the signed-in user's context to
 *      every dashboard iframe already in the DOM (harmless to dashboards that
 *      don't speak the SDK — they ignore unknown messages).
 *   2. It replies `host:init` to every `dashboard:ready` announcement
 *      (channelId "pending-channel") — this covers dashboards whose JS boots
 *      after the sweep, e.g. slow bundles. The SDK client acks the init with
 *      a `dashboard:ready` carrying the real channelId; that ack is NOT
 *      re-answered, so there is no loop.
 *   3. Call `window.munshotHostBroadcastContext()` after login/logout/user
 *      switch to push `host:context:update` to every connected dashboard
 *      without reloading iframes.
 *
 * Identity source: the `userData` localStorage entry chat.muns.io already
 * writes ({ email, name, picture, given_name, family_name, orgId, orgName,
 * authProvider } — note there is no userId field, so email IS the identity;
 * SDK dashboards are built to fall back to email).
 *
 * Verified live on 2026-06-12 by posting exactly these messages from the
 * chat.muns.io console: the podcast dashboard signed in, switched to the
 * user's personal space, and acked the channel.
 */
;(function munshotDashboardHost() {
  if (window.__munshotDashboardHost) return // idempotent install
  window.__munshotDashboardHost = true

  var NAMESPACE = 'munshot-dashboard-sdk'
  var channelByFrame = new WeakMap()

  function sessionContext() {
    try {
      var u = JSON.parse(localStorage.getItem('userData') || '{}')
      return {
        userId: u.userId || u.email, // no userId in the session → email is the identity
        email: u.email,
        name: u.name,
        orgId: u.orgId,
      }
    } catch (e) {
      return {}
    }
  }

  function envelope(channelId, kind, context) {
    return {
      namespace: NAMESPACE,
      version: '1.0.0',
      channelId: channelId,
      source: 'host',
      kind: kind,
      timestamp: Date.now(),
      payload: { context: context },
    }
  }

  function channelFor(frame) {
    var id = channelByFrame.get(frame)
    if (!id) {
      id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'host-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10)
      channelByFrame.set(frame, id)
    }
    return id
  }

  function initFrame(frame) {
    if (!frame.contentWindow || !frame.src || frame.src.indexOf('http') !== 0) return
    try {
      frame.contentWindow.postMessage(envelope(channelFor(frame), 'host:init', sessionContext()), new URL(frame.src).origin)
    } catch (e) {
      /* detached frame — ignore */
    }
  }

  // Late-booting dashboards announce themselves — answer with their init.
  window.addEventListener('message', function (e) {
    var m = e.data
    if (!m || m.namespace !== NAMESPACE || m.source !== 'dashboard') return
    if (m.kind !== 'dashboard:ready' || m.channelId !== 'pending-channel') return
    var frames = document.querySelectorAll('iframe')
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === e.source) {
        initFrame(frames[i])
        return
      }
    }
  })

  // Dashboards already up when this script installs.
  var existing = document.querySelectorAll('iframe')
  for (var i = 0; i < existing.length; i++) initFrame(existing[i])

  /** Push the (possibly changed) session to every dashboard — call on login,
   *  logout, or user switch. Connected clients apply it without a reload. */
  window.munshotHostBroadcastContext = function () {
    var ctx = sessionContext()
    var frames = document.querySelectorAll('iframe')
    for (var i = 0; i < frames.length; i++) {
      var id = channelByFrame.get(frames[i])
      if (!id || !frames[i].contentWindow) continue
      try {
        frames[i].contentWindow.postMessage(envelope(id, 'host:context:update', ctx), new URL(frames[i].src).origin)
      } catch (e) {
        /* ignore */
      }
    }
  }
})()
