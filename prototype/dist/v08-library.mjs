import {safeUrl} from './core.mjs';
import {strongText} from './v15-ui.mjs';
import {cleanEntry, splitTags, putImage, getImage, imageDataURL, importImage, deleteImage} from './library.mjs';
const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=v=>!v?'':String(v).includes('T')?new Date(v).toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}):String(v).slice(0,10);
const link=(url,label='原文')=>safeUrl(url)?`<a class="v7-link" href="${h(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${h(label)}</a>`:'';
const action=(name,label,id='',cls='v7-btn')=>`<button type="button" class="${cls}" data-r="${name}" data-id="${h(id)}">${h(label)}</button>`;
const options=(items,value)=>items.map(([key,label])=>`<option value="${h(key)}" ${key===value?'selected':''}>${h(label)}</option>`).join('');
const read=(k,f)=>{try{return JSON.parse(localStorage.getItem(k))??f;}catch{return f;}};
export function createLibrary(api){
 let entries=[],spaces=[],tags=[],urls=[],pending=[],editing=null,favorite=null;
 const chosen=new Set();
 const f={folder:'全部',tag:'全部',query:'',kind:'all'};
 const save=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));return true;}catch{api.toast('保存失败，请导出备份');return false;}};
 function reloadLibrary(){
  const notes=read('zhijian-notebook-v1',[]),oldFavs=read('zhijian-v07-favs',[]);
  entries=(Array.isArray(notes)?notes:[]).map(cleanEntry).filter(Boolean);
  const removed=read('zhijian-v08-removed-favs',[]);
  for(const item of Array.isArray(oldFavs)?oldFavs:[])if(!removed.includes('legacy-'+item.id)&&!entries.some(n=>n.referenceId==='v07:'+item.id))entries.push(cleanEntry({id:'legacy-'+item.id,referenceId:'v07:'+item.id,title:item.title,url:item.url,excerpt:item.summary,note:item.note,folder:item.folder||'未分类',createdAt:item.addedAt,updatedAt:item.addedAt}));
  spaces=[...new Set(['未分类',...(read('zhijian-spaces-v2',[])||[]),...entries.map(n=>n.folder)])];
  tags=[...new Set([...(read('zhijian-tags-v2',[])||[]),...entries.flatMap(n=>splitTags(n.tags))])];
 }
 function collect(value){
  reloadLibrary();favorite=value;
  api.dialog('收藏',`<form id="r-favorite-form"><h3>${h(value.title)}</h3><label class="v7-field"><span>分类</span><select name="folder">${options(spaces.map(s=>[s,s]),spaces.includes(f.folder)?f.folder:'未分类')}</select></label><label class="v7-field"><span>或新建分类</span><input name="newFolder" maxlength="80" placeholder="分类名称"></label><button class="v7-btn primary" type="submit">保存收藏</button></form>`);
 }
  function notebookView() {
    reloadLibrary();
    const rows=entries.filter(n=>(f.kind!=='ai'||n.aiResult)&&(f.folder==='全部'||n.folder===f.folder)&&(f.tag==='全部'||splitTags(n.tags).includes(f.tag))&&[n.title,n.excerpt,n.note,n.tags].join(' ').includes(f.query)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
    return `<div class="v7-toolbar">${action('all-entries','全部内容','',f.kind==='all'?'v7-btn primary':'v7-btn')}${action('ai-entries','AI分析 · '+entries.filter(n=>n.aiResult).length,'',f.kind==='ai'?'v7-btn primary':'v7-btn')}<label>搜索信息库<input data-r-filter="query" value="${h(f.query)}" placeholder="标题、摘录、笔记或标签"></label>${action('add-note','添加内容')}${action('export-notes','导出文字与图片')}${action('import-notes','导入信息库')}<input id="r-notebook-file" type="file" accept="application/json,.json" hidden></div>
      <div class="v7-library"><aside><h3>分类</h3>${['全部',...spaces].map(s=>action('folder',s,s,f.folder===s?'v7-btn primary':'v7-btn')).join('')}${action('new-space','新建分类')}<h3>分类标签</h3>${['全部',...tags].map(t=>action('tag',t==='全部'?'全部标签':'# '+t,t,f.tag===t?'v7-btn primary':'v7-btn')).join('')}${action('new-tag','新建标签')}</aside><div>
      <p class="v7-cap">${rows.length} 条收藏</p>
      ${rows.map(n=>`<article class="v7-card"><label><input type="checkbox" data-library-pick="${h(n.id)}" ${chosen.has(n.id)?'checked':''}>选择分析</label><p class="v7-cap">${h(n.folder)} · ${date(n.updatedAt)}</p><h2>${h(n.title)}</h2>${n.excerpt?`<p class="v7-comment">${n.aiResult?strongText(n.aiResult.result.overview?.text||n.excerpt):h(n.excerpt)}</p>`:''}
        ${n.images.length?`<div class="v7-images">${n.images.map(id=>`<button data-r="image" data-id="${h(id)}"><img data-r-image="${h(id)}" alt="收藏图片"></button>`).join('')}</div>`:''}
        ${n.analysisContext?`<details><summary>保存时的分析依据</summary><p>${h(n.analysisContext.objectName)} · ${h(n.analysisContext.recordLabel)}<br>报告日：${h(n.analysisContext.reportDates?.join(' / ')||'未保存')}<br>方法：${h(n.analysisContext.methodVersion||'未保存')}<br>资料版本：${h(n.analysisContext.dataVersion||'未保存')}</p></details>`:''}
        ${n.note?`<div class="v7-note"><strong>我的笔记</strong><p class="v7-comment">${h(n.note)}</p></div>`:''}<p class="v7-cap">${splitTags(n.tags).map(t=>'# '+h(t)).join(' ')}</p>
        <div class="v7-actions">${link(n.url,'原始链接')}${n.aiResult?action('open-ai','查看分析',n.id):''}${action('edit-note','编辑',n.id)}${action('delete-note','移除',n.id)}</div></article>`).join('')||'<div class="v7-empty">暂无收藏</div>'}</div></div>`;
  }
  function editor(value={}) {
    editing=value;pending=[];
    api.dialog(value.id?'编辑内容':'添加内容',`<form id="r-note-form"><label class="v7-field"><span>标题</span><input name="title" required maxlength="180" value="${h(value.title)}"></label>
      <label class="v7-field"><span>分类</span><select name="folder">${options(spaces.map(s=>[s,s]),value.folder||(f.folder==='全部'?'新能源':f.folder))}</select></label>
      <label class="v7-field"><span>分类标签（用逗号分隔）</span><input name="tags" value="${h(value.tags)}"></label>
      <label class="v7-field"><span>原始链接</span><input name="url" type="url" value="${h(value.url)}" placeholder="https://"></label>
      <label class="v7-field"><span>文字 / 摘录</span><textarea name="excerpt" rows="5" maxlength="20000">${h(value.excerpt)}</textarea></label>
      <label class="v7-field"><span>我的笔记</span><textarea name="note" rows="4" maxlength="20000">${h(value.note)}</textarea></label>
      <div id="r-editor-images" class="v7-images">${(value.images||[]).map(id=>`<div data-r-existing="${h(id)}"><img data-r-image="${h(id)}" alt="已保存图片">${action('remove-image','移除图片',id)}</div>`).join('')}</div>
      <label class="v7-field v7-upload"><span>添加、拖入或粘贴图片，每张最多 10MB，每条最多 12 张</span><input id="r-images" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple></label>
      <button class="v7-btn primary" type="submit">保存内容</button></form>`);
    hydrate();
  }
  async function hydrate() {
    for(const el of document.querySelectorAll('[data-r-image]')) {
      try {const blob=await getImage(el.dataset.rImage);if(blob&&el.isConnected){const url=URL.createObjectURL(blob);urls.push(url);el.src=url;}}catch {el.alt='图片读取失败，原记录仍保留';}
    }
  }
  function addFiles(files) {
    for(const file of files) {
      if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)||file.size>10*1024*1024){api.toast('仅支持不超过 10MB 的 PNG、JPG、WebP 或 GIF 图片。');continue;}
      const box=document.querySelector('#r-editor-images');
      if(box.children.length>=12){api.toast('每条内容最多 12 张图片。');break;}
      const id=crypto.randomUUID(),url=URL.createObjectURL(file);urls.push(url);pending.push({id,file});
      box.insertAdjacentHTML('beforeend',`<div data-r-pending="${id}"><img src="${url}" alt="待保存图片">${action('remove-pending','移除图片',id)}</div>`);
    }
  }
  async function saveNote(form) {
    const created=[],button=form.querySelector('[type=submit]');button.disabled=true;
    try {
      const values=Object.fromEntries(new FormData(form));if(values.url&&!safeUrl(values.url))throw Error('链接须以 http 或 https 开头。');
      for(const p of pending)created.push(await putImage(p.file));
      const kept=[...form.querySelectorAll('[data-r-existing]')].map(el=>el.dataset.rExisting);
      const entry=cleanEntry({...editing,...values,id:editing.id||crypto.randomUUID(),images:[...kept,...created],updatedAt:new Date().toISOString()});
      const next=entries.some(n=>n.id===entry.id)?entries.map(n=>n.id===entry.id?entry:n):[...entries,entry];
      if(!save('zhijian-notebook-v1',next))throw Error('浏览器存储不足，内容未保存。');
      entries=next;tags=[...new Set([...tags,...splitTags(entry.tags)])];save('zhijian-tags-v2',tags);f.folder=entry.folder;f.tag='全部';f.query='';
      api.close();api.showNotebook();api.toast('已保存内容与图片。');
    }catch(err){for(const id of created)await deleteImage(id).catch(()=>{});api.toast(err.message);}finally{button.disabled=false;}
  }
  const download=(name,data)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  async function exportNotes() {
    try {const list=[];for(const entry of entries){const attachments=[];for(const id of entry.images){const data=await imageDataURL(id);if(!data)throw Error('有图片无法读取，请先检查原记录。');attachments.push(data);}list.push({...entry,attachments});}download('持仓知见-信息库备份.json',{format:'zhijian-notebook-v2',spaces,tags,entries:list});api.toast('已导出，包含图片。');}catch(err){api.toast('导出失败：'+err.message);}
  }
  async function importNotes(file) {
    const imported=[];
    try {
      if(file.size>100*1024*1024)throw Error('备份最多 100MB。');
      const data=JSON.parse(await file.text());if(!['zhijian-notebook-v1','zhijian-notebook-v2'].includes(data.format)||!Array.isArray(data.entries)||data.entries.length>1000||data.spaces&&!Array.isArray(data.spaces)||data.tags&&!Array.isArray(data.tags))throw Error('信息库备份格式无效。');
      const map=new Map(entries.map(n=>[n.id,n]));
      for(const raw of data.entries){const entry=cleanEntry(raw);if(!entry)throw Error('内容格式无效。');if(map.has(entry.id))continue;entry.images=[];for(const dataURL of (raw.attachments||[]).slice(0,12)){const id=await importImage(dataURL);imported.push(id);entry.images.push(id);}map.set(entry.id,entry);}
      if(!save('zhijian-notebook-v1',[...map.values()]))throw Error('保存失败。');
      spaces=[...new Set([...spaces,...(data.spaces||[]),...[...map.values()].map(n=>n.folder)])].filter(x=>typeof x==='string');
      tags=[...new Set([...tags,...(data.tags||[]),...[...map.values()].flatMap(n=>splitTags(n.tags))])].filter(x=>typeof x==='string');
      save('zhijian-spaces-v2',spaces);save('zhijian-tags-v2',tags);api.render();api.toast('已合并信息库备份。');
    }catch(err){for(const id of imported)await deleteImage(id).catch(()=>{});api.toast('导入失败：'+err.message);}
  }

 async function click(ev){
  const el=ev.target.closest('[data-r]');if(!el)return;ev.preventDefault();const id=el.dataset.id,act=el.dataset.r;
  if(act==='ai-entries'||act==='all-entries'){f.kind=act==='ai-entries'?'ai':'all';f.folder='全部';f.tag='全部';f.query='';return api.render();}
  if(act==='folder'||act==='tag'){f[act]=id;return api.render();}
  if(act==='new-space'||act==='new-tag')return api.dialog(act==='new-space'?'新建分类':'新建标签',`<form id="r-name-form" data-kind="${act}"><label class="v7-field"><span>名称</span><input name="name" required maxlength="80"></label><button class="v7-btn primary">保存</button></form>`);
  if(act==='add-note')return editor();if(act==='edit-note')return editor(entries.find(n=>n.id===id));
  if(act==='open-ai'){const n=entries.find(n=>n.id===id);if(n?.aiResult)api.showAI(n.aiResult);return;}
  if(act==='delete-note'){if(id.startsWith('legacy-'))save('zhijian-v08-removed-favs',[...read('zhijian-v08-removed-favs',[]),id]);if(save('zhijian-notebook-v1',entries.filter(n=>n.id!==id)))api.render();return;}
  if(act==='remove-image'){el.closest('[data-r-existing]').remove();return;}
  if(act==='remove-pending'){pending=pending.filter(p=>p.id!==id);el.closest('[data-r-pending]').remove();return;}
  if(act==='image'){api.dialog('图片',`<img class="v7-full-image" data-r-image="${h(id)}" alt="收藏图片">`);return hydrate();}
  if(act==='export-notes')return exportNotes();if(act==='import-notes')document.querySelector('#r-notebook-file').click();
 }
 document.addEventListener('click',e=>{click(e).catch(err=>api.toast(err.message));});
 document.addEventListener('change',e=>{if(e.target.dataset.libraryPick){e.target.checked?chosen.add(e.target.dataset.libraryPick):chosen.delete(e.target.dataset.libraryPick);return;}const key=e.target.dataset.rFilter;if(key){f[key]=e.target.value;api.render();}if(e.target.id==='r-images')addFiles(e.target.files);if(e.target.id==='r-notebook-file'&&e.target.files[0])importNotes(e.target.files[0]);});
 document.addEventListener('submit',e=>{
  if(e.target.id==='r-note-form'){e.preventDefault();saveNote(e.target);}
  if(e.target.id==='r-name-form'){e.preventDefault();const name=new FormData(e.target).get('name').trim();if(!name)return;const space=e.target.dataset.kind==='new-space',list=space?spaces:tags;if(!list.includes(name))list.push(name);if(save(space?'zhijian-spaces-v2':'zhijian-tags-v2',list)){if(space)f.folder=name;else f.tag=name;api.close();api.showNotebook();}}
  if(e.target.id==='r-favorite-form'){e.preventDefault();const data=Object.fromEntries(new FormData(e.target)),folder=data.newFolder.trim()||data.folder;const existing=entries.find(n=>n.referenceId&&n.referenceId===favorite.referenceId);const entry=cleanEntry({...existing,...favorite,folder,updatedAt:new Date().toISOString()});const next=existing?entries.map(n=>n.id===existing.id?entry:n):[...entries,entry];if(save('zhijian-notebook-v1',next)){if(!spaces.includes(folder))spaces.push(folder);save('zhijian-spaces-v2',spaces);api.close();api.toast('已收藏到 '+folder);if(api.isNotebook())api.render();}}
 });
 document.addEventListener('paste',e=>{if(!document.querySelector('#r-note-form'))return;const files=[...(e.clipboardData?.files||[])];if(files.some(x=>x.type.startsWith('image/'))){e.preventDefault();addFiles(files);}});
 document.addEventListener('dragover',e=>{if(document.querySelector('#r-note-form'))e.preventDefault();});document.addEventListener('drop',e=>{if(document.querySelector('#r-note-form')){e.preventDefault();addFiles([...e.dataTransfer.files]);}});
 function afterRender(){for(const u of urls)URL.revokeObjectURL(u);urls=[];if(api.isNotebook())hydrate();}
 function saveAI(value,job){
  reloadLibrary();const existing=entries.find(n=>n.referenceId==='ai:'+job.id),id=existing?.id||crypto.randomUUID();
  Object.assign(value,{libraryEntryId:id,scope:job.scope,createdAt:job.createdAt});
  const entry=cleanEntry({...existing,id,title:value.result.title,referenceId:'ai:'+job.id,folder:existing?.folder||'AI解读',excerpt:[value.result.overview?.text,...value.result.points.map(p=>(p.heading?p.heading+'：':'')+p.text)].filter(Boolean).join('\n\n'),aiResult:value,updatedAt:new Date().toISOString()});
  const next=existing?entries.map(n=>n.id===entry.id?entry:n):[...entries,entry];if(!save('zhijian-notebook-v1',next))return false;entries=next;if(!spaces.includes('AI解读'))spaces.push('AI解读');save('zhijian-spaces-v2',spaces);return true;
 }
 function aiEntry(id){reloadLibrary();return entries.find(n=>n.id===id&&n.aiResult);}
 function latestAI(scope){reloadLibrary();return entries.filter(n=>n.aiResult?.scope===scope).sort((a,b)=>(a.aiResult.createdAt||a.createdAt).localeCompare(b.aiResult.createdAt||b.createdAt)).at(-1);}
 function saveAINote(id,note){reloadLibrary();const entry=aiEntry(id);if(!entry)return false;const next=entries.map(n=>n.id===id?cleanEntry({...n,note,updatedAt:new Date().toISOString()}):n);if(!save('zhijian-notebook-v1',next))return false;entries=next;return true;}
 function showAIEntries(){f.kind='ai';f.folder='全部';f.tag='全部';f.query='';api.showNotebook();}
 reloadLibrary();return {saveAI,aiEntry,latestAI,saveAINote,showAIEntries,notebookView,afterRender,collect,edit:editor,analysisMaterials:()=>{reloadLibrary();return entries.filter(n=>chosen.has(n.id)).slice(0,29).map(n=>({id:'private-'+n.id,text:[n.title,n.excerpt,n.note].filter(Boolean).join('\n\n'),url:safeUrl(n.url),date:date(n.updatedAt)}));},materials:()=>{reloadLibrary();return entries;}};
}
