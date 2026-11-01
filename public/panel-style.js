// Bara presentation. Inga serveranrop, fältorder eller ändringar av stationsprofilen.
export const PANEL_STYLES = [
  {id:'original',title:'Originalpanel',detail:'Nuvarande mörka spårplan med signalbilder.'},
  {id:'modern85',title:'85-inspirerad skärmvy',detail:'Följer ljust eller mörkt tema, med trianglar för huvudsignaler och vinklar för dvärgsignaler.'}
];
export const validPanelStyle = value => PANEL_STYLES.some(s=>s.id===value)?value:'original';
export const panelStyleTitle = value => PANEL_STYLES.find(s=>s.id===validPanelStyle(value)).title;
export const panelStyleKey = station => 'tkl-panel-style:v1:'+encodeURIComponent(station||'charlottendal');
function browserStorage(){try{return globalThis.localStorage;}catch{return null;}}
export function readPanelStyle(station,storage=browserStorage()){
  try{return validPanelStyle(storage?.getItem(panelStyleKey(station)));}catch{return 'original';}
}
export function savePanelStyle(station,value,storage=browserStorage()){
  const style=validPanelStyle(value);
  try{if(!storage)throw Error();storage.setItem(panelStyleKey(station),style);}
  catch{throw Error('Webbläsaren kunde inte spara ställverksutseendet. Tillåt lokal lagring och försök igen.');}
  return style;
}
export function createPanelStyle({station,root,onChange=()=>{},storage=browserStorage(),events=globalThis.window}){
  let current=readPanelStyle(station,storage);
  const apply=value=>{const next=validPanelStyle(value);if(next===current)return false;current=next;root.dataset.panelStyle=next;onChange(next);return true;};
  // Originalets data-skin används fortfarande av dess befintliga CSS. Äldre skins återaktiveras inte.
  root.dataset.panelStyle=current;
  const listener=e=>{if(e.key===panelStyleKey(station)||e.key===null)apply(readPanelStyle(station,storage));};
  events?.addEventListener('storage',listener);
  return {get current(){return current;},save(value){const next=savePanelStyle(station,value,storage);apply(next);return next;},destroy(){events?.removeEventListener('storage',listener);}};
}
