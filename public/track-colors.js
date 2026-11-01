// Färgprioritet är en visningsregel, aldrig ett medgivande att köra.
export function trackColorState({occupied=false,blocked=false,local=false,locked=false}={}){
  return occupied?'occupied':blocked?'blocked':local?'local':locked?'locked':'free';
}
