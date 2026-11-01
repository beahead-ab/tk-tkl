import {createAdminDialog,settingsRows,settingsNote} from './admin-ui.js';
import {STYLES,STYLE_KEY,legendHTML,previewHTML,readStyle,saveStyle,styleTitle} from './timetable-style.js';
import {PANEL_STYLES,panelStyleTitle} from './panel-style.js';
export function createAdminAppearance({panelStyle,appTheme,turnoutNumbersDisplay}){
  const $=id=>document.getElementById(id),original=document.querySelector('.appearance-controls');
  $('appearance-heading').after(settingsNote('settings-scope','Gäller den här webbläsaren · sparas inte i TKL-servern'));
  const overview=document.createElement('section');overview.className='card';overview.innerHTML='<div class="card-heading"><h3>Panelen här</h3><button id="appearance-edit" class="primary">Redigera</button></div><dl id="appearance-summary"></dl>';original.before(overview);original.hidden=true;
  overview.after(settingsNote('settings-footnote','Andra skärmar mot samma TKL behåller sina egna val. Lägen, lås och order är desamma på alla skärmar; här ändras bara hur de visas och hörs.'));
  const form=document.createElement('form');form.id='appearance-form';form.innerHTML='<fieldset class="panel-style-choice"><legend>Ställverkets utseende</legend>'+PANEL_STYLES.map(s=>'<label><input type="radio" name="panel-style" value="'+s.id+'"><span><b>'+s.title+'</b><small>'+s.detail+'</small></span></label>').join('')+'<p class="muted">Samma station och manövrering i båda vyerna. Valet gäller den här webbläsaren och stationen.</p></fieldset><label>Övergångslampor<select id="pref-crossing"><option value="calm">Lugn blinkning</option><option value="steady">Fast rött sken</option></select></label><label>Ljud vid fel<select id="pref-sound"><option value="no">Av</option><option value="yes">På</option></select></label>'+
    // Tidtabellens stil (0.80.0): the same trains in each style, to compare before choosing.
    '<fieldset class="tt-style-choice"><legend>Tidtabellens stil</legend>'+STYLES.map(s=>'<label class="tt-style-option"><input type="radio" name="tt-style" value="'+s.id+'"><span><b>'+s.title+'</b><small>'+s.detail+'</small></span>'+previewHTML(s.id)+'</label>').join('')+
    '<p class="muted">Spåret står i Spår-kolumnen, med ram när tåget står inne. Tecknen förklaras under Teckenförklaring.</p></fieldset><button type="submit">Spara</button>';
  form.insertAdjacentHTML('afterbegin','<label>Färgtema<select id="pref-theme"><option value="dark">Mörkt · svart bakgrund</option><option value="light">Ljust</option></select></label>');
  form.querySelector('.panel-style-choice').insertAdjacentHTML('afterend','<label>Växelnummer<select id="pref-turnout-numbers"><option value="false">Släckta</option><option value="true">Tända</option></select><small>Gäller vald ställverksvy på den här skärmen. Släckta som standard i 85-vyn.</small></label>');
  form.querySelector('.panel-style-choice').addEventListener('change',()=>{$('pref-turnout-numbers').value=String(turnoutNumbersDisplay.visibleFor(chosenPanelStyle()));});
  const chosenStyle=()=>form.querySelector('input[name=tt-style]:checked')?.value||readStyle();
  const chosenPanelStyle=()=>form.querySelector('input[name=panel-style]:checked')?.value||panelStyle.current;
  const values=()=>JSON.stringify([...['crossing','sound','theme','turnout-numbers'].map(k=>$('pref-'+k).value),chosenStyle(),chosenPanelStyle()]);let baseline;
  const modal=createAdminDialog({title:'Utseende och ljud',body:form,saveButton:form.querySelector('button[type=submit]'),dirty:()=>values()!==baseline,unchanged:'Inget ändrat'});
  const sound=()=>$('sound-toggle').getAttribute('aria-pressed')==='true';
  function render(){settingsRows($('appearance-summary'),[
    ['Färgtema',appTheme.current==='light'?'Ljust':'Mörkt · svart bakgrund','Samma färgtema i ställverket och Studio. Sparas för den här webbläsaren.'],
    ['Ställverkets utseende',panelStyleTitle(panelStyle.current),'Originalpanel eller 85-inspirerad skärmvy. Samma station, tågvägar och manövrering.'],
    ['Växelnummer',turnoutNumbersDisplay.visible?'Tända':'Släckta','Tänd eller släck växelnumren. Valet sparas separat för varje station och ställverksvy i den här webbläsaren.'],
    ['Övergångslampor',$('crossing-display').selectedOptions[0].textContent,'Hur plankorsningarnas lampor visas på panelen. Korsningens läge påverkas inte.'],
    ['Ljud vid fel',sound()?'På':'Av','Ett kort pip när ett felmeddelande visas, till exempel en nekad order. Meddelandet visas alltid, med eller utan ljud.'],
    ['Tidtabellens stil',styleTitle(readStyle()),'Hur tåglistan visar läget och vägen: i ord, med tecken eller som en linjebild. Tidtabellen är densamma; tecknen förklaras under Teckenförklaring.']]);
    const legend=$('timetable-legend');if(legend)legend.innerHTML=legendHTML(readStyle());
    $('panel-style-legend').hidden=panelStyle.current!=='modern85';}
  window.addEventListener('panel-style-change',render);
  window.addEventListener('app-theme-change',render);
  window.addEventListener('turnout-numbers-change',render);
  window.addEventListener('storage',e=>{if(e.key===STYLE_KEY)render();});
  $('appearance-edit').onclick=()=>{$('pref-turnout-numbers').value=String(turnoutNumbersDisplay.visible);$('pref-theme').value=appTheme.current;$('pref-crossing').value=$('crossing-display').value;$('pref-sound').value=sound()?'yes':'no';const style=readStyle();for(const r of form.querySelectorAll('input[name=tt-style]'))r.checked=r.value===style;for(const r of form.querySelectorAll('input[name=panel-style]'))r.checked=r.value===panelStyle.current;baseline=values();modal.open();};
  form.onsubmit=e=>{e.preventDefault();try{if($('pref-theme').value!==appTheme.current)appTheme.save($('pref-theme').value);if(chosenPanelStyle()!==panelStyle.current)panelStyle.save(chosenPanelStyle());if(turnoutNumbersDisplay.visible!==($('pref-turnout-numbers').value==='true'))turnoutNumbersDisplay.save($('pref-turnout-numbers').value==='true');$('crossing-display').value=$('pref-crossing').value;$('crossing-display').dispatchEvent(new Event('change'));if(sound()!==($('pref-sound').value==='yes'))$('sound-toggle').click();const style=saveStyle(chosenStyle());window.dispatchEvent(new CustomEvent('timetable-style',{detail:style}));modal.close(true);render();}catch(e){modal.message(e.message);}};render();
}
