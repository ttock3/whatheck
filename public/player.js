'use strict';
let room = new URL(location.href).searchParams.get('room')?.trim().toUpperCase() || '';
let token = null, playerId=null, selectedColor='#328bb8', latestState=null, listening=false, lastPhase='', lastRound=0, lastItemIndex=-1, timerHandle=null, polling=false;
$('roomInput').value=room;
function connection(text,bad=false){$('netStatus').textContent=text;$('netStatus').style.color=bad?'#b44f42':'#547a74'}
function showSection(s){setHidden('entry',s!=='entry');setHidden('studentLobby',s!=='lobby');setHidden('race18ui',s!=='game');setHidden('studentResults',s!=='result');if(s==='game')window.RaceGame?.resize()}
function save(){localStorage.setItem('balance-v19-participant-'+room,JSON.stringify({token,playerId}))}
function clearSession(){localStorage.removeItem('balance-v19-participant-'+room);token=null;playerId=null}
async function join(){
 const btn=$('join');btn.disabled=true;$('joinError').textContent='';
 try{
  room=$('roomInput').value.trim().toUpperCase();if(room.length!==6)throw new Error('게임방 코드를 확인해 주세요.');
  const result=await api('join',{room,name:$('nickInput').value.trim(),color:selectedColor});
  token=result.token;playerId=result.id;save();history.replaceState(null,'','/play?room='+encodeURIComponent(room));
  showSection('lobby');connection('참가 완료');if(!polling){polling=true;poll()}
 }catch(e){$('joinError').textContent=e.message;connection('참가 확인 필요',true)}finally{btn.disabled=false}
}
function memberList(players){const holder=$('lobbyList');holder.replaceChildren();for(const p of players){let row=document.createElement('div');row.className='racer';const dot=document.createElement('span');dot.className='avatar';dot.style.background=p.color;const label=document.createElement('strong');label.textContent=p.name+(p.id===playerId?' (나)':'');row.append(dot,label);holder.append(row)}}
function resultList(players){const holder=$('resultsList');holder.replaceChildren();for(const p of players){const row=document.createElement('div');row.className='resultsRow'+(p.id===playerId?' me':'');const pos=document.createElement('span');pos.className='position';pos.textContent=p.rank+'위';const n=document.createElement('span');n.className='resultName';n.textContent=p.name+(p.id===playerId?' (나)':'');const t=document.createElement('span');t.className='resultTime';t.textContent=p.time;row.append(pos,n,t);holder.append(row)}}
function onState(data){
 latestState=data;connection('실시간 연결됨');
 const phase=data.phase;
 if(data.round!==lastRound){lastItemIndex=-1;lastRound=data.round;window.RaceGame?.reset()}
 if(phase==='lobby'){
  showSection('lobby');$('lobbyName').textContent=data.me.name;$('lobbyCount').textContent=data.count+' / 7명 참가';memberList(data.players);
 }else if(phase==='revealed'){
  resultList(data.players);showSection('result');
 }else{
  showSection('game');
  window.RaceGame?.sync(data);
  if(phase==='countdown'){
   setHidden('g19overlay',false);$('g19count').textContent=String(Math.max(1,Math.ceil(data.countdown_ms/1000)));
   $('g19overlayTitle').textContent='다 함께 출발!';$('g19overlayText').textContent='교사가 게임을 시작했어요.';
  }else if(phase==='running'){
   if(data.me.finished){
    setHidden('g19overlay',false);$('g19count').textContent='✓';$('g19overlayTitle').textContent='완주!';$('g19overlayText').textContent='다른 친구들의 완주를 기다리는 중이에요.';
   }else setHidden('g19overlay',true);
  }else if(phase==='finished'){
   setHidden('g19overlay',false);$('g19count').textContent='✓';$('g19overlayTitle').textContent='전원 완주!';$('g19overlayText').textContent='선생님이 최종 순위를 공개할 때까지 기다려 주세요.';
  }
 }
 lastPhase=phase;
}
async function poll(){
 if(!token||!room){polling=false;return}
 try{const data=await api('student/state',{room,token});onState(data)}
 catch(e){connection('연결 재시도 중',true);if(/만료|인증/.test(e.message)){clearSession();showSection('entry');$('joinError').textContent=e.message;polling=false;return}}
 timerHandle=setTimeout(poll,latestState&&['countdown','running'].includes(latestState.phase)?220:650);
}
async function move(direction){
 if(!latestState||latestState.phase!=='running'||latestState.me.finished)return;
 const lane=Math.max(0,Math.min(2,(window.RaceGame?.getLane()??latestState.me.lane)+direction));
 window.RaceGame?.setLocalLane(lane);
 try{await api('student/move',{room,token,lane})}catch(e){connection('이동 명령 재전송이 필요해요.',true)}
}
$('join').onclick=join;
$('nickInput').addEventListener('keydown',e=>{if(e.key==='Enter')join()});
document.querySelectorAll('.joinColor').forEach(b=>b.onclick=()=>{selectedColor=b.dataset.color;document.querySelectorAll('.joinColor').forEach(x=>x.classList.toggle('selected',x===b))});
$('g19left').onclick=()=>move(-1);$('g19right').onclick=()=>move(1);
let touchX=null;
$('g19stage').addEventListener('touchstart',e=>{touchX=e.changedTouches[0].clientX},{passive:true});
$('g19stage').addEventListener('touchend',e=>{if(touchX===null)return;const dx=e.changedTouches[0].clientX-touchX;if(Math.abs(dx)>35)move(dx>0?1:-1);touchX=null},{passive:true});
window.addEventListener('keydown',e=>{if((e.key==='ArrowLeft'||e.key==='ArrowRight')&&!$('race18ui').classList.contains('hidden')){e.preventDefault();move(e.key==='ArrowLeft'?-1:1)}});
if(room){try{const stored=JSON.parse(localStorage.getItem('balance-v19-participant-'+room)||'null');if(stored?.token){token=stored.token;playerId=stored.playerId;showSection('lobby');polling=true;poll()}}catch(e){}}
