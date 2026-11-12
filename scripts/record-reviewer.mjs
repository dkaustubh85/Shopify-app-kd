import {writeFileSync} from 'node:fs';
const [out,duration='210']=process.argv.slice(2);
const targets=await(await fetch('http://127.0.0.1:9333/json/list')).json();
const t=targets.find(t=>t.type==='page'&&t.url.startsWith('https://admin.shopify.com/store/kaustubhs-test-shop/apps/stocksheet'));
if(!t)throw Error('App tab missing');
const ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let seq=0;const pending=new Map();
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
const evaluate=async(expression)=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
try{
 await call('Page.bringToFront');await call('Emulation.setDeviceMetricsOverride',{width:1824,height:1200,deviceScaleFactor:1,mobile:false});await call('Page.reload');await new Promise(r=>setTimeout(r,8000));
 const rect=await evaluate(`(()=>{const r=Array.from(document.querySelectorAll('iframe')).find(e=>e.src.startsWith('https://stocksheet-web.onrender.com/')).getBoundingClientRect();return {x:r.x,y:r.y,width:1600,height:900,scale:1};})()`);
 await evaluate(`(()=>{window.__demoCaption='StockSheet — real development-store walkthrough';const c=document.createElement('canvas');c.width=1600;c.height=960;window.__demoCanvas=c;window.__demoChunks=[];window.__demoRecorder=new MediaRecorder(c.captureStream(5),{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:1400000});window.__demoRecorder.ondataavailable=e=>window.__demoChunks.push(e.data);window.__demoRecorder.start(1000);return true})()`);
 console.log('Recording started; app content only.');
 const start=Date.now();let frames=0;
 while(Date.now()-start<Number(duration)*1000){
  const shot=await call('Page.captureScreenshot',{format:'jpeg',quality:80,clip:rect,captureBeyondViewport:false,fromSurface:true});
  await evaluate(`(async()=>{const i=new Image();i.src='data:image/jpeg;base64,${shot.data}';await i.decode();const x=window.__demoCanvas.getContext('2d');x.drawImage(i,0,0,1600,900);x.fillStyle='#102e24';x.fillRect(0,900,1600,60);x.fillStyle='white';x.font='24px sans-serif';x.fillText(window.__demoCaption||'StockSheet',24,939,1552);return true})()`);
  frames++;await new Promise(r=>setTimeout(r,450));
 }
 await evaluate(`new Promise(r=>{window.__demoRecorder.onstop=async()=>{const b=new Blob(window.__demoChunks,{type:'video/webm'});const f=new FileReader();f.onload=()=>{window.__demoVideo=f.result.split(',')[1];r(true)};f.readAsDataURL(b)};window.__demoRecorder.stop()})`);
 const length=await evaluate('window.__demoVideo.length');const parts=[];for(let i=0;i<length;i+=400000)parts.push(await evaluate(`window.__demoVideo.slice(${i},${i+400000})`));writeFileSync(out,Buffer.from(parts.join(''),'base64'));console.log(JSON.stringify({saved:out,seconds:Number(duration),frames,bytes:Buffer.from(parts.join(''),'base64').length}));
}finally{ws.close();}
