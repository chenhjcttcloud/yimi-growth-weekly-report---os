import {useEffect,useState} from 'react';
import type {PageKey,UserAccess} from './types';

const pages:PageKey[]=['growth','reports','coach','actions','timeline','scores','dashboard','monthly','tasks','trends','settings','departments'];
const personalPages:PageKey[]=['growth','reports','coach','actions','timeline'];

export function requestedPage():PageKey|undefined {
 const url=new URL(window.location.href);
 const requested=url.searchParams.get('page')||url.pathname.replace(/^\/+|\/+$/g,'');
 return pages.includes(requested as PageKey)?requested as PageKey:undefined;
}

export function canVisitPage(page:PageKey,access:UserAccess):boolean {
 if(['dashboard','monthly','tasks','trends'].includes(page))return access.canViewBossDashboard;
 if(['settings','departments'].includes(page))return access.canViewSettings&&!access.externalView;
 if(personalPages.includes(page))return !access.externalView&&access.role!=='boss'&&access.role!=='system_admin';
 return page==='scores';
}

export function resolvePage(page:PageKey|undefined,access:UserAccess):PageKey {
 return page&&canVisitPage(page,access)?page:access.canViewBossDashboard?'dashboard':'growth';
}

export function perspectiveAccess(access:UserAccess,mode:string):UserAccess {
 const personal=access.role==='system_admin'&&(mode==='personal'||(mode.startsWith('employee:')&&access.visibleEmployees.some(e=>e.userId===mode.slice(9))));
 return personal?{...access,role:'member',bossView:false,canViewBossDashboard:false,canViewSettings:false,canManageScoring360:false,canManagePersonnel:false}:access;
}

export function locationValue(key:string):string {
 return new URL(window.location.href).searchParams.get(key)||'';
}

export function rememberLocation(key:string,value:string):void {
 const url=new URL(window.location.href);
 if(url.searchParams.get(key)===value)return;
 url.searchParams.set(key,value);
 window.history.replaceState(window.history.state,'',url.pathname+url.search+url.hash);
}

// Keep section selection in the same tab's URL, including after an SSO return.
export function useLocationSection<T extends string>(key:string,allowed:readonly T[],fallback:T){
 const choose=()=>allowed.includes(locationValue(key) as T)?locationValue(key) as T:fallback;
 const [value,setValue]=useState<T>(choose);
 const valid=allowed.includes(value)?value:fallback;
 const options=allowed.join('|');
 useEffect(()=>{rememberLocation(key,valid);},[key,valid]);
 useEffect(()=>{const restore=()=>setValue(choose());window.addEventListener('popstate',restore);return()=>window.removeEventListener('popstate',restore);},[key,options,fallback]);
 return [valid,setValue] as const;
}
