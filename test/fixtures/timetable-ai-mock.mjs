// Test-only Responses transport. No network request or real AI inference is made.
const original=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
  if(url!=='https://api.openai.com/v1/responses')return original(url,options);
  const input=JSON.parse(options.body),files=input.input[0].content.filter(c=>['input_image','input_file'].includes(c.type));
  const result={title:'Testtidtabell · inget AI-anrop',warnings:['Kontrollerat testsvar – inte en verklig bildtolkning.'],coverage:files.map((_,i)=>({file:i+1,pages:[1],complete:true})),rows:[
    {trainNumber:'101',station:'Charlottendal',day:'Lör',arrival:'09:15',departure:'09:20',track:'1',from:'Lekby',to:'Kungsfors',note:'Invänta möte <b>text</b>',noStop:false,sources:[{file:1,page:1}],uncertainties:[]},
    {trainNumber:'202',station:'Charlottendal',day:'Lör',arrival:'10:05',departure:'10:10',track:'',from:'Kungsfors',to:'Lekby',note:'',noStop:false,sources:[{file:files.length,page:1}],uncertainties:['Spåret behöver kontrolleras.']}
  ]};
  return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]}));
};
