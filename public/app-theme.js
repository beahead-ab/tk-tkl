// Samma temaval som Studio. Mörkt är standard; inget driftdata ändras.
export const THEME_KEY='studio-theme';
export const validTheme=value=>value==='light'?'light':'dark';
function storage(){try{return globalThis.localStorage;}catch{return null;}}
export function readTheme(store=storage()){try{return validTheme(store?.getItem(THEME_KEY));}catch{return 'dark';}}
export function createAppTheme({root=document.documentElement,events=window,store=storage()}={}){
  let current=readTheme(store);
  const apply=value=>{current=validTheme(value);root.dataset.theme=current;events.dispatchEvent(new Event('app-theme-change'));};
  root.dataset.theme=current;
  events.addEventListener('storage',e=>{if(e.key===THEME_KEY||e.key===null)apply(readTheme(store));});
  return {get current(){return current;},save(value){const next=validTheme(value);try{if(!store)throw Error();store.setItem(THEME_KEY,next);}catch{throw Error('Webbläsaren kunde inte spara färgtemat.');}apply(next);}};
}
