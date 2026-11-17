import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import worker,{SCHEMA,WEBHOOK,ORIGIN,validateInitData,webhookSecret} from '../worker.js';

const TOKEN='123456:test-token-only-not-real';
function signed(user=123,age=0,extra={}){
  const p=new URLSearchParams({auth_date:String(Math.floor(Date.now()/1000)-age),user:JSON.stringify({id:user,first_name:'Test'}),...extra});p.sort();
  const key=createHmac('sha256','WebAppData').update(TOKEN).digest();
  p.set('hash',createHmac('sha256',key).update([...p].map(([k,v])=>k+'='+v).join('\n')).digest('hex'));return p.toString();
}
function database(){
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');SCHEMA.forEach(sql=>db.exec(sql));db.exec("INSERT INTO app_config VALUES('checkout_enabled','1')");
  const adapter={prepare(sql){return {bind(...args){return {async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};}};}};},async batch(items){db.exec('BEGIN');try{const values=[];for(const item of items)values.push(await item.run());db.exec('COMMIT');return values;}catch(e){db.exec('ROLLBACK');throw e;}}};return {db,adapter};
}
function fixture(){
  const {db,adapter}=database(),calls=[];const env={DB:adapter,BOT_TOKEN:TOKEN};
  let invoiceError=false;
  globalThis.fetch=async(url,opts)=>{const method=url.split('/').pop(),data=JSON.parse(opts.body);calls.push({method,data});
    if(method==='createInvoiceLink'&&invoiceError)return Response.json({ok:false,description:'token-must-not-leak'},{status:500});
    const result=method==='getWebhookInfo'?{url:WEBHOOK}:method==='createInvoiceLink'?'https://t.me/$test_'+calls.length:true;
    return Response.json({ok:true,result});};
  async function api(path,options={}){const {user=123,key='idempotency-key-12345',origin=ORIGIN,auth=signed(user),...rest}=options;const headers={Origin:origin,Authorization:'tma '+auth,'Content-Type':'application/json','Idempotency-Key':key,...rest.headers};const response=await worker.fetch(new Request('https://example.test'+path,{...rest,headers}),env);return {status:response.status,headers:response.headers,data:response.status===204?null:await response.json()};}
  const buy=(options={})=>api('/api/checkout',{method:'POST',body:JSON.stringify({serviceId:'wifi',target:'Тест',reason:'Шутка',amount:1}),...options});
  const hook=async(update,secret)=>api('/telegram/webhook',{method:'POST',body:JSON.stringify(update),headers:{'X-Telegram-Bot-Api-Secret-Token':secret??await webhookSecret(TOKEN)}});
  const pre=(id,qid='query-one',user=123,extra={})=>hook({update_id:1,pre_checkout_query:{id:qid,from:{id:user},invoice_payload:id,currency:'XTR',total_amount:19,...extra}});
  const success=(id,charge='charge-one',extra={},update=2)=>hook({update_id:update,message:{from:{id:123},successful_payment:{invoice_payload:id,currency:'XTR',total_amount:19,telegram_payment_charge_id:charge,...extra}}});
  return {db,env,calls,api,buy,hook,pre,success,setInvoiceError(){invoiceError=true;}};
}
test('signed initData: independent HMAC vector, signature field, Unicode',async()=>{assert.equal(await validateInitData(signed(123,0,{signature:'signature-data',start_param:'Привет'}),TOKEN),'123');});
test('reject forged, stale, future and duplicate initData',async()=>{
  for(const raw of [signed().replace('Test','Hacker'),signed(123,3601),signed(123,-90),signed()+'&user={}'])await assert.rejects(validateInitData(raw,TOKEN));
});
test('catalog and exact-origin CORS; missing auth and wrong methods',async()=>{const f=fixture();const r=await f.api('/api/catalog');assert.deepEqual(r.data.services.map(x=>x.stars),[19,39,69,19,29]);assert.equal(r.headers.get('Access-Control-Allow-Origin'),ORIGIN);assert.equal((await f.api('/api/catalog',{origin:'https://evil.test'})).status,403);assert.equal((await f.api('/api/orders',{auth:''})).status,401);assert.equal((await f.api('/api/checkout')).status,405);assert.equal((await f.api('/api/checkout',{method:'OPTIONS'})).status,204);});
test('checkout uses server price and XTR; pending response conceals result',async()=>{const f=fixture();const r=await f.buy();assert.equal(r.status,200);assert.equal(r.data.amount,19);assert.equal(r.data.status,'pending');assert.equal(r.data.result,undefined);const invoice=f.calls.find(x=>x.method==='createInvoiceLink').data;assert.equal(invoice.currency,'XTR');assert.equal(invoice.provider_token,'');assert.equal(invoice.prices.length,1);assert.equal(invoice.prices[0].amount,19);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM payments').get().n,1);});
test('same idempotency key creates a single invoice, changed content rejected',async()=>{const f=fixture();const a=await f.buy(),b=await f.buy();assert.equal(a.data.orderId,b.data.orderId);assert.equal(f.calls.filter(x=>x.method==='createInvoiceLink').length,1);assert.equal((await f.buy({body:JSON.stringify({serviceId:'poison',target:'other',reason:'x'})})).status,409);});
test('concurrent identical checkout has one order and one invoice',async()=>{const f=fixture();const results=await Promise.all([f.buy(),f.buy()]);assert.ok(results.every(r=>r.status===200));assert.equal(results[0].data.orderId,results[1].data.orderId);assert.equal(f.calls.filter(x=>x.method==='createInvoiceLink').length,1);});
test('unknown service and invalid personalisation rejected',async()=>{const f=fixture();for(const b of [{serviceId:'vip',target:'x',reason:'x'},{serviceId:'wifi',target:'x'.repeat(71),reason:'x'}])assert.equal((await f.buy({body:JSON.stringify(b)})).status,400);});
test('secret required; no forged successful_payment can unlock result',async()=>{const f=fixture();const r=await f.buy();assert.equal((await f.hook({update_id:1},'forged')).status,403);await f.success(r.data.orderId);assert.equal((await f.api('/api/orders/'+r.data.orderId)).data.status,'pending');});
test('pre-checkout validates currency, amount, buyer, expiry and query reuse',async()=>{const f=fixture();const id=(await f.buy()).data.orderId;
  for(const [user,extra] of [[999,{}],[123,{currency:'USD'}],[123,{total_amount:1}]]){await f.pre(id,'bad',user,extra);assert.equal(f.calls.at(-1).data.ok,false);}
  await f.pre(id);assert.equal(f.calls.at(-1).data.ok,true);await f.pre(id);assert.equal(f.calls.at(-1).data.ok,true);await f.pre(id,'second');assert.equal(f.calls.at(-1).data.ok,false);
  f.db.prepare('UPDATE order_details SET expires_at=0').run();await f.pre(id);assert.equal(f.calls.at(-1).data.ok,false);
});
test('confirmed payment unlocks only owner; duplicate update and charge idempotent',async()=>{const f=fixture();const id=(await f.buy()).data.orderId;await f.pre(id);await f.success(id);await f.success(id);await f.success(id,'charge-one',{},3);const own=await f.api('/api/orders/'+id);assert.equal(own.data.status,'paid');assert.equal(own.data.result.target,'Тест');assert.equal((await f.api('/api/orders/'+id,{user:999})).status,404);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM payments WHERE status='paid'").get().n,1);await f.pre(id);assert.equal(f.calls.at(-1).data.ok,false);});
test('wrong successful amount/currency/buyer do not mark paid',async()=>{const f=fixture();const id=(await f.buy()).data.orderId;await f.pre(id);await f.success(id,'bad',{total_amount:1});await f.success(id,'bad',{currency:'EUR'},3);await f.hook({update_id:4,message:{from:{id:999},successful_payment:{invoice_payload:id,total_amount:19,currency:'XTR',telegram_payment_charge_id:'bad'}}});assert.equal((await f.api('/api/orders/'+id)).data.status,'pending');});
test('same charge cannot pay two orders; late legitimate success is accepted',async()=>{const f=fixture();const a=(await f.buy()).data.orderId,b=(await f.buy({key:'idempotency-key-other'})).data.orderId;await f.pre(a);await f.pre(b,'query-two');await f.success(a);await f.success(b,'charge-one',{},4);assert.equal((await f.api('/api/orders/'+b)).data.status,'pending');f.db.prepare('UPDATE order_details SET expires_at=0').run();await f.success(b,'charge-two',{},5);assert.equal((await f.api('/api/orders/'+b)).data.status,'paid');});
test('D1 write failure requests Telegram retry; retried payment is persisted',async()=>{const f=fixture();const id=(await f.buy()).data.orderId;await f.pre(id);const batch=f.env.DB.batch;f.env.DB.batch=async()=>{throw Error('db down');};assert.equal((await f.success(id)).status,503);f.env.DB.batch=batch;assert.equal((await f.success(id)).status,200);assert.equal((await f.api('/api/orders/'+id)).data.status,'paid');});
test('invoice failure does not expose secrets or mark paid',async()=>{const f=fixture();f.setInvoiceError();const r=await f.buy();assert.equal(r.status,502);assert.ok(!JSON.stringify(r.data).includes('token'));assert.equal(f.db.prepare('SELECT status FROM payments').get().status,'invoice_error');});
test('refund removes future access; replay success cannot restore it',async()=>{const f=fixture();const id=(await f.buy()).data.orderId;await f.pre(id);await f.success(id);await f.hook({update_id:5,message:{refunded_payment:{invoice_payload:id,currency:'XTR',total_amount:19,telegram_payment_charge_id:'charge-one'}}});await f.success(id,'charge-one',{},6);const result=await f.api('/api/orders/'+id);assert.equal(result.data.status,'refunded');assert.equal(result.data.result,undefined);});
test('hourly limit and disabled checkout enforced',async()=>{const f=fixture();for(let i=0;i<10;i++)assert.equal((await f.buy({key:'limit-test-key-0000'+i})).status,200);assert.equal((await f.buy({key:'limit-test-key-final'})).status,429);f.db.prepare("UPDATE app_config SET value='0'").run();assert.equal((await f.buy({user:222,key:'disabled-key-000000'})).status,503);});
test('payment support request survives retry without duplicate ticket',async()=>{const f=fixture();const update={update_id:10,message:{chat:{id:123,type:'private'},from:{id:123},text:'/paysupport p_order проблема'}};await f.hook(update);await f.hook(update);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM support_requests').get().n,1);});
test('frontend scripts parse; client callback does not grant purchase',()=>{const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);const js=readFileSync(new URL('../checkout.js',import.meta.url),'utf8');new vm.Script(js);assert.ok(html.includes('src="checkout.js"'));assert.ok(!html.includes('const shopItems='));assert.ok(js.includes("api('/api/orders/'+encodeURIComponent(id))"));});
