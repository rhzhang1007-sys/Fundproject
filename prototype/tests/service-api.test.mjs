import test from 'node:test';import assert from 'node:assert/strict';
import {createAPIResolver,apiURL} from '../dist/service-api.mjs';
test('local app keeps its existing same-origin API; Pages routes all backend jobs to one HTTPS service',()=>{
 assert.equal(apiURL('/api/ai'),'/api/ai');
 const api=createAPIResolver('https://fund-api.example.com/');
 for(const route of ['/api/ai','/api/ai/status','/api/news/body?eventId=a%3Ab','/api/forum?objectId=fund000001&date=2026-11-26','/api/forum/batch?jobId=test'])assert.equal(api(route),'https://fund-api.example.com'+route);
});
test('backend config cannot redirect to another URL, expose credentials or send plaintext to a public host',()=>{
 for(const base of ['http://public.example.com','https://u:secret@example.com','https://example.com/api','https://example.com/?key=secret','https://example.com/#x'])assert.throws(()=>createAPIResolver(base));
 const api=createAPIResolver('https://api.example.com');
 for(const route of ['//evil.example/api/ai','/api/../data/a','/api/../../','https://evil.example/api/ai','/api/\\evil','/api/a\r\nHost:evil'])assert.throws(()=>api(route));
 assert.equal(createAPIResolver('http://127.0.0.1:8794')('/api/ai'),'http://127.0.0.1:8794/api/ai');
});
