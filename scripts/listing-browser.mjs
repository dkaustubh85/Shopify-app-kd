import {writeFileSync,readFileSync,mkdirSync} from 'node:fs';
const [mode,...args]=process.argv.slice(2);
const targets=await (await fetch('http://127.0.0.1:9333/json/list')).json();
const target=targets.find(t=>mode==='viewport'||mode==='capture'||mode==='parent'?t.type==='page'&&t.url.startsWith('https://admin.shopify.com/store/kaustubhs-test-shop/apps/stocksheet'):t.type==='iframe'&&t.url.startsWith('https://stocksheet-web.onrender.com/'));
if(!target) throw new Error('StockSheet browser target not found');
const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let seq=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}});
function call(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
try {
if(mode==='eval'||mode==='parent'){const r=await call('Runtime.evaluate',{expression:args[0] || readFileSync(0,"utf8"),returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);console.log(JSON.stringify(r.result.value));}
if(mode==='viewport'){await call('Emulation.setDeviceMetricsOverride',{width:Number(args[0]),height:Number(args[1]),deviceScaleFactor:1,mobile:false});console.log('Viewport set');}
if(mode==='framecapture'){const r=await call('Page.captureScreenshot',{format:'jpeg',quality:92,fromSurface:true,captureBeyondViewport:true});writeFileSync(args[0],Buffer.from(r.data,'base64'));console.log('Saved frame screenshot');}
if(mode==='upload'){const d=await call('DOM.getDocument');const n=await call('DOM.querySelector',{nodeId:d.root.nodeId,selector:'input[type=file]'});await call('DOM.setFileInputFiles',{nodeId:n.nodeId,files:[args[0]]});console.log('Sample file selected');}
if(mode==='capture'){await call('Page.bringToFront');await call('Emulation.setDeviceMetricsOverride',{width:1824,height:1200,deviceScaleFactor:1,mobile:false});await call('Page.reload');await new Promise(r=>setTimeout(r,8000));const rect=await call('Runtime.evaluate',{expression:"JSON.stringify(Array.from(document.querySelectorAll('iframe')).find(e=>e.src.startsWith('https://stocksheet-web.onrender.com/')).getBoundingClientRect())",returnByValue:true});const bounds=JSON.parse(rect.result.value);console.log(JSON.stringify({bounds}));const clip={x:bounds.x,y:bounds.y+(Number(args[1])||0),width:1600,height:900};let r;for(let attempt=0;attempt<4;attempt++){await call('Runtime.evaluate',{expression:"window.dispatchEvent(new Event('resize'));window.scrollTo(0,0)"});await new Promise(r=>setTimeout(r,1200));r=await call('Page.captureScreenshot',{format:'jpeg',quality:92,clip:{...clip,scale:1},captureBeyondViewport:false,fromSurface:true});if(Buffer.from(r.data,'base64').length>18000)break;}if(Buffer.from(r.data,'base64').length<18000)throw new Error('Blank capture; image not saved');writeFileSync(args[0],Buffer.from(r.data,'base64'));console.log('Saved '+args[0]);}
}finally{ws.close();}

