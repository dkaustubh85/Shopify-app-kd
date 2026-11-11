/* eslint-disable no-control-regex -- Deliberately reject control characters in filenames. */
import test from "node:test";
import assert from "node:assert/strict";
import {fetchAttachment,attachmentName,safeFilename} from "../app/utils/download.ts";

const url="/app/download?kind=sample";
const excel="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
function response(type=excel,name="sample.xlsx"){
 return new Response(new Uint8Array([80,75,3,4]),{headers:{"content-type":type,"content-disposition":'attachment; filename="'+name+'"'}});
}
test("download fetch sends a fresh session token and returns the attachment bytes",async()=>{
 let tokens=0;
 const fetcher=(async(input,init)=>{
  assert.equal(input,url);assert.equal(init?.credentials,"same-origin");assert.equal(init?.redirect,"error");
  assert.equal(new Headers(init?.headers).get("authorization"),"Bearer token1");
  return response();
 }) as typeof fetch;
 const result=await fetchAttachment(url,async()=>{tokens++;return "token"+tokens;},fetcher);
 assert.equal(result.filename,"sample.xlsx");
 assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()),new Uint8Array([80,75,3,4]));
 assert.equal(tokens,1);
});
test("401 triggers one token refresh and identical local download request",async()=>{
 const headers:string[]=[],urls:unknown[]=[];
 let tokens=0;
 const fetcher=(async(input,init)=>{
  urls.push(input);headers.push(new Headers(init?.headers).get("authorization")!);
  return urls.length===1?new Response(null,{status:401}):response("text/csv; charset=utf-8","stock.csv");
 }) as typeof fetch;
 const result=await fetchAttachment(url,async()=>"token"+(++tokens),fetcher);
 assert.equal(result.filename,"stock.csv");assert.deepEqual(urls,[url,url]);
 assert.deepEqual(headers,["Bearer token1","Bearer token2"]);
});
test("repeated 401 stops after two attempts and exposes a useful error",async()=>{
 let requests=0;
 const fetcher=(async()=>{requests++;return Response.json({error:"Sign in again."},{status:401});}) as typeof fetch;
 await assert.rejects(fetchAttachment(url,async()=>"token",fetcher),/Sign in again/);
 assert.equal(requests,2);
});
test("HTML auth responses and redirects cannot become downloaded spreadsheets",async()=>{
 const html=(async()=>new Response("<html>Sign in</html>",{headers:{"content-type":"text/html"}})) as typeof fetch;
 await assert.rejects(fetchAttachment(url,async()=>"token",html),/sign-in expired/);
 const redirect=(async(_input,init)=>{assert.equal(init?.redirect,"error");return Response.redirect("https://accounts.shopify.com/",302);}) as typeof fetch;
 await assert.rejects(fetchAttachment(url,async()=>"token",redirect),/Reopen StockSheet/);
});
test("only same-app download paths are fetched and rejected URLs never request a token",async()=>{
 let requests=0,tokens=0;
 const fetcher=(async()=>{requests++;return response();}) as typeof fetch;
 for(const path of ["https://evil.test/app/download?kind=sample","//evil.test/app/download?kind=sample","/app/download","/app/download?kind=sample#external","/app/../download?kind=sample","\\evil.test\\app\\download?kind=sample"]){
  await assert.rejects(fetchAttachment(path,async()=>{tokens++;return "token";},fetcher),/StockSheet download/);
 }
 assert.equal(requests,0);assert.equal(tokens,0);
});
test("filename sanitizing removes controls and path separators while retaining Unicode",()=>{
 const result=safeFilename('..\\folder/evil\u0000"\r\n.xlsx');
 assert.ok(!/[\u0000-\u001f\u007f<>:"/\\|?*]/.test(result));
 assert.ok(!result.startsWith("."));
 assert.equal(safeFilename("Café weekly.csv"),"Café weekly.csv");
 assert.equal(safeFilename("..."),"stocksheet.xlsx");
 assert.ok(safeFilename("a".repeat(300)+".csv").length<=180);
});
test("attachment names support RFC5987 Unicode and malformed encodings safely",()=>{
 assert.equal(attachmentName("attachment; filename=\"fallback.xlsx\"; filename*=UTF-8''Caf%C3%A9.xlsx"),"Café.xlsx");
 assert.equal(attachmentName("attachment; filename=\"fallback.csv\"; filename*=UTF-8''%E0%A4%A"),"fallback.csv");
 assert.equal(attachmentName('attachment; filename="../../evil.csv"'),"_.._evil.csv");
 assert.equal(attachmentName(null),"stocksheet.xlsx");
});
test("empty spreadsheet payloads and server-side JSON failures are clearly rejected",async()=>{
 const empty=(async()=>new Response(null,{headers:{"content-type":excel}})) as typeof fetch;
 await assert.rejects(fetchAttachment(url,async()=>"token",empty),/no rows/);
 const missing=(async()=>Response.json({error:"Upload not found."},{status:404})) as typeof fetch;
 await assert.rejects(fetchAttachment(url,async()=>"token",missing),/Upload not found/);
});
