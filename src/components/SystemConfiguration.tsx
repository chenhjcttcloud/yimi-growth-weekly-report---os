import {useEffect,useState} from 'react';
import {AiUsagePanel} from './AiUsagePanel';
import {AppSelect} from './AppSelect';
import {MonthlyScoreReminderSettings} from './MonthlyScoreReminderSettings';
import '../styles/ai-settings.css';
const errors:Record<string,string>={future_cycle_required:'规则须从下个月或更晚月份生效',invalid_weights:'四模块权重必须为 0–100 的数字，合计 100%',invalid_deadline:'请填写有效截止时间',invalid_reminder_hours:'提醒时间须为 1–720 的整数小时',policy_version_exists:'该月份已配置规则，请选择新的生效月份',invalid_ai_url:'请填写公开的 HTTPS API 服务地址，不含密钥或查询参数',invalid_ai_model:'请填写模型名称',ai_key_host_change_requires_clear:'切换到另一服务来源前，请先清除当前密钥。保存新地址后，再为该服务设置密钥。',ai_key_service_address_changed:'API 服务地址已变更，请确认当前地址后重新操作。',ai_key_action_required:'请通过「更换 API 密钥」或「清除 API 密钥」管理密钥。',invalid_ai_key_action:'请选择有效的密钥操作。',invalid_ai_key:'请填写有效的 API 密钥。',settings_save_failed:'保存失败，请稍后重试'};
type KeyAction='replace'|'clear';
type AiDraft={baseUrl:string;model:string};
type AiConnection=AiDraft&{keyConfigured:boolean};
type ModelList={baseUrl:string;keyRevision:number;models:string[];notice?:string};

function AiModelField({connection,draft,keyRevision,disabled,onChange}:{
 connection:AiConnection;draft:AiDraft;keyRevision:number;disabled:boolean;onChange:(model:string)=>void;
}){
 const {baseUrl,keyConfigured}=connection;
 const [modelList,setModelList]=useState<ModelList|null>(null);
 const [refreshCount,setRefreshCount]=useState(0);
 const [manual,setManual]=useState(false);

 useEffect(()=>{
  if(!keyConfigured||!baseUrl)return;
  const controller=new AbortController();
  setModelList(null);
  async function loadModels(){
   let models:string[]=[];
   let notice:string|undefined;
   try{
    const response=await fetch('/api/system-settings/ai/models',{signal:controller.signal,cache:'no-store'});
    const result=await response.json();
    if(!response.ok||result?.ok!==true||!Array.isArray(result.models)){
     notice=response.status===504?'读取模型列表超时，可手动填写。':'暂时无法读取模型列表，可手动填写。';
    }else if(result.baseUrl!==baseUrl){
     notice='API 服务地址已变更，请刷新配置后重新读取模型列表。';
    }else{
     models=result.models.filter((value:unknown):value is string=>typeof value==='string'&&Boolean(value));
    }
   }catch{notice='暂时无法读取模型列表，可手动填写。';}
   if(!controller.signal.aborted)setModelList({baseUrl,keyRevision,models,notice});
  }
  void loadModels();
  return()=>controller.abort();
 },[baseUrl,keyConfigured,keyRevision,refreshCount]);

 const savedAddress=draft.baseUrl.trim().replace(/\/$/,'')===baseUrl.trim().replace(/\/$/,'');
 const listAvailable=Boolean(keyConfigured&&baseUrl&&savedAddress);
 const currentList=listAvailable&&modelList?.baseUrl===baseUrl&&modelList.keyRevision===keyRevision?modelList:null;
 const hasModels=Boolean(currentList?.models.length);
 const options=[...new Set([draft.model,connection.model,...(currentList?.models??[])].filter(Boolean))];
 const loading=listAvailable&&!currentList;
 const notice=!savedAddress?'保存 API 服务地址后可读取该服务的模型列表。'
  :!listAvailable?'设置 API 密钥后可读取模型列表。'
  :loading?'正在读取模型列表…'
  :currentList?.notice||(!hasModels?'服务商暂无可选模型，可手动填写。':'');

 return <div className="ai-model-field">
  <label>模型名称{hasModels&&!manual?
   <AppSelect aria-label="模型名称" value={draft.model} onValueChange={onChange} searchable searchPlaceholder="搜索模型…" placeholder="选择模型" disabled={disabled}>
    {options.map(model=><option key={model} value={model}>{model}</option>)}
   </AppSelect>:
   <input autoComplete="off" value={draft.model} disabled={disabled} onChange={event=>{setManual(true);onChange(event.target.value);}}/>}
  </label>
  <div className="ai-settings-actions ai-model-actions">
   <button type="button" className="secondary-button" disabled={disabled||!listAvailable||loading} onClick={()=>{setModelList(null);setRefreshCount(count=>count+1);}}>刷新模型列表</button>
   {hasModels&&<button type="button" className="secondary-button" disabled={disabled} onClick={()=>setManual(value=>!value)}>{manual?'从列表选择':'手动填写'}</button>}
  </div>
  {notice&&<p className="pf-caption ai-model-notice" role="status">{notice}</p>}
 </div>;
}

export function SystemConfiguration({section}:{section:'rules'|'ai'|'cycles'|'logs'}){
 const [data,setData]=useState<any>(null),[logs,setLogs]=useState<any[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[policy,setPolicy]=useState<any>(null),[effective,setEffective]=useState(''),[ai,setAi]=useState<AiDraft>({baseUrl:'',model:''});
 const [keyAction,setKeyAction]=useState<KeyAction|null>(null),[apiKey,setApiKey]=useState('');
 const [keyRevision,setKeyRevision]=useState(0);
 function selectKeyAction(action:KeyAction|null){setApiKey('');setKeyAction(action);}
 async function load(){selectKeyAction(null);try{const r=await fetch('/api/system-settings');if(!r.ok)throw Error();const j=await r.json();setData(j);setPolicy(j.policy);setAi({baseUrl:j.ai.baseUrl,model:j.ai.model});const d=new Date(j.currentMonth+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);setEffective(d.toISOString().slice(0,7));if(section==='logs'){const r=await fetch('/api/system-settings/logs');if(!r.ok)throw Error();setLogs((await r.json()).logs||[]);}}catch{setMessage('无法读取系统配置，请刷新重试');}}
 useEffect(()=>{void load();},[section]);
 async function refreshReminderStatus(){try{const r=await fetch('/api/system-settings');if(r.ok){const j=await r.json();setData((current:any)=>({...current,integration:j.integration,monthlyReminders:j.monthlyReminders}));}}catch{/* The saved setting is already persisted; the refresh button can retry. */}}
 async function save(path:string,body:any){setBusy(true);setMessage('');try{const r=await fetch('/api/system-settings/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json();if(!r.ok)throw Error(errors[j.error]||'保存失败');setMessage(path==='ai'?'AI 服务配置已保存，后续调用立即使用新配置。':'规则版本已保存，指定月份起生效，历史结果不变。');await load();}catch(e){setMessage(e instanceof Error?e.message:'保存失败');}finally{setBusy(false);}}
 async function saveAiKey(){
  if(!keyAction||busy||keyAction==='replace'&&!apiKey.trim())return;
  const body={action:keyAction,expectedBaseUrl:data.ai.baseUrl,...(keyAction==='replace'?{apiKey}:{})};
  setBusy(true);setMessage('');setApiKey('');
  try{
   const response=await fetch('/api/system-settings/ai/key',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
   const result=await response.json();
   if(!response.ok||typeof result.keyConfigured!=='boolean'){
    const code=result.error;
    setMessage(Object.hasOwn(errors,code)?errors[code]:'密钥操作失败，请稍后重试。');
    if(code==='ai_key_service_address_changed')await load();
    return;
   }
   setData((current:any)=>({...current,ai:{...current.ai,keyConfigured:result.keyConfigured}}));
   setKeyRevision(revision=>revision+1);
   setKeyAction(null);
   setMessage(result.keyConfigured?'API 密钥已保存。':'API 密钥已清除，实时 AI 调用已关闭。');
  }catch{setMessage('密钥操作失败，请稍后重试。');}finally{setBusy(false);}
 }
 if(!data||!policy)return <article className="panel"><p>{message||'正在读取配置…'}</p></article>;
 return <article className="panel system-config"><div className="panel-heading"><div><h2>{{rules:'评分规则',ai:'AI 服务配置',cycles:'周期与提醒',logs:'操作日志'}[section]}</h2><p className="pf-caption">{section==='ai'?'兼容 Chat Completions 的模型服务，密钥加密存储并由后端调用。':section==='logs'?'记录配置、部门、人员和质量分审核操作。':section==='cycles'?'维护月末飞书提醒和周报周期规则；提醒设置保存后即生效。':'规则按月版本化，新版本从未来月份生效；历史结果与已生效规则保持不变。'}</p></div><button className="secondary-button" disabled={busy} onClick={()=>void load()}>刷新</button></div>
 {message&&<p role="status" className="pf-notice">{message}</p>}
 {section==='cycles'&&<MonthlyScoreReminderSettings onSaved={refreshReminderStatus}/>}
 {(section==='rules'||section==='cycles')&&<><div className="pf-notice">周报质量由 AI 生成候选分，月度最终分由管理人员确认。新评分采用本周成果 30%、问题与挑战 25%、下周计划 25%、思考与复盘 20%。</div><div className="pf-form"><label>新规则生效月份<input type="month" value={effective} onChange={e=>setEffective(e.target.value)}/></label><label>周报截止时间（周五／假前最后工作日，北京时间）<input type="time" value={policy.deadlineTime} onChange={e=>setPolicy({...policy,deadlineTime:e.target.value})}/></label><label>催评等待时间（小时）<input type="number" min="1" max="720" value={policy.reminderWaitHours} onChange={e=>setPolicy({...policy,reminderWaitHours:Number(e.target.value)})}/></label><label>催评冷却时间（小时）<input type="number" min="1" max="720" value={policy.reminderCooldownHours} onChange={e=>setPolicy({...policy,reminderCooldownHours:Number(e.target.value)})}/></label></div><p className="pf-caption">月度候选分取当月有效周报质量分的平均值。周报提交及时率独立统计，遇假期按最后工作日截止，整周放假免交。个人催评外发状态：{data.integration.remindersEnabled?'已启用':'未开启'}，修改等待时间不会开启外发。在「周期与提醒」统一配置飞书评分提醒开关及生效月份，个人催评与月末自动提醒共同生效；管理员手动发送需显式点击。评分关系在「协作评分关系」中管理。</p><button className="primary-button" disabled={busy} onClick={()=>void save('policy',{effectiveMonth:effective,policy})}>保存新周期规则</button><h3>规则版本</h3><div className="pf-table-scroll"><table className="pf-table"><thead><tr><th>生效月份</th><th>历史规则权重</th><th>截止时间</th><th>催评等待 / 冷却</th></tr></thead><tbody><tr><td>初始规则</td><td>30 / 25 / 25 / 20</td><td>周五／假前最后工作日 20:00</td><td>24 / 24 小时</td></tr>{data.versions.map((v:any)=><tr key={v.effective_month}><td>{v.effective_month}</td><td>{v.policy.weights.join(' / ')}</td><td>{v.policy.deadlineTime}</td><td>{v.policy.reminderWaitHours} / {v.policy.reminderCooldownHours} 小时</td></tr>)}</tbody></table></div></>}
 {section==='ai'&&<>
  <div className="pf-form ai-connection-form">
   <label>API 服务地址<input autoComplete="off" value={ai.baseUrl} disabled={busy} onChange={e=>setAi({...ai,baseUrl:e.target.value})} placeholder="https://服务地址/v1"/></label>
   <AiModelField connection={data.ai} draft={ai} keyRevision={keyRevision} disabled={busy} onChange={model=>setAi(current=>({...current,model}))}/>
  </div>
  <p className="pf-caption">此配置用于周报 AI 评分、管理摘要、个人 AI 教练和任务追问。模型配置与密钥分别保存。</p>
  <div className="ai-settings-actions"><button type="button" className="primary-button" disabled={busy||Boolean(keyAction)} onClick={()=>void save('ai',{baseUrl:ai.baseUrl,model:ai.model})}>保存 AI 配置</button></div>
  <section className="ai-settings-section" aria-label="API 密钥管理">
   <div className="ai-settings-heading"><h3>API 密钥</h3><span className={`pf-status${data.ai.keyConfigured?' is-confirmed':''}`}>{data.ai.keyConfigured?'已配置':'尚未配置'}</span></div>
   <div className="ai-settings-actions">
    <button type="button" className="secondary-button" disabled={busy} aria-expanded={keyAction==='replace'} onClick={()=>selectKeyAction('replace')}>{data.ai.keyConfigured?'更换 API 密钥':'设置 API 密钥'}</button>
    {data.ai.keyConfigured&&<button type="button" className="secondary-button" disabled={busy} aria-expanded={keyAction==='clear'} onClick={()=>selectKeyAction('clear')}>清除 API 密钥</button>}
   </div>
   {keyAction&&<div className="ai-key-confirmation" role="group" aria-label={keyAction==='replace'?'设置新密钥':'确认清除密钥'}>
    {keyAction==='replace'?<>
     <p className="pf-caption">新密钥将用于已保存的 API 服务地址 <strong>{data.ai.baseUrl}</strong>。若要切换服务来源，请先保存新地址。</p>
     <div className="pf-form"><label>新 API 密钥<input type="password" autoComplete="new-password" autoCapitalize="none" spellCheck={false} maxLength={4000} value={apiKey} onChange={e=>setApiKey(e.target.value)} disabled={busy}/></label></div>
    </>:<p className="pf-caption">清除后，实时 AI 调用将停止，直至设置新密钥。</p>}
    <div className="ai-settings-actions">
     <button type="button" className="primary-button" disabled={busy||keyAction==='replace'&&!apiKey.trim()} onClick={()=>void saveAiKey()}>{keyAction==='replace'?(data.ai.keyConfigured?'确认更换密钥':'确认设置密钥'):'确认清除密钥'}</button>
     <button type="button" className="secondary-button" disabled={busy} onClick={()=>selectKeyAction(null)}>取消</button>
    </div>
   </div>}
  </section>
  <AiUsagePanel/>
 </>}
 {section==='logs'&&<div className="pf-table-scroll"><table className="pf-table"><thead><tr><th>时间</th><th>操作人</th><th>操作</th><th>内容</th></tr></thead><tbody>{logs.map(l=><tr key={l.id}><td>{l.created_at} UTC</td><td>{l.actor_name}</td><td>{l.action}</td><td><details><summary>查看详情</summary><pre>{JSON.stringify(l.details,null,2)}</pre></details></td></tr>)}</tbody></table>{!logs.length&&<p>暂无操作记录，新的配置变更将记录于此。</p>}</div>}
 </article>;
}
