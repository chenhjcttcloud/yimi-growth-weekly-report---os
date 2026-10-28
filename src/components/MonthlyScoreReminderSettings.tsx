import {useEffect,useState} from 'react';

type Preview={month:string;settings:{enabled:boolean;time:string;configured:boolean};dates:string[];calendarCovered:boolean;calendarWarning:string;calendarUpdate?:{enabled:boolean;source:string;sourceUrl:string;cachedYears:number[];years:{year:number;checkedAt:string;status:string;available:boolean}[]}|null;recipients:{userId:string;name:string;total:number;counts:{peer:number;manager:number;boss:number}}[];deliveries:{reminder_date:string;recipient_user_id:string;recipient_name:string;status:string;attempts:number;sent_at:string|null}[]};
export function MonthlyScoreReminderSettings(){
 const [data,setData]=useState<Preview|null>(null),[enabled,setEnabled]=useState(false),[time,setTime]=useState('10:00'),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function load(){
  const response=await fetch('/api/system-settings/monthly-reminders');
  if(!response.ok)throw Error('无法读取月末提醒设置，请稍后刷新');
  const preview=await response.json() as Preview;setData(preview);setEnabled(preview.settings.enabled);setTime(preview.settings.time);
 }
 useEffect(()=>{void load().catch(e=>setMessage(e.message));},[]);
 async function save(){
  setBusy(true);setMessage('');
  try{
   const response=await fetch('/api/system-settings/monthly-reminders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({enabled,time})}),result=await response.json();
   if(!response.ok)throw Error(result.error==='feishu_required'?'请先在「飞书与数据集成」配置应用凭证':result.error==='invalid_monthly_reminders'?'请填写有效的提醒时间':'月末提醒设置保存失败');
   await load();setMessage(enabled?'已开启：每月最后两个工作日按北京时间自动提醒未评分人员。':'已保存：自动提醒已关闭。');
  }catch(e){setMessage(e instanceof Error?e.message:'保存失败');}finally{setBusy(false);}
 }
 return <section className="month-end-reminders" aria-label="月度评分飞书提醒">
  <div className="month-end-heading"><div><span className="section-label">月末待办提醒</span><h3>月度评分飞书提醒</h3><p className="pf-caption">每个月最后两个工作日，各提醒一次。只发送给仍未完成评分的人。</p></div><span className="scoring360-live-badge">{data?.settings.enabled?'自动提醒已开启':'自动提醒未开启'}</span></div>
  {message&&<p role="status" className="pf-notice">{message}</p>}
  {data?<>
   <div className="month-end-schedule"><div><small>{data.month} {data.calendarCovered?'推送日期':'预计日期'} · 北京时间</small><strong>{data.dates.join('、')}</strong><span>法定节假日跳过，调休上班日计入</span></div><div><small>当前待提醒人员</small><strong>{data.recipients.length} 人</strong><span>同一人的多类待办合并为一条消息</span></div></div>
   {data.calendarUpdate&&<div className="pf-caption" aria-label="工作日日历更新状态"><strong>节假日与调休日历 · {data.calendarUpdate.enabled?'每日自动更新':'自动更新已关闭'}</strong><span> · 已缓存 {data.calendarUpdate.cachedYears.join('、')||'暂无'} 年</span><br/>{data.calendarUpdate.years.map(y=><span key={y.year}>{y.year} 年：{y.status==='updated'?'已更新':y.status==='not_published'?'等待完整日历，自动继续检查':y.available?'更新失败，继续使用已缓存日历':'更新失败，自动继续检查'}（最近检查 {new Date(y.checkedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}）<br/></span>)}<a href={data.calendarUpdate.sourceUrl} target="_blank" rel="noreferrer">数据来源：{data.calendarUpdate.source}</a></div>}
   {data.calendarWarning&&<p role="alert" className="pf-notice">{data.calendarWarning}</p>}
   <div className="month-end-controls"><label className="month-end-toggle"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} disabled={busy}/>开启月末自动飞书提醒</label><label>发送时间（北京时间）<input aria-label="月末提醒发送时间" type="time" required value={time} onChange={e=>setTime(e.target.value)} disabled={busy}/></label><button type="button" className="primary-button" disabled={busy||!time} onClick={()=>void save()}>保存月末提醒设置</button></div>
   {!data.settings.configured&&<p className="pf-caption">飞书应用凭证尚未配置，请先前往「飞书与数据集成」。</p>}
   <p className="pf-caption">覆盖同事互评、负责人给下属评分、老板给部门负责人评分；发送前重新检查进度，已完成、已停用或结果已发布的任务不再提醒。评分关系须先手动配置并开启；预览不会发送消息。</p>
   <details><summary>查看待提醒名单（{data.recipients.length} 人）</summary><div className="pf-table-scroll"><table className="pf-table"><thead><tr><th>评分人</th><th>同事互评</th><th>下属月评</th><th>负责人评分</th></tr></thead><tbody>{data.recipients.map(r=><tr key={r.userId}><td>{r.name}</td><td>{r.counts.peer} 项</td><td>{r.counts.manager} 项</td><td>{r.counts.boss} 项</td></tr>)}</tbody></table>{!data.recipients.length&&<p className="pf-caption">当前没有待提醒人员。未开启的同事互评任务不计入名单。</p>}</div></details>
   <details><summary>本月发送记录（{data.deliveries.length} 条）</summary><div className="pf-table-scroll"><table className="pf-table"><thead><tr><th>日期</th><th>评分人</th><th>状态</th></tr></thead><tbody>{data.deliveries.map(d=><tr key={d.reminder_date+':'+d.recipient_user_id}><td>{d.reminder_date}</td><td>{d.recipient_name}</td><td>{{sent:'已发送',pending:'发送中',failed:'失败，最多重试3次',cancelled:'已无需提醒',ready:'等待发送',uncertain:'发送状态待核实，不自动重发'}[d.status]||d.status}</td></tr>)}</tbody></table>{!data.deliveries.length&&<p className="pf-caption">尚无自动发送记录。</p>}</div></details>
   <button className="secondary-button" type="button" disabled={busy} onClick={()=>void load().catch(e=>setMessage(e.message))}>刷新待提醒名单（不发送）</button>
  </>:<p>{message?'':'正在读取提醒计划…'}</p>}
 </section>;
}
