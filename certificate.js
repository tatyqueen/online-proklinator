'use strict';
function downloadCase(){if(currentCase)savePng('ПРИГОВОР СУДА ВЕДЬМ','Дело № '+currentCase.number+' · '+currentCase.name+'\n'+currentCase.penalty,'Татьяна и Екатерина');}
function certificateLines(context,text,width){
  const lines=[];
  for(const paragraph of String(text).split('\n')){
    let line='';
    for(const word of paragraph.split(/\s+/)){
      if(context.measureText((line?line+' ':'')+word).width<=width){line+=(line?' ':'')+word;continue;}
      if(line){lines.push(line);line='';}
      for(const char of word){if(context.measureText(line+char).width>width&&line){lines.push(line);line='';}line+=char;}
    }
    lines.push(line);
  }
  return lines;
}
function certificateCanvas(title,text,by){
  const canvas=document.createElement('canvas');canvas.width=1080;
  const c=canvas.getContext('2d');if(!c)throw Error('Браузер не смог создать картинку.');
  c.font='bold 52px sans-serif';const heading=certificateLines(c,title,900);
  c.font='34px sans-serif';const bodyLines=certificateLines(c,text,870);
  c.font='30px sans-serif';const author=certificateLines(c,by,900);
  const bodyTop=270+heading.length*68,footerTop=bodyTop+bodyLines.length*51+85;
  canvas.height=Math.max(1350,footerTop+author.length*44+180);
  const bg=c.createLinearGradient(0,0,1080,canvas.height);bg.addColorStop(0,'#4e1a3c');bg.addColorStop(1,'#130d1c');c.fillStyle=bg;c.fillRect(0,0,1080,canvas.height);
  c.strokeStyle='#f39dc4';c.lineWidth=7;c.strokeRect(45,45,990,canvas.height-90);c.textAlign='center';c.fillStyle='#ffb5d4';c.font='bold 35px sans-serif';c.fillText('✦ ТАЙНАЯ КАНЦЕЛЯРИЯ ✦',540,150);
  c.font='bold 52px sans-serif';heading.forEach((line,i)=>c.fillText(line,540,260+i*68));
  c.fillStyle='#fff2f8';c.font='34px sans-serif';bodyLines.forEach((line,i)=>c.fillText(line,540,bodyTop+i*51));
  const footer=Math.max(footerTop,canvas.height-author.length*44-180);c.fillStyle='#ffc5db';c.font='30px sans-serif';author.forEach((line,i)=>c.fillText(line,540,footer+i*44));
  c.font='24px sans-serif';c.fillText('ИСКЛЮЧИТЕЛЬНО ШУТОЧНАЯ МАГИЯ',540,canvas.height-100);return canvas;
}
function savePng(title,text,by){
  document.getElementById('certificateDialog')?.close();
  const dialog=document.createElement('dialog');dialog.id='certificateDialog';dialog.setAttribute('aria-label','Сохранить сертификат');
  dialog.style.cssText='box-sizing:border-box;width:min(94vw,600px);max-height:90dvh;overflow:auto;background:#211428;color:#fff0f7;border:1px solid #b873a1;border-radius:20px;padding:20px;';
  dialog.innerHTML='<h2>Ваш сертификат</h2><p>Выберите способ сохранения.</p><div class="certificateActions"></div><p role="status">Подготавливаем PNG…</p><img alt="Готовый сертификат" style="display:block;width:100%;height:auto;border-radius:10px"><p>Если скачивание не началось, попробуйте «Поделиться файлом» или удерживайте картинку и выберите сохранение изображения.</p><button class="secondary" type="button">Закрыть</button>';
  document.body.append(dialog);const status=dialog.querySelector('[role="status"]'),actions=dialog.querySelector('.certificateActions');
  let objectUrl;const cleanup=()=>{if(objectUrl)URL.revokeObjectURL(objectUrl);dialog.remove();};dialog.addEventListener('close',cleanup,{once:true});dialog.querySelector('button').onclick=()=>dialog.close();dialog.showModal();
  try{
    const canvas=certificateCanvas(title,text,by),dataUrl=canvas.toDataURL('image/png');dialog.querySelector('img').src=dataUrl;
    canvas.toBlob(blob=>{
      if(!dialog.isConnected)return;
      if(!blob){status.textContent='Не удалось подготовить файл. Попробуйте сохранить картинку ниже.';return;}
      const name='proklinator-'+Date.now()+'.png';objectUrl=URL.createObjectURL(blob);
      const download=document.createElement('a');download.className='primary';download.textContent='⬇️ Скачать PNG';download.href=objectUrl;download.download=name;download.style.cssText='display:block;text-align:center;text-decoration:none';download.onclick=()=>{status.textContent='Запрос на скачивание передан браузеру. Если файл не появился, выберите другой способ ниже.';};actions.append(download);
      if(typeof File==='function'&&navigator.canShare&&navigator.share){const file=new File([blob],name,{type:'image/png'});if(navigator.canShare({files:[file]})){const shareButton=document.createElement('button');shareButton.className='secondary';shareButton.textContent='📤 Поделиться файлом / сохранить';shareButton.onclick=async()=>{try{await navigator.share({files:[file],title:'Сертификат канцелярии'});status.textContent='Файл передан в меню устройства.';}catch(e){status.textContent=e.name==='AbortError'?'Сохранение отменено. Можно выбрать другой способ.':'Устройство не открыло меню. Попробуйте скачать PNG или получить файл в боте.';}};actions.append(shareButton);}}
      if(window.Telegram?.WebApp?.initData){const send=document.createElement('button');send.className='primary';send.textContent='📎 Получить файл в Telegram';send.onclick=async()=>{send.disabled=true;status.textContent='Отправляем файл в ваш личный чат с ботом…';try{await api('/api/certificate',{method:'POST',body:JSON.stringify({png:dataUrl.split(',')[1]})});status.textContent='Файл отправлен в чат с ботом. Сверните приложение и сохраните документ из сообщения.';send.textContent='✓ Файл отправлен';}catch(e){status.textContent=e.message;send.disabled=false;}};actions.append(send);}
      status.textContent='PNG готов. Выберите кнопку выше.';
    },'image/png');
  }catch(e){status.textContent='Не удалось создать сертификат: '+e.message;}
}
