class RelayService {
  constructor({ baseUrl = null, fetcher = fetch, attempts = 3, timeoutMs = 3000, logger = () => {} } = {}) { Object.assign(this,{baseUrl,fetcher,attempts,timeoutMs,logger}); }
  async set(table,state) {
    table.relayDesiredState=state;
    if(!this.baseUrl){table.relayPending=false;this.logger("INFO","RELAY_NOT_CONFIGURED",{relay:table.relay,desiredState:state});return {connected:false,desiredState:state,actualState:table.relayActualState||null};}
    let lastError;
    for(let attempt=1;attempt<=this.attempts;attempt+=1)try{
      const response=await this.fetcher(`${this.baseUrl.replace(/\/$/,"")}/relay/${table.relay}?state=${state}`,{signal:AbortSignal.timeout(this.timeoutMs)});
      if(!response.ok)throw new Error(`Relay HTTP ${response.status}`);
      table.relayActualState=state;table.relayState=state;table.relayPending=false;
      this.logger("INFO","RELAY_COMMAND_SUCCEEDED",{relay:table.relay,desiredState:state,actualState:state,attempts:attempt});return {connected:true,attempts:attempt,desiredState:state,actualState:state};
    }catch(error){lastError=error;}
    table.relayPending=true;
    this.logger("ERROR","RELAY_COMMAND_FAILED",{relay:table.relay,desiredState:state,actualState:table.relayActualState||null,attempts:this.attempts,errorCode:lastError?.code||"RELAY_OFFLINE"});return {connected:false,failed:true,attempts:this.attempts,desiredState:state,actualState:table.relayActualState||null,error:lastError?.message};
  }
}
module.exports={RelayService};
