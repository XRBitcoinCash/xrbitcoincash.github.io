'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {validateRequest, READ_METHODS} = require('../xrpl-proxy/rpc-policy.cjs');
test('ledger evidence and simulation requests remain available', () => {
  for (const method of READ_METHODS) assert.equal(validateRequest({method,params:[{}]}), null);
  assert.equal(validateRequest({method:'account_lines',params:[{account:'public-address',ledger_index:'validated',limit:400}]}),null);
});
test('signing, submission and administration cannot be relayed', () => {
  for (const method of ['sign','sign_for','submit','submit_multisigned','wallet_propose','validation_create','stop','json'])
    assert(validateRequest({method,params:[{}]}));
  assert(validateRequest({method:'feature',params:[{feature:'example',vetoed:true}]}));
});
test('nested wallet secrets and malformed envelopes are rejected', () => {
  for (const field of ['secret','seed','private_key','master_seed','seed_hex'])
    assert(validateRequest({method:'simulate',params:[{tx_json:{[field]:'test-only'}}]}));
  for (const body of [null,[],{}, {method:'ledger',params:[{},{}]}, {method:'ledger',params:['bad']}])
    assert(validateRequest(body));
});
