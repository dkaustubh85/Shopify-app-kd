import {readFileSync,writeFileSync} from 'node:fs';
const [mode,...args]=process.argv.slice(2);
const root='http://127.0.0.1:9333';
if(mode==='open'){const url='https://partners.shopify.com/4727112/apps/446018453505/distribution';const r=await fetch(root+'/json/new?'+encodeURIComponent(url),{method:'PUT'});if(!r.ok)throw new Error('Could not open dashboard');console.log('Opened StockSheet distribution');process.exit(0);}
const ts=await(await fetch(root+'/json/list')).json();const t=ts.find(t=>t.type==='page'&&(t.url.startsWith('https://apps.shopify.com/services/pricing/fe6a76a80017a63cbc948eed99d2f5c9')||t.url.startsWith('https://apps.shopify.com/services/partner-app-submissions/fe6a76a80017a63cbc948eed99d2f5c9/')||t.url.startsWith('https://partners.shopify.com/4727112/apps/446018453505')||t.url.startsWith('https://dev.shopify.com/dashboard/203860982/apps/446018453505')));if(!t)throw new Error('StockSheet dashboard tab not found');
const ws=new WebSocket(t.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let seq=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}});function call(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
try{
if(mode==='dismiss-dialog'){await call('Page.handleJavaScriptDialog',{accept:false});console.log('Stayed on current page');}
if(mode==='eval'){const r=await call('Runtime.evaluate',{expression:readFileSync(0,'utf8'),returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);console.log(JSON.stringify(r.result.value));}
if(mode==='upload'){const doc=await call('DOM.getDocument');const node=await call('DOM.querySelector',{nodeId:doc.root.nodeId,selector:args[0].startsWith("id=")?"[id="+JSON.stringify(args[0].slice(3))+"]":args[0]});if(!node.nodeId)throw new Error('File input not found');await call('DOM.setFileInputFiles',{nodeId:node.nodeId,files:args.slice(1)});console.log('Selected listing asset');}
if(mode==='capture'){await call('Page.bringToFront');const r=await call('Page.captureScreenshot',{format:'png'});writeFileSync(args[0],Buffer.from(r.data,'base64'));console.log('Saved dashboard screenshot');}
}finally{ws.close();}

