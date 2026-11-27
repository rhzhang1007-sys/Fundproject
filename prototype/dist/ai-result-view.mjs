import {safeUrl} from './core.mjs';
import {strongText} from './v15-ui.mjs';
import {AI_FOOTNOTE} from './ai-writing.mjs';
const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(act,label,id='')=>`<button type="button" class="v7-btn" data-act="${act}" data-id="${h(id)}">${label}</button>`;
export function aiResultBody(value){
 const {result,materials=[]}=value;
 const refs=p=>`<div class="v15-ai-refs">${[...new Set(p.sourceIds||[])].map(id=>{const m=materials.find(x=>x.id===id);if(!m)return '';const url=safeUrl(m.url);return `${url?`<a class="v7-link" href="${h(url)}" target="_blank" rel="noopener noreferrer">${h(m.date||'原文')}</a>`:''}${button('ai-evidence','分析依据',id)}`;}).join('')}</div>`;
 const q=result.quality,notice=q?.kind==='source-excerpts'?'<p class="v8-muted">原文要点</p>':q&&(q.numberWarnings||q.unmappedBlocks)?`<details class="v20-source-review"><summary>来源对照</summary><p>${q.numberWarnings?'已保留解读，并将未对应原文的数值标为待对照。':''}${q.unmappedBlocks?'未逐条标注的段落仍可结合本次材料阅读。':''}</p></details>`:'';
 return `<div class="v15-ai-result">${result.overview?`<div class="v15-ai-overview"><h3>${value.task==='news_summary'?'整体摘要':'整体解读'}</h3><p>${strongText(result.overview.text)}</p>${refs(result.overview)}</div>`:''}${result.points.map((p,i)=>`<section class="${/关注|下一步|建议|后续/.test(p.heading||'')?'v24-ai-action':''}"><h3>${h(p.heading||'要点 '+String.fromCharCode(65+i))}</h3><p>${strongText(p.text)}</p>${refs(p)}</section>`).join('')}</div>${notice}${q?.unmappedBlocks?`<details><summary>本次材料</summary>${materials.map(m=>button('ai-evidence',m.date||'查看原文材料',m.id)).join('')}</details>`:''}${q?.kind==='source-excerpts'?'':`<small class="v24-ai-footnote">${h(AI_FOOTNOTE)}</small>`}`;
}
export function recentAIResult(value,entry){
 if(!value)return '';
 const stamp=value.createdAt||entry?.createdAt;
 return `<section class="v18-recent-ai" aria-label="最近一次AI分析"><button type="button" class="v24-ai-dismiss" data-act="dismiss-recent-ai" aria-label="关闭最近一次分析" title="关闭最近一次分析"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button><div class="v8-sectionhead"><div><small class="v8-muted">最近一次分析${stamp?' · '+h(new Date(stamp).toLocaleString('zh-CN',{hour12:false})):''}</small><h3>${h(value.result.title)}</h3></div>${button('open-recent-ai','查看完整分析')}</div>${value.result.overview?`<p class="v18-ai-preview">${strongText(value.result.overview.text)}</p>`:''}<details data-ai-expanded><summary>展开分析与笔记</summary>${aiResultBody(value)}${entry?`<form class="v18-ai-note" data-ai-note-form="${h(entry.id)}"><label class="v7-field"><span>我的笔记</span><textarea name="note" rows="3" maxlength="20000" placeholder="记下你的理解或想继续追问的问题">${h(entry.note)}</textarea></label><button class="v7-btn primary">保存笔记</button></form>`:''}</details><div class="v7-actions">${button('organize-recent-ai','收藏与分类')}${button('ai-library','在资料库查看')}${button('copy-recent-ai','复制结果')}</div></section>`;
}
export const recentAIKey=value=>String(value?.libraryEntryId||value?.jobId||value?.createdAt||value?.result?.title||'');
