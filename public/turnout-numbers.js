// Lokalt visningsval per station och ställverksvy. Skickar inga fältorder.
export const turnoutNumbersKey=(station,view)=>'tkl-turnout-numbers:v1:'+encodeURIComponent(station||'charlottendal')+':'+view;
function browserStorage(){try{return globalThis.localStorage;}catch{return null;}}
export function readTurnoutNumbers(station,view,storage=browserStorage()){
  let value;try{value=storage?.getItem(turnoutNumbersKey(station,view));}catch{}
  return value==='true'?true:value==='false'?false:view!=='modern85';
}
export function createTurnoutNumbers({station,root,panelStyle,storage=browserStorage(),events=globalThis.window}){
  const visibleFor=view=>readTurnoutNumbers(station,view,storage);
  function apply(){root.dataset.turnoutNumbers=String(visibleFor(panelStyle.current));}
  function changed(){apply();events?.dispatchEvent(new Event('turnout-numbers-change'));}
  const listener=e=>{if(e.key===null||e.key===turnoutNumbersKey(station,panelStyle.current))changed();};
  events?.addEventListener('panel-style-change',apply);
  events?.addEventListener('storage',listener);
  apply();
  return {visibleFor,get visible(){return visibleFor(panelStyle.current);},save(visible){
    try{if(!storage)throw Error();storage.setItem(turnoutNumbersKey(station,panelStyle.current),String(!!visible));}
    catch{throw Error('Webbläsaren kunde inte spara visningen av växelnummer. Tillåt lokal lagring och försök igen.');}
    changed();
  },destroy(){events?.removeEventListener('panel-style-change',apply);events?.removeEventListener('storage',listener);}};
}
