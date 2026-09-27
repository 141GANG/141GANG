(() => {
  'use strict';
  const STORAGE_KEY = 'cr7:auction-page:v2';
  const COLORS = ['#ef3d3d','#ef8f3d','#f2cd45','#61bf70','#45b9d8','#5378e8','#a567df','#dc5fba'];
  const initialState = {
    lots: [],
    rules: [],
    donations: [],
    timerSeconds:36000,donationChannel:'',demoDonationsSeeded:false,demoDonationsVersion:0
  };
  const cloneInitial = () => JSON.parse(JSON.stringify(initialState));
  const loadState = () => { try { const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); return saved && Array.isArray(saved.lots) && Array.isArray(saved.rules) ? {...cloneInitial(),...saved} : cloneInitial(); } catch { return cloneInitial(); } };
  let state = loadState(); let timerId = 0; let wheelRotation = 0; let toastTimer = 0; let donationAuthSubscription = null; let donationSyncToken = 0; let draggedDonationId = '';
  const byId = id => document.getElementById(id);
  const closestTarget = (event,selector) => event.target instanceof Element ? event.target.closest(selector) : event.target?.parentElement?.closest(selector);
  const money = value => `${new Intl.NumberFormat('ru-RU').format(Math.round(Number(value)||0))} ₽`;
  const makeId = prefix => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
  const save = () => localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
  const escapeHtml = value => String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const normalizedLotName = value => String(value||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('ru-RU');
  const comparableText = value => ` ${String(value||'').normalize('NFKD').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,' ').trim()} `;
  function titleFromDonationMessage(message){
    const text=String(message||'').trim();if(!text)return '';
    const quoted=text.match(/[«“"]([^»”"]{2,80})[»”"]/)?.[1]?.trim();if(quoted)return quoted;
    const cue=text.match(/(?:^|[\s,.;!?])(?:на|за|для)\s+(?:игру\s+)?(.+)/iu)?.[1]||text.match(/(?:^|[\s,.;!?])(?:for)\s+(?:the\s+)?(?:game\s+)?(.+)/iu)?.[1];
    let candidate=(cue||text).trim();
    candidate=candidate.split(/(?:[,!?;]|\s[—–-]\s|\s+(?:мне\s+кажется|потому\s+что|пожалуйста|чтобы|хочу|давай|думаю|кажется|стоит|because|please|i\s+think|you\s+should)\b)/iu)[0].trim();
    candidate=candidate.replace(/^(?:донат(?:ик|чу)?|доначу|кидаю|отправляю|ставлю|хочу|please|donation)\s+/iu,'').replace(/^[«“"']|[»”"'.:]+$/gu,'').trim();
    if(!cue&&candidate.split(/\s+/).length>8)return '';
    return candidate.slice(0,80);
  }
  function inferDonationLot(payload,message){
    const haystack=comparableText(message);
    const existing=[...state.lots].sort((a,b)=>String(b.name).length-String(a.name).length).find(lot=>{
      const needle=comparableText(lot.name).trim();return needle&&haystack.includes(` ${needle} `)
    });
    if(existing)return existing.name;
    const explicit=String(payload.lot||payload.game||'').trim();
    if(explicit&&normalizedLotName(explicit)!=='новый лот')return explicit.slice(0,80);
    return titleFromDonationMessage(message)||'Новый лот';
  }
  function mergeDuplicateLots(){
    const unique=[];const byName=new Map();
    state.lots.forEach(item=>{
      const name=String(item?.name||'').trim().replace(/\s+/g,' ');const key=normalizedLotName(name);if(!key)return;
      const amount=Math.max(0,Math.round(Number(item.amount)||0));const existing=byName.get(key);
      if(existing)existing.amount+=amount;else{const lot={...item,id:item.id||makeId('lot'),name,amount};unique.push(lot);byName.set(key,lot)}
    });
    state.lots=unique;
  }
  function addToNamedLot(name,amount){
    const cleanName=String(name||'').trim().replace(/\s+/g,' ');const value=Math.max(0,Math.round(Number(amount)||0));if(!cleanName||!value)return null;
    let lot=state.lots.find(item=>normalizedLotName(item.name)===normalizedLotName(cleanName));
    if(lot)lot.amount+=value;else{lot={id:makeId('lot'),name:cleanName,amount:value};state.lots.push(lot)}
    return lot;
  }
  function seedDemoDonations(){
    if(Number(state.demoDonationsVersion)>=2)return;
    const samples=[
      {demoKey:'silent-hill',amount:500,author:'Кирилл',lot:'Silent Hill 2',message:'На прохождение Silent Hill 2'},
      {demoKey:'silksong',amount:250,author:'Аноним',lot:'Hollow Knight: Silksong',message:'Добавь Silksong в список!'},
      {demoKey:'watch-dogs',amount:500,author:'Аноним',lot:'Watch Dogs 3',message:'Доначу на игру Watch dogs 3, мне кажется тебе стоит поиграть в неё, потому что она крутая и крутая'},
      {demoKey:'resident-evil',amount:1410,author:'Dmitry',lot:'Resident Evil 4',message:'За Resident Evil 4 — пора возвращаться в классику.'},
      {demoKey:'portal',amount:300,author:'Маша',lot:'Portal 2',message:'На совместное прохождение Portal 2!'}
    ];
    samples.forEach(sample=>{
      const exists=state.donations.some(item=>item.demoKey===sample.demoKey||(item.author===sample.author&&item.message===sample.message&&Number(item.amount)===sample.amount));
      if(!exists)state.donations.push({id:makeId('donation'),...sample})
    });
    state.demoDonationsSeeded=true;
    state.demoDonationsVersion=2;
  }
  function toast(message){const node=byId('auctionToast');clearTimeout(toastTimer);node.textContent=message;node.hidden=false;toastTimer=setTimeout(()=>{node.hidden=true},2600)}
  function renderRules(){byId('rulesList').innerHTML=state.rules.map((rule,index)=>`<li>${escapeHtml(rule)}<button type="button" data-remove-rule="${index}" aria-label="Удалить правило">×</button></li>`).join('')}
  function renderLots(){
    const query=byId('lotSearch').value.trim().toLowerCase(); const lots=state.lots.filter(lot=>lot.name.toLowerCase().includes(query));
    byId('lotsList').innerHTML=lots.map((lot,index)=>`<article class="lot-row" data-lot-id="${lot.id}"><span class="lot-index">${index+1}</span><span class="lot-name" title="${escapeHtml(lot.name)}">${escapeHtml(lot.name)}</span><span class="lot-total">${money(lot.amount).replace(' ₽','')}</span><form class="bid-control" data-bid-form><span>+</span><input type="number" min="1" step="1" inputmode="numeric" placeholder="Сумма" aria-label="Добавить сумму к ${escapeHtml(lot.name)}"></form><button class="lot-delete" type="button" data-delete-lot aria-label="Удалить ${escapeHtml(lot.name)}">×</button></article>`).join('');
    byId('lotsEmpty').hidden=lots.length>0; renderWheel();
  }
  function renderDonations(){
    byId('donationsFeed').innerHTML=state.donations.length?state.donations.map(item=>`<article class="donation-card" data-donation-id="${item.id}" draggable="true" title="Перетащите донат на нужный лот"><div class="donation-card-head"><strong>${money(item.amount).replace(' ₽','')}</strong><span>${escapeHtml(item.author)}</span></div><button class="donation-delete" type="button" data-delete-donation aria-label="Удалить донат">×</button><p>${escapeHtml(item.message)}</p><button class="donation-add" type="button" data-add-donation>Добавить</button></article>`).join(''):'<div class="empty-state donation-empty-state"><span>Лента обновится после получения события.</span></div>';
  }
  function receiveDonation(payload={}){
    const amount=Math.max(1,Math.round(Number(payload.amount)||0));
    const author=String(payload.author||payload.username||'Аноним').trim().slice(0,80)||'Аноним';
    const providedLot=String(payload.lot||payload.game||'').trim();
    const message=String(payload.message||(providedLot?`Донат на ${providedLot}`:'Донат без сообщения')).trim().slice(0,500);
    const lot=(providedLot||payload.message)?inferDonationLot(payload,message):'Новый лот';
    state.donations.unshift({id:makeId('donation'),amount,author,lot,message});
    save();renderDonations();toast(`Получен донат ${money(amount)}`);
  }
  function renderWheel(){
    const total=state.lots.reduce((sum,lot)=>sum+Math.max(0,Number(lot.amount)||0),0); let position=0;
    const stops=state.lots.map((lot,index)=>{const start=position;position+=total?(lot.amount/total)*360:0;return `${COLORS[index%COLORS.length]} ${start}deg ${position}deg`});
    byId('auctionWheel').style.background=stops.length?`conic-gradient(${stops.join(',')})`:'#2a2a2a';
    byId('wheelRosterList').innerHTML=state.lots.map((lot,index)=>{const chance=total?Math.round((lot.amount/total)*1000)/10:0;return `<article class="wheel-roster-item" style="--segment:${COLORS[index%COLORS.length]}"><i></i><b>${escapeHtml(lot.name)}</b><span>${chance}%</span></article>`}).join('');
    byId('wheelCount').textContent=state.lots.length;byId('wheelBank').textContent=money(total);byId('summaryLots').textContent=state.lots.length;byId('summaryBank').textContent=money(total);
    const leader=[...state.lots].sort((a,b)=>b.amount-a.amount)[0];byId('summaryLeader').textContent=leader?.name||'—';byId('wheelSpin').disabled=state.lots.length<2||total<=0;
  }
  function renderTimer(){const seconds=Math.max(0,Math.floor(state.timerSeconds));const hours=String(Math.floor(seconds/3600)).padStart(2,'0');const minutes=String(Math.floor((seconds%3600)/60)).padStart(2,'0');const rest=String(seconds%60).padStart(2,'0');byId('timerDisplay').textContent=`${hours}:${minutes}:${rest}`;const toggle=byId('timerToggle');toggle.classList.toggle('is-running',Boolean(timerId));toggle.setAttribute('aria-label',timerId?'Поставить таймер на паузу':'Запустить таймер');toggle.title=timerId?'Поставить таймер на паузу':'Запустить таймер'}
  function switchView(view){const wheel=view==='wheel';byId('lotsView').hidden=wheel;byId('wheelView').hidden=!wheel;byId('lotsTab').classList.toggle('is-active',!wheel);byId('wheelTab').classList.toggle('is-active',wheel);byId('lotsTab').setAttribute('aria-selected',String(!wheel));byId('wheelTab').setAttribute('aria-selected',String(wheel));if(wheel)renderWheel()}
  function weightedWinner(){const total=state.lots.reduce((sum,lot)=>sum+Math.max(0,Number(lot.amount)||0),0);let point=Math.random()*total;return state.lots.find(lot=>(point-=lot.amount)<=0)||state.lots.at(-1)}
  function spinWheel(){const winner=weightedWinner();if(!winner)return;const button=byId('wheelSpin');button.disabled=true;byId('wheelHeadline').textContent='Колесо вращается';wheelRotation+=1440+Math.round(Math.random()*720);byId('auctionWheel').style.transform=`rotate(${wheelRotation}deg)`;setTimeout(()=>{byId('wheelHeadline').textContent=winner.name;byId('winnerName').textContent=winner.name;byId('winnerMeta').textContent=`Сумма лота — ${money(winner.amount)}`;byId('winnerDialog').showModal();button.disabled=false},4300)}
  async function refreshAdminNavigation(){const button=byId('adminPortalOpen');if(!button)return;let isAdmin=false;try{const client=window.CR7_SUPABASE_CLIENT;if(client){const{data:sessionData}=await client.auth.getSession();if(sessionData?.session?.user&&!sessionData.session.user.is_anonymous){const{data,error}=await client.rpc('is_site_admin');isAdmin=!error&&data===true}}}catch(error){console.warn('Не удалось обновить состояние управления:',error?.message||error)}document.body.classList.toggle('is-site-admin',isAdmin);document.querySelectorAll('[data-admin-nav]').forEach(item=>{item.hidden=!isAdmin;item.classList.toggle('is-admin',isAdmin)});button.hidden=!isAdmin;button.classList.toggle('is-admin',isAdmin);button.setAttribute('aria-label','Открыть управление сайтом');button.title='Управление сайтом'}
  function bindAdminNavigation(){refreshAdminNavigation();window.CR7_SUPABASE_CLIENT?.auth?.onAuthStateChange?.(()=>setTimeout(refreshAdminNavigation,0))}
  function setDonationButton(label,status='idle'){
    const button=byId('donationConnect');
    button.firstChild.textContent=`${label} `;
    button.dataset.status=status;
    button.disabled=status==='loading';
    button.setAttribute('aria-busy',String(status==='loading'));
  }
  function openDonationAuth(){
    const panel=byId('donationAuthPanel');
    panel.hidden=false;panel.setAttribute('aria-hidden','false');document.body.classList.add('site-auth-open');
    requestAnimationFrame(()=>byId('donationAlertsProvider')?.focus());
  }
  function closeDonationAuth(){
    const panel=byId('donationAuthPanel');
    panel.hidden=true;panel.setAttribute('aria-hidden','true');document.body.classList.remove('site-auth-open');
    byId('donationConnect')?.focus();
  }
  async function donationSession(){
    const client=window.CR7_SUPABASE_CLIENT;
    if(!client)return null;
    const result=window.CR7_AUTH?.getUsableSession?await window.CR7_AUTH.getUsableSession(client):await client.auth.getSession();
    if(result?.error)throw result.error;
    const session=result?.data?.session||null;
    return session?.user&&!session.user.is_anonymous?session:null;
  }
  async function syncDonationConnection(session=null,{notify=false}={}){
    const token=++donationSyncToken;
    const client=window.CR7_SUPABASE_CLIENT;
    if(!client){setDonationButton('Подключить DonationAlerts');if(notify)toast('Авторизация временно недоступна');return false}
    let activeSession=session;
    try{
      if(!activeSession)activeSession=await donationSession();
      if(token!==donationSyncToken)return false;
      if(!activeSession?.user||activeSession.user.is_anonymous){
        setDonationButton('Подключить DonationAlerts','signed-out');
        return false;
      }
      setDonationButton('Проверяем DonationAlerts…','loading');
      const{data,error}=await client.rpc('get_donationalerts_connection_status');
      if(error)throw error;
      if(token!==donationSyncToken)return false;
      if(!data?.connected){
        state.donationChannel='';save();setDonationButton('DonationAlerts не подключён','unavailable');
        if(notify)toast('Аккаунт DonationAlerts пока не подключён к сайту');
        return false;
      }
      state.donationChannel=String(data.name||data.code||'подключён');save();
      setDonationButton(`DonationAlerts: ${state.donationChannel}`,'connected');
      if(notify)toast('DonationAlerts подключён к аукциону');
      return true;
    }catch(error){
      console.warn('Проверка DonationAlerts:',error?.message||error);
      setDonationButton(state.donationChannel?`DonationAlerts: ${state.donationChannel}`:'Подключить DonationAlerts','error');
      if(notify)toast('Не удалось проверить подключение DonationAlerts');
      return false;
    }
  }
  async function connectDonationAlerts(){
    try{
      const session=await donationSession();
      if(!session){
        closeDonationAuth();
        byId('siteAuthOpen')?.click();
        toast('Сначала войдите в профиль сайта');
        return;
      }
      const connected=await syncDonationConnection(session,{notify:true});
      if(connected)closeDonationAuth();
    }catch(error){
      console.warn('Авторизация DonationAlerts:',error?.message||error);
      toast('Не удалось проверить авторизацию');
    }
  }
  async function syncDonationAccess(session=null){
    try{
      const activeSession=session||await donationSession();
      if(!activeSession?.user||activeSession.user.is_anonymous){
        setDonationButton('Подключить DonationAlerts','signed-out');
        return;
      }
      setDonationButton(state.donationChannel?`DonationAlerts: ${state.donationChannel}`:'Подключить DonationAlerts',state.donationChannel?'connected':'idle');
    }catch{
      setDonationButton('Подключить DonationAlerts','error');
    }
  }
  function bindDonationAuthorization(){
    const client=window.CR7_SUPABASE_CLIENT;
    if(!client)return;
    syncDonationAccess();
    const{data}=client.auth.onAuthStateChange((_event,session)=>window.setTimeout(()=>syncDonationAccess(session),0));
    donationAuthSubscription=data?.subscription||null;
  }
  byId('servicesToggle')?.addEventListener('click',event=>{event.stopPropagation();const menu=byId('servicesMenu');if(!menu)return;menu.hidden=!menu.hidden;event.currentTarget.setAttribute('aria-expanded',String(!menu.hidden))});
  document.addEventListener('click',event=>{const menu=byId('servicesMenu');const toggle=byId('servicesToggle');if(menu&&toggle&&!closestTarget(event,'.nav-menu-wrap')){menu.hidden=true;toggle.setAttribute('aria-expanded','false')}const button=closestTarget(event,'[data-toast]');if(button)toast(button.dataset.toast)});
  byId('lotsTab').addEventListener('click',()=>switchView('lots'));byId('wheelTab').addEventListener('click',()=>switchView('wheel'));byId('backToLots').addEventListener('click',()=>switchView('lots'));byId('lotSearch').addEventListener('input',renderLots);
  byId('lotForm').addEventListener('submit',event=>{event.preventDefault();const name=byId('lotName').value.trim();const amount=Math.max(1,Math.round(Number(byId('lotAmount').value)||0));if(!name||!amount)return;const existing=state.lots.find(item=>normalizedLotName(item.name)===normalizedLotName(name));const lot=addToNamedLot(name,amount);event.currentTarget.reset();save();renderLots();toast(existing?`${money(amount)} добавлено к «${lot.name}»`:'Лот добавлен')});
  byId('lotsList').addEventListener('submit',event=>{const form=closestTarget(event,'[data-bid-form]');if(!form)return;event.preventDefault();const row=form.closest('[data-lot-id]');const input=form.querySelector('input');const amount=Math.max(0,Math.round(Number(input.value)||0));const lot=state.lots.find(item=>item.id===row.dataset.lotId);if(!lot||!amount)return;lot.amount+=amount;input.value='';save();renderLots();toast(`${money(amount)} добавлено к «${lot.name}»`)});
  byId('lotsList').addEventListener('click',event=>{const button=closestTarget(event,'[data-delete-lot]');if(!button)return;const row=button.closest('[data-lot-id]');state.lots=state.lots.filter(item=>item.id!==row.dataset.lotId);save();renderLots()});
  byId('addRuleButton').addEventListener('click',()=>{byId('ruleText').value='';byId('ruleDialog').showModal();byId('ruleText').focus()});
  byId('ruleForm').addEventListener('submit',event=>{const text=byId('ruleText').value.trim();if(!text){event.preventDefault();return}state.rules.push(text);save();renderRules();toast('Правило добавлено')});
  byId('rulesList').addEventListener('click',event=>{const button=closestTarget(event,'[data-remove-rule]');if(!button)return;state.rules.splice(Number(button.dataset.removeRule),1);save();renderRules()});
  byId('timerToggle').addEventListener('click',()=>{if(timerId){clearInterval(timerId);timerId=0}else if(state.timerSeconds>0){timerId=setInterval(()=>{state.timerSeconds=Math.max(0,state.timerSeconds-1);renderTimer();if(!state.timerSeconds){clearInterval(timerId);timerId=0;save();renderTimer();toast('Время аукциона истекло')}},1000)}renderTimer()});
  byId('timerAdd').addEventListener('click',()=>{state.timerSeconds+=300;save();renderTimer()});byId('timerSubtract').addEventListener('click',()=>{state.timerSeconds=Math.max(0,state.timerSeconds-300);save();renderTimer()});byId('timerReset').addEventListener('click',()=>{clearInterval(timerId);timerId=0;state.timerSeconds=36000;save();renderTimer()});
  byId('donationConnect').addEventListener('click',openDonationAuth);
  byId('donationAuthClose').addEventListener('click',closeDonationAuth);
  byId('donationAuthPanel').addEventListener('click',event=>{if(closestTarget(event,'[data-donation-auth-close]'))closeDonationAuth()});
  byId('donationAlertsProvider').addEventListener('click',connectDonationAlerts);
  byId('donationsFeed').addEventListener('click',event=>{const card=closestTarget(event,'[data-donation-id]');if(!card)return;const donation=state.donations.find(item=>item.id===card.dataset.donationId);if(!donation)return;if(closestTarget(event,'[data-delete-donation]'))state.donations=state.donations.filter(item=>item.id!==donation.id);else if(closestTarget(event,'[data-add-donation]')){const lot=addToNamedLot(donation.lot,donation.amount);state.donations=state.donations.filter(item=>item.id!==donation.id);toast(`${money(donation.amount)} добавлено к «${lot.name}»`)}else return;save();renderDonations();renderLots()});
  byId('donationsFeed').addEventListener('dragstart',event=>{const card=closestTarget(event,'[data-donation-id]');if(!card)return;draggedDonationId=card.dataset.donationId;card.classList.add('is-dragging');event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',draggedDonationId)});
  byId('donationsFeed').addEventListener('dragend',()=>{draggedDonationId='';document.querySelectorAll('.is-dragging,.is-drop-target').forEach(node=>node.classList.remove('is-dragging','is-drop-target'))});
  byId('lotsList').addEventListener('dragover',event=>{const row=closestTarget(event,'[data-lot-id]');if(!row||!draggedDonationId)return;event.preventDefault();event.dataTransfer.dropEffect='move';byId('lotsList').querySelectorAll('.is-drop-target').forEach(node=>{if(node!==row)node.classList.remove('is-drop-target')});row.classList.add('is-drop-target')});
  byId('lotsList').addEventListener('dragleave',event=>{const row=closestTarget(event,'[data-lot-id]');if(row&&!row.contains(event.relatedTarget))row.classList.remove('is-drop-target')});
  byId('lotsList').addEventListener('drop',event=>{const row=closestTarget(event,'[data-lot-id]');if(!row)return;event.preventDefault();const donationId=draggedDonationId||event.dataTransfer.getData('text/plain');const donation=state.donations.find(item=>item.id===donationId);const lot=state.lots.find(item=>item.id===row.dataset.lotId);if(!donation||!lot)return;lot.amount+=donation.amount;state.donations=state.donations.filter(item=>item.id!==donation.id);draggedDonationId='';save();renderDonations();renderLots();toast(`${money(donation.amount)} добавлено к «${lot.name}»`)});
  byId('newAuctionButton').addEventListener('click',()=>{if(!confirm('Начать новый аукцион? Текущие лоты и таймер будут сброшены.'))return;const channel=state.donationChannel;state=cloneInitial();state.lots=[];state.donationChannel=channel;save();renderRules();renderLots();renderDonations();renderTimer();switchView('lots');toast('Новый аукцион готов')});
  byId('wheelSpin').addEventListener('click',spinWheel);document.addEventListener('keydown',event=>{if(event.key==='Escape'){byId('servicesMenu').hidden=true;if(!byId('donationAuthPanel').hidden)closeDonationAuth()}});
  window.CR7_AUCTION=Object.freeze({receiveDonation,inferDonationLot:(message,payload={})=>inferDonationLot(payload,message),getState:()=>JSON.parse(JSON.stringify(state))});
  window.addEventListener('cr7:donation',event=>receiveDonation(event.detail));
  function bindSupabaseFeatures(){bindAdminNavigation();bindDonationAuthorization()}
  if(window.CR7_SUPABASE_CLIENT)bindSupabaseFeatures();else window.addEventListener('cr7:supabase-ready',bindSupabaseFeatures,{once:true});
  window.addEventListener('beforeunload',()=>donationAuthSubscription?.unsubscribe?.());
  mergeDuplicateLots();seedDemoDonations();save();if(state.donationChannel)setDonationButton(`DonationAlerts: ${state.donationChannel}`,'connected');renderRules();renderLots();renderDonations();renderTimer();
})();
