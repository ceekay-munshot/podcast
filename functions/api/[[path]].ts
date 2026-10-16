import { gateway, type GatewayEnv } from '../../server/github/gateway'

// Stateless transport only. No KV, model credentials, feeds, PDF generation,
// email service, background timers or runtime data live on Cloudflare.
export const onRequest = ({ request, env }: { request: Request; env: GatewayEnv }) => gateway(request, env)
