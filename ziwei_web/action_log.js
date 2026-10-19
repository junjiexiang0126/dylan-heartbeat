'use strict';
// Persist only public tool metadata. Never accept args, reasoning, or thinking deltas.
const labels={terminal:'执行命令',file:'读写文件',read_file:'读文件',write_file:'写文件',patch:'改文件',memory:'整理记忆',web_search:'联网查',web_extract:'联网查',browser:'打开网页',cronjob_manage:'排定时任务',ziwei_status:'更新状态',ziwei_moment:'写朋友圈',ziwei_poke:'拍一拍',ziwei_briefing:'写日志',delegate_task:'派任务'};
class ActionLog{
 constructor(db){this.db=db;db.exec(`CREATE TABLE IF NOT EXISTS tool_actions(request_id TEXT NOT NULL,start_seq INTEGER NOT NULL,tool TEXT NOT NULL,call_id TEXT,preview TEXT NOT NULL,at TEXT NOT NULL,state TEXT NOT NULL,end_seq INTEGER,ended_at TEXT,PRIMARY KEY(request_id,start_seq));`);}
 capture(requestId,event,data){
  const tool=data.tool_name||data.tool,seq=data.seq;
  if(tool==='_thinking'||typeof tool!=='string'||!tool||tool.length>128||!Number.isSafeInteger(seq)||seq<0)return false;
  const stamp=typeof data.ts==='string'?Date.parse(data.ts):typeof data.ts==='number'?(data.ts<1e12?data.ts*1000:data.ts):NaN;
  const at=new Date(Number.isFinite(stamp)?stamp:Date.now()).toISOString(),call=typeof (data.tool_call_id||data.call_id)==='string'?String(data.tool_call_id||data.call_id).slice(0,200):null;
  if(event==='tool.started'){
   const preview=''; // Never persist tool arguments, results, or private reasoning.
   this.db.prepare('INSERT OR IGNORE INTO tool_actions(request_id,start_seq,tool,call_id,preview,at,state) VALUES(?,?,?,?,?,?,?)').run(requestId,seq,tool,call,preview,at,'in_progress');return true;
  }
  const rows=this.db.prepare("SELECT * FROM tool_actions WHERE request_id=? AND tool=? AND state='in_progress' AND start_seq<? ORDER BY start_seq").all(requestId,tool,seq).filter(r=>!call||r.call_id===call);
  // A completion without a correlation key cannot guess between concurrent calls.
  if(rows.length!==1)return false;
  const row=rows[0];this.db.prepare('UPDATE tool_actions SET state=?,end_seq=?,ended_at=? WHERE request_id=? AND start_seq=?').run(event==='tool.completed'?'completed':'failed',seq,at,requestId,row.start_seq);return true;
 }
 list(requestId){return this.db.prepare('SELECT start_seq seq,tool,preview,at,state,end_seq,ended_at FROM tool_actions WHERE request_id=? ORDER BY start_seq').all(requestId).map(r=>({...r,label:labels[r.tool]||r.tool,elapsedMs:r.ended_at?Math.max(0,Date.parse(r.ended_at)-Date.parse(r.at)):null}));}
}
module.exports={ActionLog};
