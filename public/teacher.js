'use strict';
let room=null,hostToken=null,pollActive=false;
function status(message,good){$('connection').textContent=message;$('connection').style.background=good?'#e4f4ec':'#feeae5';$('connection').style.color=good?'#15715c':'#a44835'}
function roomUI(){
 setHidden('createPanel',!!room);setHidden('dashboard',!room);
 if(!room)return;
 $('roomCode').textContent=room;
 const url=location.origin+'/play?room='+encodeURIComponent(room);
 $('joinUrl').href=url;$('joinUrl').textContent=url;
 $('qr').src='/api/qr?room='+encodeURIComponent(room)+'&v='+Date.now();
}
function setRoom(data){room=data.room;hostToken=data.host_token;sessionStorage.setItem('balance-v19-teacher',JSON.stringify({room,hostToken}));roomUI();if(!pollActive){pollActive=true;poll()}}
async function createRoom(){
 $('createErr').textContent='';$('create').disabled=true;
 try{const result=await api('create',{});setRoom(result);status('게임방 연결됨',true)}catch(e){$('createErr').textContent=e.message;status('연결 확인 필요',false)}finally{$('create').disabled=false}
}
function itemLine(r){
 const row=document.createElement('div');row.className='racer';
 const sw=document.createElement('span');sw.className='avatar';sw.style.background=r.color;
 const nm=document.createElement('span');nm.className='name';nm.textContent=r.name;
 const detail=document.createElement('span');detail.className='details';detail.textContent=r.finished?'완주 '+(r.time||''):(r.rank?r.rank+'위 · '+Math.floor(r.distance/16800*100)+'%':'참가 완료');
 row.append(sw,nm,detail);return row;
}
function render(state){
 $('headcount').textContent=state.count+' / 7';
 const map={lobby:'학생 입장 대기 중',countdown:'출발 카운트다운 중',running:'경기 진행 중',finished:'전원 완주 · 순위 공개 대기',revealed:'순위 공개 완료'};
 $('phaseInfo').textContent=map[state.phase]||state.phase;
 $('finishState').textContent=state.phase==='finished'?'결과 공개 가능':map[state.phase];
 $('start').disabled=state.phase!=='lobby'||state.count===0;
 $('reveal').disabled=state.phase!=='finished';
 $('reset').disabled=state.phase==='lobby'&&state.count===0;
 $('reset').textContent=state.phase==='lobby'?'경기 초기화':'다음 경기 준비';
 const playerBox=$('players');playerBox.replaceChildren();
 if(!state.players.length){const empty=document.createElement('p');empty.className='muted';empty.textContent='아직 참가한 학생이 없어요.';playerBox.append(empty)}
 const order=state.phase==='lobby'?[...state.players].sort((a,b)=>a.name.localeCompare(b.name,'ko')):state.players;
 order.forEach(r=>{const row=itemLine(r);if(state.phase==='lobby'){
  const kick=document.createElement('button');kick.className='button secondary';kick.style.cssText='min-height:28px;padding:5px 8px;font-size:11px';kick.textContent='퇴장';kick.onclick=()=>action('kick',r.id);row.append(kick);
 }playerBox.append(row)});
 const progress=$('progressList');progress.replaceChildren();
 for(const r of state.players){const container=document.createElement('div');container.style.margin='12px 0';const line=document.createElement('div');line.className='topline';const name=document.createElement('strong');name.textContent=(r.rank?r.rank+'위 · ':'')+r.name;const label=document.createElement('small');label.className='muted';label.textContent=r.finished?(r.time||'완주'):(r.distance!==null?Math.round(r.distance/16800*100)+'%':'대기');line.append(name,label);const outer=document.createElement('div');outer.style.cssText='height:9px;border-radius:20px;background:#e9f1ed;overflow:hidden;margin-top:6px';const bar=document.createElement('div');bar.style.cssText='height:100%;border-radius:20px;background:'+r.color+';width:'+Math.min(100,(r.distance||0)/16800*100)+'%';outer.append(bar);container.append(line,outer);progress.append(container)}
}
async function poll(){
 if(!room||!hostToken){pollActive=false;return}
 try{const data=await api('teacher/state',{room,host_token:hostToken});render(data);status('실시간 연결됨',true)}
 catch(e){status('연결 재시도 중',false);$('actionErr').textContent=e.message}
 setTimeout(poll,650);
}
async function action(type,id){
 let msg='';if(type==='reset')msg='현재 경기를 초기화하고 참가자는 유지할까요?';if(type==='kick')msg='이 학생을 게임방에서 퇴장시킬까요?';if(type==='start')msg='입장한 '+$('headcount').textContent.split(' ')[0]+'명의 경기를 시작할까요?';
 if(msg&&!confirm(msg))return;
 $('actionErr').textContent='';
 try{const result=await api('teacher/action',{room,host_token:hostToken,action:type,id});render(result)}catch(e){$('actionErr').textContent=e.message}
}
$('create').onclick=createRoom;
$('newRoom').onclick=()=>{if(confirm('새 게임방을 생성하면 기존 게임방의 학생들은 자동으로 옮겨지지 않아요. 새 방을 만들까요?'))createRoom()};
$('copy').onclick=async()=>{const url=location.origin+'/play?room='+room;try{await navigator.clipboard.writeText(url);$('copy').textContent='복사 완료'}catch(e){prompt('아래 주소를 복사해 주세요.',url)}};
$('start').onclick=()=>action('start');$('reveal').onclick=()=>action('reveal');$('reset').onclick=()=>action('reset');
try{const saved=JSON.parse(sessionStorage.getItem('balance-v19-teacher')||'null');if(saved?.room&&saved?.hostToken){room=saved.room;hostToken=saved.hostToken;roomUI();pollActive=true;poll()}}catch(e){}
