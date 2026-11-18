import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const code=readFileSync(new URL('../certificate.js',import.meta.url),'utf8');
test('rendered court download handler parses and exports the current verdict',()=>{
  const start=html.indexOf('function renderTrial('),end=html.indexOf('\nfunction ',start);
  assert.ok(start>0&&end>start);assert.ok(html.includes('certificate.js?v=20261118.1'));
  const elements=new Map(),context=vm.createContext({currentCase:{number:12,name:'Тест',charge:'Шутка',penalty:'Первый приговор'},esc:String,go(){},sparks(){},$(id){if(!elements.has(id))elements.set(id,{classList:{add(){},remove(){}},scrollIntoView(){}});return elements.get(id);}});
  vm.runInContext(code,context);vm.runInContext(html.slice(start,end),context);vm.runInContext('renderTrial(currentCase)',context);
  const markup=elements.get('courtScene').innerHTML;
  for(const [,handler] of markup.matchAll(/onclick="([^"]*)"/g))new vm.Script(handler);
  const handler=markup.match(/onclick="([^"]*)">⬇️ Скачать сертификат/)[1];
  let result;context.savePng=(...args)=>{result=args;};vm.runInContext(handler,context);
  assert.equal(result[0],'ПРИГОВОР СУДА ВЕДЬМ');assert.ok(result[1].includes('Тест\nПервый приговор'));
  context.currentCase.penalty='Приговор после апелляции';vm.runInContext(handler,context);assert.ok(result[1].includes('Приговор после апелляции'));
});
test('certificate layout preserves line breaks and wraps long unbroken names',()=>{
  const context=vm.createContext({});vm.runInContext(code,context);
  const lines=context.certificateLines({measureText:s=>({width:s.length*10})},'Имя\n'+('Я'.repeat(150)),900);
  assert.equal(lines[0],'Имя');assert.equal(lines.slice(1).join(''),'Я'.repeat(150));assert.ok(lines.every(x=>x.length<=90));
});
