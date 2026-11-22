/* Human sandbox names are display metadata; engine unit IDs remain unchanged. */
(()=>{'use strict';
const {esc,roles}=MobaStats;
const STORE='hex-moba-human-id-presets-v1';
function stored(){
 try{const value=JSON.parse(localStorage.getItem(STORE)||'null');return value?.version===1&&value.sides&&typeof value.sides==='object'?value.sides:{};}catch{return {};}
}
function get(side){return {...(stored()[side]||{})};}
function validate(names){
 const cleaned={};
 for(const [side,ids] of Object.entries(names)){
  if(!['A','B'].includes(side)||!ids||typeof ids!=='object')throw Error('请分别填写蓝方、红方的选手ID');
  const values={...get(side)};
  for(const [role,value] of Object.entries(ids)){
   if(!Object.hasOwn(roles,role)||typeof value!=='string')throw Error('选手位置或ID无效');
   const name=value.trim();
   if([...name].length>24||/\p{C}/u.test(name))throw Error('选手ID最多24个字符，请勿包含换行或控制字符');
   values[role]=name;
  }
  const namesForTeam=Object.entries(roles).map(([role,label])=>(values[role]||'人类'+side+'.'+label).toLowerCase());
  if(new Set(namesForTeam).size!==namesForTeam.length)throw Error((side==='A'?'蓝方':'红方')+'的五位选手请使用不同ID');
  cleaned[side]=values;
 }
 return cleaned;
}
function remember(names){
 const sides={...stored(),...validate(names)};
 try{localStorage.setItem(STORE,JSON.stringify({version:1,sides}));}
 catch{throw Error('浏览器暂时无法记住ID，请检查可用存储空间后重试');}
 return sides;
}
async function initialize(){
 if(Object.hasOwn(stored(),'A')&&Object.hasOwn(stored(),'B'))return;
 try{
  const response=await fetch('/api/arena',{cache:'no-store'});if(!response.ok)return;
  const data=await response.json(),boxes=(data.sandboxes||[]).slice().sort((a,b)=>b.created-a.created),cache=new Map(),found={};
  for(const side of ['A','B']){
   if(Object.hasOwn(stored(),side))continue;
   for(const box of boxes.filter(box=>box.controllers?.[side]==='human')){
    if(!cache.has(box.id)){
     const item=await fetch('/api/sandbox/'+encodeURIComponent(box.id),{cache:'no-store'});
     cache.set(box.id,item.ok?await item.json():null);
    }
    const ids=cache.get(box.id)?.humanIds?.[side];
    if(ids&&Object.values(ids).some(name=>typeof name==='string'&&name.trim())){found[side]=ids;break;}
   }
   if(!Object.hasOwn(found,side))found[side]={};
  }
  const missing=Object.fromEntries(Object.entries(found).filter(([side])=>!Object.hasOwn(stored(),side)));
  if(Object.keys(missing).length)remember(missing);
 }catch{/* Existing game IDs remain available if initial migration cannot complete. */}
}
const ready=initialize();
function fields(side,ids=get(side),active=true){
 const sideName=side==='A'?'蓝方':'红方';
 return `<fieldset class="human-id-fields" data-human-ids="${side}" ${active?'':'hidden'}><legend>${sideName}人类选手 ID</legend><div class="human-id-grid">${Object.entries(roles).map(([role,label])=>`<label>${label} ID<input name="human-${side}-${role}" aria-label="${sideName}${label}选手ID" value="${esc(ids[role]||'')}" placeholder="人类${side}.${label}" maxlength="24" autocomplete="off" ${active?'':'disabled'}></label>`).join('')}</div><small class="arena-note">可单独起名，留空使用默认 ID。</small></fieldset>`;
}
function read(form){
 const result={};
 for(const input of form.querySelectorAll('[data-human-ids] input:not(:disabled)')){
  const [,side,role]=input.name.split('-');(result[side]||(result[side]={}))[role]=input.value.trim();
 }
 return result;
}
function sync(form){
 for(const group of form.querySelectorAll('[data-human-ids]')){
  const active=form.elements.namedItem(group.dataset.humanIds)?.value==='human';group.hidden=!active;
  group.querySelectorAll('input').forEach(input=>{input.disabled=!active;});
 }
}
async function openProfiles(){
 await ready;
 let dialog=document.querySelector('#humanIdProfiles');
 if(!dialog){dialog=document.createElement('dialog');dialog.id='humanIdProfiles';dialog.setAttribute('aria-labelledby','humanIdProfilesTitle');document.body.appendChild(dialog);}
 dialog.innerHTML=`<h2 id="humanIdProfilesTitle">蓝红常用选手 ID</h2><p class="arena-note">蓝方、红方各记住一组，新局自动带入。此浏览器会保留你的设置。</p><div class="human-id-tabs" role="tablist" aria-label="常用ID分组"><button type="button" role="tab" data-id-side="A" aria-controls="humanIdProfileA" aria-selected="true">蓝方一组</button><button type="button" role="tab" data-id-side="B" aria-controls="humanIdProfileB" aria-selected="false">红方一组</button></div><form class="arena-form" id="humanIdProfilesForm"><section id="humanIdProfileA" data-profile-side="A" role="tabpanel">${fields('A')}</section><section id="humanIdProfileB" data-profile-side="B" role="tabpanel" hidden>${fields('B')}</section><p id="humanIdProfilesStatus" class="arena-note" role="status">可随时修改，保存后用于新建沙盒。</p><div class="arena-tools"><button type="submit">保存蓝红两组</button><button type="button" data-close-profiles>完成</button></div></form>`;
 dialog.querySelectorAll('[data-id-side]').forEach(button=>{button.onclick=()=>{
  dialog.querySelectorAll('[data-id-side]').forEach(tab=>tab.setAttribute('aria-selected',String(tab===button)));
  dialog.querySelectorAll('[data-profile-side]').forEach(panel=>{panel.hidden=panel.dataset.profileSide!==button.dataset.idSide;});
 };});
 dialog.querySelector('[data-close-profiles]').onclick=()=>dialog.close();
 dialog.querySelector('form').onsubmit=event=>{
  event.preventDefault();const status=dialog.querySelector('#humanIdProfilesStatus');
  try{remember(read(event.target));status.textContent='蓝方和红方的常用ID已保存，新局会自动带入。';status.className='human-id-saved';}
  catch(error){status.textContent=error.message;status.className='human-id-error';}
 };
 dialog.showModal();
}
window.MobaHumanIds={fields,read,sync,get,validate,remember,ready,openProfiles};
})();
