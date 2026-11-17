
'use strict';
(function(){
const root=document.getElementById('race18ui'),cv=document.getElementById('g19canvas'),c=cv.getContext('2d');if(!root||!c)return;
const LENGTH=16800,VIEW=1040,DEPTH=190;
const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));
let W=390,H=720,DPR=1,G=null,latest=null,lastRender=performance.now(),lastSnapAt=0,lastStage=0,localLane=null,localSide=1,pendingUntil=0,noticeUntil=0,speedUntil=0;
let rankSignature='',routeDots=new Map();
// Game time and view time are deliberately separate: snapshots must NEVER restart a running gait.
// A fixed 30fps cadence is more consistent on 60Hz iPads than switching 60↔30fps.
let motionPhase=0, frameMinMs=1000/30;
const spriteCache=new Map();

function stage(r){return Math.min(2,Math.floor((r.dist||0)/(LENGTH/3)))}
function factor(r){return Math.abs(r.energy||0)<=23?1:.7}
function safe(s){return String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}
function sendUI(state){
 const me=state.me,phase=state.phase,order=state.players;
 const myRank=me.rank||order.findIndex(p=>p.id===me.id)+1;
 document.getElementById('g19myrank').textContent=phase==='finished'?'완주':myRank+'위';
 // Rank rows are only rebuilt when the ranking itself changes.
 const signature=phase+':'+order.map(p=>p.id+':'+(p.rank||0)).join('|');
 if(signature!==rankSignature){
  rankSignature=signature;
  const ranks=document.getElementById('g19ranks');ranks.replaceChildren();
  if(phase!=='finished')for(const p of order){
   const row=document.createElement('div');row.className='rankrow'+(p.id===me.id?' me':'');
   const a=document.createElement('span');a.className='idx';a.textContent=(p.rank||'—')+'.';
   const b=document.createElement('span');b.className='nm';b.textContent=(p.id===me.id?'나 · ':'')+p.name;
   row.append(a,b);ranks.append(row);
  }
 }
 const balanced=Math.abs(me.energy)<=23,mode=balanced?'balanced':me.energy>0?'intake':'consume';
 const label=phase==='finished'||me.finished?'완주!':balanced?'균형 유지':mode==='intake'?'섭취가 더 많음':'소비가 더 많음';
 document.getElementById('g19status').dataset.mode=mode;
 document.getElementById('g19statusText').textContent=label;
 document.getElementById('g19statusExtra').textContent=phase==='finished'||me.finished?'결승선 통과':me.penalty>0?'일시 감속 중':balanced?'가속 중':'균형 조절 중';
 document.getElementById('g19needle').style.left=(50+me.energy*.4)+'%';
 // Reuse mini-map DOM markers instead of destroying and rebuilding them on every poll.
 const bar=document.getElementById('g19bar'),seen=new Set();
 for(let i=0;i<order.length;i++){
  const p=order[i];if(p.distance===null)continue;seen.add(p.id);
  let dot=routeDots.get(p.id);
  if(!dot){
   dot=document.createElement('span');dot.className='dot'+(p.id===me.id?' me':'');
   dot.style.setProperty('--cl',p.color);bar.append(dot);routeDots.set(p.id,dot);
  }
  dot.style.left=Math.max(0,Math.min(100,p.distance/LENGTH*100))+'%';
  dot.style.top=((i%3)-1)*4+'px';
 }
 for(const [id,dot] of routeDots){if(!seen.has(id)){dot.remove();routeDots.delete(id)}}
 document.getElementById('g19route').classList.toggle('hidden',phase==='finished');
 if(me.last_item&&me.last_item.index!==G.lastItem){
  G.lastItem=me.last_item.index;const n=me.last_item;
  document.getElementById('g19notice').textContent=n.name+(n.kind===2?' · 감속':balanced?' · 가속':' 선택');
  noticeUntil=performance.now()+1200;
 }
 if(stage(G)>lastStage&&phase==='running'){lastStage=stage(G);speedUntil=performance.now()+1800}
}
function reset(){G=null;latest=null;lastStage=0;localLane=null;pendingUntil=0;lastSnapAt=0;motionPhase=0;rankSignature='';routeDots.clear();document.getElementById('g19bar').replaceChildren();document.getElementById('g19notice').classList.remove('show');document.getElementById('g19speedNotice').classList.add('hidden')}
function sync(s){
 const me=s.me;latest=s;lastSnapAt=performance.now();
 if(!G){localSide=me.side;G={dist:me.distance,visualSpeed:me.speed||0,elapsed:s.elapsed,side:me.side,shirt:me.color,phase:'intro',energy:me.energy,penalty:me.penalty,rows:[],bots:[],lastItem:me.last_item?.index??-1}}
 const previousPhase=G.phase;
 G.distTarget=me.distance;G.speed=me.speed;G.energy=me.energy;G.penalty=me.penalty;G.shirt=me.color;G.phase=s.phase==='running'&&!me.finished?'run':me.finished?'wait':'intro';
 if(G.phase==='run'&&previousPhase!=='run'){
   G.visualSpeed=me.speed;
   G.dist=Math.max(G.dist,me.distance);
 }
 G.rows=s.rows.map(row=>({z:row.at,taken:false,options:row.items.map(it=>({type:it.kind,item:it.item}))}));
 // Keep opponents between network snapshots to prevent 380ms position jumps.
 const oldBots=new Map((G.bots||[]).map(b=>[b.key,b]));
 G.bots=s.players.filter(p=>p.id!==me.id&&p.distance!==null).map((p,i)=>{
  const b=oldBots.get(p.id)||{key:p.id,name:p.name,color:p.color,dist:p.distance,visualSpeed:p.speed||0,side:p.side,id:i};
  b.name=p.name;b.color=p.color;b.id=i;b.speed=p.speed;
  b.targetDist=p.distance;b.targetSide=p.side;b.finish=p.finished?1:null;
  return b;
 });
 if(localLane===null||performance.now()>pendingUntil)localLane=me.lane;
 sendUI(s);
}
function setLocalLane(lane){localLane=lane;pendingUntil=performance.now()+700}function getLane(){return localLane??(latest?.me.lane??1)}
function box(x,y,w,h,r,fill){if(w<=0||h<=0)return;c.fillStyle=fill;c.beginPath();if(c.roundRect)c.roundRect(x,y,w,h,r);else c.rect(x,y,w,h);c.fill();}
function poly(pts,col){c.fillStyle=col;c.beginPath();pts.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.closePath();c.fill();}
function line(x,y,X,Y,col,width){c.strokeStyle=col;c.lineWidth=width;c.lineCap='round';c.beginPath();c.moveTo(x,y);c.lineTo(X,Y);c.stroke();}
function txt(s,x,y,size=12,col='#28434d',weight=850){c.fillStyle=col;c.font=weight+' '+size+'px system-ui,-apple-system,"Apple SD Gothic Neo",sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(s,x,y);}
function proj(z){const q=Math.max(0,Math.min(1,1-z/VIEW)),d=Math.pow(q,1.36);return{x:W/2,y:H*(.17+.87*d),half:W*(.30+.17*d),d};}
function xAt(z,l){const p=proj(z);return p.x+(l-1)*p.half*2/3;}
function bg(){const v=c.createLinearGradient(0,0,0,H);v.addColorStop(0,'#8bc9d8');v.addColorStop(.18,'#b4e0bb');v.addColorStop(.181,'#86c792');v.addColorStop(1,'#67b67d');c.fillStyle=v;c.fillRect(0,0,W,H);poly([[0,H*.2],[W*.14,H*.14],[W*.35,H*.2],[W*.53,H*.145],[W*.73,H*.2],[W,H*.14],[W,H*.3],[0,H*.3]],'#8abdb0');poly([[0,H*.26],[W*.13,H*.2],[W*.32,H*.24],[W*.54,H*.2],[W*.72,H*.25],[W,H*.21],[W,H*.33],[0,H*.33]],'#78b98d');}
function road(){let f=proj(VIEW),n=proj(0);poly([[f.x-f.half-5,f.y],[f.x+f.half+5,f.y],[n.x+n.half+6,n.y],[n.x-n.half-6,n.y]],'#e4d3a1');poly([[f.x-f.half,f.y],[f.x+f.half,f.y],[n.x+n.half,n.y],[n.x-n.half,n.y]],'#425b66');for(let l=1;l<=2;l++){let start=Math.floor((G.dist-DEPTH)/150)*150;for(let d=start;d<G.dist+VIEW;d+=150){let z=DEPTH+d-G.dist,Z=z+66;if(z<2||Z>VIEW)continue;let p=proj(z),q=proj(Z),x=p.x+p.half*(l*2/3-1),X=q.x+q.half*(l*2/3-1),w=2+p.d*6;poly([[x-w/2,p.y],[x+w/2,p.y],[X+w*.27,q.y],[X-w*.27,q.y]],'#fdf5db');}}}
function tree(x,y,s,i){c.save();c.translate(x,y);c.scale(s,s);box(-3,-29,7,31,2,'#7d6751');c.fillStyle=i%2?'#357e5a':'#438e66';for(const [dx,dy,r] of [[-14,-36,15],[13,-34,15],[0,-48,20]]){c.beginPath();c.arc(dx,dy,r,0,2*Math.PI);c.fill();}c.restore();}
function bush(x,y,s,i){c.save();c.translate(x,y);c.scale(s,s);c.fillStyle=i%2?'#398b67':'#509e67';for(let dx of [-12,0,13]){c.beginPath();c.ellipse(dx,-6,15,10,0,0,2*Math.PI);c.fill();}c.restore();}
function trees(){const a=Math.floor((G.dist-DEPTH)/102)-1,b=Math.floor((G.dist+VIEW)/102)+1;for(let i=b;i>=a;i--){let z=DEPTH+i*102-G.dist;if(z<0||z>VIEW)continue;const p=proj(z),s=.17+p.d*1.25;c.save();c.globalAlpha=Math.max(0,Math.min(1,z/145,(VIEW-z)/110));for(const side of [-1,1]){let x=p.x+side*(p.half+20+p.d*37);if(i%4===1)bush(x,p.y,s,i);else tree(x,p.y,s,i+side+1);if(i%3===0)bush(x+side*23,p.y,s*.43,i);}c.restore();}}
function actor(x,y,s,col,still,alpha,offset=0){c.save();c.globalAlpha=alpha;c.translate(x,y);c.scale(s,s);const t=motionPhase+offset,stride=still?0:Math.sin(t),bob=still?0:Math.abs(Math.sin(t))*1.4;c.fillStyle='#153c4440';c.beginPath();c.ellipse(0,4,21,6,0,0,2*Math.PI);c.fill();c.translate(0,-bob);for(const side of [-1,1]){let q=side*stride,lift=Math.max(0,q),hipX=side*7,kneeX=side*(8+lift*1.1),kneeY=-15-6*lift,shoeX=side*(8+q*1.1),shoeY=1-9*lift;line(hipX,-29,kneeX,kneeY,'#334e60',7.8);line(kneeX,kneeY,shoeX,shoeY,'#243c4b',6.5);c.fillStyle='#f7f7ed';c.beginPath();c.ellipse(shoeX+side,shoeY+1.5,6,3.3,0,0,2*Math.PI);c.fill();}for(const side of [-1,1]){let q=-side*stride,sx=side*13,ex=side*(18+Math.max(0,q)),ey=-41+q*3,hx=side*(15+Math.max(0,q)*1.5),hy=-28-Math.max(0,q)*8+Math.max(0,-q)*4;line(sx,-52,ex,ey,col,8.2);line(ex,ey,hx,hy,'#e9b88f',6.2);c.fillStyle='#edbe99';c.beginPath();c.arc(hx,hy,3.8,0,2*Math.PI);c.fill();}poly([[-13,-51],[13,-51],[11,-27],[-11,-27]],col);box(-9,-29,18,5,2,'#f6faff45');c.fillStyle='#ecc39c';c.beginPath();c.arc(0,-66,12.5,0,2*Math.PI);c.fill();c.fillStyle='#5a493e';c.beginPath();c.arc(0,-69,12.5,Math.PI,2*Math.PI);c.lineTo(12,-68);c.quadraticCurveTo(9,-78,0,-80);c.quadraticCurveTo(-10,-80,-12,-68);c.closePath();c.fill();box(-12,-72,24,6,3,col);box(-11,-72,10,3,2,'#ffffff75');c.restore();}
function icon(item,x,y,d,type){const r=19+3*d;c.save();c.fillStyle=type===0?'#ffeccd':type===1?'#dcf6e8':'#ffe3df';c.beginPath();c.arc(x,y,r,0,2*Math.PI);c.fill();c.strokeStyle=type===0?'#efcd94':type===1?'#abd9c5':'#f4bfb2';c.lineWidth=1.2;c.stroke();if(item[2]==='STAIRS'){c.save();c.translate(x,y);const k=1.15+d*.1;c.scale(k,k);c.fillStyle='#5d93af';c.strokeStyle='#fff';c.lineWidth=1.7;c.beginPath();c.moveTo(-16,13);c.lineTo(-16,5);c.lineTo(-7,5);c.lineTo(-7,-2);c.lineTo(2,-2);c.lineTo(2,-10);c.lineTo(14,-10);c.lineTo(14,13);c.closePath();c.fill();c.stroke();c.restore();}else{c.font=(29+6*d)+'px "Apple Color Emoji","Segoe UI Emoji",system-ui';c.textAlign='center';c.textBaseline='middle';c.fillText(item[2],x,y+1);}if(item[4]){let dx=x+r*.9,dy=y-r*.7;c.fillStyle='white';c.beginPath();c.arc(dx,dy,9,0,2*Math.PI);c.fill();c.font='12.5px "Apple Color Emoji","Segoe UI Emoji",system-ui';c.textAlign='center';c.textBaseline='middle';c.fillText(item[4],dx,dy+.5);}c.restore();}
function cachedSprite(option){
 const item=option.item,kind=option.type,key=kind+'|'+item.join('|');
 if(spriteCache.has(key))return spriteCache.get(key);
 const cv=document.createElement('canvas');cv.width=240;cv.height=236;
 const a=cv.getContext('2d');a.scale(2,2);
 const fill=kind===0?'#fffdf7':kind===1?'#f8fffc':'#fff9f7';
 const edge=kind===0?'#e1ba77':kind===1?'#74bf9d':'#db9581';
 a.fillStyle=fill;a.strokeStyle=edge;a.lineWidth=2;
 a.beginPath();if(a.roundRect)a.roundRect(1,1,118,116,9);else a.rect(1,1,118,116);a.fill();a.stroke();
 a.fillStyle=kind===0?'#ffeccd':kind===1?'#dcf6e8':'#ffe3df';
 a.beginPath();a.arc(60,38,21,0,Math.PI*2);a.fill();
 a.strokeStyle=kind===0?'#efcd94':kind===1?'#abd9c5':'#f4bfb2';a.lineWidth=1.2;a.stroke();
 a.textAlign='center';a.textBaseline='middle';
 if(item[2]==='STAIRS'){
  a.save();a.translate(60,38);a.fillStyle='#5d93af';a.strokeStyle='#fff';a.lineWidth=1.7;
  a.beginPath();a.moveTo(-16,13);a.lineTo(-16,5);a.lineTo(-7,5);a.lineTo(-7,-2);
  a.lineTo(2,-2);a.lineTo(2,-10);a.lineTo(14,-10);a.lineTo(14,13);
  a.closePath();a.fill();a.stroke();a.restore();
 }else{
  a.font='33px "Apple Color Emoji","Segoe UI Emoji",system-ui';a.fillText(item[2],60,40);
 }
 if(item[4]){
  a.fillStyle='#fff';a.beginPath();a.arc(79,23,10,0,Math.PI*2);a.fill();
  a.font='14px "Apple Color Emoji","Segoe UI Emoji",system-ui';a.fillText(item[4],79,23);
 }
 a.fillStyle='#193942';a.font='950 18px system-ui,-apple-system,"Apple SD Gothic Neo",sans-serif';
 if(item[1]){a.fillText(item[0],60,86);a.fillText(item[1],60,104)}
 else a.fillText(item[0],60,98);
 if(spriteCache.size>=32){const oldest=spriteCache.keys().next().value;spriteCache.delete(oldest)}
 spriteCache.set(key,cv);return cv;
}
function cards(){
 // No text, emoji font rasterization, roundrect or icon geometry in the animation loop.
 // A sprite is generated once per card type and cheaply transformed by the GPU thereafter.
 for(const row of G.rows){
  const z=DEPTH+row.z-G.dist;
  if(z<DEPTH-20||z>VIEW-28)continue;
  const p=proj(z),w=Math.min(118,p.half*2/3-3),h=90+p.d*24;
  for(let j=0;j<3;j++){
   const option=row.options[j],x=xAt(z,j),y=p.y-h*.73;
   const sprite=cachedSprite(option);
   // Quantize transformed texture edges to device pixels to prevent subpixel shimmer.
   const x0=Math.round((x-w/2)*DPR)/DPR,y0=Math.round((y-h/2)*DPR)/DPR;
   const x1=Math.round((x+w/2)*DPR)/DPR,y1=Math.round((y+h/2)*DPR)/DPR;
   c.drawImage(sprite,x0,y0,Math.max(1/DPR,x1-x0),Math.max(1/DPR,y1-y0));
  }
 }
}
function gate(z,finish){if(z<0||z>VIEW-30)return;const p=proj(z),q=proj(Math.min(VIEW,z+38)),w=p.half*2/10;for(let i=0;i<10;i++)poly([[p.x-p.half+i*w,p.y],[p.x-p.half+(i+1)*w,p.y],[q.x-q.half+(i+1)*2*q.half/10,q.y],[q.x-q.half+i*2*q.half/10,q.y]],i%2?'#1a333d':'#fff8e8');if(!finish)return;const h=p.half*.96,s=.3+p.d,y=p.y-125*s;for(const side of [-1,1])box(p.x+side*h-5*s,y,10*s,p.y-y,2,'#f0f3e8');box(p.x-h,y-29*s,2*h,32*s,4,'#1a3944');txt('FINISH',p.x,y-12*s,Math.max(13,23*s),'#fff',950);}
function draw(){if(!G)return;c.clearRect(0,0,W,H);bg();road();trees();const start=DEPTH-G.dist;if(start>0&&start<VIEW-40)gate(start,false);for(const b of G.bots){const z=DEPTH+b.dist-G.dist;if(z<20||z>VIEW-60)continue;const p=proj(z),formation=[.12,.44,.76,1.24,1.56,1.88][b.id%6],blend=Math.min(1,G.elapsed/1.8),renderSide=formation*(1-blend)+b.side*blend,x=xAt(z,renderSide),s=.23+p.d*.60;actor(x,p.y,s,b.color,b.finish!==null,.43,b.id*1.3);box(x-28,p.y-s*104-22,56,20,5,'#1d4047ca');txt(b.name,x,p.y-s*104-12,11,'#fff')}cards();const finish=DEPTH+LENGTH-G.dist;if(finish<=VIEW-30)gate(finish,true);const p=proj(DEPTH);if(G.phase==='run'&&factor(G)===1&&G.penalty<=0){c.fillStyle='#c9ffe722';c.beginPath();c.ellipse(xAt(DEPTH,G.side),p.y-48,40,70,0,0,2*Math.PI);c.fill()}actor(xAt(DEPTH,G.side),p.y,.87,G.shirt,G.phase!=='run',1)}
function resize(){
 const r=cv.getBoundingClientRect();
 // Hidden game: do not resize to arbitrary fallback dimensions.
 if(r.width<1||r.height<1)return;
 const w=r.width,h=r.height,dpr=Math.min(1.3,window.devicePixelRatio||1,Math.sqrt(425000/(w*h)));
 const pw=Math.round(w*dpr),ph=Math.round(h*dpr);
 // Canvas width/height writes reallocate the backing store and produce a visible hiccup.
 if(cv.width===pw&&cv.height===ph&&Math.abs(W-w)<.5&&Math.abs(H-h)<.5)return;
 W=w;H=h;DPR=dpr;
 cv.width=pw;cv.height=ph;c.setTransform(DPR,0,0,DPR,0,0);
 draw();
}
function frame(now){
 requestAnimationFrame(frame);
 if(!G||root.classList.contains('hidden')||document.hidden){lastRender=now;return}
 const elapsed=now-lastRender;
 if(elapsed<frameMinMs-1.5)return;
 const dt=Math.min(.065,Math.max(0,elapsed/1000));lastRender=now;
 if(G.phase==='run'){
  G.elapsed+=dt;
  motionPhase+=dt*(12.5+stage(G)*1.2);
  const age=Math.min(1.5,Math.max(0,(now-lastSnapAt)/1000));
  const target=Math.min(LENGTH-.01,G.distTarget+G.speed*age);
  // Camera velocity is eased continuously: network snapshots must not cause visible jolts.
  // Keep the camera near the authoritative server while avoiding sudden speed steps.
  const error=target-G.dist;
  const bound=Math.max(20,G.speed*.22);
  const desiredSpeed=Math.max(0,G.speed+clamp(error*1.15,-bound,bound));
  if(Math.abs(error)>850){G.dist=target;G.visualSpeed=G.speed;} // recovery after long sleep
  else{
   G.visualSpeed+=(desiredSpeed-G.visualSpeed)*Math.min(1,dt*4.2);
   G.dist=Math.min(LENGTH-.01,G.dist+Math.max(0,G.visualSpeed)*dt);
  }
  localSide+=((localLane??latest?.me.lane??1)-localSide)*Math.min(1,dt*12);
  G.side=localSide;
  for(const b of G.bots){
   const t=Math.min(LENGTH,b.finish?b.targetDist:b.targetDist+b.speed*age);
   const error=t-b.dist,limit=Math.max(20,b.speed*.25);
   const goal=b.finish?0:Math.max(0,b.speed+clamp(error*1.15,-limit,limit));
   if(Math.abs(error)>850){b.dist=t;b.visualSpeed=b.speed;}
   else{
    b.visualSpeed+=(goal-b.visualSpeed)*Math.min(1,dt*4.2);
    b.dist=Math.min(LENGTH,b.dist+Math.max(0,b.visualSpeed)*dt);
    if(b.finish&&Math.abs(t-b.dist)<1){b.dist=t;b.visualSpeed=0;}
   }
   b.side+=(b.targetSide-b.side)*Math.min(1,dt*12);
  }
 }else{G.dist=G.distTarget;G.side=latest?.me.side??G.side}
 draw();
 const message=document.getElementById('g19notice');
 message.classList.toggle('show',now<noticeUntil&&G.phase==='run');
 document.getElementById('g19speedNotice').classList.toggle('hidden',!(now<speedUntil&&G.phase==='run'));
}
window.RaceGame={reset,sync,resize,setLocalLane,getLane,diagnostics:()=>({DPR,canvasWidth:cv.width,canvasHeight:cv.height,frameMinMs,cacheSize:spriteCache.size,dist:G?.dist,visualSpeed:G?.visualSpeed,serverTarget:G?.distTarget,visibleItems:G?.rows.filter(row=>{const z=DEPTH+row.z-(G?.dist||0);return z>=DEPTH-20&&z<=VIEW-28}).length,motionPhase,phase:G?.phase})};
window.addEventListener('resize',resize);
// Mobile address bar/orientation can change the available height without a window resize event.
if('ResizeObserver' in window){new ResizeObserver(()=>resize()).observe(document.getElementById('g19stage'))}
resize();requestAnimationFrame(frame);
})();
