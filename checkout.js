'use strict';
const API_BASE='https://proklinator-api.tanushaaim.workers.dev';
let shopItems=[],shopChoice=-1,checkoutBusy=false,pollGeneration=0;
const paymentStatuses={pending:'Ожидает оплаты',paid:'Оплачено',invoice_error:'Счёт не создан',refunded:'Возвращено',expired:'Счёт истёк'};
async function api(path,options={},auth=true){
  const headers={'Content-Type':'application/json',...options.headers};
  if(auth){if(!tg?.initData)throw Error('Для покупки откройте приложение через кнопку в Telegram-боте.');headers.Authorization='tma '+tg.initData;}
  let response;
  try{response=await fetch(API_BASE+path,{...options,headers,cache:'no-store',signal:AbortSignal.timeout(12000)});}catch{throw Error('Не удалось связаться с кассой. Повторите проверку; повторная покупка не требуется.');}
  const data=await response.json();if(!response.ok)throw Error(data.error||'Касса временно недоступна.');return data;
}
function renderServices(){
  const el=$('serviceGrid');if(!el)return;
  el.innerHTML=shopItems.length?shopItems.map((s,i)=>`<button class="service ${shopChoice===i?'active':''}" onclick="chooseService(${i})"><span>${esc(s.emoji)}</span><b>${esc(s.name)}</b><small>${s.stars} ⭐ · ${esc(s.description)}</small></button>`).join(''):'<p class="sub">Загружаем каталог…</p>';
}
async function loadCatalog(){
  try{const data=await api('/api/catalog',{},false);shopItems=data.services;renderServices();}
  catch(e){$('serviceGrid').textContent=e.message;const retry=document.createElement('button');retry.className='secondary';retry.textContent='Повторить загрузку';retry.onclick=loadCatalog;$('serviceGrid').append(retry);}
}
function chooseService(i){
  if(checkoutBusy)return toast('Дождитесь ответа кассы.');
  pollGeneration++;shopChoice=i;renderServices();const s=shopItems[i];if(!s)return;
  $('serviceDetail').innerHTML=`<h3>${esc(s.emoji)} ${esc(s.name)}</h3><p>${esc(s.description)}</p><p class="choiceNote">Шуточный цифровой документ и карточка для сохранения. Реального воздействия на людей нет. Не указывайте чужие личные данные.</p><label class="field" for="serviceTarget">Прозвище или ситуация</label><input class="input" id="serviceTarget" maxlength="70" placeholder="Например, начальник без выходных"><label class="field" for="serviceReason">За что вызываем в канцелярию?</label><textarea class="input" id="serviceReason" maxlength="280" rows="3" placeholder="Расскажи, что случилось"></textarea><button class="primary" onclick="shopPreview()">🔮 Получить бесплатный диагноз</button><div id="shopCheckout" aria-live="polite"></div>`;
  $('serviceDetail').scrollIntoView({behavior:'smooth',block:'nearest'});
}
function shopPreview(){
  if(checkoutBusy)return;
  const target=$('serviceTarget').value.trim(),reason=$('serviceReason').value.trim(),s=shopItems[shopChoice];
  if(!target||!reason)return toast('Заполните прозвище и причину вызова.');
  $('shopCheckout').innerHTML=`<div class="speech"><strong>🔮 Татьяна:</strong> Объект «${esc(target)}» подозревается в следующем: ${esc(reason)}.</div><div class="panel"><h3>🧾 Касса преисподней</h3><p>${esc(s.description)}. Разовая покупка, без подписки.</p><h2>${s.stars} ⭐</h2><p class="choiceNote">Результат появится после подтверждения платежа. Его можно снова открыть в «Моих покупках». Прозвище, причина и запись покупки сохраняются на сервере. Помощь и запрос возврата: /paysupport в боте.</p>${tg?.initData?`<button class="primary" id="payButton" onclick="buyService()">⭐ Оплатить ${s.stars} Stars</button>`:'<p>Для оплаты откройте приложение кнопкой в <a href="https://t.me/portalvdarkside_bot" target="_blank" rel="noopener" style="color:#ffb4d5">Telegram-боте</a>.</p>'}<div id="paymentState" role="status"></div></div>`;
  $('shopCheckout').scrollIntoView({behavior:'smooth',block:'nearest'});
}
function paymentState(text){const el=$('paymentState');if(el)el.textContent=text;}
function intentFor(data){
  const storageKey='proklinatorIntent:'+String(tg?.initDataUnsafe?.user?.id||'session');
  const fingerprint=JSON.stringify(data);let saved;
  try{saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');}catch{}
  if(!saved||saved.fingerprint!==fingerprint){saved={fingerprint,key:crypto.randomUUID()};try{sessionStorage.setItem(storageKey,JSON.stringify(saved));}catch{}}
  return {key:saved.key,clear(){try{sessionStorage.removeItem(storageKey);}catch{}}};
}
async function buyService(){
  if(checkoutBusy)return;const s=shopItems[shopChoice];if(!s)return;
  const data={serviceId:s.id,target:$('serviceTarget').value.trim(),reason:$('serviceReason').value.trim()},intent=intentFor(data);
  checkoutBusy=true;if($('payButton'))$('payButton').disabled=true;paymentState('Создаём счёт…');
  try{
    const order=await api('/api/checkout',{method:'POST',headers:{'Idempotency-Key':intent.key},body:JSON.stringify(data)});
    if(order.status==='paid'){intent.clear();return showPaidOrder(order);}
    if(order.status==='invoice_error'||order.status==='refunded'||order.status==='expired'){intent.clear();throw Error('Этот счёт закрыт. Нажмите оплату ещё раз, чтобы создать новый.');}
    if(!order.invoiceUrl){paymentState('Счёт создаётся или уже истёк. Проверьте «Мои покупки».');return;}
    paymentState('Подтвердите оплату в окне Telegram.');
    await new Promise((resolve,reject)=>{try{tg.openInvoice(order.invoiceUrl,status=>{
      resolve();
      // Client callback is a hint only. It never grants access to a result.
      if(status==='cancelled'){paymentState('Оплата отменена. Проверить заказ можно в «Моих покупках».');}
      else if(status==='failed'){paymentState('Telegram не завершил оплату. Проверьте «Мои покупки».');}
      else{paymentState('Проверяем подтверждение Telegram…');pollOrder(order.orderId).catch(e=>paymentState(e.message));}
    });}catch(e){reject(e);}});
  }catch(e){paymentState(e.message);}
  finally{checkoutBusy=false;if($('payButton'))$('payButton').disabled=false;}
}
async function pollOrder(id){
  const generation=++pollGeneration;
  for(let n=0;n<20;n++){
    const order=await api('/api/orders/'+encodeURIComponent(id));if(generation!==pollGeneration)return;
    if(order.status==='paid')return showPaidOrder(order);
    if(order.status==='refunded'){paymentState('Платёж возвращён.');return;}
    await new Promise(resolve=>setTimeout(resolve,1500));
  }
  paymentState('Подтверждение ещё не пришло. Не оплачивайте заново: откройте «Мои покупки» и проверьте заказ позже.');
}
function showPaidOrder(order){
  if(order.status!=='paid'||!order.result)return;
  const r=order.result;go('services');
  $('serviceDetail').innerHTML=`<div class="result"><div class="eyebrow">Оплата подтверждена · ${order.amount} ⭐</div><h2>${esc(r.title)}</h2><p style="white-space:pre-line">${esc(r.text)}</p><div class="stamp">ПЕЧАТЬ<br>✦<br>КАНЦЕЛЯРИИ</div><p class="muted">${esc(r.disclaimer)}</p><p class="muted">Заказ ${esc(order.orderId)}</p></div><button class="primary" id="paidShare">📨 Поделиться карточкой</button><button class="secondary" id="paidSave">⬇️ Сохранить PNG</button><button class="secondary" onclick="loadPurchases()">Мои покупки</button>`;
  $('paidShare').onclick=()=>share(r.title,r.text);$('paidSave').onclick=()=>savePng(r.title,r.text,'Татьяна и Екатерина');sparks();
  $('serviceDetail').scrollIntoView({behavior:'smooth',block:'start'});
}
async function loadPurchases(){
  pollGeneration++;go('services');const panel=$('purchases');panel.textContent='Проверяем покупки…';
  try{
    const data=await api('/api/orders');panel.innerHTML='<h3>Мои покупки</h3>';
    if(!data.orders.length){const p=document.createElement('p');p.textContent='Покупок пока нет.';panel.append(p);}
    for(const order of data.orders){
      const row=document.createElement('div');row.className='historyItem';
      const name=shopItems.find(s=>s.id===order.serviceId)?.name||order.serviceId;
      const label=document.createElement('p');label.textContent=name+' · '+order.amount+' ⭐ · '+(paymentStatuses[order.status]||order.status)+'\n'+order.orderId;row.append(label);
      const check=document.createElement('button');check.className='secondary';check.textContent=order.status==='paid'?'Открыть результат':'Проверить статус';check.onclick=async()=>{check.disabled=true;try{const current=await api('/api/orders/'+encodeURIComponent(order.orderId));if(current.status==='paid')showPaidOrder(current);else toast(paymentStatuses[current.status]||current.status);}catch(e){toast(e.message);}finally{check.disabled=false;}};row.append(check);
      if(order.status==='pending'&&order.invoiceUrl){const pay=document.createElement('button');pay.className='secondary';pay.textContent='Открыть этот счёт';pay.onclick=()=>tg.openInvoice(order.invoiceUrl,()=>loadPurchases());row.append(pay);}
      panel.append(row);
    }
  }catch(e){panel.textContent=e.message;}
  panel.scrollIntoView({behavior:'smooth',block:'start'});
}
setTimeout(loadCatalog,0);
