const featureNames={media:'Now Playing',lyrics:'Synced lyrics',volume:'Volume HUD',brightness:'Brightness HUD',battery:'Battery and charging',timer:'Timer and stopwatch',notifications:'Local notifications'};
const $=id=>document.getElementById(id);
async function init(){
 const s=await window.islandAPI.getSettings();
 $('features').innerHTML=Object.entries(featureNames).map(([key,label])=>`<label class="feature"><span>${label}</span><input type="checkbox" data-key="${key}" ${s[key]?'checked':''}></label>`).join('');
 for(const key of ['position','offsetY','animationSpeed','startWithWindows']) $(key).value=s[key]??$(key).value;
 $('startWithWindows').checked=!!s.startWithWindows;
 $('speedValue').textContent=`${s.animationSpeed||1}×`;
 document.querySelectorAll('[data-key]').forEach(el=>el.addEventListener('change',()=>save(el.dataset.key,el.checked)));
 for(const key of ['position','offsetY','animationSpeed','startWithWindows']) $(key).addEventListener('change',()=>save(key,key==='offsetY'||key==='animationSpeed'?Number($(key).value):key==='startWithWindows'?$(key).checked:$(key).value));
 $('animationSpeed').addEventListener('input',()=> $('speedValue').textContent=`${$('animationSpeed').value}×`);
 $('close').addEventListener('click',()=>window.close());
}
async function save(key,value){try{await window.islandAPI.setSetting(key,value);$('status').textContent='Saved';}catch(e){$('status').textContent='Could not save';}}
init().catch(e=>$('status').textContent=e.message);