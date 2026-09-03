import { VERSION } from '../../src/domain.js';
import {
  MCP_LEGACY_VERSION,
  agentCard,
  openApi,
  mcpTools,
  mcpServerJson,
  robotsTxt,
  sitemapXml,
  llmsTxt,
  llmsFullTxt,
  securityTxt,
  webManifest
} from '../../src/discovery.js';
import { D1Repository } from './repository.js';
import { PLATFORM_FEE_BPS, paymentQuote } from '../../src/payments.js';
import { stripeCreateConnectedAccount, stripeCreateAccountLink, stripeCreatePaymentIntent, stripeCreateTransfer, stripeCreateTransferReversal, stripeCreateRefund, verifyStripeWebhook } from './stripe.js';
import { lookupAustralianBusiness } from './abr.js';

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'cross-origin-opener-policy': 'same-origin',
  'strict-transport-security': 'max-age=31536000; includeSubDomains'
};
const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  ...SECURITY_HEADERS
};
const ALLOW_HEADERS = 'content-type,idempotency-key,x-taskbay-source,x-relaymarket-source,authorization,mcp-protocol-version,mcp-method,mcp-name,accept';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = publicOrigin(env, url);
    const source = requestSource(request, url);

    if (request.method === 'OPTIONS') {
      return preflight(request, env, origin);
    }

    if (url.pathname === '/health') {
      return json({ status: 'ok', service: 'taskbay', runtime: 'cloudflare-worker', storage: env.DB ? 'd1' : 'unbound', version: VERSION });
    }

    // Search and machine-discovery endpoints intentionally remain available
    // even if D1 is temporarily unavailable.
    if (request.method === 'GET' && (url.pathname === '/.well-known/agent.json' || url.pathname === '/.well-known/agent-card.json')) {
      await safeMetric(env.DB, 'discovery.agent_card', source);
      return json(agentCard(origin), 200, { 'cache-control': 'public, max-age=300' });
    }
    if (request.method === 'GET' && url.pathname === '/openapi.json') {
      await safeMetric(env.DB, 'discovery.openapi', source);
      return json(openApi(origin), 200, { 'cache-control': 'public, max-age=300' });
    }
    if (request.method === 'GET' && url.pathname === '/server.json') return json(mcpServerJson(origin), 200, { 'cache-control': 'public, max-age=300' });
    if (request.method === 'GET' && url.pathname === '/robots.txt') return text(robotsTxt(origin), 'text/plain; charset=utf-8', { 'cache-control': 'public, max-age=3600' });
    if (request.method === 'GET' && url.pathname === '/sitemap.xml') return text(sitemapXml(origin), 'application/xml; charset=utf-8', { 'cache-control': 'public, max-age=3600' });
    if (request.method === 'GET' && url.pathname === '/llms.txt') return text(llmsTxt(origin), 'text/plain; charset=utf-8', { 'cache-control': 'public, max-age=300' });
    if (request.method === 'GET' && url.pathname === '/llms-full.txt') return text(llmsFullTxt(origin), 'text/plain; charset=utf-8', { 'cache-control': 'public, max-age=300' });
    if (request.method === 'GET' && url.pathname === '/.well-known/security.txt') return text(securityTxt(origin), 'text/plain; charset=utf-8', { 'cache-control': 'public, max-age=3600' });
    if (request.method === 'GET' && url.pathname === '/manifest.webmanifest') return json(webManifest(origin), 200, { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'public, max-age=3600' });

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html') && env.ASSETS) {
      return servePortal(request, env, origin);
    }

    if (!env.DB) {
      if (url.pathname.startsWith('/api/') || url.pathname === '/mcp' || url.pathname === '/a2a') return json({ error: 'd1_not_bound' }, 503);
      return env.ASSETS ? env.ASSETS.fetch(request) : json({ error: 'not_found' }, 404);
    }

    const repo = new D1Repository(env.DB);
    try {
      if (request.method === 'POST' && url.pathname === '/webhooks/stripe') return await handleStripeWebhook(request, env, repo);
      const limited = await enforceMutationRateLimit(request, env, url.pathname);
      if (limited) return limited;
      if (url.pathname === '/mcp' && request.method === 'GET') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' });
      if (request.method === 'POST' && url.pathname === '/mcp') {
        validateMcpOrigin(request, origin);
        await repo.recordMetric('protocol.mcp_call', { source, audit: false });
        return handleMcp(request, repo, source, env);
      }
      if (request.method === 'POST' && url.pathname === '/a2a') {
        await repo.recordMetric('protocol.a2a_call', { source, audit: false });
        return handleA2A(request, repo, source, env);
      }

      if (url.pathname === '/api/v1/stats' && request.method === 'GET') return json(await repo.stats());
    if (url.pathname === '/api/v1/kpis' && request.method === 'GET') return json(await repo.launchKpis());
    if (url.pathname === '/api/v1/metrics' && request.method === 'GET') return json(await repo.metrics());
      if (request.method === 'GET' && url.pathname === '/api/v1/events') return json({ events: publicEvents(await repo.recentEvents(url.searchParams.get('limit'))) });
      if (request.method === 'GET' && url.pathname === '/api/v1/payments/config') { const provider=env.PAYMENT_PROVIDER||'disabled',policy=env.PAYMENT_PROCESSOR_COST_POLICY||'unset'; return json({ provider, live: stripeRuntimeReady(env), platformFeeBps: PLATFORM_FEE_BPS, platformFeePercent: PLATFORM_FEE_BPS / 100, feeRounding: 'floor_minor_unit', processorFeesIncluded: false, releaseModel: 'after_task_completion', processorCostPolicy: policy, readiness: provider==='stripe' ? { secretConfigured:Boolean(env.STRIPE_SECRET_KEY), webhookConfigured:Boolean(env.STRIPE_WEBHOOK_SECRET), processorPolicyConfigured:processorPolicyValid(policy) } : null }); }
      if (request.method === 'GET' && url.pathname === '/api/v1/payments/quote') {
        try { return json({ quote: paymentQuote(Number(url.searchParams.get('amountMinor')), url.searchParams.get('currency') || 'USD') }); }
        catch (e) { return json({ error: e.code || 'invalid_payment_quote', message: e.message }, e.status || 400); }
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/payments/stats') return json(await repo.paymentStats());


      if (request.method === 'GET' && url.pathname === '/api/v1/agents') {
        await repo.recordMetric('agent.discovery', { source, audit: false });
        return json({ agents: await repo.listAgents({ capability: url.searchParams.get('capability'), protocol: url.searchParams.get('protocol'), available: url.searchParams.get('available') }) });
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/agents') {
        return await mutate(request, url, repo, async body => {
          const registered = await repo.registerAgent(body, { source });
          let verification = registered.agent?.endpoints?.length
            ? { status: 'manual_challenge_required', challenge: null, challengeEndpoint: `/api/v1/agents/${encodeURIComponent(registered.agent.id)}/verification-challenges` }
            : { status: 'endpoint_required', challenge: null };
          if (registered.agent?.endpoints?.length) {
            try {
              const challenge = await repo.createVerificationChallenge(registered.agent.id, 0, { source });
              verification = { status: 'challenge_created', challenge, nextAction: 'publish_token_then_verify' };
            } catch (error) {
              verification = {
                status: 'manual_challenge_required',
                challenge: null,
                error: error?.code || 'verification_challenge_creation_failed',
                challengeEndpoint: `/api/v1/agents/${encodeURIComponent(registered.agent.id)}/verification-challenges`
              };
            }
          }
          return {
            status: 201,
            payload: {
              agent: registered.agent,
              credential: {
                apiKey: registered.credential.apiKey,
                credentialId: registered.credential.credentialId,
                warning: 'Store this API key securely; it is returned only through this registration response.'
              },
              verification
            }
          };
        });
      }

      let m = url.pathname.match(/^\/api\/v1\/agents\/([^/]+)$/);
      if (m) {
        const agentId = decodeURIComponent(m[1]);
        if (request.method === 'GET') {
          await repo.recordMetric('agent.viewed', { source, audit: false });
          const agent = await repo.getAgent(agentId);
          return agent ? json({ agent }) : json({ error: 'agent_not_found' }, 404);
        }
        if (request.method === 'PATCH') {
          return await mutate(request, url, repo, async body => {
            await requireAgent(request, repo, agentId);
            return { status: 200, payload: { agent: await repo.updateAgent(agentId, body, { source }) } };
          });
        }
      }

      m = url.pathname.match(/^\/api\/v1\/agents\/([^/]+)\/credentials(?:\/([^/]+)\/(rotate|revoke))?$/);
      if (m) {
        const agentId = decodeURIComponent(m[1]);
        const credentialId = m[2] ? decodeURIComponent(m[2]) : null;
        const action = m[3] || null;
        await requireAgent(request, repo, agentId);
        if (request.method === 'GET' && !credentialId) return json({ credentials: await repo.listCredentials(agentId) });
        if (request.method === 'POST' && credentialId && action === 'rotate') {
          return await mutate(request, url, repo, async () => {
            const c = await repo.rotateCredential(agentId, credentialId, { source });
            return { status: 201, payload: { credential: { apiKey: c.apiKey, credentialId: c.credentialId, warning: 'Store this API key securely; the previous credential is now revoked.' } } };
          });
        }
        if (request.method === 'POST' && credentialId && action === 'revoke') {
          return await mutate(request, url, repo, async () => ({ status: 200, payload: { credential: await repo.revokeCredential(agentId, credentialId, { source }) } }));
        }
        return json({ error: 'method_not_allowed' }, 405);
      }

      if(request.method==='GET'&&url.pathname==='/api/v1/trust/summary') return json({trust:await repo.trustSummary()});

      m = url.pathname.match(/^\/api\/v1\/agents\/([^/]+)\/trust(?:\/(operator|business-verification))?$/);
      if (m) {
        const agentId=decodeURIComponent(m[1]),action=m[2]||null;
        if(request.method==='GET'&&!action) return json({trust:await repo.getAgentTrust(agentId)});
        if(request.method==='POST'&&action==='operator'){
          await requireAgent(request,repo,agentId);
          return await mutate(request,url,repo,async body=>({status:201,payload:{trust:await repo.createOperatorForAgent(agentId,body,{source})}}));
        }
        if(request.method==='POST'&&action==='business-verification'){
          await requireAgent(request,repo,agentId);
          return await mutate(request,url,repo,async body=>{
            const lookup=await lookupAustralianBusiness({type:body.businessIdentifierType,identifier:body.businessIdentifier,guid:env.ABR_GUID});
            return{status:200,payload:{trust:await repo.applyAustralianBusinessVerification(agentId,lookup,{source}),registry:{provider:lookup.provider,status:lookup.status,active:lookup.active,registryName:lookup.registryName,identifierType:lookup.identifierType}}};
          });
        }
        return json({error:'method_not_allowed'},405);
      }

      m=url.pathname.match(/^\/api\/v1\/internal\/operators\/([^/]+)\/risk-review$/);
      if(m&&request.method==='POST'){
        await requireTrustAdmin(request,env);const operatorId=decodeURIComponent(m[1]);
        return await mutate(request,url,repo,async body=>({status:200,payload:{operator:await repo.setOperatorRiskState(operatorId,String(body.level||''),body.score,body.reason,{source,actorId:'trust-admin'})}}));
      }

      m=url.pathname.match(/^\/api\/v1\/internal\/operators\/([^/]+)\/sanctions-review$/);
      if(m&&request.method==='POST'){
        await requireTrustAdmin(request,env);const operatorId=decodeURIComponent(m[1]);
        return await mutate(request,url,repo,async body=>({status:200,payload:{operator:await repo.setOperatorSanctionsStatus(operatorId,String(body.status||''),{source,actorId:'trust-admin'})}}));
      }

      m=url.pathname.match(/^\/api\/v1\/internal\/protection-cases\/([^/]+)\/resolve$/);
      if(m&&request.method==='POST'){
        await requireTrustAdmin(request,env);const caseId=decodeURIComponent(m[1]);
        return await mutate(request,url,repo,async body=>{
          const protection=await repo.getProtectionCase(caseId);if(!protection)throw problem('protection_case_not_found',404);const decision=String(body.decision||'');
          const payment=protection.paymentId?await repo.getPayment(protection.paymentId):null;
          if(payment&&env.PAYMENT_PROVIDER==='stripe'){
            if(!env.STRIPE_SECRET_KEY)throw problem('stripe_secret_not_configured',503);
            if(decision==='release'){
              const payout=await repo.getPayoutAccount(payment.providerAgentId);if(!payout||!payout.payoutsEnabled)throw problem('provider_payout_account_not_ready',409);
              const transfer=await stripeCreateTransfer(env.STRIPE_SECRET_KEY,{payment,destination:payout.externalAccountId,idempotencyKey:`taskbay-protection-release-${payment.id}`});
              await repo.transitionPayment(payment.id,'released',null,{transferReference:transfer.id},{source:'trust-admin',system:true});
            }else if(decision==='refund'){
              if(!payment.providerReference)throw problem('stripe_payment_intent_missing',409);let reversal=null;if(payment.status==='released'&&payment.transferReference)reversal=await stripeCreateTransferReversal(env.STRIPE_SECRET_KEY,{transferId:payment.transferReference,idempotencyKey:`taskbay-protection-reversal-${payment.id}`});
              const refund=await stripeCreateRefund(env.STRIPE_SECRET_KEY,{paymentIntentId:payment.providerReference,idempotencyKey:`taskbay-protection-refund-${payment.id}`});
              await repo.transitionPayment(payment.id,'refunded',null,{refundReference:refund.id,reversalReference:reversal?.id},{source:'trust-admin',system:true});
            }else throw problem('protection_resolution_invalid',400);
          }else if(payment&&['mock','disabled'].includes(payment.provider)){
            if(decision==='release')await repo.transitionPayment(payment.id,'released',null,{}, {source:'trust-admin',system:true});else if(decision==='refund')await repo.transitionPayment(payment.id,'refunded',null,{}, {source:'trust-admin',system:true});else throw problem('protection_resolution_invalid',400);
          }
          return{status:200,payload:{protection:await repo.resolveProtectionCase(caseId,decision,body.note,{source:'trust-admin',actorId:'trust-admin'})}};
        });
      }

      if(request.method==='POST'&&url.pathname==='/api/v1/trust/reports'){
        return await mutate(request,url,repo,async body=>{
          if(!body.reporterAgentId)throw problem('reporter_agent_required',401);
          await requireAgent(request,repo,body.reporterAgentId);
          return{status:201,payload:{case:await repo.reportTrustCase({...body,evidence:{...(body.evidence||{}),reporterAgentId:body.reporterAgentId}},{source})}};
        });
      }

      m = url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)\/risk$/);
      if(m&&request.method==='GET'){
        const taskId=decodeURIComponent(m[1]),task=await repo.getTask(taskId);if(!task)return json({error:'task_not_found'},404);
        const actor=await authenticate(request,repo);if(!actor||![task.requesterAgentId,task.providerAgentId].includes(actor))return json({error:'actor_not_authorized'},403);
        return json({risk:await repo.evaluateTaskRisk(taskId,{source})});
      }

      m = url.pathname.match(/^\/api\/v1\/agents\/([^/]+)\/payout\/stripe(?:\/onboard)?$/);
      if (m) {
        const agentId = decodeURIComponent(m[1]);
        await requireAgent(request, repo, agentId);
        if (request.method === 'GET') return json({ payoutAccount: await repo.getPayoutAccount(agentId) });
        if (request.method === 'POST' && url.pathname.endsWith('/onboard')) {
          if (env.PAYMENT_PROVIDER !== 'stripe') return json({ error: 'stripe_not_enabled' }, 503);
          if (!env.STRIPE_SECRET_KEY) return json({ error: 'stripe_secret_not_configured' }, 503);
          return await mutate(request, url, repo, async body => {
            let payout = await repo.getPayoutAccount(agentId);
            let account;
            if (!payout) {
              account = await stripeCreateConnectedAccount(env.STRIPE_SECRET_KEY,{country:body.country,email:body.email,idempotencyKey:`relaymarket-onboard-${agentId}`});
              payout = await repo.savePayoutAccount(agentId, account);
              await repo.syncPaymentProviderVerification(agentId,payout,{source});
            }
            const link = await stripeCreateAccountLink(env.STRIPE_SECRET_KEY,{account:payout.externalAccountId,refreshUrl:`${origin}/?stripe=refresh&agent=${encodeURIComponent(agentId)}`,returnUrl:`${origin}/?stripe=return&agent=${encodeURIComponent(agentId)}`,idempotencyKey:`relaymarket-link-${agentId}-${Date.now()}`});
            return { status: 200, payload: { payoutAccount:payout, onboardingUrl:link.url, expiresAt:link.expires_at ? new Date(link.expires_at*1000).toISOString() : null } };
          });
        }
        return json({ error: 'method_not_allowed' }, 405);
      }

      m = url.pathname.match(/^\/api\/v1\/agents\/([^/]+)\/verification-challenges(?:\/([^/]+)\/verify)?$/);
      if (m) {
        const agentId = decodeURIComponent(m[1]);
        const challengeId = m[2] ? decodeURIComponent(m[2]) : null;
        await requireAgent(request, repo, agentId);
        if (request.method === 'POST' && !challengeId) {
          return await mutate(request, url, repo, async body => ({ status: 201, payload: { challenge: await repo.createVerificationChallenge(agentId, body.endpointIndex ?? 0, { source }) } }));
        }
        if (request.method === 'POST' && challengeId) {
          return await mutate(request, url, repo, async () => {
            const challenge = await repo.getVerificationChallenge(agentId, challengeId);
            if (!challenge) throw problem('verification_challenge_not_found', 404);
            await verifyOwnershipUrl(challenge.verificationUrl, challenge.tokenHash);
            return { status: 200, payload: { agent: await repo.completeVerificationChallenge(agentId, challengeId, { source }), verifiedEndpoint: challenge.endpointUrl } };
          });
        }
        return json({ error: 'method_not_allowed' }, 405);
      }

      if (request.method === 'GET' && url.pathname === '/api/v1/tasks') {
        await repo.recordMetric('task.discovery', { source, audit: false });
        return json({ tasks: await repo.listTasks(url.searchParams.get('status') || 'all') });
      }
      if (request.method === 'POST' && url.pathname === '/api/v1/tasks') {
        return await mutate(request, url, repo, async body => {
          if (body.requesterAgentId) await requireAgent(request, repo, body.requesterAgentId);
          return { status: 201, payload: { task: await repo.createTask(body, { source }) } };
        });
      }

      m = url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)\/protection$/);
      if(m){
        const taskId=decodeURIComponent(m[1]),task=await repo.getTask(taskId);if(!task)return json({error:'task_not_found'},404);const actor=await authenticateAgent(request,repo);if(!actor||![task.requesterAgentId,task.providerAgentId].includes(actor))return json({error:'actor_not_authorized'},403);
        if(request.method==='GET')return json({protection:await repo.getProtectionCaseByTask(taskId)});
        if(request.method==='POST')return await mutate(request,url,repo,async body=>{const c=await repo.getProtectionCaseByTask(taskId);if(!c)throw problem('protection_case_not_found',404);return{status:201,payload:{protection:await repo.addProtectionEvidence(c.id,actor,body)}};});
        return json({error:'method_not_allowed'},405);
      }

      m = url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)\/payment$/);
      if (m) {
        const taskId = decodeURIComponent(m[1]);
        if (request.method === 'GET') {
          const payment = await repo.getTaskPayment(taskId);
          if (!payment) return json({ error: 'payment_not_found' }, 404);
          await requireAgent(request, repo, payment.requesterAgentId);
          return json({ payment });
        }
        if (request.method === 'POST') {
          if ((env.PAYMENT_PROVIDER || 'disabled') === 'disabled') return json({ error: 'payments_not_configured' }, 503);
          return await mutate(request, url, repo, async body => {
            await requireAgent(request, repo, body.requesterAgentId);
            return { status: 201, payload: await createProviderPayment(repo, env, taskId, body.requesterAgentId, body, source) };
          });
        }
      }

      m = url.pathname.match(/^\/api\/v1\/payments\/([^/]+)\/mock\/(fund|hold|release|refund|fail|cancel)$/);
      if (m && request.method === 'POST') {
        if (env.PAYMENT_PROVIDER !== 'mock') return json({ error: 'not_found' }, 404);
        const paymentId = decodeURIComponent(m[1]), action = m[2], map = { fund: 'funded', hold: 'held', release: 'released', refund: 'refunded', fail: 'failed', cancel: 'cancelled' };
        return await mutate(request, url, repo, async body => {
          const payment = await repo.getPayment(paymentId);
          if (!payment) throw problem('payment_not_found', 404);
          const actor = body.actorAgentId || payment.requesterAgentId;
          await requireAgent(request, repo, actor);
          return { status: 200, payload: { payment: await repo.transitionPayment(paymentId, map[action], actor, body, { source }) } };
        });
      }

      m = url.pathname.match(/^\/api\/v1\/payments\/([^/]+)\/(release|refund)$/);
      if (m && request.method === 'POST') {
        if (env.PAYMENT_PROVIDER !== 'stripe') return json({ error: 'stripe_not_enabled' }, 503);
        if (!env.STRIPE_SECRET_KEY) return json({ error: 'stripe_secret_not_configured' }, 503);
        const paymentId=decodeURIComponent(m[1]),action=m[2];
        return await mutate(request,url,repo,async body=>{
          const payment=await repo.getPayment(paymentId);if(!payment)throw problem('payment_not_found',404);
          await requireAgent(request,repo,body.requesterAgentId||payment.requesterAgentId);
          if(await repo.hasOpenProtectionCaseForPayment(payment.id))throw problem('payment_protection_case_open',409);
          if(action==='release'){
            const payout=await repo.getPayoutAccount(payment.providerAgentId);if(!payout||!payout.payoutsEnabled)throw problem('provider_payout_account_not_ready',409);
            const task=await repo.getTask(payment.taskId);if(task?.status!=='completed')throw problem('task_must_be_completed_before_release',409);
            const transfer=await stripeCreateTransfer(env.STRIPE_SECRET_KEY,{payment,destination:payout.externalAccountId,idempotencyKey:`relaymarket-release-${payment.id}`});
            return{status:200,payload:{payment:await repo.transitionPayment(payment.id,'released',payment.requesterAgentId,{transferReference:transfer.id},{source}),transfer:{id:transfer.id}}};
          }
          if(!['funded','held','released'].includes(payment.status))throw problem('payment_not_refundable',409);
          if(!payment.providerReference)throw problem('stripe_payment_intent_missing',409);
          let reversal=null;
          if(payment.status==='released'){
            if(!payment.transferReference)throw problem('stripe_transfer_missing',409);
            reversal=await stripeCreateTransferReversal(env.STRIPE_SECRET_KEY,{transferId:payment.transferReference,idempotencyKey:`relaymarket-reversal-${payment.id}`});
          }
          const refund=await stripeCreateRefund(env.STRIPE_SECRET_KEY,{paymentIntentId:payment.providerReference,idempotencyKey:`relaymarket-refund-${payment.id}`});
          return{status:200,payload:{payment:await repo.transitionPayment(payment.id,'refunded',payment.requesterAgentId,{refundReference:refund.id},{source}),refund:{id:refund.id,status:refund.status},reversal:reversal?{id:reversal.id}:null}};
        });
      }

      m = url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)\/messages$/);
      if (m) {
        const taskId = decodeURIComponent(m[1]);
        if (request.method === 'GET') { await requireTaskParticipant(request, repo, taskId); return json({ messages: await repo.listMessages(taskId) }); }
        if (request.method === 'POST') {
          return await mutate(request, url, repo, async body => {
            await requireAgent(request, repo, body.fromAgentId);
            return { status: 201, payload: { message: await repo.createMessage(taskId, body, { source }) } };
          });
        }
      }

      m = url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)(?:\/(matches|select|accept|start|deliver|revise|complete|dispute|cancel))?$/);
      if (m) {
        const taskId = decodeURIComponent(m[1]);
        const action = m[2];
        if (!action && request.method === 'GET') {
          await repo.recordMetric('task.viewed', { source, audit: false });
          const task = await repo.getTask(taskId);
          return task ? json({ task }) : json({ error: 'task_not_found' }, 404);
        }
        if (action === 'matches' && request.method === 'GET') {
          await repo.recordMetric('task.match_requested', { source, audit: false });
          return json({ matches: await repo.matches(taskId) });
        }
        if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
        return await mutate(request, url, repo, async body => {
          if (action === 'select') {await requireAgent(request, repo, body.requesterAgentId);return { status: 200, payload: { task: await repo.selectProvider(taskId, body.requesterAgentId, body.providerAgentId, { source }) } };}
          if (action === 'accept') {
            await requireAgent(request, repo, body.providerAgentId);
            const task=await repo.transition(taskId,'accepted',body.providerAgentId,body,{source});await repo.evaluateTaskRisk(taskId,{source});
            return { status: 200, payload: { task } };
          }
          if (action === 'start') {
            await requireAgent(request, repo, body.providerAgentId);
            return { status: 200, payload: { task: await repo.transition(taskId, 'working', body.providerAgentId, body, { source }) } };
          }
          if (action === 'deliver') {
            await requireAgent(request, repo, body.providerAgentId);
            return { status: 200, payload: { task: await repo.transition(taskId, 'delivered', body.providerAgentId, body, { source }) } };
          }
          if (action === 'revise') {await requireAgent(request, repo, body.requesterAgentId);return { status: 200, payload: { task: await repo.transition(taskId, 'working', body.requesterAgentId, body, { source }) } };}
          if (action === 'complete') {
            await requireAgent(request, repo, body.requesterAgentId);
            return { status: 200, payload: { task: await repo.transition(taskId, 'completed', body.requesterAgentId, body, { source }) } };
          }
          if (action === 'dispute') {
            await requireAgent(request, repo, body.requesterAgentId);
            return { status: 200, payload: { task: await repo.transition(taskId, 'disputed', body.requesterAgentId, body, { source }) } };
          }
          if (action === 'cancel') {
            await requireAgent(request, repo, body.actorAgentId);
            return { status: 200, payload: { task: await repo.transition(taskId, 'cancelled', body.actorAgentId, body, { source }) } };
          }
          throw problem('not_found', 404);
        });
      }

      if (request.method === 'GET' && env.ASSETS) return env.ASSETS.fetch(request);
      return json({ error: 'not_found' }, 404);
    } catch (e) {
      return json({ error: e.code || 'internal_error', message: e.message || 'Internal error' }, e.status || 500);
    }
  }
};

async function createProviderPayment(repo, env, taskId, requesterAgentId, input, source) {
  const provider = env.PAYMENT_PROVIDER || 'disabled';
  if (provider === 'disabled') throw problem('payments_not_configured',503);
  if (provider === 'stripe') {
    if (!stripeRuntimeReady(env)) throw problem('stripe_runtime_not_ready',503);
    const task = await repo.getTask(taskId);
    const payout = task?.providerAgentId ? await repo.getPayoutAccount(task.providerAgentId) : null;
    if (!payout || !payout.payoutsEnabled || !payout.detailsSubmitted) throw problem('provider_payout_account_not_ready',409);
  }
  let payment = await repo.createPayment(taskId, requesterAgentId, input, { source, provider });
  if (provider !== 'stripe') return { payment };
  try {
    const intent = await stripeCreatePaymentIntent(env.STRIPE_SECRET_KEY,payment,{idempotencyKey:`relaymarket-payment-${payment.id}`});
    payment = await repo.attachPaymentProviderReference(payment.id,intent.id);
    return { payment, providerSession:{ provider:'stripe', paymentIntentId:intent.id, clientSecret:intent.client_secret, status:intent.status } };
  } catch (error) {
    await repo.transitionPayment(payment.id,'failed',null,{providerReference:error.code||'stripe_error'},{source,system:true});
    throw error;
  }
}

function processorPolicyValid(policy){return ['platform_absorbs','provider_external_costs','payer_surcharge_compliant'].includes(String(policy||''));}
function stripeRuntimeReady(env){return env.PAYMENT_PROVIDER==='stripe'&&Boolean(env.STRIPE_SECRET_KEY)&&Boolean(env.STRIPE_WEBHOOK_SECRET)&&processorPolicyValid(env.PAYMENT_PROCESSOR_COST_POLICY);}

async function handleStripeWebhook(request, env, repo) {
  if (env.PAYMENT_PROVIDER !== 'stripe') return json({ error: 'stripe_not_enabled' }, 404);
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: 'stripe_webhook_secret_not_configured' }, 503);
  const raw = await request.text();
  const event = await verifyStripeWebhook(raw, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET);
  if(!event?.id||!event?.type)throw problem('stripe_webhook_event_invalid',400);
  const owner=await repo.claimProviderWebhook('stripe',event.id,event.type);
  if(!owner)return json({received:true,duplicate:true});
  try{
    const object = event?.data?.object || {};
    if (event.type === 'payment_intent.succeeded') {
      const paymentId = (object.metadata?.taskbay_payment_id || object.metadata?.relaymarket_payment_id);
      const payment = paymentId ? await repo.getPayment(paymentId) : await repo.getPaymentByProviderReference(object.id);
      if (payment) {
        if (object.amount_received != null && Number(object.amount_received) !== payment.payerTotalMinor) throw problem('stripe_payment_amount_mismatch',409);
        if (object.currency && String(object.currency).toUpperCase() !== payment.currency) throw problem('stripe_payment_currency_mismatch',409);
        await repo.transitionPayment(payment.id,'funded',null,{providerReference:object.id},{source:'stripe-webhook',system:true});
      }
    } else if (event.type === 'payment_intent.payment_failed' || event.type === 'payment_intent.canceled') {
      const paymentId = (object.metadata?.taskbay_payment_id || object.metadata?.relaymarket_payment_id);
      const payment = paymentId ? await repo.getPayment(paymentId) : await repo.getPaymentByProviderReference(object.id);
      if (payment && payment.status === 'created') await repo.transitionPayment(payment.id,event.type.endsWith('canceled')?'cancelled':'failed',null,{providerReference:object.id},{source:'stripe-webhook',system:true});
    } else if (event.type === 'account.updated') {
      await repo.updatePayoutAccountFromStripe(object);
    }
    return json({ received: true });
  }catch(error){await repo.releaseProviderWebhook('stripe',event.id);throw error;}
}

async function mutate(request, url, repo, fn) {
  const body = await readJson(request);
  const key = idempotencyKey(request);
  const scope = `${request.method}:${url.pathname}`;
  const fingerprint = await hash(JSON.stringify({ method: request.method, path: url.pathname, body }));
  let claim = { owner: true, keyHash: null };
  if (key) {
    claim = await repo.claimIdempotency(scope, key, fingerprint);
    if (!claim.owner) return json(claim.replay.payload, claim.replay.status, { 'x-idempotent-replay': 'true' });
  }
  try {
    const out = await fn(body);
    await repo.finishIdempotency(scope, claim.keyHash, out);
    return json(out.payload, out.status);
  } catch (e) {
    await repo.releaseIdempotency(scope, claim.keyHash);
    throw e;
  }
}

async function protocolMutation(repo, request, operation, args, fn, protocol = 'mcp') {
  const key = idempotencyKey(request);
  if (!key) return fn();
  const scope = `${protocol}:${operation}`;
  const fingerprint = await hash(JSON.stringify({ operation, args }));
  const claim = await repo.claimIdempotency(scope, key, fingerprint);
  if (!claim.owner) return claim.replay.payload;
  try {
    const value = await fn();
    await repo.finishIdempotency(scope, claim.keyHash, { status: 200, payload: value });
    return value;
  } catch (error) {
    await repo.releaseIdempotency(scope, claim.keyHash);
    throw error;
  }
}

async function requireTrustAdmin(request, env) {
  const expected = String(env.TRUST_ADMIN_TOKEN || '');
  if (!expected) throw problem('trust_admin_not_configured', 503);
  const presented = String(request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1] || '';
  const [a,b] = await Promise.all([hash(expected), hash(presented)]);
  if (a !== b) throw problem('trust_admin_unauthorized', 401);
}

async function requireTaskParticipant(request, repo, taskId) {
  const task = await repo.getTask(taskId);
  if (!task) throw problem('task_not_found', 404);
  const actor = await authenticateAgent(request, repo);
  if (!actor) throw problem('invalid_agent_api_key', 401);
  if (![task.requesterAgentId, task.providerAgentId].filter(Boolean).includes(actor)) throw problem('actor_not_authorized', 403);
  return actor;
}

async function authenticateAgent(request, repo) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.match(/^Bearer\s+(.+)$/i)?.[1];
  return repo.authenticateApiKey(token);
}

async function requireAgent(request, repo, claimed) {
  if (!claimed) throw problem('agent_identity_required', 401);
  const auth = request.headers.get('authorization') || '';
  const token = auth.match(/^Bearer\s+(.+)$/i)?.[1];
  const actual = await repo.authenticateApiKey(token);
  if (!actual) throw problem('invalid_agent_api_key', 401);
  if (actual !== claimed) throw problem('agent_identity_mismatch', 403);
  return actual;
}

async function readJson(request) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > 1_000_000) throw problem('request_too_large', 413);
  let raw;
  try { raw = await request.arrayBuffer(); }
  catch { throw problem('invalid_json', 400); }
  if (raw.byteLength > 1_000_000) throw problem('request_too_large', 413);
  if (raw.byteLength === 0) return {};
  try { return JSON.parse(new TextDecoder().decode(raw)); }
  catch { throw problem('invalid_json', 400); }
}

function idempotencyKey(request) {
  const v = request.headers.get('idempotency-key');
  if (!v) return null;
  const k = v.trim();
  if (k.length < 8 || k.length > 200) throw problem('invalid_idempotency_key', 400);
  return k;
}

function requestSource(request, url) {
  return String(request.headers.get('x-taskbay-source') || request.headers.get('x-relaymarket-source') || url.searchParams.get('source') || 'direct')
    .toLowerCase().replace(/[^a-z0-9_.:-]/g, '').slice(0, 80) || 'direct';
}

async function handleMcp(request, repo, source, env) {
  const body = await readJson(request);
  const id = body.id ?? null;
  try {
    if (body.method === 'server/discover') {
      return rpc(id, {
        supportedVersions: [MCP_LEGACY_VERSION],
        capabilities: { tools: { listChanged: false } },
        instructions: 'Use TaskBay tools to discover agents, publish tasks, rank matches, inspect tasks, read task messages, and query marketplace statistics.',
        ttlMs: 300000,
        cacheScope: 'public',
        _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'taskbay', version: VERSION } }
      });
    }
    if (body.method === 'initialize') {
      return rpc(id, {
        protocolVersion: MCP_LEGACY_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'taskbay', version: VERSION },
        instructions: 'TaskBay is an agent-to-agent marketplace. Prefer the discovery and task tools over scraping the human portal.'
      });
    }
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202, headers: CORS });
    if (body.method === 'tools/list') return rpc(id, { tools: mcpTools() });
    if (body.method === 'tools/call') {
      const args = body.params?.arguments || {};
      const name = body.params?.name;
      let value;
      if (['taskbay_discover_agents','relaymarket_discover_agents'].includes(name)) value = { agents: await repo.listAgents({ capability: args.capability, protocol: args.protocol, available: args.available === false ? undefined : 'true' }) };
      else if (['taskbay_publish_task','relaymarket_publish_task'].includes(name)) {
        if (args.requesterAgentId) await requireAgent(request, repo, args.requesterAgentId);
        value = await protocolMutation(repo, request, 'publish_task', args, async () => ({ task: await repo.createTask(args, { source }) }));
      } else if (['taskbay_task_matches','relaymarket_task_matches'].includes(name)) value = { matches: await repo.matches(args.taskId) };
      else if (['taskbay_get_task','relaymarket_get_task'].includes(name)) value = { task: await repo.getTask(args.taskId) };
      else if (['taskbay_task_messages','relaymarket_task_messages'].includes(name)) { await requireTaskParticipant(request, repo, args.taskId); value = { messages: await repo.listMessages(args.taskId) }; }
      else if (['taskbay_accept_task','relaymarket_accept_task'].includes(name)) {
        await requireAgent(request, repo, args.providerAgentId);
        value = await protocolMutation(repo, request, 'accept_task', args, async () => {const task=await repo.transition(args.taskId,'accepted',args.providerAgentId,args,{source});await repo.evaluateTaskRisk(args.taskId,{source});return{task};});
      } else if (['taskbay_start_task','relaymarket_start_task'].includes(name)) {
        await requireAgent(request, repo, args.providerAgentId);
        value = await protocolMutation(repo, request, 'start_task', args, async () => ({ task: await repo.transition(args.taskId, 'working', args.providerAgentId, args, { source }) }));
      } else if (['taskbay_deliver_task','relaymarket_deliver_task'].includes(name)) {
        await requireAgent(request, repo, args.providerAgentId);
        value = await protocolMutation(repo, request, 'deliver_task', args, async () => ({ task: await repo.transition(args.taskId, 'delivered', args.providerAgentId, args, { source }) }));
      } else if (['taskbay_complete_task','relaymarket_complete_task'].includes(name)) {
        await requireAgent(request, repo, args.requesterAgentId);
        value = await protocolMutation(repo, request, 'complete_task', args, async () => ({ task: await repo.transition(args.taskId, 'completed', args.requesterAgentId, args, { source }) }));
      } else if (['taskbay_dispute_task','relaymarket_dispute_task'].includes(name)) {
        await requireAgent(request, repo, args.requesterAgentId);
        value = await protocolMutation(repo, request, 'dispute_task', args, async () => ({ task: await repo.transition(args.taskId, 'disputed', args.requesterAgentId, args, { source }) }));
      } else if (['taskbay_cancel_task','relaymarket_cancel_task'].includes(name)) {
        await requireAgent(request, repo, args.actorAgentId);
        value = await protocolMutation(repo, request, 'cancel_task', args, async () => ({ task: await repo.transition(args.taskId, 'cancelled', args.actorAgentId, args, { source }) }));
      } else if (['taskbay_send_message','relaymarket_send_message'].includes(name)) {
        await requireAgent(request, repo, args.fromAgentId);
        value = await protocolMutation(repo, request, 'send_message', args, async () => ({ message: await repo.createMessage(args.taskId, args, { source }) }));
      } else if (['taskbay_get_protection_case','relaymarket_get_protection_case'].includes(name)) {
        await requireAgent(request,repo,args.actorAgentId);const task=await repo.getTask(args.taskId);if(!task||![task.requesterAgentId,task.providerAgentId].includes(args.actorAgentId))throw problem('actor_not_authorized',403);value={protection:await repo.getProtectionCaseByTask(args.taskId)};
      } else if (['taskbay_add_protection_evidence','relaymarket_add_protection_evidence'].includes(name)) {
        await requireAgent(request,repo,args.actorAgentId);const task=await repo.getTask(args.taskId);if(!task||![task.requesterAgentId,task.providerAgentId].includes(args.actorAgentId))throw problem('actor_not_authorized',403);const c=await repo.getProtectionCaseByTask(args.taskId);if(!c)throw problem('protection_case_not_found',404);value=await protocolMutation(repo,request,'add_protection_evidence',args,async()=>({protection:await repo.addProtectionEvidence(c.id,args.actorAgentId,args)}));
      } else if (['taskbay_payment_quote','relaymarket_payment_quote'].includes(name)) value = { quote: paymentQuote(args.amountMinor, args.currency || 'USD') };
      else if (['taskbay_create_payment','relaymarket_create_payment'].includes(name)) {
        if ((env.PAYMENT_PROVIDER || 'disabled') === 'disabled') throw problem('payments_not_configured', 503);
        await requireAgent(request, repo, args.requesterAgentId);
        value = await protocolMutation(repo, request, 'create_payment', args, async () => await createProviderPayment(repo, env, args.taskId, args.requesterAgentId, args, source));
      } else if (['taskbay_trust_summary','relaymarket_trust_summary'].includes(name)) value = { trust: await repo.trustSummary() };
      else if (['taskbay_stats','relaymarket_stats'].includes(name)) value = await repo.stats();
      else throw problem('unknown_tool', 400);
      return rpc(id, { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
    }
    return rpcError(id, -32601, 'Method not found');
  } catch (e) {
    return rpcError(id, -32000, e.message || 'Tool error');
  }
}

async function handleA2A(request, repo, source, env) {
  const body = await readJson(request);
  const id = body.id ?? null;
  try {
    if (body.method !== 'message/send' && body.method !== undefined) {
      return json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }, 400);
    }
    const message = body.params?.message ?? body.message ?? {};
    const parts = message.parts || [];
    const data = parts.find(p => p.data)?.data || {};
    let result;
    if (data.action === 'discover_agents') result = { agents: await repo.listAgents(data.filters || {}) };
    else if (data.action === 'trust_summary') result = { trust: await repo.trustSummary() };
    else if (data.action === 'publish_task') {
      const task = data.task || {};
      if (task.requesterAgentId) await requireAgent(request, repo, task.requesterAgentId);
      result = await protocolMutation(repo, request, 'publish_task', task, async () => ({ task: await repo.createTask(task, { source }) }), 'a2a');
    } else if (data.action === 'task_matches') result = { matches: await repo.matches(data.taskId) };
    else if (data.action === 'get_task') result = { task: await repo.getTask(data.taskId) };
    else if (data.action === 'task_messages') { await requireTaskParticipant(request, repo, data.taskId); result = { messages: await repo.listMessages(data.taskId) }; }
    else if (data.action === 'accept_task') {
      await requireAgent(request, repo, data.providerAgentId);
      result = await protocolMutation(repo, request, 'accept_task', data, async () => {const task=await repo.transition(data.taskId,'accepted',data.providerAgentId,data,{source});await repo.evaluateTaskRisk(data.taskId,{source});return{task};}, 'a2a');
    } else if (data.action === 'start_task') {
      await requireAgent(request, repo, data.providerAgentId);
      result = await protocolMutation(repo, request, 'start_task', data, async () => ({ task: await repo.transition(data.taskId, 'working', data.providerAgentId, data, { source }) }), 'a2a');
    } else if (data.action === 'deliver_task') {
      await requireAgent(request, repo, data.providerAgentId);
      result = await protocolMutation(repo, request, 'deliver_task', data, async () => ({ task: await repo.transition(data.taskId, 'delivered', data.providerAgentId, data, { source }) }), 'a2a');
    } else if (data.action === 'complete_task') {
      await requireAgent(request, repo, data.requesterAgentId);
      result = await protocolMutation(repo, request, 'complete_task', data, async () => ({ task: await repo.transition(data.taskId, 'completed', data.requesterAgentId, data, { source }) }), 'a2a');
    } else if (data.action === 'dispute_task') {
      await requireAgent(request, repo, data.requesterAgentId);
      result = await protocolMutation(repo, request, 'dispute_task', data, async () => ({ task: await repo.transition(data.taskId, 'disputed', data.requesterAgentId, data, { source }) }), 'a2a');
    } else if (data.action === 'cancel_task') {
      await requireAgent(request, repo, data.actorAgentId);
      result = await protocolMutation(repo, request, 'cancel_task', data, async () => ({ task: await repo.transition(data.taskId, 'cancelled', data.actorAgentId, data, { source }) }), 'a2a');
    } else if (data.action === 'get_protection_case') {
      await requireAgent(request,repo,data.actorAgentId);const task=await repo.getTask(data.taskId);if(!task||![task.requesterAgentId,task.providerAgentId].includes(data.actorAgentId))throw problem('actor_not_authorized',403);result={protection:await repo.getProtectionCaseByTask(data.taskId)};
    } else if (data.action === 'add_protection_evidence') {
      await requireAgent(request,repo,data.actorAgentId);const task=await repo.getTask(data.taskId);if(!task||![task.requesterAgentId,task.providerAgentId].includes(data.actorAgentId))throw problem('actor_not_authorized',403);const c=await repo.getProtectionCaseByTask(data.taskId);if(!c)throw problem('protection_case_not_found',404);result=await protocolMutation(repo,request,'add_protection_evidence',data,async()=>({protection:await repo.addProtectionEvidence(c.id,data.actorAgentId,data)}),'a2a');
    } else if (data.action === 'payment_quote') result = { quote: paymentQuote(data.amountMinor, data.currency || 'USD') };
    else if (data.action === 'create_payment') {
      if ((env.PAYMENT_PROVIDER || 'disabled') === 'disabled') throw problem('payments_not_configured', 503);
      await requireAgent(request, repo, data.requesterAgentId);
      result = await protocolMutation(repo, request, 'create_payment', data, async () => await createProviderPayment(repo, env, data.taskId, data.requesterAgentId, data, source), 'a2a');
    } else if (data.action === 'send_message') {
      await requireAgent(request, repo, data.fromAgentId);
      result = await protocolMutation(repo, request, 'send_message', data, async () => ({ message: await repo.createMessage(data.taskId, data, { source }) }), 'a2a');
    } else result = { help: 'Use data.action: discover_agents, trust_summary, publish_task, task_matches, get_task, task_messages, accept_task, start_task, deliver_task, complete_task, dispute_task, cancel_task, send_message, get_protection_case, add_protection_evidence, payment_quote, or create_payment.' };
    const taskId = `task_${crypto.randomUUID()}`;
    const contextId = message.contextId || `ctx_${crypto.randomUUID()}`;
    return json({
      jsonrpc: '2.0',
      id,
      result: {
        id: taskId,
        contextId,
        kind: 'task',
        status: { state: 'completed', timestamp: new Date().toISOString() },
        artifacts: [{
          artifactId: `artifact_${crypto.randomUUID()}`,
          name: 'RelayMarketResult',
          parts: [{ kind: 'data', data: result }]
        }],
        history: message.messageId ? [{ ...message, taskId, contextId, kind: 'message' }] : undefined,
        metadata: { service: 'RelayMarket', action: data.action || 'help' }
      }
    });
  } catch (e) {
    return json({ jsonrpc: '2.0', id, error: { code: -32000, message: e.message || 'A2A error' } }, 400);
  }
}

async function servePortal(request, env, origin) {
  const assetRequest = new Request(new URL('/index.html', request.url), request);
  const response = await env.ASSETS.fetch(assetRequest);
  if (!response.ok) return response;
  const verification = String(env.GOOGLE_SITE_VERIFICATION || '');
  const html = (await response.text())
    .replaceAll('__PUBLIC_ORIGIN__', origin)
    .replaceAll('__GOOGLE_SITE_VERIFICATION__', verification);
  const headers = new Headers(response.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'public, max-age=300');
  for (const [k,v] of Object.entries(SECURITY_HEADERS)) headers.set(k,v);
  headers.set('content-security-policy', portalCsp(origin));
  return new Response(html, { status: response.status, headers });
}



async function safeMetric(db, metric, source) {
  if (!db) return;
  try { await new D1Repository(db).recordMetric(metric, { source, audit: false }); }
  catch { /* Discovery must remain available if metrics storage is degraded. */ }
}

async function enforceMutationRateLimit(request, env, pathname) {
  if (!env.MUTATION_RATE_LIMITER || !['POST', 'PATCH', 'DELETE'].includes(request.method)) return null;
  const auth = request.headers.get('authorization') || '';
  const stable = auth || request.headers.get('cf-connecting-ip') || 'anonymous';
  const key = `${pathname.split('/').slice(0, 5).join('/')}:${await hash(stable)}`;
  const { success } = await env.MUTATION_RATE_LIMITER.limit({ key });
  if (success) return null;
  return json({ error: 'rate_limited', message: 'Too many mutation requests; retry shortly.' }, 429, { 'retry-after': '60' });
}

function publicOrigin(env, url) {
  const configured = String(env.PUBLIC_ORIGIN || '').trim();
  if (!configured) return url.origin;
  try {
    const parsed = new URL(configured);
    if (parsed.protocol !== 'https:') return url.origin;
    return parsed.origin;
  } catch {
    return url.origin;
  }
}

function validateMcpOrigin(request, origin) {
  const presented = request.headers.get('origin');
  if (presented && presented !== origin) throw problem('invalid_mcp_origin', 403);
}

async function verifyOwnershipUrl(url, expectedHash) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw problem('verification_url_must_use_https', 400);
  if (u.username || u.password || (u.port && u.port !== '443')) throw problem('verification_url_not_public', 400);
  if (isPrivateHostLiteral(u.hostname)) throw problem('verification_url_not_public', 400);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const r = await fetch(u, { method: 'GET', redirect: 'manual', signal: controller.signal, headers: { 'user-agent': `RelayMarket-Ownership-Verifier/${VERSION}` } });
    if (r.status !== 200) throw problem('verification_token_not_found', 422);
    const raw = await r.text();
    if (raw.length > 4096) throw problem('verification_response_too_large', 422);
    const body = raw.trim();
    if (await hash(body) !== expectedHash) throw problem('verification_token_mismatch', 422);
    return true;
  } catch (e) {
    if (e?.code) throw e;
    throw problem('verification_fetch_failed', 422);
  } finally {
    clearTimeout(timer);
  }
}

function isPrivateHostLiteral(host) {
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || host === '0.0.0.0') return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  const m = host.match(/^172\.(\d+)\./);
  return Boolean(m && Number(m[1]) >= 16 && Number(m[1]) <= 31);
}

function rpc(id, result) { return json({ jsonrpc: '2.0', id, result }); }
function rpcError(id, code, message) { return json({ jsonrpc: '2.0', id, error: { code, message } }, 400); }
function json(body, status = 200, extra = {}) { return new Response(body === null ? null : JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } }); }
function text(body, contentType, extra = {}) { return new Response(body, { status: 200, headers: { 'content-type': contentType, ...SECURITY_HEADERS, ...extra } }); }
function publicEvents(events=[]) { return events.map(e => ({ type:e.type, source:e.detail?.source || 'direct', at:e.at })); }
function portalCsp(origin) { return `default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ${origin}; font-src 'self'; upgrade-insecure-requests`; }
function allowedBrowserOrigins(env, origin) {
  const configured=String(env.BROWSER_CORS_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
  return new Set([origin,...configured]);
}
function preflight(request, env, origin) {
  const requested=String(request.headers.get('origin')||'');
  if (!requested) return new Response(null,{status:204,headers:{...SECURITY_HEADERS,allow:'GET,POST,PATCH,OPTIONS'}});
  if (!allowedBrowserOrigins(env,origin).has(requested)) return json({error:'cors_origin_not_allowed'},403);
  return new Response(null,{status:204,headers:{...SECURITY_HEADERS,'access-control-allow-origin':requested,'access-control-allow-methods':'GET,POST,PATCH,OPTIONS','access-control-allow-headers':ALLOW_HEADERS,'access-control-max-age':'600','vary':'Origin'}});
}

async function hash(v) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function problem(code, status) { return Object.assign(new Error(code.replaceAll('_', ' ')), { code, status }); }
