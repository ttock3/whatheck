'use strict';
async function api(path,body){
 const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),7000);
 try{
  const response=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:ctl.signal,cache:'no-store'});
  const result=await response.json();
  if(!response.ok||!result.ok)throw new Error(result.error||'서버에 연결할 수 없어요.');
  return result;
 }finally{clearTimeout(timer)}
}
const $=id=>document.getElementById(id);
function nameOnly(s){const span=document.createElement('span');span.textContent=s;return span}
function setHidden(id,hidden){$(id).classList.toggle('hidden',hidden)}
function fmtSeconds(n){if(n===null||n===undefined)return '—';const ms=Math.max(0,Math.round(n*1000));return `${Math.floor(ms/60000)}:${String(Math.floor(ms/1000)%60).padStart(2,'0')}.${String(ms%1000).padStart(3,'0')}`}
