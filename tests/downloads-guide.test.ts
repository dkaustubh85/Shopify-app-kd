import test, {after, beforeEach} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import * as XLSX from "xlsx";
import {attachmentName} from "../app/utils/download.ts";

const directory=mkdtempSync(join(tmpdir(),"stocksheet-downloads-"));
process.env.DATABASE_URL="file:"+join(directory,"test.db").replaceAll("\\","/");
process.env.NODE_ENV="test";
writeFileSync(join(directory,"test.db"),"");
execFileSync(process.execPath,[resolve("node_modules/prisma/build/index.js"),"migrate","deploy"],{env:process.env,stdio:"pipe"});
const {default:db}=await import("../app/db.server.ts");
const {historyDownload,fileType,EXCEL_TYPE}=await import("../app/services/downloads.server.ts");
const {readGuide,saveGuide,GUIDE_STEPS,GUIDE_VERSION}=await import("../app/services/guide.server.ts");
const shop="one.myshopify.com",other="two.myshopify.com";

beforeEach(async()=>{await db.upload.deleteMany();await db.userGuide.deleteMany();});
after(async()=>{await db.$disconnect();rmSync(directory,{recursive:true,force:true});});
async function fixture(fileName="weekly.csv",contents?:Uint8Array){
 return db.upload.create({data:{
  shopId:shop,fileName,action:"soldOut",locationId:"loc",staffName:"Test staff",status:"completed",mapping:{sku:"SKU"},
  ...(contents?{file:{create:{contents:Buffer.from(contents),mimeType:fileType(fileName),sha256:createHash("sha256").update(contents).digest("hex")}}}:{}),
  rows:{create:[
   {rowIndex:3,source:{SKU:"002",Barcode:"000124",Quantity:"3"},matchKey:"missing",status:"unmatched",errorMessage:"No match"},
   {rowIndex:2,source:{SKU:"001",Barcode:"000123",Quantity:"0"},matchKey:"001",status:"success",previousQty:10,newQty:0,applied:true},
   {rowIndex:4,source:{SKU:"003",Barcode:"000125",Quantity:"2"},matchKey:"003",status:"error",errorMessage:"Stock changed"},
   {rowIndex:5,source:{SKU:"004",Barcode:"000126",Quantity:"1"},matchKey:"004",status:"undo_conflict",errorMessage:"Newer change"},
  ]}
 }});
}
function sheet(bytes:Uint8Array){
 const book=XLSX.read(bytes,{type:"array",raw:true});
 return XLSX.utils.sheet_to_json<Record<string,string>>(book.Sheets[book.SheetNames[0]],{raw:false,defval:""});
}
test("original download returns exact retained bytes, MIME and Unicode filename for every input format",async()=>{
 for(const [filename,mime] of [["Café weekly.csv","text/csv; charset=utf-8"],["weekly.xls","application/vnd.ms-excel"],["weekly.xlsx",EXCEL_TYPE]]){
  const original=new Uint8Array([0xef,0xbb,0xbf,83,75,85,44,0,255,10]);
  const upload=await fixture(filename,original);
  const response=await historyDownload(shop,upload.id,"upload");
  assert.equal(response.status,200);
  assert.equal(response.headers.get("content-type"),mime);
  assert.equal(attachmentName(response.headers.get("content-disposition")),filename);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),original);
  assert.equal(response.headers.get("cache-control"),"private, no-store");
  assert.equal(response.headers.get("x-content-type-options"),"nosniff");
 }
});
test("all history download variants deny another shop and missing IDs",async()=>{
 const upload=await fixture("weekly.csv",new Uint8Array([1,2,3]));
 for(const kind of ["upload","results","unmatched"] as const){
  const response=await historyDownload(other,upload.id,kind);
  assert.equal(response.status,404);
  assert.deepEqual(await response.json(),{error:"Upload not found."});
  assert.equal((await historyDownload(shop,"missing",kind)).status,404);
 }
});
test("legacy upload rebuilds Excel in row order without losing identifier zeroes",async()=>{
 const upload=await fixture("legacy.csv");
 const response=await historyDownload(shop,upload.id,"upload");
 assert.equal(response.headers.get("content-type"),EXCEL_TYPE);
 assert.equal(attachmentName(response.headers.get("content-disposition")),"legacy-rebuilt.xlsx");
 const rows=sheet(new Uint8Array(await response.arrayBuffer()));
 assert.deepEqual(rows.map(r=>r.SKU),["001","002","003","004"]);
 assert.equal(rows[0].Barcode,"000123");
 assert.equal(rows[0].Quantity,"0");
});
test("results CSV includes every source row with accurate row-level outcomes",async()=>{
 const upload=await fixture();
 const response=await historyDownload(shop,upload.id,"results");
 assert.equal(attachmentName(response.headers.get("content-disposition")),"weekly-results.csv");
 assert.match(response.headers.get("content-type")!,/^text\/csv/);
 const rows=sheet(new Uint8Array(await response.arrayBuffer()));
 assert.equal(rows.length,4);
 assert.equal(rows[0].SKU,"001");assert.equal(rows[0].Barcode,"000123");
 assert.equal(rows[0]["StockSheet row"],"2");
 assert.equal(rows[0]["StockSheet status"],"success");
 assert.equal(rows[0]["Previous quantity"],"10");assert.equal(rows[0]["New quantity"],"0");
 assert.equal(rows[2]["StockSheet error"],"Stock changed");
});
test("unmatched CSV includes failures and undo conflicts while excluding successful rows",async()=>{
 const upload=await fixture();
 const response=await historyDownload(shop,upload.id,"unmatched");
 const rows=sheet(new Uint8Array(await response.arrayBuffer()));
 assert.deepEqual(rows.map(r=>r.SKU),["002","003","004"]);
 assert.deepEqual(rows.map(r=>r["StockSheet error"]),["No match","Stock changed","Newer change"]);
});
test("empty unmatched selection returns a useful header-only CSV",async()=>{
 const upload=await fixture();
 await db.uploadRow.updateMany({where:{uploadId:upload.id},data:{status:"success"}});
 const response=await historyDownload(shop,upload.id,"unmatched");
 assert.equal(await response.text(),'"StockSheet error"\r\n');
});
test("guide state persists separately per staff member and per shop",async()=>{
 assert.deepEqual(await readGuide(shop,"staff1"),{step:0,status:"in_progress"});
 await saveGuide(shop,"staff1",2,"in_progress");
 assert.deepEqual(await readGuide(shop,"staff1"),{step:2,status:"in_progress"});
 assert.deepEqual(await readGuide(shop,"staff2"),{step:0,status:"in_progress"});
 assert.deepEqual(await readGuide(other,"staff1"),{step:0,status:"in_progress"});
 await saveGuide(shop,"staff2",4,"dismissed");
 await saveGuide(other,"staff1",5,"completed");
 assert.deepEqual(await readGuide(shop,"staff1"),{step:2,status:"in_progress"});
 assert.deepEqual(await readGuide(shop,"staff2"),{step:4,status:"dismissed"});
 assert.deepEqual(await readGuide(other,"staff1"),{step:5,status:"completed"});
 await db.$disconnect();
 assert.deepEqual(await readGuide(shop,"staff1"),{step:2,status:"in_progress"});
 assert.equal(await db.userGuide.count(),3);
});
test("guide validates step/status and completion instead of saving invalid state",async()=>{
 for(const step of [-1,GUIDE_STEPS,1.5,NaN,Infinity])
  await assert.rejects(saveGuide(shop,"staff1",step,"in_progress"),/valid guide step/);
 await assert.rejects(saveGuide(shop,"staff1",0,"unknown"),/valid guide step/);
 await assert.rejects(saveGuide(shop,"staff1",0,"completed"),/Finish the guide/);
 assert.equal(await db.userGuide.count(),0);
 await saveGuide(shop,"staff1",GUIDE_STEPS-1,"completed");
 assert.deepEqual(await readGuide(shop,"staff1"),{step:GUIDE_STEPS-1,status:"completed"});
});
test("guide version changes restart onboarding and subsequent saves update one existing record",async()=>{
 await saveGuide(shop,"staff1",3,"dismissed");
 await db.userGuide.updateMany({where:{shopId:shop,userId:"staff1"},data:{version:GUIDE_VERSION-1}});
 assert.deepEqual(await readGuide(shop,"staff1"),{step:0,status:"in_progress"});
 await saveGuide(shop,"staff1",1,"in_progress");
 assert.equal(await db.userGuide.count(),1);
 assert.equal((await db.userGuide.findFirstOrThrow()).version,GUIDE_VERSION);
 assert.deepEqual(await readGuide(shop,"staff1"),{step:1,status:"in_progress"});
});
