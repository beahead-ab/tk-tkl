// Verifierad utpassage i frånkopplat läge. Spårbild och TrainMeet har olika
// uppgifter: ett tåg kan ha lämnat ställverket innan avgången godkänts där.
const scope = meet => JSON.stringify([meet?.sessionId,meet?.revision,meet?.origin,meet?.context?.meetGeneration,meet?.context?.publicationId,meet?.context?.day,meet?.context?.station?.id]);
export class TrafficDepartures {
  constructor({movement,available,currentContext,edgeInfo,log=()=>{},now=Date.now}) {
    Object.assign(this,{movement,available,currentContext,edgeInfo,log,now});
    this.identity='';this.bindings=new Map();this.reports=new Map();this.busy=false;
  }
  observe(meet,tracking) {
    const identity=scope(meet);
    if(identity!==this.identity){this.identity=identity;this.bindings.clear();this.reports.clear();}
    if(!this.available()||!meet?.paired||meet.stale||!meet.context)return;
    const c=meet.context,states=new Map(c.movements.map(m=>[m.id,m]));
    for(const train of tracking.trains||[]) {
      if(!train.certain||!train.number||train.state!=='station')continue;
      const candidates=c.trains.filter(t=>t.train_number===train.number&&t.departure_time&&['positioned','ready','waiting'].includes(states.get(t.id)?.departure));
      // Samma nummer kan köras flera gånger. Bind bara till en entydig aktiv rörelse.
      if(candidates.length===1)this.bindings.set(train.id,{movementId:candidates[0].id,number:train.number});
      else this.bindings.delete(train.id);
    }
    for(const train of tracking.lines||[]) {
      const bound=this.bindings.get(train.id);
      if(train.direction!=='out'||!train.certain||!bound||bound.number!==train.number||this.reports.has(bound.movementId)||(tracking.trains||[]).some(t=>t.number===train.number))continue;
      this.reports.set(bound.movementId,{...bound,edge:train.edge,neighborId:train.stationId||'',observedAt:train.since,status:'pending',reason:'Avgången är ännu inte anmäld till TrainMeet.',retryAt:0});
      this.bindings.delete(train.id);
    }
    for(const report of this.reports.values())if(states.get(report.movementId)?.departure==='departed'){
      report.status='confirmed';report.reason='';
    }
  }
  line(context,report) {
    const neighborId=this.edgeInfo?this.edgeInfo()[report.edge]?.stationId||'':report.neighborId;
    report.neighborId=neighborId;
    return neighborId&&(context.lines||[]).find(l=>l.direction==='out'&&l.state==='reserved'&&l.trainNumber===report.number&&l.neighborId===neighborId);
  }
  async tick(meet,tracking) {
    this.observe(meet,tracking);
    if(this.busy||!this.available()||!meet?.paired||meet.stale||!meet.context)return;
    const report=[...this.reports.values()].find(r=>r.status==='pending'&&r.retryAt<=this.now());
    if(!report)return;
    report.retryAt=this.now()+5000;
    if(!this.line(meet.context,report)){
      report.reason=report.neighborId?'Avgång ej anmäld: klarering mot rätt grannstation saknas.':'Avgång ej anmäld: koppla utfarten till rätt TrainMeet-station under Orter.';
      return;
    }
    const identity=this.identity;
    const guard=()=>{
      if(!this.available()||identity!==this.identity||!this.line(this.currentContext(),report))throw Object.assign(Error('Avgångens underlag har ändrats. Kontrollera klareringen.'),{status:409});
    };
    this.busy=true;
    try {
      const answer=await this.movement({sessionId:meet.sessionId,revision:meet.revision,meetGeneration:meet.context.meetGeneration??null,movementId:report.movementId,departure:'departed'},{guard});
      if(identity!==this.identity)return;
      if(scope(answer)!==identity||answer.stale||answer.context?.movements.find(m=>m.id===report.movementId)?.departure!=='departed')throw Error('TrainMeet har inte bekräftat avgången.');
      report.status='confirmed';report.reason='';
      this.log('traffic-departures',`Tåg ${report.number}: verifierad avgång återrapporterad till TrainMeet.`);
    } catch(error) {
      if(identity!==this.identity)return;
      const reason='Avgång ej anmäld: '+error.message;
      if(report.reason!==reason)this.log('traffic-departures',`Tåg ${report.number}: ${reason}`);
      report.reason=reason;
    } finally {this.busy=false;}
  }
  view(){return [...this.reports.values()].map(({movementId,number,observedAt,status,reason})=>({movementId,number,observedAt,status,reason}));}
}
