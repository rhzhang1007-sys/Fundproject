export function discussionIds(model,selected=''){
 if(selected.startsWith('stock'))return new Set([selected]);
 const funds=selected?model.funds.filter(f=>f.id===selected):model.funds;
 return new Set(funds.flatMap(f=>[f.id,...(f.holdings||[]).map(r=>'stock'+r.code)]));
}
export function discussionRows(records,ids,day,limit=30){
 const score=r=>(r.content?1000:0)+(r.comments?.length?100:0);
 return records.filter(r=>ids.has(r.objectId)&&r.date===day).sort((a,b)=>score(b)-score(a)||(b.publishedAt||'').localeCompare(a.publishedAt||'')).slice(0,limit);
}
export function readableDiscussionDay(records,ids,current,today){
 const rows=records.filter(r=>ids.has(r.objectId)&&r.content&&r.date<=today&&(Date.parse(today)-Date.parse(r.date))/86400000<=30);
 const withComments=rows.filter(r=>r.comments?.length);return (withComments.length?withComments:rows).map(r=>r.date).sort().at(-1)||current;
}
