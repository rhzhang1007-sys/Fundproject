import test from 'node:test';import assert from 'node:assert/strict';
import {strongText} from '../dist/v15-ui.mjs';import {aiResultBody,recentAIResult,recentAIKey} from '../dist/ai-result-view.mjs';import {PROMPTS,validateAIResult} from '../dist/v08-ai.mjs';
test('emphasis supports bold and fixed accent marks while escaping model-supplied markup',()=>{
 const text=strongText('**关键判断**，==关注公告==，<img src=x onerror=1>');assert.match(text,/<strong>关键判断<\/strong>/);assert.match(text,/<mark class="v24-ai-highlight">关注公告<\/mark>/);assert.ok(!text.includes('<img'));
});
test('AI reading puts its single small-print footnote after all findings and provides a named close control',()=>{
 const v={task:'news_summary',libraryEntryId:'one',result:{title:'项目进展',overview:{text:'**项目推进**',sourceIds:['s']},points:[{heading:'接下来关注',text:'==查看进度==',sourceIds:['s']}]},materials:[{id:'s',text:'项目推进',url:'https://example.com'}]};
 const html=aiResultBody(v);assert.ok(html.indexOf('v24-ai-footnote')>html.indexOf('v24-ai-action'));assert.equal((html.match(/仅供研究参考/g)||[]).length,1);assert.match(recentAIResult(v),/aria-label="关闭最近一次分析"/);assert.equal(recentAIKey(v),'one');assert.notEqual(recentAIKey(v),recentAIKey({...v,libraryEntryId:'two'}));assert.equal(recentAIKey(v),recentAIKey(structuredClone(v)));
});
test('new presentation preserves source and numeric validation and prompt-specific writing intent',()=>{
 for(const key of ['analysis_module','news_summary','discussion_summary','qa']){assert.match(PROMPTS[key],/肯定式/);assert.match(PROMPTS[key],/研究/);assert.match(PROMPTS[key],/sourceIds/);}
 assert.match(PROMPTS.discussion_summary,/情绪/);assert.match(PROMPTS.news_summary,/一篇新闻一条/);assert.match(PROMPTS.analysis_cost,/同类整体/);
 const raw={title:'事实',points:[{text:'**增长5%**，==查看公告==',sourceIds:['s']}]},materials=[{id:'s',text:'增长5%'}];assert.equal(validateAIResult(JSON.stringify(raw),'summary',materials).points[0].text,raw.points[0].text);assert.throws(()=>validateAIResult(JSON.stringify({...raw,points:[{text:'**增长99%**',sourceIds:['s']}]}),'summary',materials),/数字/);
});
