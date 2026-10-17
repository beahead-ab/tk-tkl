import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT, createLocalJWKSet } from 'jose';
import { createAccessGuard } from '../src/access.mjs';
import { guard } from '../src/http.mjs';

const env = {
  CHARLOTTENDAL_PUBLIC_ORIGIN: 'https://cda-tkl.trainmeet.app',
  CHARLOTTENDAL_ACCESS_ISSUER: 'https://test-team.cloudflareaccess.com',
  CHARLOTTENDAL_ACCESS_AUD: 'test-application',
  CHARLOTTENDAL_ACCESS_EMAIL: 'operator@example.test',
};
const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(publicKey), kid: 'test-key', alg: 'RS256' };
const authenticate = createAccessGuard(env, createLocalJWKSet({ keys: [jwk] }));
const request = token => ({ headers: token ? { 'cf-access-jwt-assertion': token } : {} });
async function sign(overrides = {}, key = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: env.CHARLOTTENDAL_ACCESS_ISSUER, aud: env.CHARLOTTENDAL_ACCESS_AUD,
    sub: 'test-user', email: env.CHARLOTTENDAL_ACCESS_EMAIL, iat: now, exp: now + 300, ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(key);
}
test('public deployment refuses incomplete or insecure Access configuration', () => {
  for (const key of Object.keys(env).filter(k => k !== 'CHARLOTTENDAL_PUBLIC_ORIGIN')) {
    assert.throws(() => createAccessGuard({ ...env, [key]: '' }));
  }
  assert.throws(() => createAccessGuard({ ...env, CHARLOTTENDAL_PUBLIC_ORIGIN: 'http://cda-tkl.trainmeet.app' }));
  assert.throws(() => createAccessGuard({ ...env, CHARLOTTENDAL_ACCESS_ISSUER: 'https://other.example' }));
});
test('local operation needs no Cloudflare account', async () => {
  assert.equal(await createAccessGuard({})(request()), null);
});
test('Access accepts a valid signature only for the configured app and operator', async () => {
  assert.ok(await authenticate(request(await sign())) > Date.now());
  const badKey = (await generateKeyPair('RS256')).privateKey;
  for (const token of [undefined, 'malformed', await sign({}, badKey),
    await sign({ aud: 'another-application' }), await sign({ iss: 'https://other.cloudflareaccess.com' }),
    await sign({ exp: Math.floor(Date.now() / 1000) - 1 }), await sign({ exp: undefined }),
    await sign({ nbf: Math.floor(Date.now() / 1000) + 60 }), await sign({ email: 'someone-else@example.test' })]) {
    await assert.rejects(authenticate(request(token)), e => e.status === 403);
  }
  await assert.rejects(authenticate({ headers: { 'cf-access-authenticated-user-email': env.CHARLOTTENDAL_ACCESS_EMAIL } }), e => e.status === 403);
});
test('public POST origin and Host are restricted to the configured HTTPS address', () => {
  const req = { method: 'POST', headers: { host: 'cda-tkl.trainmeet.app', origin: env.CHARLOTTENDAL_PUBLIC_ORIGIN, 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' } };
  assert.doesNotThrow(() => guard(req, 8910, env.CHARLOTTENDAL_PUBLIC_ORIGIN));
  for (const headers of [{ origin: 'http://cda-tkl.trainmeet.app' }, { origin: 'https://other.trainmeet.app' },
    { host: '127.0.0.1:8910' }, { 'sec-fetch-site': 'cross-site' }, { 'content-type': 'text/plain' }]) {
    assert.throws(() => guard({ ...req, headers: { ...req.headers, ...headers } }, 8910, env.CHARLOTTENDAL_PUBLIC_ORIGIN));
  }
});
test('other computers on the layout network reach TKL only by a configured name',async()=>{
  const {guard}=await import('../src/http.mjs');
  const req=host=>({method:'GET',headers:{host}});
  assert.throws(()=>guard(req('cda-tkl.local:8910'),8910,'',''),/Otillåten värd/);
  assert.doesNotThrow(()=>guard(req('cda-tkl.local:8910'),8910,'','cda-tkl.local:8910, 192.168.1.20:8910'));
  assert.doesNotThrow(()=>guard(req('192.168.1.20:8910'),8910,'','cda-tkl.local:8910, 192.168.1.20:8910'));
  assert.throws(()=>guard({method:'POST',headers:{host:'cda-tkl.local:8910',origin:'http://evil.example','content-type':'application/json'}},8910,'','cda-tkl.local:8910'),/ursprung/);
  assert.throws(()=>guard(req('cda-tkl.local:8910'),8910,'https://tkl.example','cda-tkl.local:8910'),/Otillåten värd/,'the web deployment ignores LAN names');
});
