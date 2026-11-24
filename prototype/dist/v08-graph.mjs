import {graphSubset} from './v08-model.mjs';
const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createGraph(root,api){
 let m,focus='portfolio',z=1,x=0,y=0,pan=null,pts=new Map(),pinch=null,gestureScale=1,anim;
 root.innerHTML='<div class="g-viewport" tabindex="0" aria-label="关联图谱"><div class="g-world"><svg class="g-lines" width="850" height="660" aria-hidden="true"></svg><div class="g-nodes"></div></div></div>';
 const view=root.querySelector('.g-viewport'),world=root.querySelector('.g-world'),nodes=root.querySelector('.g-nodes'),svg=root.querySelector('svg');
 function transform(smooth=true){world.style.transition=smooth?'transform 450ms cubic-bezier(.2,.7,.2,1)':'none';world.style.transform=`translate(${x}px,${y}px) scale(${z})`;}
 function fit(){z=Math.max(.25,Math.min(1,view.clientWidth/850,(view.clientHeight||610)/660));x=(view.clientWidth-850*z)/2;y=((view.clientHeight||610)-660*z)/2;transform();}
 function zoom(next,cx=view.clientWidth/2,cy=view.clientHeight/2){const old=z;z=Math.max(.25,Math.min(2.5,next));x=cx-(cx-x)*z/old;y=cy-(cy-y)*z/old;transform(false);}
 function update(model,next=focus){m=model;focus=next;const group=graphSubset(m,focus),arr=[],edges=[];
  if(group.kind==='portfolio'){
   arr.push({id:'portfolio',name:'我的组合',sub:m.total?'¥'+m.total.toLocaleString('zh-CN'):'',kind:'portfolio',x:10,y:278});
   group.funds.forEach((f,i)=>{arr.push({id:f.id,name:f.name,sub:f.share.toFixed(2)+'%',kind:'fund',x:300,y:35+i*(520/Math.max(1,group.funds.length-1))});edges.push(['portfolio',f.id]);});
   group.companies.forEach((c,i)=>{arr.push({id:c.id,name:c.name,sub:c.share.toFixed(2)+'%',kind:'company',x:625,y:10+i*62});for(const f of group.funds)if(c.paths.some(p=>p.fundId===f.id))edges.push([f.id,c.id]);});
  }else if(group.kind==='fund'&&group.root){const f=group.root;arr.push({id:f.id,name:f.name,sub:f.share.toFixed(2)+'%',kind:'fund',x:110,y:278});group.companies.forEach((c,i)=>{arr.push({id:c.id,name:c.name,sub:(f.holdings.find(r=>r.code===c.code)?.weight??0).toFixed(2)+'%',kind:'company',x:550,y:10+i*62});edges.push([f.id,c.id]);});
  }else if(group.root){const c=group.root;arr.push({id:c.id,name:c.name,sub:c.share.toFixed(2)+'%',kind:'company',x:550,y:278});group.funds.slice(0,8).forEach((f,i)=>{arr.push({id:f.id,name:f.name,sub:f.share.toFixed(2)+'%',kind:'fund',x:110,y:25+i*70});edges.push([f.id,c.id]);});}
  const byId=new Map(arr.map(n=>[n.id,n]));
  // Reuse existing cards, so changing focus animates node positions instead of replacing the graph.
  for(const el of nodes.children)if(!byId.has(el.dataset.graphId)){el.classList.add('leaving');setTimeout(()=>{if(el.classList.contains('leaving'))el.remove();},300);}
  for(const n of arr){let el=[...nodes.children].find(el=>el.dataset.graphId===n.id);if(!el){el=document.createElement('article');el.dataset.graphId=n.id;el.className='g-node '+n.kind;el.style.opacity='0';nodes.append(el);requestAnimationFrame(()=>el.style.opacity='1');}el.classList.remove('leaving');el.style.left=n.x+'px';el.style.top=n.y+'px';el.innerHTML=`<button class="g-focus" data-g-focus="${h(n.id)}"><strong>${h(n.name)}</strong><small>${h(n.sub)}</small></button><button class="g-detail" data-g-detail="${h(n.id)}" aria-label="查看${h(n.name)}详情">↗</button>`;}
  clearTimeout(anim);anim=setTimeout(()=>{svg.innerHTML=edges.map(([a,b])=>{a=byId.get(a);b=byId.get(b);return `<path d="M${a.x+190},${a.y+30} C${(a.x+b.x+190)/2},${a.y+30} ${(a.x+b.x+190)/2},${b.y+30} ${b.x},${b.y+30}"/>`;}).join('');},20);
  fit();
 }
 root.addEventListener('click',e=>{const f=e.target.closest('[data-g-focus]'),d=e.target.closest('[data-g-detail]');if(d)api.details(d.dataset.gDetail);else if(f){api.focus(f.dataset.gFocus);update(m,f.dataset.gFocus);}});
 view.addEventListener('wheel',e=>{if(e.ctrlKey||e.metaKey){e.preventDefault();const r=view.getBoundingClientRect();zoom(z*Math.exp(-e.deltaY*.008),e.clientX-r.left,e.clientY-r.top);}else{e.preventDefault();x-=e.deltaX;y-=e.deltaY;transform(false);}},{passive:false});
 view.addEventListener('gesturestart',e=>{e.preventDefault();gestureScale=z;},{passive:false});view.addEventListener('gesturechange',e=>{e.preventDefault();zoom(gestureScale*e.scale);},{passive:false});
 view.addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;view.setPointerCapture(e.pointerId);pts.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pts.size===2){const [a,b]=[...pts.values()];pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),z};}else pan={x:e.clientX,y:e.clientY,baseX:x,baseY:y};});
 view.addEventListener('pointermove',e=>{if(!pts.has(e.pointerId))return;pts.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pts.size===2&&pinch){const[a,b]=[...pts.values()],r=view.getBoundingClientRect();zoom(pinch.z*Math.hypot(a.x-b.x,a.y-b.y)/pinch.distance,(a.x+b.x)/2-r.left,(a.y+b.y)/2-r.top);}else if(pan){x=pan.baseX+e.clientX-pan.x;y=pan.baseY+e.clientY-pan.y;transform(false);}});
 const stop=e=>{pts.delete(e.pointerId);pan=null;pinch=null;};view.addEventListener('pointerup',stop);view.addEventListener('pointercancel',stop);
 view.addEventListener('keydown',e=>{if(e.key==='+'||e.key==='='){e.preventDefault();zoom(z*1.15);}if(e.key==='-'){e.preventDefault();zoom(z/1.15);}if(e.key==='0')fit();});
 return {update,fit,zoom:factor=>zoom(z*factor)};
}
