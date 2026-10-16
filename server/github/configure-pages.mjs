// Called only by the explicitly enabled GitHub deployment workflow.
// Credentials stay in process memory and are sent only to Cloudflare's API.
const required = name => { if (!process.env[name]) throw Error(`Missing ${name}`); return process.env[name] }
const account = '489675fbe898cd94904c654de83ade00'
const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/pages/projects/podcast`, {
  method: 'PATCH',
  headers: { authorization: `Bearer ${required('CLOUDFLARE_API_TOKEN')}`, 'content-type': 'application/json' },
  body: JSON.stringify({ deployment_configs: { production: {
    env_vars: {
      PODCAST_GITHUB_TOKEN: { type: 'secret_text', value: required('PODCAST_GITHUB_TOKEN') },
      PODCAST_GATEWAY_KEY: { type: 'secret_text', value: required('PODCAST_GATEWAY_KEY') },
      GITHUB_BACKGROUND_ENABLED: { type: 'plain_text', value: process.env.GITHUB_BACKGROUND_ENABLED === '1' ? '1' : '0' },
      SITE_URL: { type: 'plain_text', value: process.env.SITE_URL || 'https://podcast-afg.pages.dev' },
    },
    kv_namespaces: { SUMMARIES: null },
  } } }),
})
const result = await response.json()
if (!response.ok || !result.success) throw Error(`Cloudflare gateway configuration failed (${response.status})`)
console.log('Configured the production stateless gateway without a storage binding.')
