import {Clock3} from 'lucide-react';

export type ReviewWindow={month:string;opensAt:string;isOpen:boolean;reason?:string};

export const isReviewWindowBlocked=(window?:ReviewWindow|null)=>Boolean(window&&window.isOpen!==true);

export function reviewWindowMessage(window?:ReviewWindow|null){
 if(!window||window.isOpen)return '';
 if(window.reason==='closed')return '所选月份评分已关闭。已提交的评分和历史记录仍可查看。';
 const date=new Date(window.opensAt),opensAt=Number.isNaN(date.getTime())?'':new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date);
 const timing=opensAt?`本月评分尚未开放。开放时间：北京时间 ${opensAt}。`:'本月评分尚未开放。';
 const reasons:Record<string,string>={future_month:'所选月份尚未到评分时间，请在开放后填写和提交。',before_window:'请在开放后填写和提交本月评分。',missing_cycle:'管理员尚未完成本月评分安排。',draft:'本月评分安排尚待管理员确认。',scheduled:'评分已预约，请在开放后填写和提交。',missing_launch:'本月评分安排尚待管理员确认。',launch_pending:'评分已预约，请在开放后填写和提交。'};
 return timing+(reasons[window.reason||'']||'评分任务将在所选月份规定的时间开放；已提交的记录仍可查看。');
}

export function ReviewWindowNotice({window,className='pf-notice'}:{window?:ReviewWindow|null;className?:string}){
 if(!isReviewWindowBlocked(window))return null;
 return <p className={className} role="status" data-review-window="closed"><Clock3 size={15}/><span>{reviewWindowMessage(window)}</span></p>;
}
