import {PrismaClient} from '@prisma/client';
const db=new PrismaClient();
try {
 const jobs=await db.job.findMany({where:{type:'privacy',status:'awaiting_review'},select:{id:true,shopId:true,createdAt:true,payload:true},orderBy:{createdAt:'asc'}});
 console.log(JSON.stringify(jobs.map(({payload,...job})=>({...job,topic:payload.topic,dueAt:payload.dueAt,overdue:Date.parse(payload.dueAt)<Date.now()})),null,2));
 console.log(`Pending privacy requests: ${jobs.length}. Review originals in History before resolving; this command never marks requests complete.`);
}finally{await db.$disconnect();}
