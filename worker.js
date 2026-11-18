// Cloudflare Worker. BOT_TOKEN stays exclusively in the encrypted Worker binding.
export const VERSION = 'stars-2026-11-18.1';
export const NOTICE_VERSION = '2026-11-17';
export const ORIGIN = 'https://tatyqueen.github.io';
export const WEBHOOK = 'https://proklinator-api.tanushaaim.workers.dev/telegram/webhook';
export const APP = ORIGIN + '/online-proklinator/';
export const CATALOG = [
  {id:'poison',name:'Проклятие на понос',stars:19,emoji:'🚽',description:'Персональная грамота кишечного возмездия'},
  {id:'ex',name:'Бывший, вспомни',stars:39,emoji:'💔',description:'Письмо из отдела бывших'},
  {id:'court',name:'Верховный суд ведьм',stars:69,emoji:'⚖️',description:'Персональное судебное постановление'},
  {id:'wifi',name:'Wi-Fi от Сатаны',stars:19,emoji:'📶',description:'Цифровой приговор'},
  {id:'excel',name:'Excel-экзорцизм',stars:29,emoji:'💻',description:'Офисный приказ'}
];
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY, telegram_user_id TEXT NOT NULL, service_id TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', invoice_payload TEXT NOT NULL, telegram_payment_charge_id TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, paid_at TEXT)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS payments_payload_unique ON payments(invoice_payload)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS payments_charge_unique ON payments(telegram_payment_charge_id) WHERE telegram_payment_charge_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS payments_user_created ON payments(telegram_user_id,created_at)`,
  `CREATE TABLE IF NOT EXISTS order_details (invoice_payload TEXT PRIMARY KEY REFERENCES payments(invoice_payload), telegram_user_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_json TEXT NOT NULL, result_json TEXT NOT NULL, invoice_url TEXT, expires_at INTEGER NOT NULL, precheckout_id TEXT, UNIQUE(telegram_user_id,idempotency_key))`,
  `CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS payment_events (update_id INTEGER PRIMARY KEY, kind TEXT NOT NULL, outcome TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS support_requests (update_id INTEGER PRIMARY KEY, telegram_user_id TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS order_consents (invoice_payload TEXT PRIMARY KEY REFERENCES payments(invoice_payload), telegram_user_id TEXT NOT NULL, rules_version TEXT NOT NULL, data_notice_version TEXT NOT NULL, entertainment_ack INTEGER NOT NULL CHECK(entertainment_ack=1), accepted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS bot_outbox (event_key TEXT PRIMARY KEY, method TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, lease_until INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`
];
const enc = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes), b=>b.toString(16).padStart(2,'0')).join('');
export async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', typeof key==='string'?enc.encode(key):key, {name:'HMAC',hash:'SHA-256'},false,['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}
export async function webhookSecret(token) { return hex(await hmac(token, 'proklinator:webhook:v1:'+WEBHOOK)); }
function equal(a,b) { if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false; let d=0; for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i); return d===0; }
class HttpError extends Error { constructor(status,message){super(message);this.status=status;} }
function fail(status,message){throw new HttpError(status,message);}
export async function validateInitData(raw, token, now=Math.floor(Date.now()/1000)) {
  if(typeof raw!=='string'||raw.length>12000||!raw)fail(401,'Откройте приложение заново через Telegram.');
  const p=new URLSearchParams(raw), seen=new Set();
  for(const [k] of p){if(seen.has(k))fail(401,'Некорректные данные Telegram.');seen.add(k);}
  const hash=p.get('hash'); if(!/^[a-f0-9]{64}$/.test(hash||''))fail(401,'Некорректная подпись Telegram.');
  p.delete('hash'); p.sort();
  // HMAC includes every field except hash (including signature, if present).
  const expected=hex(await hmac(await hmac('WebAppData',token),Array.from(p,([k,v])=>k+'='+v).join('\n')));
  if(!equal(hash,expected))fail(401,'Некорректная подпись Telegram.');
  const date=Number(p.get('auth_date'));
  if(!Number.isSafeInteger(date)||date>now+30||date<now-3600)fail(401,'Сессия истекла. Откройте приложение заново.');
  let user; try{user=JSON.parse(p.get('user'));}catch{fail(401,'Нет пользователя Telegram.');}
  if(!Number.isSafeInteger(user?.id)||user.id<=0||user.is_bot)fail(401,'Нет пользователя Telegram.');
  return String(user.id);
}
async function bot(env,method,data={}) {
  let r,j;
  try {r=await fetch('https://api.telegram.org/bot'+env.BOT_TOKEN+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(6500)}); j=await r.json();}
  catch{fail(502,'Telegram временно недоступен. Попробуйте позже.');}
  // Never propagate Telegram/network error bodies: they can contain sensitive information.
  if(!r.ok||j.ok!==true){const error=new HttpError(502,'Telegram не подтвердил запрос. Попробуйте позже.');error.telegramCode=Number(j.error_code)||r.status;throw error;}
  return j.result;
}
async function body(request) {
  if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))fail(415,'Ожидается JSON.');
  const reader=request.body?.getReader(); if(!reader)fail(400,'Пустой запрос.');
  let size=0,parts=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>32768){await reader.cancel();fail(413,'Слишком большой запрос.');}parts.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail(400,'Некорректный JSON.');}
}
function statement(env,sql,...args){return env.DB.prepare(sql).bind(...args);}
async function order(env,payload){return statement(env,`SELECT p.*,d.request_json,d.result_json,d.invoice_url,d.expires_at,d.precheckout_id FROM payments p JOIN order_details d USING(invoice_payload) WHERE p.invoice_payload=?`,payload).first();}
function publicOrder(row, includeResult=true){return {orderId:row.invoice_payload,serviceId:row.service_id,amount:row.amount,currency:'XTR',status:row.status==='pending'&&row.expires_at<=Math.floor(Date.now()/1000)?'expired':row.status,createdAt:row.created_at,paidAt:row.paid_at,...(row.status==='pending'&&row.expires_at>Math.floor(Date.now()/1000)&&row.invoice_url?{invoiceUrl:row.invoice_url}:{}),...(includeResult&&row.status==='paid'?{result:JSON.parse(row.result_json)}:{})};}
function makeResult(service,target,reason,payload){
  const spells={poison:'Отдел фарфоровых престолов постановляет: в самый пафосный момент вспомнить о земном и срочно искать табличку «WC».',ex:'Архив бывших постановляет: при каждом «ну как ты?» вспоминать всё хорошее, а писать только после проверки на здравый смысл.',court:'Суд ведьм постановляет: признать виновным в бытовом драматизме и назначить три искренних извинения, один остывший чай и день без отговорок.',wifi:'Сетевая канцелярия постановляет: пусть индикатор связи показывает все деления, пока единственное важное сообщение размышляет о смысле отправки.',excel:'Офисная канцелярия постановляет: формулам обрести характер, ячейкам — независимость, а кнопке «Сохранить» — заслуженное уважение.'};
  return {version:1,certificate:payload,title:service.name,target,reason,text:'Дело: «'+target+'».\nОснование: '+reason+'\n\n'+spells[service.id]+'\n\nТатьяна: «Дело изучено». Екатерина: «Печать поставлена». Кот-аудитор: «Мяу. Копия верна».',disclaimer:'Развлекательный цифровой документ. Всё вымышлено; реального воздействия на людей нет.'};
}
async function checkout(request,env,user){
  const b=await body(request), key=request.headers.get('Idempotency-Key');
  if(!/^[a-zA-Z0-9_-]{16,80}$/.test(key||''))fail(400,'Нужен идентификатор заказа.');
  const service=CATALOG.find(s=>s.id===b?.serviceId);
  if(!service)fail(400,'Услуга недоступна.');
  if(typeof b.target!=='string'||typeof b.reason!=='string')fail(400,'Заполните имя и причину.');
  const target=b.target.trim(),reason=b.reason.trim();
  if(!target||target.length>70||!reason||reason.length>280)fail(400,'Проверьте длину имени и причины.');
  if(b.acceptance?.rulesVersion!==NOTICE_VERSION||b.acceptance?.dataNoticeVersion!==NOTICE_VERSION||b.acceptance?.entertainment!==true)fail(400,'Ознакомьтесь с правилами и информацией о данных и подтвердите игровой характер покупки.');
  const requestJson=JSON.stringify({serviceId:service.id,target,reason});
  const existing=await statement(env,`SELECT invoice_payload FROM order_details WHERE telegram_user_id=? AND idempotency_key=?`,user,key).first();
  if(existing){const row=await order(env,existing.invoice_payload);if(row.request_json!==requestJson)fail(409,'Этот идентификатор уже относится к другому заказу.');if(row.status==='pending')await recordConsent(env,row.invoice_payload,user).run();return publicOrder(row);}
  const ready=await statement(env,"SELECT value FROM app_config WHERE key='checkout_enabled'").first();
  if(ready?.value!=='1')fail(503,'Касса ещё проходит настройку.');
  const webhookInfo=await bot(env,'getWebhookInfo');
  if(webhookInfo.url!==WEBHOOK)fail(503,'Касса временно недоступна.');
  const payload='p_'+crypto.randomUUID(), expires=Math.floor(Date.now()/1000)+900;
  // Atomic insertion limits each user to 10 orders/hour; all SQL values are bound.
  try{
    await env.DB.batch([
      statement(env,`INSERT INTO payments(telegram_user_id,service_id,amount,invoice_payload) SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM payments WHERE telegram_user_id=? AND created_at>=datetime('now','-1 hour'))<10`,user,service.id,service.stars,payload,user),
      statement(env,`INSERT INTO order_details(invoice_payload,telegram_user_id,idempotency_key,request_json,result_json,expires_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM payments WHERE invoice_payload=?)`,payload,user,key,requestJson,JSON.stringify(makeResult(service,target,reason,payload)),expires,payload),
      recordConsent(env,payload,user)
    ]);
  }catch{
    const concurrent=await statement(env,`SELECT invoice_payload,request_json FROM order_details WHERE telegram_user_id=? AND idempotency_key=?`,user,key).first();
    if(!concurrent)fail(503,'Не удалось сохранить заказ.');
    if(concurrent.request_json!==requestJson)fail(409,'Идентификатор занят другим заказом.');
    return publicOrder(await order(env,concurrent.invoice_payload));
  }
  if(!await order(env,payload))fail(429,'Слишком много заказов. Попробуйте через час.');
  try{
    const link=await bot(env,'createInvoiceLink',{title:service.name,description:service.description+'. Шуточный цифровой документ, без реального магического воздействия.',payload,provider_token:'',currency:'XTR',prices:[{label:service.name,amount:service.stars}]});
    if(typeof link!=='string'||!/^https:\/\/t\.me\/[\w$?=.+%/-]+$/.test(link))fail(502,'Не удалось создать счёт.');
    await statement(env,'UPDATE order_details SET invoice_url=? WHERE invoice_payload=?',link,payload).run();
  }catch(error){await statement(env,"UPDATE payments SET status='invoice_error' WHERE invoice_payload=? AND status='pending'",payload).run();throw error;}
  return publicOrder(await order(env,payload));
}
function recordConsent(env,payload,user){return statement(env,`INSERT OR IGNORE INTO order_consents(invoice_payload,telegram_user_id,rules_version,data_notice_version,entertainment_ack) SELECT ?,?,?,?,1 WHERE EXISTS(SELECT 1 FROM payments WHERE invoice_payload=? AND telegram_user_id=?)`,payload,user,NOTICE_VERSION,NOTICE_VERSION,payload,user);}
function appButtons(){return {inline_keyboard:[[{text:'☠️ Выбрать пакость',web_app:{url:APP+'#services'}}],[{text:'🧾 Мои покупки',web_app:{url:APP+'#purchases'}}],[{text:'Правила и данные',url:APP+'notice.html'}]]};}
// Keep Mini App launches in inline buttons: keyboard web_app launches do not
// supply the same signed initData needed by checkout and private purchases.
function chatMenu(){return {keyboard:[[{text:'🔮 Открыть канцелярию'}],[{text:'🧾 Мои покупки'},{text:'💬 Поддержка'}],[{text:'❓ Помощь'}]],resize_keyboard:true,is_persistent:true,one_time_keyboard:false,input_field_placeholder:'Выберите пункт меню или напишите вопрос'};}
async function sendOnce(env,key,method,payload){
  await statement(env,`INSERT OR IGNORE INTO bot_outbox(event_key,method,payload_json) VALUES(?,?,?)`,key,method,JSON.stringify(payload)).run();
  const now=Math.floor(Date.now()/1000);
  const claimed=await statement(env,`UPDATE bot_outbox SET lease_until=?,attempts=attempts+1 WHERE event_key=? AND status='pending' AND lease_until<=? RETURNING *`,now+30,key,now).first();
  if(!claimed){const row=await statement(env,'SELECT status FROM bot_outbox WHERE event_key=?',key).first();if(row?.status==='pending')fail(503,'Сообщение ожидает отправки.');return;}
  try{await bot(env,claimed.method,JSON.parse(claimed.payload_json));await statement(env,"UPDATE bot_outbox SET status='sent',lease_until=0 WHERE event_key=?",key).run();}
  catch(error){await statement(env,'UPDATE bot_outbox SET status=?,lease_until=0 WHERE event_key=?',error.telegramCode===403?'blocked':'pending',key).run();if(error.telegramCode!==403)throw error;}
}
async function purchaseMessage(env,user){
  const rows=await statement(env,'SELECT invoice_payload,service_id,amount,status FROM payments WHERE telegram_user_id=? ORDER BY id DESC LIMIT 8',user).all();
  if(!rows.results.length)return '🧾 В вашем архиве пока нет покупок. Выберите шуточный документ в каталоге — после оплаты он появится здесь.';
  const labels={paid:'оплачено',pending:'ожидает оплаты',invoice_error:'счёт не создан',refunded:'возвращено'};
  return '🧾 Ваши последние заказы\n\n'+rows.results.map(row=>(CATALOG.find(x=>x.id===row.service_id)?.name||row.service_id)+' · '+row.amount+' ⭐ · '+(labels[row.status]||row.status)+'\n'+row.invoice_payload).join('\n\n')+'\n\nВсе заказы и результаты — по кнопке «Мои покупки». Для текста в чате: /order номер_заказа.';
}
function validPayment(row,payment,user){return row&&payment.currency==='XTR'&&Number.isSafeInteger(payment.total_amount)&&payment.total_amount===row.amount&&String(user)===row.telegram_user_id;}
async function webhook(request,env){
  const supplied=request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if(!equal(supplied,await webhookSecret(env.BOT_TOKEN)))fail(403,'Запрещено.');
  const update=await body(request);
  if(!Number.isSafeInteger(update?.update_id)||update.update_id<0)fail(400,'Некорректное обновление.');
  const q=update.pre_checkout_query;
  if(q){
    const row=typeof q.invoice_payload==='string'?await order(env,q.invoice_payload):null;
    let ok=validPayment(row,q,q.from?.id)&&row.status==='pending'&&row.expires_at>Math.floor(Date.now()/1000)&&typeof q.id==='string';
    if(ok){
      // Reserve for one pre-checkout query. A reused invoice cannot create a second charge.
      await statement(env,`UPDATE order_details SET precheckout_id=? WHERE invoice_payload=? AND (precheckout_id IS NULL OR precheckout_id=?)`,q.id,row.invoice_payload,q.id).run();
      const reserved=await order(env,row.invoice_payload);ok=reserved.precheckout_id===q.id&&reserved.status==='pending';
    }
    await bot(env,'answerPreCheckoutQuery',{pre_checkout_query_id:q.id,ok:Boolean(ok),...(ok?{}:{error_message:'Счёт недоступен, уже использован или истёк. Откройте приложение и создайте новый заказ.'})});
    return {ok:true};
  }
  const message=update.message, payment=message?.successful_payment;
  if(payment){
    const row=typeof payment.invoice_payload==='string'?await order(env,payment.invoice_payload):null;
    const charge=payment.telegram_payment_charge_id;
    if(!validPayment(row,payment,message.from?.id)||typeof charge!=='string'||!charge||charge.length>512||!row.precheckout_id){
      await statement(env,`INSERT OR IGNORE INTO payment_events(update_id,kind,outcome) VALUES(?,'successful_payment','rejected')`,update.update_id).run();return {ok:true};
    }
    // One atomic batch: receipt uniqueness + state transition + event log. Retrying a delivered
    // webhook is harmless. A failed D1 write returns 503 so Telegram retries the delivery.
    await env.DB.batch([
      statement(env,`UPDATE payments SET status='paid',telegram_payment_charge_id=?,paid_at=CURRENT_TIMESTAMP WHERE invoice_payload=? AND status='pending' AND telegram_payment_charge_id IS NULL AND NOT EXISTS(SELECT 1 FROM payments WHERE telegram_payment_charge_id=?)`,charge,row.invoice_payload,charge),
      statement(env,`INSERT OR IGNORE INTO payment_events(update_id,kind,outcome) VALUES(?,'successful_payment',CASE WHEN EXISTS(SELECT 1 FROM payments WHERE invoice_payload=? AND telegram_payment_charge_id=? AND status IN ('paid','refunded')) THEN 'recorded' ELSE 'conflict' END)`,update.update_id,row.invoice_payload,charge)
    ]);
    const recorded=await order(env,row.invoice_payload);
    if(recorded.status==='paid'&&recorded.telegram_payment_charge_id===charge)await sendOnce(env,'paid:'+row.invoice_payload,'sendMessage',{chat_id:Number(row.telegram_user_id),text:'🧾 Оплата подтверждена: '+(CATALOG.find(s=>s.id===row.service_id)?.name||row.service_id)+' · '+row.amount+' ⭐\n\nТатьяна изучила дело, Екатерина поставила печать. Ваш шуточный документ готов. Открывайте его в «Моих покупках» — повторно платить не нужно.\n\nЗаказ: '+row.invoice_payload+'\nПомощь: /paysupport номер заказа и описание.',reply_markup:{inline_keyboard:[[{text:'Открыть купленный результат',web_app:{url:APP+'#order='+row.invoice_payload}}],[{text:'Все мои покупки',web_app:{url:APP+'#purchases'}}]]}});
    return {ok:true};
  }
  const refund=message?.refunded_payment;
  if(refund){
    await env.DB.batch([
      statement(env,`UPDATE payments SET status='refunded' WHERE invoice_payload=? AND telegram_payment_charge_id=? AND amount=? AND ?='XTR' AND status='paid'`,refund.invoice_payload||'',refund.telegram_payment_charge_id||'',refund.total_amount||0,refund.currency||''),
      statement(env,`INSERT OR IGNORE INTO payment_events(update_id,kind,outcome) VALUES(?,'refunded_payment','processed')`,update.update_id)
    ]);return {ok:true};
  }
  if(message?.chat?.type==='private'&&typeof message.text==='string'){
    const menuCommands={'🔮 Открыть канцелярию':'/catalog','🧾 Мои покупки':'/purchases','💬 Поддержка':'/support','❓ Помощь':'/help'};
    const command=menuCommands[message.text.trim()]||message.text.split(/[\s@]/)[0],user=String(message.from.id),eventKey='command:'+update.update_id;
    if(String(message.chat.id)!==user)return {ok:true};
    if(command==='/catalog'){
      await sendOnce(env,eventKey,'sendMessage',{chat_id:message.chat.id,text:'🔮 Канцелярия открыта! Выберите пакость или загляните в свои покупки по кнопкам ниже.',reply_markup:appButtons()});
    }else if(command==='/support'){
      await sendOnce(env,eventKey,'sendMessage',{chat_id:message.chat.id,text:'💬 Поддержка канцелярии\n\nНапишите следующим сообщением, что случилось. Если вопрос о покупке, добавьте номер заказа из «Моих покупок». Обращение сохранится в очереди владельца сервиса. Это не мгновенный чат с оператором.\n\nДля вопроса об оплате или возврате также можно использовать /paysupport номер заказа и описание. Не присылайте пароли, документы и реквизиты карты.',reply_markup:appButtons()});
    }else if(command==='/paysupport'){
      await statement(env,`INSERT OR IGNORE INTO support_requests(update_id,telegram_user_id,message) VALUES(?,?,?)`,update.update_id,String(message.from.id),message.text.slice(0,2000)).run();
      await sendOnce(env,eventKey,'sendMessage',{chat_id:message.chat.id,text:'🐈 Кот-аудитор зарегистрировал обращение № '+update.update_id+'.\n\nВладелец сервиса увидит его в очереди поддержки. Если ещё не описали проблему, отправьте /paysupport номер заказа и подробности. Не присылайте пароли, документы и реквизиты карты.\n\nПокупки можно восстановить по кнопке ниже.',reply_markup:appButtons()});
    }else if(command==='/purchases'||command==='/orders'){
      await sendOnce(env,eventKey,'sendMessage',{chat_id:message.chat.id,text:await purchaseMessage(env,user),reply_markup:appButtons()});
    }else if(command==='/order'){
      const payload=message.text.trim().split(/\s+/)[1]||'';const row=/^p_[a-f0-9-]{36}$/.test(payload)?await order(env,payload):null;
      const text=row&&row.telegram_user_id===user&&row.status==='paid'?JSON.parse(row.result_json).text+'\n\nИсключительно шуточная магия. Заказ: '+row.invoice_payload:'Оплаченный заказ для этого аккаунта не найден. Проверьте номер в «Моих покупках».';
      await sendOnce(env,eventKey,'sendMessage',{chat_id:message.chat.id,text,reply_markup:appButtons()});
    }else if(command==='/privacy'||command==='/terms'){
      await sendOnce(env,eventKey,'sendMessage',{chat_id:message.chat.id,text:'📜 Правила и информация о данных: '+APP+'notice.html\n\nДля заказа сохраняем Telegram ID, введённый текст, результат и сведения о платеже. Для запроса доступа, исправления или удаления данных: /paysupport ваш запрос. Окончательные документы продавца для Казахстана ещё готовятся.',reply_markup:appButtons()});
    }else if(command==='/start'||command==='/help'||command==='/menu'){
      const text='🔮 Добро пожаловать в «Проклинатор душ»!\n\nТатьяна разбирается, что случилось. Екатерина оформляет последствия. Кот-аудитор проверяет печати.\n\nВыберите пакость → придумайте прозвище и ситуацию → получите персональный шуточный документ. Только вымысел и юмор, никакого реального воздействия.\n\n⭐ Оплата — Telegram Stars, без подписки.\n🧾 /purchases — ваши покупки по Telegram ID.\n💬 /paysupport — помощь с заказом.\n📜 /terms и /privacy — правила и данные.';
      const menuHint='\n\n👇 Кнопки меню — под строкой ввода. Если скрылись, нажмите значок клавиатуры или отправьте /menu.';
      if(command==='/start')await sendOnce(env,eventKey,'sendPhoto',{chat_id:message.chat.id,photo:APP+'assets/bot-cover.jpg',caption:text+menuHint,reply_markup:chatMenu()});
      else await sendOnce(env,eventKey,'sendMessage',{chat_id:message.chat.id,text:text+menuHint,reply_markup:chatMenu()});
    }else if(!message.text.startsWith('/')){
      await statement(env,`INSERT OR IGNORE INTO support_requests(update_id,telegram_user_id,message) VALUES(?,?,?)`,update.update_id,user,message.text.slice(0,2000)).run();
      await sendOnce(env,eventKey,'sendMessage',{chat_id:message.chat.id,text:'💬 Сообщение передано в очередь поддержки. Номер обращения: '+update.update_id+'.\nКаталог и ваши документы доступны по кнопкам ниже.',reply_markup:appButtons()});
    }else{
      await sendOnce(env,eventKey,'sendMessage',{chat_id:message.chat.id,text:'Кот не нашёл такую команду. /help — помощь, /purchases — покупки, /paysupport — поддержка.',reply_markup:appButtons()});
    }
  }
  return {ok:true};
}
export default {
  async fetch(request,env){
    const url=new URL(request.url), origin=request.headers.get('Origin');
    const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
    if(origin===ORIGIN){headers['Access-Control-Allow-Origin']=ORIGIN;headers['Access-Control-Allow-Methods']='GET, POST, OPTIONS';headers['Access-Control-Allow-Headers']='Content-Type, Authorization, Idempotency-Key';}
    const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
    try{
      if(url.pathname==='/telegram/webhook'){
        if(request.method!=='POST')return respond({error:'Метод не разрешён.'},405);
        if(!env.BOT_TOKEN||!env.DB)fail(503,'Сервис не настроен.');
        return respond(await webhook(request,env));
      }
      if(origin&&origin!==ORIGIN)fail(403,'Источник не разрешён.');
      if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
      if(url.pathname==='/'&&request.method==='GET')return respond({project:'Проклинатор душ',status:'online',version:VERSION,payments:'verification_required'});
      if(url.pathname==='/api/catalog'&&request.method==='GET')return respond({currency:'XTR',services:CATALOG,noticeVersion:NOTICE_VERSION});
      if(!env.BOT_TOKEN||!env.DB)fail(503,'Касса ещё не настроена.');
      if(!['/api/checkout','/api/orders','/api/account'].includes(url.pathname)&&!/^\/api\/orders\/p_[a-f0-9-]{36}$/.test(url.pathname))fail(404,'Маршрут не найден.');
      if((url.pathname==='/api/checkout'&&request.method!=='POST')||(url.pathname!=='/api/checkout'&&request.method!=='GET'))fail(405,'Метод не разрешён.');
      const auth=request.headers.get('Authorization')||'';
      if(!auth.startsWith('tma '))fail(401,'Откройте приложение через Telegram.');
      const user=await validateInitData(auth.slice(4),env.BOT_TOKEN);
      if(url.pathname==='/api/checkout')return respond(await checkout(request,env,user));
      if(url.pathname==='/api/account')return respond({telegramUserId:user,...await statement(env,"SELECT COUNT(*) total,COALESCE(SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END),0) paid,COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END),0) stars FROM payments WHERE telegram_user_id=?",user).first()});
      if(url.pathname==='/api/orders'){
        const before=Number(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER);if(!Number.isSafeInteger(before)||before<1)fail(400,'Неверная страница.');
        const rows=await statement(env,`SELECT p.*,d.result_json,d.invoice_url,d.expires_at FROM payments p JOIN order_details d USING(invoice_payload) WHERE p.telegram_user_id=? AND p.id<? ORDER BY p.id DESC LIMIT 21`,user,before).all();
        const page=rows.results.slice(0,20);return respond({orders:page.map(row=>publicOrder(row,false)),nextCursor:rows.results.length>20?page.at(-1).id:null});
      }
      const row=await order(env,url.pathname.split('/').pop());
      if(!row||row.telegram_user_id!==user)fail(404,'Заказ не найден.');
      return respond(publicOrder(row));
    }catch(error){return respond({error:error instanceof HttpError?error.message:'Сервис временно недоступен. Повторите проверку позже.'},error instanceof HttpError?error.status:503);}
  }
};
